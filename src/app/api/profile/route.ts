import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const body = await request.json() as { full_name?: string; company?: string; onboarding_complete?: boolean; preferences?: Record<string, unknown> };
    if (principal.demo) return NextResponse.json({ ...body, id: "demo" });
    if (!principal.userId) return NextResponse.json({ error: { type: "forbidden", message: "User session required." } }, { status: 403 });
    const admin = createAdminClient();
    const update: Record<string, unknown> = { full_name: body.full_name?.trim(), company: body.company?.trim(), onboarding_complete: body.onboarding_complete ?? true };
    // Merge preferences (theme, notification toggles, routing default) with the
    // stored object so partial updates never clobber other keys.
    if (body.preferences && typeof body.preferences === "object" && !Array.isArray(body.preferences)) {
      const { data: current } = await admin.from("profiles").select("preferences").eq("id", principal.userId).maybeSingle();
      update.preferences = { ...((current?.preferences as Record<string, unknown> | null) ?? {}), ...body.preferences };
    }
    const { data, error } = await admin.from("profiles").update(update).eq("id", principal.userId).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) { return apiError(error); }
}

