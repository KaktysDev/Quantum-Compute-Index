import { BackendUnavailableError, buildAlternatives, type UnavailabilityReason } from "./availability";
import { BACKENDS, getBackend } from "./catalog";
import { PricingError, providerPrice, softwareFees, totalPrice } from "./pricing";
import type { Backend, CircuitAnalysis, Quote, RouteCandidate, RouteDecision, RoutingConstraints, RoutingMode } from "./types";

export interface RouteInput {
  backends?: Backend[];
  analysis: CircuitAnalysis;
  shots: number;
  target: string;
  mode: RoutingMode;
  constraints?: RoutingConstraints;
  failover?: { enabled: boolean; max_attempts: number };
  /** Per-target compiled analyses, populated before the final routing decision. */
  compiledAnalyses?: Record<string, CircuitAnalysis>;
  qciSnapshotId?: number | null;
  qciTimestamp?: string;
}

function weights(mode: RoutingMode) {
  if (mode === "cost") return { cost: 0.7, speed: 0.15, quality: 0.1, reliability: 0.05 };
  if (mode === "speed") return { cost: 0.15, speed: 0.65, quality: 0.1, reliability: 0.1 };
  if (mode === "quality") return { cost: 0.1, speed: 0.1, quality: 0.65, reliability: 0.15 };
  return { cost: 0.35, speed: 0.25, quality: 0.25, reliability: 0.15 };
}

export function routeCircuit(input: RouteInput): RouteDecision {
  const constraints = input.constraints ?? {};
  const backends = input.backends ?? BACKENDS;
  const pinned = input.target === "auto" ? undefined : backends.find((b) => b.id === input.target);
  if (input.target !== "auto" && !pinned) throw new Error(`Unknown backend: ${input.target}`);
  // Existing pinned targets and kind constraints remain explicit intent. An
  // unconstrained automatic route starts with simulation; it cannot spend on a QPU.
  const executionIntent = constraints.executionIntent ?? (constraints.kind === "qpu" || pinned?.kind === "qpu" ? "hardware" : "simulate");
  const kind = executionIntent === "hardware" ? "qpu" : "simulator";
  const attempts = input.failover?.enabled ? Math.max(1, Math.min(5, input.failover.max_attempts)) : 1;
  const candidateReasons = new Map<string, UnavailabilityReason[]>();
  const candidates: RouteCandidate[] = backends.map((backend) => {
    const analysis = input.compiledAnalyses?.[backend.id] ?? input.analysis;
    const price = providerPrice(backend, input.shots);
    const total = price.cost == null ? null : totalPrice(analysis, price.cost * attempts);
    const reasons: UnavailabilityReason[] = [];
    if (!backend.available) reasons.push(backend.capabilityNote
      ? { code: "capability_mismatch", message: backend.capabilityNote }
      : { code: "credentials_missing", message: `the ${backend.provider} provider connection is not configured on this deployment` });
    if (backend.status === "offline") reasons.push({ code: "offline", message: "backend is offline" });
    if (analysis.qubits > backend.qubits) reasons.push({ code: "insufficient_qubits", message: `requires ${analysis.qubits} qubits; backend has ${backend.qubits}` });
    if (backend.kind !== kind || (constraints.kind && backend.kind !== constraints.kind)) reasons.push({ code: "kind_constraint", message: `execution intent requires ${kind}` });
    if (constraints.providers?.length && !constraints.providers.includes(backend.provider)) reasons.push({ code: "provider_not_allowed", message: "provider is not allowed" });
    if (constraints.excludeProviders?.includes(backend.provider)) reasons.push({ code: "provider_excluded", message: "provider is excluded" });
    if (constraints.maxQueueSeconds != null && backend.queueSeconds > constraints.maxQueueSeconds) reasons.push({ code: "queue_limit", message: "queue exceeds limit" });
    if (constraints.minFidelity != null && backend.fidelity < constraints.minFidelity) reasons.push({ code: "fidelity_limit", message: "fidelity is below limit" });
    if (price.error) reasons.push({ code: "pricing_unknown", message: price.error });
    if (constraints.maxCost != null && total != null && total > constraints.maxCost + 1e-9) reasons.push({ code: "cost_limit", message: "total reservation including software fees and retry budget exceeds limit" });
    candidateReasons.set(backend.id, reasons);
    return {
      backend, compatible: reasons.length === 0, rejectionReasons: reasons.map((r) => r.message), score: 0,
      estimatedProviderCost: price.cost, estimatedTotalCost: total, estimatedNqh: 0,
      pricingEvidence: price.evidence, compiled: Boolean(input.compiledAnalyses?.[backend.id]),
    };
  });
  const pool = input.target === "auto" ? candidates : candidates.filter((c) => c.backend.id === input.target);
  const runnable = pool.filter((c) => c.compatible);
  if (!runnable.length) {
    if (pinned) {
      const requested = pool[0];
      throw new BackendUnavailableError(pinned, candidateReasons.get(pinned.id)?.[0] ?? { code: "capability_mismatch", message: "The target does not satisfy the request." }, buildAlternatives(pinned, requested.estimatedProviderCost, candidates));
    }
    throw new PricingError(`No backend can run this workload. ${pool.map((c) => `${c.backend.id}: ${c.rejectionReasons.join(", ")}`).join("; ")}`, pool.some((c) => c.rejectionReasons.some((reason) => /total reservation/.test(reason))) ? "budget_exceeded" : "pricing_unavailable");
  }
  const maxCost = Math.max(1e-6, ...runnable.map((c) => c.estimatedTotalCost ?? 0));
  const maxQueue = Math.max(1, ...runnable.map((c) => c.backend.queueSeconds));
  const w = weights(input.mode);
  for (const candidate of pool) {
    if (!candidate.compatible) continue;
    candidate.score = (1 - candidate.estimatedTotalCost! / maxCost) * w.cost
      + (1 - candidate.backend.queueSeconds / maxQueue) * w.speed
      + candidate.backend.fidelity * w.quality + candidate.backend.reliability * w.reliability;
    candidate.paretoOptimal = !runnable.some((other) => other !== candidate
      && other.estimatedTotalCost! <= candidate.estimatedTotalCost!
      && other.backend.queueSeconds <= candidate.backend.queueSeconds
      && other.backend.fidelity >= candidate.backend.fidelity
      && (other.estimatedTotalCost! < candidate.estimatedTotalCost! || other.backend.queueSeconds < candidate.backend.queueSeconds || other.backend.fidelity > candidate.backend.fidelity));
  }
  pool.sort((a, b) => Number(b.compatible) - Number(a.compatible) || b.score - a.score || a.backend.id.localeCompare(b.backend.id));
  const selected = pool.find((c) => c.compatible)!;
  return {
    selected: selected.backend, candidates: pool, mode: input.mode, executionIntent,
    acceptedBudget: constraints.maxCost ?? selected.estimatedTotalCost ?? undefined, maxAttempts: attempts,
    providerBudget: selected.estimatedProviderCost! * attempts, reservedTotal: selected.estimatedTotalCost ?? undefined, pricingVersion: "native-v2",
    explanation: [
      `${selected.backend.displayName} satisfies the ${executionIntent} intent and stated constraints.`,
      `Native provider rate; total reservation includes software fees and up to ${attempts} attempt(s).`,
      "Quality and queue scores use catalog observations; they do not predict this workload's result accuracy or guarantee completion time.",
    ],
  };
}

