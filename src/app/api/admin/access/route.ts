// ─────────────────────────────────────────────────────────────────────────────
// Admin → Access: approve waitlist requests and manage console access.
//
// Every mutation goes through a security-definer RPC that re-checks is_admin()
// inside the database (see supabase/access.sql), so requireAdminApi() here is
// defence in depth rather than the only gate.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin";

export const dynamic = "force-dynamic";

const ActionSchema = z.object({
  action: z.enum(["grant", "revoke", "decline"]),
  email: z.string().trim().email().max(200),
});

const RPC_BY_ACTION = {
  grant: "grant_console_access",
  revoke: "revoke_console_access",
  decline: "decline_waitlist_submission",
} as const;

/** POST: grant / revoke console access, or decline a waitlist request. */
export async function POST(req: Request) {
  const ctx = await requireAdminApi();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let parsed: z.infer<typeof ActionSchema>;
  try {
    parsed = ActionSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // The user-scoped client is required: the RPC reads auth.jwt() to confirm the
  // caller is an admin and to record who granted access.
  const { error } = await ctx.supabase.rpc(RPC_BY_ACTION[parsed.action], {
    p_email: parsed.email.toLowerCase(),
  });

  if (error) {
    // PGRST202 → the migration hasn't been run yet; anything else is a real
    // failure (e.g. the DB refusing to revoke an admin).
    const missing = error.code === "PGRST202";
    return NextResponse.json(
      {
        error: missing
          ? "Run supabase/access.sql in the Supabase SQL editor first — the access functions are missing."
          : error.message,
      },
      { status: missing ? 503 : 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
