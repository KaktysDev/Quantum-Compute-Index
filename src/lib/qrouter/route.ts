import type { Backend, CircuitAnalysis, Quote, RouteCandidate, RouteDecision, RoutingConstraints, RoutingMode } from "./types";

function estimate(backend: Backend, analysis: CircuitAnalysis, shots: number) {
  const equivalentOps = analysis.gates + analysis.twoQubitGates * 4;
  const nqh = equivalentOps * shots / Math.max(backend.clops, 1) / 3600;
  return { nqh, cost: Math.max(backend.taskMinimum, nqh * backend.pricePerNqh) };
}
function weights(mode: RoutingMode) { return mode === "cost" ? [.7,.15,.1,.05] : mode === "speed" ? [.15,.65,.1,.1] : mode === "quality" ? [.1,.1,.65,.15] : [.35,.25,.25,.15]; }

export function routeCircuit(input: { backends: Backend[]; analysis: CircuitAnalysis; shots: number; target: string; mode: RoutingMode; constraints?: RoutingConstraints; qciSnapshotId?: number | null; qciTimestamp?: string }): RouteDecision {
  const pool = input.target === "auto" ? input.backends : input.backends.filter((item) => item.id === input.target);
  if (!pool.length) throw new Error(`Unknown backend: ${input.target}`);
  const constraints = input.constraints ?? {};
  const raw = pool.map((backend) => { const rejectionReasons: string[] = []; const price = estimate(backend, input.analysis, input.shots); if (!backend.available) rejectionReasons.push("provider connection is not configured"); if (backend.executionModel === "photonic") rejectionReasons.push("OpenQASM gate circuits cannot be compiled to this photonic execution model"); if (backend.status === "offline") rejectionReasons.push("backend is offline"); if (input.analysis.qubits > backend.qubits) rejectionReasons.push(`needs ${input.analysis.qubits} qubits; backend has ${backend.qubits}`); if (constraints.kind && backend.kind !== constraints.kind) rejectionReasons.push(`requires ${constraints.kind}`); if (constraints.providers?.length && !constraints.providers.includes(backend.provider)) rejectionReasons.push("provider is not allowed"); if (constraints.excludeProviders?.includes(backend.provider)) rejectionReasons.push("provider is excluded"); if (constraints.maxQueueSeconds != null && backend.queueSeconds > constraints.maxQueueSeconds) rejectionReasons.push("queue exceeds limit"); if (constraints.minFidelity != null && backend.fidelity < constraints.minFidelity) rejectionReasons.push("fidelity is below limit"); if (constraints.maxCost != null && price.cost > constraints.maxCost) rejectionReasons.push("cost exceeds limit"); return { backend, rejectionReasons, ...price }; });
  const valid = raw.filter((item) => !item.rejectionReasons.length); if (!valid.length) throw new Error(`No backend can run this workload. ${raw.map((item) => `${item.backend.id}: ${item.rejectionReasons.join(", ")}`).join("; ")}`);
  const maxCost = Math.max(...valid.map((item) => item.cost), .000001); const maxQueue = Math.max(...valid.map((item) => item.backend.queueSeconds), 1); const w = weights(input.mode);
  const candidates: RouteCandidate[] = raw.map((item) => ({ backend: item.backend, compatible: !item.rejectionReasons.length, rejectionReasons: item.rejectionReasons, score: item.rejectionReasons.length ? 0 : (1-item.cost/maxCost)*w[0] + (1-item.backend.queueSeconds/maxQueue)*w[1] + item.backend.fidelity*w[2] + item.backend.reliability*w[3], estimatedProviderCost: item.cost, estimatedNqh: item.nqh })).sort((a,b) => b.score-a.score);
  const selected = candidates.find((item) => item.compatible)!;
  return { selected: selected.backend, candidates, mode: input.mode, qciSnapshotId: input.qciSnapshotId ?? null, qciTimestamp: input.qciTimestamp ?? new Date().toISOString(), explanation: [`${selected.backend.displayName} passed every workload constraint.`, `${input.mode} policy score ${(selected.score*100).toFixed(1)}.`, `QCI rate $${selected.backend.pricePerNqh.toFixed(2)}/NQH; estimated queue ${Math.ceil(selected.backend.queueSeconds/60)} min.`] };
}

export function buildQuote(decision: RouteDecision, analysis: CircuitAnalysis, shots: number): Quote {
  const candidate = decision.candidates.find((item) => item.backend.id === decision.selected.id)!; const providerCost = candidate.estimatedProviderCost; const transpilerFee = .01 + analysis.gates*.00002 + analysis.twoQubitGates*.00008; const platformFee = Math.max(.005, providerCost*.08); const round = (n:number) => Math.round(n*1e6)/1e6;
  return { providerCost: round(providerCost), transpilerFee: round(transpilerFee), platformFee: round(platformFee), total: round(providerCost+transpilerFee+platformFee), currency: "usd", expiresAt: new Date(Date.now()+15*60_000).toISOString(), rateSnapshot: { qciSnapshotId: decision.qciSnapshotId, qciTimestamp: decision.qciTimestamp, backend: decision.selected.id, pricePerNqh: decision.selected.pricePerNqh, estimatedNqh: candidate.estimatedNqh, queueSeconds: decision.selected.queueSeconds, shots, formula: "max(taskMinimum, normalizedQuantumHours * qciRate) + transpiler + 8% platform" } };
}
