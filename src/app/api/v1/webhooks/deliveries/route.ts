import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

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
    return NextResponse.json({ object: "list", data });
  } catch (error) {
    return apiError(error);
  }
}
