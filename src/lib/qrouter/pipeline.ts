import { BackendUnavailableError, buildAlternatives } from "./availability";
import { mapWithConcurrency } from "./concurrency";
import {
  applySatisfaction, buildExecutionEnvelope, cachedTranspile, cacheKey, compileTargets,
  encodeBundles, encodingTrace, liveStages, profileBackend, quoteBindingLabel,
  verificationLabel, workloadLabel,
} from "./encoding";
import { resolveProviderTarget } from "./providerTargets";
import { buildQuote, routeCircuit } from "./route";
import { analysisFromTranspilation, transpileForBackend } from "./transpiler";
import type { Backend, CircuitAnalysis, InputFormat, RoutingConstraints, RoutingMode, TranspilationResult } from "./types";

const COMPILE_CONCURRENCY = () => Math.max(1, Number(process.env.QROUTER_COMPILE_CONCURRENCY ?? 3));

export async function prepareExecution(input: {
  backends: Backend[]; analysis: CircuitAnalysis; shots: number; target: string; mode: RoutingMode;
  constraints?: RoutingConstraints; qciSnapshotId?: number | null; qciTimestamp?: string;
  optimizationLevel?: number; source?: string; format?: InputFormat;
  failover?: { enabled: boolean; max_attempts: number };
}) {
  const source = input.source ?? input.analysis.normalizedQasm2;
  const format = input.format ?? "openqasm2";
  const envelope = buildExecutionEnvelope({ source, format, shots: input.shots, routing_mode: input.mode,
    constraints: input.constraints, failover: input.failover });
  // Cost ceilings are enforced after compilation, using each target's metrics.
  const initial = routeCircuit({ ...input, constraints: { ...input.constraints, maxCost: undefined } });
  const scored = applySatisfaction(initial.candidates, envelope);
  const runnable = scored.filter((candidate) => candidate.compatible);
  if (!runnable.length) {
    if (input.target !== "auto") {
      const requested = scored[0];
      throw new BackendUnavailableError(requested.backend,
        { code: "capability_mismatch", message: requested.rejectionReasons[0] ?? "capability mismatch" },
        buildAlternatives(requested.backend, requested.estimatedProviderCost, scored));
    }
    throw new Error(`No backend can run this workload. ${scored.map((c) => `${c.backend.id}: ${c.rejectionReasons.join(", ")}`).join("; ")}`);
  }
  const eager = compileTargets(scored).filter((target) => target.quoteBinding === "binding");
  const optimizationLevel = input.optimizationLevel ?? 2;
  const outcomes = await mapWithConcurrency(eager, COMPILE_CONCURRENCY(), async (target) => {
    try {
      const backend = await resolveProviderTarget(target.backend);
      const profile = profileBackend(backend);
      const transpilation = await cachedTranspile(
        cacheKey(envelope.provenance.source_sha256, backend.id, profile.fingerprint, optimizationLevel, 42, true),
        () => transpileForBackend(backend, input.analysis, { optimizationLevel, seedTranspiler: 42, verifyEquivalence: true }),
      );
      return { ok: true as const, backend, transpilation, quoteBinding: "binding" as const };
    } catch (error) {
      return { ok: false as const, backend: target.backend, error };
    }
  });
  const compiled: Array<{ backend: Backend; transpilation: TranspilationResult; quoteBinding: "binding" }> = [];
  for (const outcome of outcomes) if (outcome.ok) compiled.push(outcome);
  if (!compiled.length) throw new Error(`No backend compiled this workload. ${outcomes.filter((o) => !o.ok).map((o) => o.ok ? "" : `${o.backend.id}: ${o.error instanceof Error ? o.error.message : "compile failed"}`).join("; ")}`);
  const compiledAnalyses = Object.fromEntries(compiled.map((c) => [c.backend.id, analysisFromTranspilation(c.transpilation)]));
  const compiledDecision = routeCircuit({ ...input, backends: compiled.map((c) => c.backend), compiledAnalyses });
  const primary = compiled.find((c) => c.backend.id === compiledDecision.selected.id)!;
  const executionAnalysis = compiledAnalyses[primary.backend.id];
  const candidates = [
    ...compiledDecision.candidates.map((c) => ({ ...c, compiled: true, quoteBinding: "binding" as const })),
    ...scored.filter((c) => !compiled.some((item) => item.backend.id === c.backend.id)).map((c) => ({
      ...c, compatible: false, score: 0, compiled: false, quoteBinding: "indicative" as const,
      rejectionReasons: [...c.rejectionReasons, outcomes.some((o) => !o.ok && o.backend.id === c.backend.id) ? "Compilation failed for this target." : "Not compiled in this quote; request this target explicitly to evaluate it."],
    })),
  ];
  const eligibleCompiled = compiled.filter((c) => candidates.some((candidate) => candidate.backend.id === c.backend.id && candidate.compatible));
  const bundles = encodeBundles({ envelope, analysis: executionAnalysis, compiled: eligibleCompiled });
  const stages = liveStages({ analyzed: true, scored: true, compiled: true, routed: true,
    details: {
      analyze: `${workloadLabel(envelope.workload.kind)} · ${envelope.requirements.qubits} qubits · ${envelope.requirements.instructions.length} ops`,
      score: `${candidates.filter((c) => c.compatible).length} compiled candidates; ${candidates.filter((c) => c.paretoOptimal).length} on the cost/queue/catalog-quality frontier`,
      transpile: `Depth ${primary.transpilation.before.depth} → ${primary.transpilation.after.depth} · ${primary.transpilation.before.gates} → ${primary.transpilation.after.gates} gates`,
      route: `${primary.backend.displayName} · ${quoteBindingLabel(primary.quoteBinding).toLowerCase()}`,
      execute: "waiting to run",
    },
  });
  const encoding = encodingTrace({ envelope, bundles, selectedBackendId: primary.backend.id, stages });
  const decision = { ...compiledDecision, candidates, encoding, explanation: [
    ...compiledDecision.explanation,
    `Ranked ${eligibleCompiled.length} compiled candidates using target-specific metrics and native billing units.`,
    `${verificationLabel((bundles.find((b) => b.backend_id === primary.backend.id) ?? bundles[0])?.verification.status)}; compiled binding describes the artifact, while provider pricing remains an estimate.`,
  ] };
  return { decision, quote: buildQuote(decision, executionAnalysis, input.shots), transpilation: primary.transpilation, executionAnalysis, envelope, bundles, encoding };
}
