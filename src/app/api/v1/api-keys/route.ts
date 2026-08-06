import { NextResponse } from "next/server";
import { z } from "zod";
import { API_SCOPES, createApiKey, keyPrefix, resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

const DEMO_KEY = "qci_test_local_development";

/** Bounds how many live credentials one workspace can have outstanding. */
const MAX_ACTIVE_API_KEYS = Number(process.env.QROUTER_MAX_ACTIVE_API_KEYS ?? 25);

// `key_prefix` is unique in the schema. Four random characters is 64^4 values
// per environment, so a collision is rare but not negligible once a workspace
// has thousands of keys — regenerate instead of failing the request.
const UNIQUE_VIOLATION = "23505";
const PREFIX_ATTEMPTS = 5;

const createApiKeySchema = z.object({
  // nullish + fallback keeps today's behaviour, where an omitted or blank name
  // is accepted rather than rejected.
  name: z.string().trim().max(120).nullish().transform((value) => value || "Developer key"),
  environment: z.enum(["test", "live"]).default("live"),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(25).optional(),
}).strict();

export async function GET(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (principal.demo) return NextResponse.json({ object: "list", data: [{ id: "demo", name: "Local development", key_prefix: keyPrefix(DEMO_KEY), environment: "test", created_at: new Date().toISOString() }] });
    const { data, error } = await createAdminClient().from("api_keys").select("id,name,key_prefix,environment,scopes,last_used_at,expires_at,revoked_at,created_at").eq("organization_id", principal.organizationId).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ object: "list", data });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    if (!principal.userId) return NextResponse.json({ error: { type: "forbidden", message: "API keys can only be created from the console." } }, { status: 403 });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: { type: "invalid_request", message: "Request body must be valid JSON." } }, { status: 400 });
    }
    const parsed = createApiKeySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: { type: "invalid_request", message: "The request body is invalid.", details: parsed.error.flatten() } }, { status: 400 });
    }
    const { name, environment } = parsed.data;
    const scopes = [...new Set(parsed.data.scopes ?? API_SCOPES)];

    if (principal.demo) return NextResponse.json({ id: "demo", name, key: DEMO_KEY, key_prefix: keyPrefix(DEMO_KEY), environment, scopes }, { status: 201 });

    const admin = createAdminClient();
    const { count, error: countError } = await admin.from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", principal.organizationId)
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_ACTIVE_API_KEYS) {
      return NextResponse.json({ error: { type: "api_key_limit_reached", message: `This workspace already has ${MAX_ACTIVE_API_KEYS} active API keys. Revoke one before creating another.` } }, { status: 409 });
    }

    for (let attempt = 0; attempt < PREFIX_ATTEMPTS; attempt += 1) {
      const generated = createApiKey(environment);
      const { data, error } = await admin.from("api_keys")
        .insert({ organization_id: principal.organizationId, created_by: principal.userId, name, environment, scopes, key_prefix: generated.prefix, key_hash: generated.hash })
        .select("id,name,key_prefix,environment,scopes,created_at").single();
      if (!error) return NextResponse.json({ ...data, key: generated.key }, { status: 201 });
      if (error.code !== UNIQUE_VIOLATION) throw error;
    }
    return NextResponse.json({ error: { type: "conflict", message: "Could not allocate a unique key prefix. Retry the request." } }, { status: 409 });
  } catch (error) { return apiError(error); }
}
