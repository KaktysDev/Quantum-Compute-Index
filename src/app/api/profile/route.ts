import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as { full_name?: string; company?: string; onboarding_complete?: boolean };
    if (principal.demo) return NextResponse.json({ ...body, id: "demo" });
    if (!principal.userId) return NextResponse.json({ error: { type: "forbidden", message: "User session required." } }, { status: 403 });
    const update = { full_name: body.full_name?.trim(), company: body.company?.trim(), onboarding_complete: body.onboarding_complete ?? true };
    const { data, error } = await createAdminClient().from("profiles").update(update).eq("id", principal.userId).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}

