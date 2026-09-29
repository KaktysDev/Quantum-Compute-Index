// Builds POST /api/v2/jobs bodies for single and compare runs started from a
// circuit's page. Pure so it can be tested against the server schema.

import type { RoutingMode } from "@/lib/qrouter/types";

export type RunSettings = {
  shots: number;
  routingMode: RoutingMode;
  optimizationLevel: number;
  failover: boolean;
  maxAttempts: number;
  timeoutSeconds: number;
};

export const DEFAULT_RUN_SETTINGS: RunSettings = {
  shots: 1024,
  routingMode: "balanced",
  optimizationLevel: 2,
  failover: true,
  maxAttempts: 3,
  timeoutSeconds: 7200,
};

export const MAX_COMPARE_TARGETS = 10;

/** Stable, readable execution key for a target: `ibm-brisbane`, `auto`, `auto-2`. */
export function executionKeys(targets: string[]): string[] {
  const used = new Map<string, number>();
  return targets.map((target) => {
    const base = target.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56) || "target";
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen === 0 ? base : `${base}-${seen + 1}`;
  });
}

export function buildRunRequest({
  circuitId,
  name,
  targets,
  settings,
}: {
  circuitId: string;
  name?: string;
  targets: string[];
  settings: RunSettings;
}) {
  const keys = executionKeys(targets);
  const trimmed = name?.trim();
  return {
    circuit_id: circuitId,
    metadata: trimmed ? { name: trimmed.slice(0, 500) } : {},
    executions: targets.map((target, index) => ({
      key: keys[index],
      target,
      shots: settings.shots,
      routing_mode: settings.routingMode,
      optimization_level: settings.optimizationLevel,
      failover: settings.failover,
      max_attempts: settings.maxAttempts,
      timeout_seconds: settings.timeoutSeconds,
      constraints: {},
    })),
  };
}

/** Provider-side estimate from list prices. The server quote is authoritative. */
export function estimateProviderCost(backend: { pricePerShot?: number; pricePerTask?: number }, shots: number): number | null {
  if (typeof backend.pricePerShot !== "number" && typeof backend.pricePerTask !== "number") return null;
  return (backend.pricePerShot ?? 0) * shots + (backend.pricePerTask ?? 0);
}
