import { NextResponse } from "next/server";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { applyProviderHealth, loadPersistedBackendHealth } from "@/lib/qrouter/providerHealth";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await loadPersistedBackendHealth();
  return NextResponse.json({ object: "list", data: applyProviderHealth(BACKENDS, health), updated_at: new Date().toISOString() });
}
