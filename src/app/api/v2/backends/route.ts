import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/qci/store";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { advertisedCapabilities } from "@/lib/qrouter/encoding";
import { requestId, v2Problem } from "@/lib/qrouter/v2-http";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { backendsForPrincipal } from "@/lib/qrouter/scopes";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestIdValue = requestId(request);
  try {
    const principal = await resolvePrincipal(request);
    const [snapshot, health] = await Promise.all([getLatestSnapshot(), loadPersistedBackendHealth()]);
    const catalog = applyProviderHealth(withQciSnapshot(snapshot.components), health);
    const data = backendsForPrincipal(principal, catalog).map((backend) => ({
      ...backend,
      capabilities: advertisedCapabilities(backend),
    }));
    return NextResponse.json({ object: "list", data, qci: { timestamp: snapshot.ts, source: snapshot.source, index: snapshot.price, price_per_qc_hour: snapshot.vwap } }, { headers: { "x-request-id": requestIdValue } });
  } catch (error) {
    return v2Problem(request, requestIdValue, error);
  }
}