export function buildQuote(decision: RouteDecision, analysis: CircuitAnalysis, shots: number): Quote {
  const candidate = decision.candidates.find((c) => c.backend.id === decision.selected.id);
  if (!candidate?.compatible || decision.pricingVersion !== "native-v2") throw new PricingError("A fresh native-rate routing decision is required before reserving funds.", "requote_required");
  const priced = providerPrice(candidate.backend, shots);
  if (priced.error || priced.cost == null) throw new PricingError(priced.error ?? "Native pricing is unknown.");
  const attempts = decision.maxAttempts ?? 1;
  const providerBudget = priced.cost * attempts;
  const fees = softwareFees(analysis, providerBudget);
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  const total = round(providerBudget + fees.transpilerFee + fees.platformFee);
  if (decision.acceptedBudget != null && total > decision.acceptedBudget + 1e-6) throw new PricingError("Compiled total reservation exceeds the accepted budget.", "budget_exceeded");
  return {
    providerCost: round(providerBudget), transpilerFee: round(fees.transpilerFee), platformFee: round(fees.platformFee), total,
    currency: "usd", expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    rateSnapshot: { backend: decision.selected.id, shots, pricingMethod: "native-v2", nativePricing: priced.evidence,
      estimatedAttemptCost: round(priced.cost), maximumAttempts: attempts, providerBudget: round(providerBudget),
      acceptedBudget: decision.acceptedBudget, estimateOnly: true, settlement: "actual usage when reported; estimates remain labelled" },
  };
}

export function backendFor(id: string) {
  const backend = getBackend(id);
  if (!backend) throw new Error(`Unknown backend: ${id}`);
  return backend;
}
