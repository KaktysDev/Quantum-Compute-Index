/**
 * Client-safe encoding views and the plain-language layer for the console.
 * Stored jobs still keep the hashed payload for the dispatcher; list/quote/UI
 * responses must not ship QASM or native programs in React state.
 */

import type { EncodingStage, EncodingTrace, VerificationStatus, WorkloadKind } from "./types";

const WORKLOAD_LABEL: Record<WorkloadKind, string> = {
  gate: "Gate circuit",
  dynamic: "Dynamic circuit",
  timed: "Timed circuit",
  analog: "Analog program",
  annealing: "Annealing problem",
  photonic: "Photonic program",
  primitive: "Primitive",
  estimation: "Estimation",
};

const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  proved: "Proved equivalent",
  checked: "Checked",
  provider_validated: "Provider validated",
  partial: "Partially checked",
  unsupported: "Not verified",
  failed: "Verification failed",
};

export function workloadLabel(kind: string | undefined): string {
  if (kind && kind in WORKLOAD_LABEL) return WORKLOAD_LABEL[kind as WorkloadKind];
  return kind ? kind.replaceAll("_", " ") : "Circuit";
}

export function verificationLabel(status: string | undefined): string {
  if (status && status in VERIFICATION_LABEL) return VERIFICATION_LABEL[status as VerificationStatus];
  return status ? status.replaceAll("_", " ") : "Not verified";
}

export function quoteBindingLabel(binding: string | undefined): string {
  if (binding === "binding") return "Price locked";
  if (binding === "indicative") return "Estimate";
  return "Quote";
}

export function bitOrderLabel(order: string | undefined): string {
  if (order === "q0_right") return "Qubit 0 on the right — QRouter standard";
  if (order === "q0_left") return "Qubit 0 on the left — provider order";
  return order ?? "—";
}

export function compileChange(
  before?: { depth: number; gates: number } | null,
  after?: { depth: number; gates: number } | null,
): { text: string; depth?: { from: number; to: number }; gates?: { from: number; to: number } } | null {
  if (before && after) {
    return {
      text: `Depth ${before.depth} → ${after.depth} · ${before.gates} → ${after.gates} gates`,
      depth: { from: before.depth, to: after.depth },
      gates: { from: before.gates, to: after.gates },
    };
  }
  if (after) return { text: `Compiled to depth ${after.depth} · ${after.gates} gates` };
  return null;
}

export function gateCount(metrics?: { ops?: Record<string, number>; two_qubit_ops?: number } | null): number | null {
  if (!metrics?.ops) return null;
  return Object.values(metrics.ops).reduce((sum, value) => sum + value, 0);
}

export type StoryCandidate = {
  backend: { id: string; displayName: string };
  compatible: boolean;
  score: number;
  rejectionReasons: string[];
};

export function whyRouted(input: {
  selectedId?: string;
  selectedName?: string;
  candidates?: StoryCandidate[];
  explanation?: string[];
}): string {
  const selected = input.candidates?.find((item) => item.backend.id === input.selectedId);
  const compatible = input.candidates?.filter((item) => item.compatible) ?? [];
  const name = input.selectedName ?? selected?.backend.displayName;
  if (!input.candidates?.length) {
    return input.explanation?.[0] ?? "The router has not scored backends yet.";
  }
  if (selected && !selected.compatible) {
    return `${name ?? "This backend"} cannot run this: ${selected.rejectionReasons[0] ?? "capability mismatch"}.`;
  }
  if (!name) return input.explanation?.[0] ?? "A backend has not been selected yet.";
  if (compatible.length <= 1) return `${name} is the only backend that can run this circuit.`;
  const runnerUp = compatible.find((item) => item.backend.id !== selected?.backend.id);
  const score = selected ? Math.round(selected.score * 100) : 0;
  if (runnerUp) {
    return `${name} scored ${score} vs ${runnerUp.backend.displayName} at ${Math.round(runnerUp.score * 100)} among ${compatible.length} that fit.`;
  }
  return `${name} scored ${score} among ${compatible.length} backends that can run this.`;
}

export function stageStory(
  id: EncodingStage["id"],
  fallback: string,
  ctx: {
    encoding?: EncodingTrace;
    transpilation?: { before: { depth: number; gates: number }; after: { depth: number; gates: number } };
    candidates?: StoryCandidate[];
    selectedName?: string;
  },
): string {
  if (id === "analyze" && ctx.encoding) {
    const ops = ctx.encoding.requirements.instructions.length;
    return `${workloadLabel(ctx.encoding.workload_kind)} · ${ctx.encoding.requirements.qubits} qubits · ${ops} ops`;
  }
  if (id === "transpile") {
    const after = ctx.transpilation?.after ?? (ctx.encoding?.selected_bundle
      ? { depth: ctx.encoding.selected_bundle.metrics.depth, gates: gateCount(ctx.encoding.selected_bundle.metrics) ?? ctx.encoding.selected_bundle.metrics.two_qubit_ops }
      : null);
    const change = compileChange(ctx.transpilation?.before, after);
    if (change) return change.text;
  }
  if (id === "score" && ctx.candidates?.length) {
    const ready = ctx.candidates.filter((item) => item.compatible).length;
    return `${ready} of ${ctx.candidates.length} backends can run this`;
  }
  if (id === "route" && ctx.selectedName) {
    const binding = ctx.encoding?.selected_bundle?.quote_binding;
    return binding ? `${ctx.selectedName} · ${quoteBindingLabel(binding).toLowerCase()}` : ctx.selectedName;
  }
  return fallback;
}

export function publicEncoding<T extends { selected_bundle?: { payload?: string } | undefined }>(trace: T): T {
  if (!trace.selected_bundle || trace.selected_bundle.payload == null) return trace;
  const { payload: _omit, ...bundle } = trace.selected_bundle;
  return { ...trace, selected_bundle: bundle as T["selected_bundle"] };
}

export function slimTranspilation<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  delete row.qasm;
  delete row.artifactQasm;
  delete row.providerProgram;
  return row as T;
}

export function slimAnalysis<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  delete row.normalizedQasm2;
  if (row.transpilation) row.transpilation = slimTranspilation(row.transpilation);
  if (row.encoding && typeof row.encoding === "object" && !Array.isArray(row.encoding)) {
    row.encoding = publicEncoding(row.encoding as EncodingTrace);
  }
  return row as T;
}

export function slimRouteDecision<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  if (row.encoding && typeof row.encoding === "object" && !Array.isArray(row.encoding)) {
    row.encoding = publicEncoding(row.encoding as EncodingTrace);
  }
  return row as T;
}

export function slimJobForClient<T extends Record<string, unknown>>(job: T): T {
  const next: Record<string, unknown> = { ...job };
  delete next.source;
  if (next.analysis) next.analysis = slimAnalysis(next.analysis);
  if (next.route_decision) next.route_decision = slimRouteDecision(next.route_decision);
  return next as T;
}
