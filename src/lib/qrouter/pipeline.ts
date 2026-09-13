import { BackendUnavailableError, buildAlternatives } from "./availability";
import { mapWithConcurrency } from "./concurrency";
import {
  applySatisfaction,
  buildExecutionEnvelope,
  cachedTranspile,
  cacheKey,
  compileTargets,
  encodeBundles,
  encodingTrace,
  liveStages,
  profileBackend,
  quoteBindingLabel,
  verificationLabel,
  workloadLabel,
} from "./encoding";
import { EncodingError } from "./encoding/types";
import { resolveProviderTarget } from "./providerTargets";
import { buildQuote, routeCircuit } from "./route";
import { analysisFromTranspilation, transpileForBackend } from "./transpiler";
import type { Backend, CircuitAnalysis, InputFormat, RoutingConstraints, RoutingMode, TranspilationResult } from "./types";

const COMPILE_CONCURRENCY = () => Math.max(1, Number(process.env.QROUTER_COMPILE_CONCURRENCY ?? 3));

export async function prepareExecution(input: {
  backends: Backend[];
  analysis: CircuitAnalysis;
  shots: number;
  target: string;
  mode: RoutingMode;
  constraints?: RoutingConstraints;
  qciSnapshotId?: number | null;
  qciTimestamp?: string;
  optimizationLevel?: number;
  source?: string;
  format?: InputFormat;
  failover?: { enabled: boolean; max_attempts: number };
}) {
  const source = input.source ?? input.analysis.normalizedQasm2;
  const format = input.format ?? "openqasm2";
  const envelope = buildExecutionEnvelope({
    source,
    format,
    shots: input.shots,
    routing_mode: input.mode,
    constraints: input.constraints,
    failover: input.failover,
  });

  const initialDecision = routeCircuit(input);
  const scored = {
    ...initialDecision,
    candidates: applySatisfaction(initialDecision.candidates, envelope),
  };
  const runnable = scored.candidates.filter((candidate) => candidate.compatible);
  if (!runnable.length) {
    if (input.target !== "auto") {
      const requested = scored.candidates[0];
      throw new BackendUnavailableError(
        requested.backend,
        { code: "capability_mismatch", message: requested.rejectionReasons[0] ?? "capability mismatch" },
        buildAlternatives(requested.backend, requested.estimatedProviderCost, scored.candidates),
      );
    }
    throw new Error(`No backend can run this workload. ${scored.candidates.map((item) => `${item.backend.id}: ${item.rejectionReasons.join(", ")}`).join("; ")}`);
  }
  const selected = runnable[0];
  const decisionBase = { ...scored, selected: selected.backend };

  const targets = compileTargets(decisionBase.candidates);
  const eager = targets.filter((item) => item.quoteBinding === "binding");
  const compiled: Array<{ backend: Backend; transpilation: TranspilationResult; quoteBinding: "binding" | "indicative" }> = [];
  const optimizationLevel = input.optimizationLevel ?? 2;

  const outcomes = await mapWithConcurrency(eager, COMPILE_CONCURRENCY(), async (target) => {
    try {
      const compilationTarget = await resolveProviderTarget(target.backend);
      const profile = profileBackend(compilationTarget);
      const transpilation = await cachedTranspile(
        cacheKey(
          envelope.provenance.source_sha256,
          compilationTarget.id,
          profile.fingerprint,
          optimizationLevel,
          42,
          compilationTarget.id === selected.backend.id,
        ),
        // Failover eager-compiles are quote traces only (depth/gates). Dispatch
        // never submits those artifacts: it recompiles the chosen failover
        // with verifyEquivalence: true and encodes a matching bundle.
        () => transpileForBackend(compilationTarget, input.analysis, {
          optimizationLevel,
          seedTranspiler: 42,
          verifyEquivalence: target.backend.id === selected.backend.id,
        }),
      );
      return { ok: true as const, target, transpilation };
    } catch (error) {
      return { ok: false as const, target, error };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.ok) {
      compiled.push({ backend: outcome.target.backend, transpilation: outcome.transpilation, quoteBinding: outcome.target.quoteBinding });
      continue;
    }
    if (outcome.target.backend.id === selected.backend.id && outcome.target.backend.kind === "qpu") throw outcome.error;
    const message = outcome.error instanceof Error ? outcome.error.message : "compile failed";
    const index = decisionBase.candidates.findIndex((candidate) => candidate.backend.id === outcome.target.backend.id);
    if (index >= 0) {
      decisionBase.candidates[index] = {
        ...decisionBase.candidates[index],
        compatible: false,
        score: 0,
        compiled: false,
        rejectionReasons: [...decisionBase.candidates[index].rejectionReasons, message],
      };
    }
  }

  if (!compiled.length) {
    const compilationTarget = await resolveProviderTarget(selected.backend);
    const profile = profileBackend(compilationTarget);
    const transpilation = await cachedTranspile(
      cacheKey(envelope.provenance.source_sha256, compilationTarget.id, profile.fingerprint, optimizationLevel, 42, true),
      () => transpileForBackend(compilationTarget, input.analysis, {
        optimizationLevel,
        seedTranspiler: 42,
        verifyEquivalence: true,
      }),
    );
    compiled.push({ backend: selected.backend, transpilation, quoteBinding: "binding" });
  }

  let primary = compiled.find((item) => item.backend.id === selected.backend.id) ?? compiled[0];
  // Selected compile can fail on a simulator without aborting the quote. The
  // promoted failover was compiled with verifyEquivalence: false. Recompile it
  // before it becomes the execution artifact.
  if (primary.backend.id !== selected.backend.id) {
    const compilationTarget = await resolveProviderTarget(primary.backend);
    const profile = profileBackend(compilationTarget);
    const transpilation = await cachedTranspile(
      cacheKey(envelope.provenance.source_sha256, compilationTarget.id, profile.fingerprint, optimizationLevel, 42, true),
      () => transpileForBackend(compilationTarget, input.analysis, {
        optimizationLevel,
        seedTranspiler: 42,
        verifyEquivalence: true,
      }),
    );
    primary = { ...primary, transpilation };
    const index = compiled.findIndex((item) => item.backend.id === primary.backend.id);
    if (index >= 0) compiled[index] = primary;
  }
  const executionAnalysis = analysisFromTranspilation(primary.transpilation);
  const compiledPricing = routeCircuit({
    ...input,
    analysis: executionAnalysis,
    target: primary.backend.id,
  });
  const pricedCandidate = compiledPricing.candidates[0];

  let bundles;
  try {
    bundles = encodeBundles({ envelope, analysis: executionAnalysis, compiled });
  } catch (error) {
    if (error instanceof EncodingError) throw error;
    throw error;
  }

  const candidates = decisionBase.candidates.map((candidate) => {
    const compiledHit = compiled.find((item) => item.backend.id === candidate.backend.id);
    const priced = candidate.backend.id === pricedCandidate.backend.id;
    return {
      ...candidate,
      compiled: Boolean(compiledHit),
      quoteBinding: compiledHit?.quoteBinding,
      estimatedProviderCost: priced ? pricedCandidate.estimatedProviderCost : candidate.estimatedProviderCost,
      estimatedNqh: priced ? pricedCandidate.estimatedNqh : candidate.estimatedNqh,
    };
  });

  const stages = liveStages({
    analyzed: true,
    scored: true,
    compiled: true,
    routed: true,
    details: {
      analyze: `${workloadLabel(envelope.workload.kind)} · ${envelope.requirements.qubits} qubits · ${envelope.requirements.instructions.length} ops`,
      score: `${candidates.filter((item) => item.compatible).length} of ${candidates.length} backends can run this`,
      transpile: `Depth ${primary.transpilation.before.depth} → ${primary.transpilation.after.depth} · ${primary.transpilation.before.gates} → ${primary.transpilation.after.gates} gates`,
      route: `${primary.backend.displayName} · ${quoteBindingLabel(primary.quoteBinding).toLowerCase()}`,
      execute: "waiting to run",
    },
  });

  const encoding = encodingTrace({
    envelope,
    bundles,
    selectedBackendId: primary.backend.id,
    stages,
  });

  const decision = {
    ...decisionBase,
    selected: primary.backend,
    candidates,
    encoding,
    explanation: [
      ...decisionBase.explanation,
      `Compiled for ${primary.backend.displayName}: depth ${primary.transpilation.before.depth} → ${primary.transpilation.after.depth}, gates ${primary.transpilation.before.gates} → ${primary.transpilation.after.gates}.`,
      `${verificationLabel((bundles.find((bundle) => bundle.backend_id === primary.backend.id) ?? bundles[0])?.verification.status)} · ${quoteBindingLabel(primary.quoteBinding).toLowerCase()} to the compiled circuit.`,
    ],
  };

  return {
    decision,
    quote: buildQuote(decision, executionAnalysis, input.shots),
    transpilation: primary.transpilation,
    executionAnalysis,
    envelope,
    bundles,
    encoding,
  };
}
