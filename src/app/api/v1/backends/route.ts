import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/qci/store";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";

export const dynamic = "force-dynamic";

export async function GET() {
  const [snapshot, health] = await Promise.all([getLatestSnapshot(), loadPersistedBackendHealth()]);
  const data = applyProviderHealth(withQciSnapshot(snapshot.components), health);
  return NextResponse.json({
    object: "list",
    data,
    qci: {
      timestamp: snapshot.ts,
      source: snapshot.source,
      index: snapshot.price,
      pricePerQcHour: snapshot.vwap,
    },
    updated_at: new Date().toISOString(),
  });
}
