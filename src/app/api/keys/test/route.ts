import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { decryptSecret } from "@/lib/crypto";
import { getProvider, isProviderId } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Admin-gated: verify a saved provider key actually connects (e.g. AWS Braket).
 * provider_keys has RLS with no user policies, so reads go through the service role. */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const provider = body.provider;
  if (!provider || !isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const adapter = getProvider(provider);
  if (!adapter?.testConnection) {
    return NextResponse.json({ error: "This provider has no connection test." }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("provider_keys")
    .select("encrypted_key")
    .eq("provider", provider)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.encrypted_key) {
    return NextResponse.json({ error: "No saved key for this provider." }, { status: 400 });
  }

  let secret: string;
  try {
    secret = decryptSecret(data.encrypted_key);
  } catch {
    return NextResponse.json({ error: "Could not decrypt the stored key." }, { status: 500 });
  }

  try {
    const result = await adapter.testConnection(secret);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Test failed." },
      { status: 200 },
    );
  }
}
