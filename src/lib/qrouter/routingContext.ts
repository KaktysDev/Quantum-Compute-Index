import type { QpuComponent } from "@/lib/qci/types";
import { configuredBackends } from "./catalog";
import { applyProviderHealth, loadPersistedBackendHealth } from "./providerHealth";
import type { Backend } from "./types";

export interface RoutingSnapshot {
  id: number | null;
  ts: string;
  source: "unavailable";
  price: number;
  vwap: number;
  components: QpuComponent[];
}

export interface RoutingContext {
  snapshot: RoutingSnapshot;
  backends: Backend[];
}

/** Compatibility metadata only: research index values never enter routing. */
function executionSnapshot(): RoutingSnapshot {
  return { id: null, ts: new Date().toISOString(), source: "unavailable", price: 0, vwap: 0, components: [] };
}

/** Snapshot/health change on the order of minutes; quotes last 15. */
const CONTEXT_TTL_MS = Math.max(1_000, Number(process.env.QROUTER_ROUTING_CONTEXT_TTL_MS ?? 30_000));

const cache = new Map<string, { expiresAt: number; value: RoutingContext }>();
const inflight = new Map<string, Promise<RoutingContext>>();

export function resetRoutingContextCache() {
  cache.clear();
  inflight.clear();
}

function cachedContext(key: string, load: () => Promise<RoutingContext>): Promise<RoutingContext> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const work = load().then((value) => {
    cache.set(key, { expiresAt: Date.now() + CONTEXT_TTL_MS, value });
    inflight.delete(key);
    return value;
  }).catch((error) => {
    inflight.delete(key);
    throw error;
  });
  inflight.set(key, work);
  return work;
}

function overlay(health: Awaited<ReturnType<typeof loadPersistedBackendHealth>>): RoutingContext {
  return { snapshot: executionSnapshot(), backends: applyProviderHealth(configuredBackends(), health) };
}

export async function loadRoutingContext(demo: boolean) {
  return cachedContext(demo ? "demo" : "live", async () => overlay(demo ? [] : await loadPersistedBackendHealth()));
}

/** Public execution catalog: native rate configuration + operational health. */
export async function loadPublicRoutingContext() {
  return cachedContext("public", async () => overlay(await loadPersistedBackendHealth()));
}
