import type { RouteCandidate, RouteDecision } from "./types";

export const JOB_LEASE_SECONDS = 120;

export function retryDelaySeconds(failedAttempt: number) {
  return Math.min(300, 5 * 2 ** Math.max(0, failedAttempt - 1));
}

function quotedProviderCost(decision: RouteDecision) {
  return decision.candidates.find((candidate) => candidate.backend.id === decision.selected.id)?.estimatedProviderCost;
}

/**
 * Picks a backend without exceeding the provider cost accepted in the original quote.
 * Each backend is tried at most once so a provider outage cannot consume the retry budget.
 */
export function nextAttemptCandidate(input: {
  decision: RouteDecision;
  attemptedBackendIds: string[];
  failoverEnabled: boolean;
  maxAttempts: number;
}): RouteCandidate | null {
  if (input.attemptedBackendIds.length >= input.maxAttempts) return null;

  const costCeiling = quotedProviderCost(input.decision);
  const eligible = input.decision.candidates.filter((candidate) =>
    candidate.compatible
    && !input.attemptedBackendIds.includes(candidate.backend.id)
    && (costCeiling == null || candidate.estimatedProviderCost <= costCeiling + 0.000001),
  );

  if (input.attemptedBackendIds.length === 0) {
    return eligible.find((candidate) => candidate.backend.id === input.decision.selected.id) ?? null;
  }
  return input.failoverEnabled ? eligible[0] ?? null : null;
}

export function orchestrationError(error: unknown, fallback = "Provider execution failed.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
