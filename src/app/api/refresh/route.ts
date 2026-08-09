import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { computeAndStoreSnapshot } from "@/lib/qci/refresh";
import { refreshIndex } from "@/lib/qci/v2/refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Auth'd on-demand recompute (the Settings "Refresh index now" button). Any
 * signed-in (therefore allowlisted) user may trigger it. Forces a recompute so a
 * just-added provider key shows up immediately, bypassing the once-a-day guard.
 *
 * Runs both engines; a failure in either is reported without failing the other.
 */
export async function POST() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [v2, v1] = await Promise.allSettled([
    refreshIndex({ force: true }),
    computeAndStoreSnapshot({ force: true }),
  ]);

  const body = {
    v2:
      v2.status === "fulfilled"
        ? v2.value
        : { ok: false, wrote: false, error: String(v2.reason) },
    legacy:
      v1.status === "fulfilled"
        ? v1.value
        : { wrote: false, error: String(v1.reason) },
  };
  const anyOk = (v2.status === "fulfilled" && v2.value.ok) || v1.status === "fulfilled";
  return NextResponse.json(body, { status: anyOk ? 200 : 500 });
}
