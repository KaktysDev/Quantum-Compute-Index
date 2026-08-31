import type { Backend, RouteCandidate } from "./types";

/**
 * Why a backend was rejected for a workload. `compatibility` produces these
 * instead of bare strings so the API can explain the cause and suggest a fix
 * without re-parsing prose. The human `message` stays the wire format for
 * `RouteCandidate.rejectionReasons`, which the console already renders.
 */
export type UnavailabilityCode =
  | "credentials_missing"
  | "capability_mismatch"
  | "offline"
  | "insufficient_qubits"
  | "kind_constraint"
  | "provider_not_allowed"
  | "provider_excluded"
  | "queue_limit"
  | "fidelity_limit"
  | "cost_limit";

export interface UnavailabilityReason {
  code: UnavailabilityCode;
  message: string;
}

/**
 * The deployment-level configuration each provider needs before its adapter can
 * accept a job. Used to turn "provider connection is not configured" into an
 * instruction the operator can act on.
 */
const PROVIDER_CREDENTIALS: Record<string, string> = {
  qci: "VULTR_SIMULATOR_URL and VULTR_SIMULATOR_TOKEN",
  ibm: "IBM_QUANTUM_TOKEN",
  ionq: "IONQ_API_KEY, or AWS_ACCESS_KEY_ID and BRAKET_OUTPUT_BUCKET to reach it through Braket",
  "aws-braket": "AWS_ACCESS_KEY_ID and BRAKET_OUTPUT_BUCKET",
  xanadu: "XANADU_EXECUTION_URL and XANADU_API_KEY",
  quandela: "QUANDELA_EXECUTION_URL and QUANDELA_API_KEY",
  "quantum-inspire": "QI_API_KEY (and optionally QI_EXECUTION_URL for an approved execution bridge)",
};

export function resolutionFor(backend: Backend, reason: UnavailabilityReason): string {
  switch (reason.code) {
    case "credentials_missing": {
      const credentials = PROVIDER_CREDENTIALS[backend.provider];
      return credentials
        ? `Set ${credentials} on the deployment, then resubmit. Until then this backend cannot accept jobs.`
        : "Configure this provider's credentials on the deployment, then resubmit.";
    }
    case "capability_mismatch":
      return "This backend needs circuits in its own native input format; a gate-model circuit cannot be translated automatically. Route to a gate-model backend instead.";
    case "offline":
      return "Recent health checks failed twice in a row, so the backend is circuit-broken. It returns automatically once health checks pass; route elsewhere to run now.";
    case "insufficient_qubits":
      return "Reduce the circuit's qubit count or choose a backend with more qubits.";
    case "queue_limit":
      return "Raise constraints.max_queue_seconds or choose a backend with a shorter queue.";
    case "fidelity_limit":
      return "Lower constraints.min_fidelity or choose a higher-fidelity backend.";
    case "cost_limit":
      return "Raise constraints.max_cost or choose a cheaper backend.";
    case "kind_constraint":
    case "provider_not_allowed":
    case "provider_excluded":
      return "Relax the routing constraints, or target a backend that satisfies them.";
  }
}

function ratioPhrase(requested: number, alternative: number, cheaperWord: string, pricierWord: string) {
  if (requested <= 0 || alternative <= 0) return null;
  const ratio = alternative < requested ? requested / alternative : alternative / requested;
  if (ratio < 1.15) return null;
  const rounded = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  return `${rounded}x ${alternative < requested ? cheaperWord : pricierWord}`;
}

function queuePhrase(requestedSeconds: number, alternativeSeconds: number) {
  const label = (seconds: number) => (seconds < 60 ? "effectively none" : `about ${Math.round(seconds / 60)} min`);
  if (Math.abs(requestedSeconds - alternativeSeconds) < 60) return null;
  return `queue time ${label(alternativeSeconds)} versus ${label(requestedSeconds)}`;
}

/**
 * Plain-language deltas between the backend the caller asked for and one we can
 * actually run, so the choice between alternatives is legible rather than a
 * list of near-identical names.
 */
export function differencesFrom(requested: Backend, alternative: Backend, requestedCost: number, alternativeCost: number): string[] {
  const differences: string[] = [];

  if (requested.kind !== alternative.kind) {
    differences.push(alternative.kind === "simulator"
      ? "a simulator rather than physical quantum hardware, so results are noise-free unless you model noise"
      : "physical quantum hardware rather than a simulator");
  }
  if (requested.provider !== alternative.provider) {
    differences.push(`operated by ${alternative.provider} instead of ${requested.provider}`);
  }

  const cost = ratioPhrase(requestedCost, alternativeCost, "cheaper", "more expensive");
  if (cost) differences.push(`roughly ${cost} for this workload`);

  const queue = queuePhrase(requested.queueSeconds, alternative.queueSeconds);
  if (queue) differences.push(queue);

  const fidelityDelta = (alternative.fidelity - requested.fidelity) * 100;
  if (Math.abs(fidelityDelta) >= 0.1) {
    differences.push(`${Math.abs(fidelityDelta).toFixed(2)} percentage points ${fidelityDelta > 0 ? "higher" : "lower"} two-qubit fidelity`);
  }
  if (alternative.qubits !== requested.qubits) {
    differences.push(`${alternative.qubits} qubits versus ${requested.qubits}`);
  }
  return differences;
}

export interface BackendAlternative {
  backend_id: string;
  display_name: string;
  provider: string;
  kind: Backend["kind"];
  qubits: number;
  estimated_provider_cost: number;
  queue_seconds: number;
  fidelity: number;
  differences: string[];
  retry_with: { target: string };
}

/**
 * Thrown when the caller pinned a specific backend that cannot run the job.
 * Carries the reason and runnable alternatives so the caller can choose rather
 * than being told only that the request failed.
 */
export class BackendUnavailableError extends Error {
  readonly backend: Backend;
  readonly reason: UnavailabilityReason;
  readonly alternatives: BackendAlternative[];

  constructor(backend: Backend, reason: UnavailabilityReason, alternatives: BackendAlternative[]) {
    super(`${backend.displayName} cannot run this job: ${reason.message}.`);
    this.name = "BackendUnavailableError";
    this.backend = backend;
    this.reason = reason;
    this.alternatives = alternatives;
  }
}

/** The highest-scoring runnable backends, described relative to the requested one. */
export function buildAlternatives(
  requested: Backend,
  requestedCost: number,
  candidates: Array<Pick<RouteCandidate, "backend" | "compatible" | "estimatedProviderCost">>,
  limit = 3,
): BackendAlternative[] {
  return candidates
    .filter((candidate) => candidate.compatible && candidate.backend.id !== requested.id)
    .slice(0, limit)
    .map((candidate) => ({
      backend_id: candidate.backend.id,
      display_name: candidate.backend.displayName,
      provider: candidate.backend.provider,
      kind: candidate.backend.kind,
      qubits: candidate.backend.qubits,
      estimated_provider_cost: Math.round(candidate.estimatedProviderCost * 1_000_000) / 1_000_000,
      queue_seconds: candidate.backend.queueSeconds,
      fidelity: candidate.backend.fidelity,
      differences: differencesFrom(requested, candidate.backend, requestedCost, candidate.estimatedProviderCost),
      retry_with: { target: candidate.backend.id },
    }));
}
