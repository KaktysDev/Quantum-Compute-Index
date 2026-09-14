/**
 * Assemble a public report context from a stored job + normalized result.
 * The context is the only payload the AI, PDF, and follow-up chat may see.
 */

import { getBackend } from "@/lib/qrouter/catalog";
import { elapsedMs } from "@/lib/qrouter/duration";
import { jcsHash } from "@/lib/qrouter/encoding/jcs";
import { slimAnalysis, slimResult } from "@/lib/qrouter/encoding/public";
import { computeAnalytics } from "./analytics";
import { REPORT_SCHEMA, type JobReportContext, type ReportJobMeta, type ReportTranspile } from "./types";

const HASH_COUNTS_CAP = 64;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function quoteTotal(job: Record<string, unknown>): number | null {
  const embedded = Array.isArray(job.quotes) ? job.quotes[0] : job.quotes;
  const quote = asRecord(embedded) ?? asRecord(job.quote);
  return finiteNumber(quote?.total);
}

function decodeNotes(job: Record<string, unknown>) {
  const analysis = asRecord(job.analysis);
  const route = asRecord(job.route_decision);
  const encoding = asRecord(route?.encoding) ?? asRecord(analysis?.encoding);
  const bundle = asRecord(encoding?.selected_bundle);
  const decode = asRecord(bundle?.decode_map);
  const layout = asRecord(decode?.layout);
  const mapped = layout ? Object.keys(asRecord(layout.logical_to_physical) ?? {}).length : null;
  return {
    measurementMap: decode?.measurement_map,
    layoutMapped: mapped && mapped > 0 ? mapped : null,
  };
}

function transpileOf(job: Record<string, unknown>): ReportTranspile | null {
  const analysis = slimAnalysis(job.analysis);
  const row = asRecord(analysis);
  const transpilation = asRecord(row?.transpilation);
  if (!transpilation) return null;
  const before = asRecord(transpilation.before);
  const after = asRecord(transpilation.after);
  return {
    depthFrom: finiteNumber(before?.depth),
    depthTo: finiteNumber(after?.depth),
    gatesFrom: finiteNumber(before?.gates),
    gatesTo: finiteNumber(after?.gates),
    equivalent: typeof transpilation.equivalent === "boolean" ? transpilation.equivalent : null,
    verification: typeof transpilation.verificationStatus === "string" ? transpilation.verificationStatus : null,
  };
}

export function jobMetaFrom(job: Record<string, unknown>): ReportJobMeta {
  const analysis = asRecord(job.analysis);
  const backendId = typeof job.selected_backend_id === "string" ? job.selected_backend_id : "";
  const backend = backendId ? getBackend(backendId) : undefined;
  const createdAt = typeof job.created_at === "string" ? job.created_at : null;
  const startedAt = typeof job.started_at === "string" ? job.started_at : null;
  const completedAt = typeof job.completed_at === "string" ? job.completed_at : null;
  return {
    id: typeof job.id === "string" ? job.id : "",
    name: typeof job.name === "string" ? job.name : null,
    status: typeof job.status === "string" ? job.status : "unknown",
    backendId,
    backendName: backend?.displayName ?? backendId,
    backendKind: backend?.kind ?? null,
    shots: finiteNumber(job.shots),
    qubits: finiteNumber(analysis?.qubits),
    depth: finiteNumber(analysis?.depth),
    complexity: typeof analysis?.complexity === "string" ? analysis.complexity : null,
    createdAt,
    startedAt,
    completedAt,
    durationMs: createdAt ? elapsedMs({ created_at: createdAt, started_at: startedAt, completed_at: completedAt }) : null,
    cost: quoteTotal(job),
  };
}

export function resultHashOf(result: unknown, job: ReportJobMeta): string {
  const slim = slimResult(result ?? {});
  const row = asRecord(slim) ?? {};
  const counts = asRecord(row.counts);
  const probabilities = asRecord(row.probabilities);
  const metadata = asRecord(row.metadata);
  const countKeys = counts ? Object.keys(counts).sort().slice(0, HASH_COUNTS_CAP) : [];
  return jcsHash({
    jobId: job.id,
    status: job.status,
    backend: job.backendId,
    shots: job.shots,
    counts: countKeys.length && counts
      ? Object.fromEntries(countKeys.map((key) => [key, counts[key]]))
      : null,
    probabilities: probabilities ? Object.keys(probabilities).length : 0,
    fidelity: metadata?.fidelity ?? null,
    synthetic: metadata?.synthetic ?? null,
    completedAt: job.completedAt,
  });
}

export function buildReportContext(input: {
  job: Record<string, unknown>;
  result?: unknown;
  generatedAt?: string;
}): JobReportContext {
  const job = jobMetaFrom(input.job);
  const result = slimResult(input.result ?? asRecord(input.job.result) ?? {});
  const row = asRecord(result) ?? {};
  const decode = decodeNotes(input.job);
  const analytics = computeAnalytics({
    counts: row.counts,
    probabilities: row.probabilities,
    shots: row.shots,
    requestedShots: job.shots,
    metadata: row.metadata,
    measurementMap: decode.measurementMap,
    layoutMapped: decode.layoutMapped,
  });
  const hash = resultHashOf(result, job);
  return {
    schema: REPORT_SCHEMA,
    hash,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    job,
    analytics,
    transpile: transpileOf(input.job),
    narrative: null,
  };
}

/** Compact JSON the model is allowed to see — already slim, size-capped. */
export function aiPayloadFrom(context: JobReportContext): Record<string, unknown> {
  return {
    schema: context.schema,
    job: context.job,
    analytics: {
      ...context.analytics,
      histogram: context.analytics.histogram.slice(0, 16),
      top: context.analytics.top.slice(0, 12),
    },
    transpile: context.transpile,
  };
}
