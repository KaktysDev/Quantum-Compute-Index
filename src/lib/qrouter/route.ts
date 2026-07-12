import { BACKENDS, getBackend } from "./catalog";
import type { Backend, CircuitAnalysis, Quote, RouteCandidate, RouteDecision, RoutingConstraints, RoutingMode } from "./types";

function estimatedNqh(analysis: CircuitAnalysis, shots: number) {
  const weightedOps = analysis.gates + analysis.twoQubitGates * 4 + analysis.qubits;
  return Math.round((weightedOps * shots / 1_000_000) * 1_000_000) / 1_000_000;
}

function providerCost(backend: Backend, analysis: CircuitAnalysis, shots: number) {
  const complexityMultiplier = 1 + analysis.twoQubitGates / Math.max(10, analysis.gates);
  if (backend.pricePerNqh != null) return backend.pricePerTask + backend.pricePerNqh * estimatedNqh(analysis, shots);
  return backend.pricePerTask + backend.pricePerShot * shots * complexityMultiplier;
}

function compatibility(backend: Backend, analysis: CircuitAnalysis, constraints: RoutingConstraints, shots: number) {
  const reasons: string[] = [];
  const cost = providerCost(backend, analysis, shots);
  if (!backend.available) reasons.push("provider connection is not configured");
  if (backend.status === "offline") reasons.push("backend is offline");
  if (analysis.qubits > backend.qubits) reasons.push(`requires ${analysis.qubits} qubits; backend has ${backend.qubits}`);
  if (constraints.kind && backend.kind !== constraints.kind) reasons.push(`requires a ${constraints.kind}`);
  if (constraints.providers?.length && !constraints.providers.includes(backend.provider)) reasons.push("provider is not allowed");
  if (constraints.excludeProviders?.includes(backend.provider)) reasons.push("provider is excluded");
  if (constraints.maxQueueSeconds != null && backend.queueSeconds > constraints.maxQueueSeconds) reasons.push("queue exceeds limit");
  if (constraints.minFidelity != null && backend.fidelity < constraints.minFidelity) reasons.push("fidelity is below limit");
  if (constraints.maxCost != null && cost > constraints.maxCost) reasons.push("estimated cost exceeds limit");
  return { reasons, cost };
}

function weights(mode: RoutingMode) {
  if (mode === "cost") return { cost: 0.7, speed: 0.15, quality: 0.1, reliability: 0.05 };
  if (mode === "speed") return { cost: 0.15, speed: 0.65, quality: 0.1, reliability: 0.1 };
  if (mode === "quality") return { cost: 0.1, speed: 0.1, quality: 0.65, reliability: 0.15 };
  return { cost: 0.35, speed: 0.25, quality: 0.25, reliability: 0.15 };
}

export function routeCircuit(input: {
  backends?: Backend[];
  analysis: CircuitAnalysis;
  shots: number;
  target: string;
  mode: RoutingMode;
  constraints?: RoutingConstraints;
  qciSnapshotId?: number | null;
  qciTimestamp?: string;
}): RouteDecision {
  const constraints = input.constraints ?? {};
  const backends = input.backends ?? BACKENDS;
  const pool = input.target === "auto" ? backends : backends.filter((backend) => backend.id === input.target);
  if (!pool.length) throw new Error(`Unknown backend: ${input.target}`);
  const compatibleData = pool.map((backend) => ({ backend, ...compatibility(backend, input.analysis, constraints, input.shots) }));
  const valid = compatibleData.filter((item) => item.reasons.length === 0);
  if (!valid.length) {
    const summary = compatibleData.map((item) => `${item.backend.id}: ${item.reasons.join(", ")}`).join("; ");
    throw new Error(`No backend can run this workload. ${summary}`);
  }
  const maxCost = Math.max(...valid.map((item) => item.cost), 0.000001);
  const maxQueue = Math.max(...valid.map((item) => item.backend.queueSeconds), 1);
  const w = weights(input.mode);
  const candidates: RouteCandidate[] = compatibleData.map((item) => {
    const nqh = estimatedNqh(input.analysis, input.shots);
    const score = item.reasons.length ? 0 :
      (1 - item.cost / maxCost) * w.cost +
      (1 - item.backend.queueSeconds / maxQueue) * w.speed +
      item.backend.fidelity * w.quality + item.backend.reliability * w.reliability;
    return { backend: item.backend, compatible: item.reasons.length === 0, rejectionReasons: item.reasons, score, estimatedProviderCost: item.cost, estimatedNqh: nqh };
  }).sort((a, b) => b.score - a.score);
  const selected = candidates.find((candidate) => candidate.compatible)!;
  return {
    selected: selected.backend, candidates, mode: input.mode, qciSnapshotId: input.qciSnapshotId, qciTimestamp: input.qciTimestamp,
    explanation: [
      `${selected.backend.displayName} passed every workload constraint.`,
      `${input.mode[0].toUpperCase()}${input.mode.slice(1)} policy score: ${(selected.score * 100).toFixed(1)}.`,
      `Estimated queue ${Math.ceil(selected.backend.queueSeconds / 60)} min; fidelity ${(selected.backend.fidelity * 100).toFixed(2)}%.`,
    ],
  };
}

export function buildQuote(decision: RouteDecision, analysis: CircuitAnalysis, shots: number): Quote {
  const providerCostValue = decision.candidates.find((item) => item.backend.id === decision.selected.id)!.estimatedProviderCost;
  const transpilerFee = 0.01 + analysis.gates * 0.00002 + analysis.twoQubitGates * 0.00008;
  const platformFee = Math.max(0.005, providerCostValue * 0.08);
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return {
    providerCost: round(providerCostValue), transpilerFee: round(transpilerFee),
    platformFee: round(platformFee), total: round(providerCostValue + transpilerFee + platformFee),
    currency: "usd", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    rateSnapshot: {
      backend: decision.selected.id,
      queueSeconds: decision.selected.queueSeconds,
      pricePerShot: decision.selected.pricePerShot,
      pricePerTask: decision.selected.pricePerTask,
      pricePerNqh: decision.selected.pricePerNqh,
      shots,
      qciSnapshotId: decision.qciSnapshotId,
      qciTimestamp: decision.qciTimestamp,
      qciMethod: decision.selected.pricePerNqh != null ? "qci-nqh-v1" : "provider-rate-v1",
    },
  };
}

export function backendFor(id: string) {
  const backend = getBackend(id);
  if (!backend) throw new Error(`Unknown backend: ${id}`);
  return backend;
}
