/**
 * Encoding compose path used by prepareExecution (§5.1, Phase 5).
 * Prune with satisfies → compile primary + K failover → encode exact bundles.
 */

import type { Backend, CircuitAnalysis, InputFormat, RoutingConstraints, RoutingMode, TranspilationResult } from "../types";
import type { RouteCandidate } from "../types";
import { encodeForBackend, profileBackend } from "./adapters";
import { buildEnvelope } from "./bundle";
import { workloadFromSource } from "./frontend";
import { satisfies } from "./satisfy";
import type {
  EncodingStage,
  EncodingTrace,
  ExecutionBundle,
  ExecutionEnvelope,
  QuoteBinding,
  SatisfactionFailure,
  WorkloadKind,
} from "./types";

const FAILOVER_K = () => Math.max(0, Number(process.env.QROUTER_FAILOVER_COMPILE_K ?? 2));

const compileCache = new Map<string, TranspilationResult>();
const compileInflight = new Map<string, Promise<TranspilationResult>>();

export function satisfactionFailures(backend: Backend, envelope: ExecutionEnvelope): SatisfactionFailure[] {
  const verdict = satisfies(envelope.requirements, profileBackend(backend));
  return verdict.ok ? [] : verdict.failures;
}

export function buildExecutionEnvelope(input: {
  source: string;
  format: InputFormat;
  shots: number;
  routing_mode: RoutingMode;
  constraints?: RoutingConstraints;
  failover?: { enabled: boolean; max_attempts: number };
}): ExecutionEnvelope {
  return buildEnvelope({
    workload: workloadFromSource(input.source, input.format, input.shots),
    source: input.source,
    routing_mode: input.routing_mode,
    constraints: input.constraints,
    failover: input.failover,
  });
}

export function applySatisfaction(candidates: RouteCandidate[], envelope: ExecutionEnvelope): RouteCandidate[] {
  return candidates.map((candidate) => {
    const failures = satisfactionFailures(candidate.backend, envelope);
    if (!failures.length) {
      return {
        ...candidate,
        satisfaction: { ok: true, notes: [`${candidate.backend.id} satisfies ${envelope.requirements.workload_kind}`] },
      };
    }
    return {
      ...candidate,
      compatible: false,
      score: 0,
      rejectionReasons: [...candidate.rejectionReasons, ...failures.map((failure) => failure.message)],
      satisfaction: { ok: false, failures },
    };
  }).sort((a, b) => b.score - a.score);
}

export function compileTargets(candidates: RouteCandidate[]): Array<{ backend: Backend; quoteBinding: QuoteBinding }> {
  const runnable = candidates.filter((candidate) => candidate.compatible);
  const k = FAILOVER_K();
  return runnable.map((candidate, index) => ({
    backend: candidate.backend,
    quoteBinding: index === 0 || index <= k ? "binding" : "indicative",
  }));
}

/** Content-addressed compile key — never the timestamped envelope document id. */
export function cacheKey(sourceSha: string, backendId: string, fingerprint: string, optimizationLevel: number, seed: number) {
  return `${sourceSha}:${backendId}:${fingerprint}:${optimizationLevel}:${seed}`;
}

export function cachedTranspile(key: string, compute: () => Promise<TranspilationResult>): Promise<TranspilationResult> {
  const hit = compileCache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = compileInflight.get(key);
  if (pending) return pending;
  const work = compute().then((result) => {
    compileCache.set(key, result);
    compileInflight.delete(key);
    if (compileCache.size > 128) {
      const first = compileCache.keys().next().value;
      if (first) compileCache.delete(first);
    }
    return result;
  }).catch((error) => {
    compileInflight.delete(key);
    throw error;
  });
  compileInflight.set(key, work);
  return work;
}

export function encodeBundles(input: {
  envelope: ExecutionEnvelope;
  analysis: CircuitAnalysis;
  compiled: Array<{ backend: Backend; transpilation: TranspilationResult; quoteBinding: QuoteBinding }>;
}): ExecutionBundle[] {
  return input.compiled.map((item) => encodeForBackend({
    envelope: input.envelope,
    backend: item.backend,
    analysis: input.analysis,
    transpilation: item.transpilation,
    quoteBinding: item.quoteBinding,
  }));
}

export function encodingTrace(input: {
  envelope: ExecutionEnvelope;
  bundles: ExecutionBundle[];
  selectedBackendId: string;
  stages: EncodingStage[];
}): EncodingTrace {
  const selected = input.bundles.find((bundle) => bundle.backend_id === input.selectedBackendId) ?? input.bundles[0];
  return {
    schema_version: input.envelope.schema_version,
    envelope_id: input.envelope.id,
    workload_kind: input.envelope.workload.kind as WorkloadKind,
    frontend: input.envelope.provenance.frontend,
    stages: input.stages,
    requirements: {
      qubits: input.envelope.requirements.qubits,
      clbits: input.envelope.requirements.clbits,
      instructions: input.envelope.requirements.instructions.map((item) => item.name),
      control_flow: input.envelope.requirements.classical.control_flow,
      mid_circuit_measurement: input.envelope.requirements.classical.mid_circuit_measurement,
      feedback: input.envelope.requirements.classical.feedback,
    },
    selected_bundle: selected ? {
      id: selected.id,
      backend_id: selected.backend_id,
      media_type: selected.media_type,
      payload: selected.payload,
      bit_order: selected.decode_map.bit_order,
      verification: selected.verification.status,
      quote_binding: selected.quote_binding,
      metrics: selected.metrics,
      decode_map: selected.decode_map,
    } : undefined,
    compiled: input.bundles.map((bundle) => ({
      backend_id: bundle.backend_id,
      bundle_id: bundle.id,
      quote_binding: bundle.quote_binding,
      verification: bundle.verification.status,
    })),
  };
}

export function stage(id: EncodingStage["id"], label: string, paper: string, status: EncodingStage["status"], detail: string): EncodingStage {
  return { id, label, paper, status, detail };
}

export function liveStages(input: {
  analyzed: boolean;
  scored: boolean;
  compiled: boolean;
  routed: boolean;
  executed?: boolean;
  failed?: EncodingStage["id"];
  details: Partial<Record<EncodingStage["id"], string>>;
}): EncodingStage[] {
  const order: Array<{ id: EncodingStage["id"]; label: string; paper: string; done: boolean }> = [
    { id: "analyze", label: "Analyze", paper: "ingest + envelope", done: input.analyzed },
    { id: "score", label: "Score", paper: "satisfies()", done: input.scored },
    { id: "transpile", label: "Transpile", paper: "compile fan-out + encode", done: input.compiled },
    { id: "route", label: "Route", paper: "quote & select", done: input.routed },
    { id: "execute", label: "Execute", paper: "submit + decode", done: Boolean(input.executed) },
  ];
  return order.map((item) => {
    if (input.failed === item.id) return stage(item.id, item.label, item.paper, "failed", input.details[item.id] ?? "failed");
    if (item.done) return stage(item.id, item.label, item.paper, "done", input.details[item.id] ?? "done");
    return stage(item.id, item.label, item.paper, "pending", input.details[item.id] ?? "");
  });
}

export { overlayExecute } from "./stages";
