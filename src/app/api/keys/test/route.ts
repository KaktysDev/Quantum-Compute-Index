import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { decryptSecret } from "@/lib/crypto";
import { getProvider, isProviderId } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Auth'd: verify a saved provider key actually connects (e.g. AWS Braket). */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const { data, error } = await supabase
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
