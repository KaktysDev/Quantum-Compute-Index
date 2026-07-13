import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { getProvider, isProviderId } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const TestSchema = z.object({
  provider: z.string(),
  /** Untested values typed into the form — tests these INSTEAD of the stored key. */
  fieldValues: z.record(z.string(), z.string()).optional(),
});

/**
 * POST: verify a provider credential actually connects and pulls data.
 * With fieldValues → tests the pasted (unsaved) values, so admins can check a
 * key BEFORE saving. Without → decrypts and tests the stored credential.
 */
export async function POST(req: Request) {
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed: z.infer<typeof TestSchema>;
  try {
    parsed = TestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (!isProviderId(parsed.provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const adapter = getProvider(parsed.provider);
  if (!adapter?.testConnection) {
    return NextResponse.json(
      { ok: false, message: "This provider has no connection test." },
      { status: 200 },
    );
  }

  // Assemble the credential: pasted form values win; otherwise the stored key.
  let credential: string | null = null;
  const filled = Object.entries(parsed.fieldValues ?? {})
    .map(([k, v]) => [k, v.trim()] as const)
    .filter(([, v]) => v.length > 0);

  if (filled.length > 0) {
    // Multi-field providers (AWS, IBM) expect a JSON object; single-key
    // providers take the raw value.
    credential =
      (adapter.fields ?? []).length > 1
        ? JSON.stringify(Object.fromEntries(filled))
        : filled[0][1];
  } else {
    const admin = createAdminClient();
    const { data } = await admin
      .from("provider_keys")
      .select("encrypted_key")
      .eq("provider", parsed.provider)
      .maybeSingle();
    if (!data?.encrypted_key) {
      return NextResponse.json(
        { ok: false, message: "No saved key — paste a credential first." },
        { status: 200 },
      );
    }
    try {
      credential = decryptSecret(data.encrypted_key);
    } catch {
      return NextResponse.json(
        { ok: false, message: "Could not decrypt the stored key (KEY_ENCRYPTION_SECRET changed?)." },
        { status: 200 },
      );
    }
  }

  try {
    const result = await adapter.testConnection(credential);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Connection test failed." },
      { status: 200 },
    );
  }
}
