import { getLatestSnapshot } from "@/lib/qci/store";
import type { QciSnapshot, QpuComponent } from "@/lib/qci/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { withQciSnapshot } from "./catalog";
import { applyProviderHealth, loadPersistedBackendHealth } from "./providerHealth";
import type { Backend } from "./types";

export interface RoutingSnapshot {
  id: number | null;
  ts: string;
  source: QciSnapshot["source"];
  price: number;
  vwap: number;
  components: QpuComponent[];
}

export interface RoutingContext {
  snapshot: RoutingSnapshot;
  backends: Backend[];
}

function sampleRoutingSnapshot(snapshot: QciSnapshot): RoutingSnapshot {
  return {
    id: null,
    ts: snapshot.ts,
    source: snapshot.source,
    price: snapshot.price,
    vwap: snapshot.vwap,
    components: snapshot.components,
  };
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

async function loadLiveSnapshot(): Promise<RoutingSnapshot> {
  const { data } = await createAdminClient()
    .from("qci_snapshots")
    .select("id,ts,source,price,vwap,components")
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return sampleRoutingSnapshot(await getLatestSnapshot());
  return {
    id: data.id,
    ts: data.ts,
    source: data.source === "live" ? "live" : "sample",
    price: Number(data.price ?? 0),
    vwap: Number(data.vwap ?? 0),
    components: (data.components ?? []) as QpuComponent[],
  };
}

function overlay(snapshot: RoutingSnapshot, health: Awaited<ReturnType<typeof loadPersistedBackendHealth>>): RoutingContext {
  return {
    snapshot,
    backends: applyProviderHealth(withQciSnapshot(snapshot.components), health),
  };
}

export async function loadRoutingContext(demo: boolean) {
  if (demo) {
    return cachedContext("demo", async () => overlay(sampleRoutingSnapshot(await getLatestSnapshot()), []));
  }
  return cachedContext("live", async () => {
    const [snapshot, health] = await Promise.all([loadLiveSnapshot(), loadPersistedBackendHealth()]);
    return overlay(snapshot, health);
  });
}

/** Public backends/chat catalog: user-readable snapshot + health, no admin client. */
export async function loadPublicRoutingContext() {
  return cachedContext("public", async () => {
    const [snapshot, health] = await Promise.all([
      getLatestSnapshot().then(sampleRoutingSnapshot),
      loadPersistedBackendHealth(),
    ]);
    return overlay(snapshot, health);
  });
}
