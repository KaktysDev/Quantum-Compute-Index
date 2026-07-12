import { NextResponse } from "next/server";
import { createApiKey, resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) return NextResponse.json({ object: "list", data: [{ id: "demo", name: "Local development", key_prefix: "qci_test_local...", environment: "test", created_at: new Date().toISOString() }] });
    const { data, error } = await createAdminClient().from("api_keys").select("id,name,key_prefix,environment,scopes,last_used_at,expires_at,revoked_at,created_at").eq("organization_id", principal.organizationId).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ object: "list", data });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (!principal.userId) return NextResponse.json({ error: { type: "forbidden", message: "API keys can only be created from the console." } }, { status: 403 });
    const body = await request.json() as { name?: string; environment?: "test" | "live" };
    const generated = createApiKey(body.environment ?? "live");
    if (principal.demo) return NextResponse.json({ id: "demo", name: body.name ?? "Developer key", key: "qci_test_local_development", key_prefix: "qci_test_local..." }, { status: 201 });
    const { data, error } = await createAdminClient().from("api_keys").insert({ organization_id: principal.organizationId, created_by: principal.userId, name: body.name?.trim() || "Developer key", environment: body.environment ?? "live", key_prefix: generated.prefix, key_hash: generated.hash }).select("id,name,key_prefix,environment,created_at").single();
    if (error) throw error;
    return NextResponse.json({ ...data, key: generated.key }, { status: 201 });
  } catch (error) { return apiError(error); }
}

