import { NextResponse } from "next/server";
import { computeAndStoreSnapshot } from "@/lib/qci/refresh";
import { refreshIndex } from "@/lib/qci/v2/refresh";
import { authorizeCronRequest } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// The cron is scheduled for the morning ET, but Vercel fires crons on a
// best-effort schedule (can drift by many minutes), so we DON'T gate on the exact
// time. Both engines compute at most once per ET calendar day (idempotency), so
// whenever the job actually fires that day it records the day's point.
// `force=true` (or POST) bypasses that once-a-day guard.
//
// v1 and v2 are run INDEPENDENTLY and neither can break the other: v2 is the
// index going forward, v1 keeps the legacy pages rendering until they migrate.
// They are also isolated failure-wise — a v2 schema problem must not stop v1
// recording its snapshot, and vice versa.
async function run(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true" || req.method === "POST";

  const [v2, v1] = await Promise.allSettled([
    refreshIndex({ force }),
    computeAndStoreSnapshot({ force }),
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

  // Only a total failure of both is a 500 — a single-engine failure is reported
  // in the body so the cron does not retry-storm on a partial outage.
  const anyOk = (v2.status === "fulfilled" && v2.value.ok) || v1.status === "fulfilled";
  return NextResponse.json(body, { status: anyOk ? 200 : 500 });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
