import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { encryptSecret } from "@/lib/crypto";
import { isProviderId, PROVIDER_DEFINITIONS } from "@/lib/providers";

export const dynamic = "force-dynamic";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** GET: status of each provider key (set / enabled / label / updated). Never the raw key. */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("provider_keys")
    .select("provider, label, enabled, updated_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byProvider = new Map((data ?? []).map((r) => [r.provider, r]));
  const status = PROVIDER_DEFINITIONS.map((p) => {
    const row = byProvider.get(p.id);
    return {
      ...p,
      configured: Boolean(row),
      enabled: row?.enabled ?? false,
      label: row?.label ?? null,
      updatedAt: row?.updated_at ?? null,
    };
  });
  return NextResponse.json({ providers: status });
}

/** POST: save (encrypt + upsert) a provider key, or toggle enabled. */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { provider?: string; apiKey?: string; label?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { provider, apiKey, label, enabled } = body;
  if (!provider || !isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // Toggle-only update (no new key supplied).
  if (apiKey === undefined && typeof enabled === "boolean") {
    const { error } = await supabase
      .from("provider_keys")
      .update({ enabled, updated_by: user.id, updated_at: new Date().toISOString() })
      .eq("provider", provider);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 4) {
    return NextResponse.json({ error: "API key is too short" }, { status: 400 });
  }

  let encrypted: string;
  try {
    encrypted = encryptSecret(apiKey.trim());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Encryption failed" },
      { status: 500 },
    );
  }

  const { error } = await supabase.from("provider_keys").upsert(
    {
      provider,
      encrypted_key: encrypted,
      label: label ?? null,
      enabled: enabled ?? true,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE: remove a provider key. */
export async function DELETE(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");
  if (!provider || !isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }
  const { error } = await supabase.from("provider_keys").delete().eq("provider", provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
