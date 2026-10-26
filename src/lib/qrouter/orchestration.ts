import type { RouteCandidate, RouteDecision } from "./types";

export const JOB_LEASE_SECONDS = 120;
export function retryDelaySeconds(failedAttempt: number) {
  return Math.min(300, 5 * 2 ** Math.max(0, failedAttempt - 1));
}

export interface AttemptUsage {
  backendId: string;
  cost?: number | null;
  confirmed: boolean;
  /** A submission timeout can be billable even when no provider id came back. */
  ambiguous?: boolean;
}

/** Retry only compiled, accepted native-rate candidates within the cumulative reservation. */
export function nextAttemptCandidate(input: {
  decision: RouteDecision; attemptedBackendIds: string[]; failoverEnabled: boolean; maxAttempts: number;
  usage?: AttemptUsage[];
}): RouteCandidate | null {
  const { decision } = input;
  if (decision.pricingVersion !== "native-v2") return null;
  if (input.attemptedBackendIds.length >= Math.min(input.maxAttempts, decision.maxAttempts ?? 1)) return null;
  if (input.attemptedBackendIds.length && !input.failoverEnabled) return null;
  const primary = decision.candidates.find((c) => c.backend.id === decision.selected.id);
  if (!primary || primary.estimatedProviderCost == null) return null;
  let spent = 0;
  for (const backendId of input.attemptedBackendIds) {
    const previous = decision.candidates.find((c) => c.backend.id === backendId);
    const usage = input.usage?.find((u) => u.backendId === backendId);
    // Internal simulation has a deterministic tariff. External ambiguous or
    // unconfirmed costs cannot be treated as zero to authorize more spending.
    if (previous?.backend.provider !== "qci" && (!usage?.confirmed || usage.ambiguous || usage.cost == null)) return null;
    const cost = usage?.cost ?? previous?.estimatedProviderCost;
    if (cost == null || !Number.isFinite(cost) || cost < 0) return null;
    spent += cost;
  }
  const remaining = (decision.providerBudget ?? primary.estimatedProviderCost) - spent;
  const eligible = decision.candidates.filter((c) => c.compatible && c.compiled === true && c.quoteBinding === "binding"
    && !input.attemptedBackendIds.includes(c.backend.id)
    && c.estimatedProviderCost != null && c.estimatedProviderCost <= primary.estimatedProviderCost! + 1e-6
    && c.estimatedProviderCost <= remaining + 1e-6
    && c.estimatedTotalCost != null && c.estimatedTotalCost <= (decision.reservedTotal ?? decision.acceptedBudget ?? 0) + 1e-6
    && c.backend.kind === decision.selected.kind);
  return input.attemptedBackendIds.length === 0
    ? eligible.find((c) => c.backend.id === decision.selected.id) ?? null
    : eligible[0] ?? null;
}

export function orchestrationError(error: unknown, fallback = "Provider execution failed.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
