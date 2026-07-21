import { getLatestSnapshot } from "@/lib/qci/store";
import type { QciSnapshot, QpuComponent } from "@/lib/qci/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { withQciSnapshot } from "./catalog";
import { applyProviderHealth, loadPersistedBackendHealth } from "./providerHealth";

export interface RoutingSnapshot {
  id: number | null;
  ts: string;
  source: QciSnapshot["source"];
  price: number;
  vwap: number;
  components: QpuComponent[];
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

export async function loadRoutingContext(demo: boolean) {
  let snapshot: RoutingSnapshot;
  if (demo) {
    snapshot = sampleRoutingSnapshot(await getLatestSnapshot());
  } else {
    const { data } = await createAdminClient()
      .from("qci_snapshots")
      .select("id,ts,source,price,vwap,components")
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    snapshot = data
      ? {
          id: data.id,
          ts: data.ts,
          source: data.source === "live" ? "live" : "sample",
          price: Number(data.price ?? 0),
          vwap: Number(data.vwap ?? 0),
          components: (data.components ?? []) as QpuComponent[],
        }
      : sampleRoutingSnapshot(await getLatestSnapshot());
  }

  const health = demo ? [] : await loadPersistedBackendHealth();
  return {
    snapshot,
    backends: applyProviderHealth(withQciSnapshot(snapshot.components), health),
  };
}
