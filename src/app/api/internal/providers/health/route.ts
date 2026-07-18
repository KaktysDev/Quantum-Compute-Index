import { NextResponse } from "next/server";
import { checkProviderConnections } from "@/lib/qrouter/providerHealth";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const providers = await checkProviderConnections();
  const admin = createAdminClient();
  const backendIds = providers.flatMap((provider) => provider.backendIds);
  const { data: previous } = backendIds.length
    ? await admin.from("provider_health").select("backend_id,consecutive_failures").in("backend_id", backendIds)
    : { data: [] };
  const failures = new Map((previous ?? []).map((item) => [item.backend_id, item.consecutive_failures]));
  const healthRows = providers.flatMap((provider) => provider.backendIds.map((backendId) => ({
    backend_id: backendId,
    configured: provider.configured,
    reachable: provider.reachable,
    consecutive_failures: provider.reachable ? 0 : (failures.get(backendId) ?? 0) + 1,
    detail: provider.detail,
    checked_at: provider.checkedAt,
  })));
  if (healthRows.length) {
    const { error } = await admin.from("provider_health").upsert(healthRows, { onConflict: "backend_id" });
    if (error) throw error;
  }
  return NextResponse.json({
    healthy: providers.filter((provider) => provider.configured).every((provider) => provider.reachable),
    providers,
  });
}
