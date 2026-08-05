import { NextResponse } from "next/server";
import { getLatestSnapshot } from "@/lib/qci/store";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { requestId, v2Problem } from "@/lib/qrouter/v2-http";
import { resolvePrincipal } from "@/lib/qrouter/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestIdValue = requestId(request);
  try {
    await resolvePrincipal(request);
    const [snapshot, health] = await Promise.all([getLatestSnapshot(), loadPersistedBackendHealth()]);
    const data = applyProviderHealth(withQciSnapshot(snapshot.components), health).map((backend) => ({
      ...backend,
      capabilities: { input_formats: ["openqasm2", "openqasm3"], execution: "async", result: ["counts", "probabilities", "shots"] },
    }));
    return NextResponse.json({ object: "list", data, qci: { timestamp: snapshot.ts, source: snapshot.source, index: snapshot.price, price_per_qc_hour: snapshot.vwap } }, { headers: { "x-request-id": requestIdValue } });
  } catch (error) {
    return v2Problem(request, requestIdValue, error);
  }
}
