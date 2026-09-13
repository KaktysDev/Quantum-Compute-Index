/**
 * Encoding compose path used by prepareExecution (§5.1, Phase 5).
 * Prune with satisfies → compile primary + K failover → encode exact bundles.
 */

import { createHash } from "crypto";
import type { Backend, CircuitAnalysis, InputFormat, RoutingConstraints, RoutingMode, TranspilationResult } from "../types";
import type { RouteCandidate } from "../types";
import { encodeForBackend, profileBackend } from "./adapters";
import { buildEnvelope } from "./bundle";
import { lruGet, lruSet } from "./cache";
import { workloadFromSource } from "./frontend";
import { jcs } from "./jcs";
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
const COMPILE_CACHE_MAX = 128;
const ENVELOPE_CACHE_MAX = 32;

const compileCache = new Map<string, TranspilationResult>();
const compileInflight = new Map<string, Promise<TranspilationResult>>();
const envelopeCache = new Map<string, ExecutionEnvelope>();

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
  const key = [
    createHash("sha256").update(input.source).digest("hex"),
    input.format,
    input.shots,
    input.routing_mode,
    jcs(input.constraints ?? {}),
    jcs(input.failover ?? {}),
  ].join(":");
  const hit = lruGet(envelopeCache, key);
  if (hit) return hit;
  return lruSet(envelopeCache, key, buildEnvelope({
    workload: workloadFromSource(input.source, input.format, input.shots),
    source: input.source,
    routing_mode: input.routing_mode,
    constraints: input.constraints,
    failover: input.failover,
  }), ENVELOPE_CACHE_MAX);
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
export function cacheKey(
  sourceSha: string,
  backendId: string,
  fingerprint: string,
  optimizationLevel: number,
  seed: number,
  verifyEquivalence = true,
) {
  return createHash("sha256").update([
    sourceSha,
    backendId,
    fingerprint,
    String(optimizationLevel),
    String(seed),
    verifyEquivalence ? "v" : "nv",
  ].join("\0")).digest("hex");
}

export function cachedTranspile(key: string, compute: () => Promise<TranspilationResult>): Promise<TranspilationResult> {
  const hit = lruGet(compileCache, key);
  if (hit) return Promise.resolve(hit);
  const pending = compileInflight.get(key);
  if (pending) return pending;
  const work = compute().then((result) => {
    lruSet(compileCache, key, result, COMPILE_CACHE_MAX);
    compileInflight.delete(key);
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

export function selectedBundleView(bundle: ExecutionBundle): NonNullable<EncodingTrace["selected_bundle"]> {
  return {
    id: bundle.id,
    backend_id: bundle.backend_id,
    media_type: bundle.media_type,
    payload: bundle.payload,
    bit_order: bundle.decode_map.bit_order,
    verification: bundle.verification.status,
    quote_binding: bundle.quote_binding,
    metrics: bundle.metrics,
    decode_map: bundle.decode_map,
  };
}

/**
 * The quote-time `selected_bundle` is the primary only. Failover must not
 * inherit that payload or decode map — IBM QPY / IonQ JSON are backend-specific
 * and bit-order differs across adapters.
 */
export function selectedBundleForBackend(
  encoding: EncodingTrace | undefined,
  backendId: string,
): EncodingTrace["selected_bundle"] | undefined {
  const bundle = encoding?.selected_bundle;
  if (!bundle?.backend_id || bundle.backend_id !== backendId) return undefined;
  return bundle;
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
    selected_bundle: selected ? selectedBundleView(selected) : undefined,
    compiled: input.bundles.map((bundle) => ({
      backend_id: bundle.backend_id,
      bundle_id: bundle.id,
      quote_binding: bundle.quote_binding,
      verification: bundle.verification.status,
    })),
  };
}

export function resetComposeCaches() {
  compileCache.clear();
  compileInflight.clear();
  envelopeCache.clear();
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
