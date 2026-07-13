import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto";
import { isProviderId } from "@/lib/providers";

export const dynamic = "force-dynamic";

// provider_keys has NO RLS policies by design (infrastructure secrets), so all
// mutations go through the service role — after the admin check above.

const SaveSchema = z.object({
  provider: z.string(),
  apiKey: z.string().trim().min(4).max(10_000).optional(),
  label: z.string().trim().max(120).optional(),
  enabled: z.boolean().optional(),
});

/** POST: save (encrypt + upsert) a provider key, or toggle/relabel an existing one. */
export async function POST(req: Request) {
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed: z.infer<typeof SaveSchema>;
  try {
    parsed = SaveSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!isProviderId(parsed.provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Toggle / relabel only (no new key material supplied).
  if (parsed.apiKey === undefined) {
    const patch: Record<string, unknown> = { updated_by: ctx.user.id, updated_at: now };
    if (parsed.enabled !== undefined) patch.enabled = parsed.enabled;
    if (parsed.label !== undefined) patch.label = parsed.label;
    const { error } = await admin.from("provider_keys").update(patch).eq("provider", parsed.provider);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  let encrypted: string;
  try {
    encrypted = encryptSecret(parsed.apiKey);
  } catch {
    return NextResponse.json(
      { error: "KEY_ENCRYPTION_SECRET is not configured on the server." },
      { status: 500 },
    );
  }

  const { error } = await admin.from("provider_keys").upsert(
    {
      provider: parsed.provider,
      encrypted_key: encrypted,
      label: parsed.label ?? null,
      enabled: parsed.enabled ?? true,
      updated_by: ctx.user.id,
      updated_at: now,
    },
    { onConflict: "provider" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

const DeleteSchema = z.object({ provider: z.string() });

/** DELETE: remove a provider credential entirely. */
export async function DELETE(req: Request) {
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed: z.infer<typeof DeleteSchema>;
  try {
    parsed = DeleteSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("provider_keys").delete().eq("provider", parsed.provider);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
