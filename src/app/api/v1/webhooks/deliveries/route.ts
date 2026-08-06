import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { webhookFailureReason } from "@/lib/qrouter/webhooks";
import { createAdminClient } from "@/lib/supabase/admin";

type DeliveryRow = Record<string, unknown> & { error: unknown };

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) return NextResponse.json({ object: "list", data: [] });
    const { data, error } = await createAdminClient()
      .from("webhook_deliveries")
      .select("id,job_id,event_type,attempt,response_status,error,next_attempt_at,delivered_at,failed_at,created_at,webhook_endpoints!inner(url,organization_id)")
      .eq("webhook_endpoints.organization_id", principal.organizationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    // `error` is a classification, never upstream text: raw failure strings next
    // to `response_status` would hand the caller an internal network scanner.
    // Rows written before that rule collapse to the catch-all reason.
    const deliveries = ((data ?? []) as DeliveryRow[]).map((delivery) => ({ ...delivery, error: webhookFailureReason(delivery.error) }));
    return NextResponse.json({ object: "list", data: deliveries });
  } catch (error) {
    return apiError(error);
  }
}
