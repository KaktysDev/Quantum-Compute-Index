import { NextResponse } from "next/server";
import { computeAndStoreSnapshot } from "@/lib/qci/refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

// The cron is scheduled for the morning ET, but Vercel fires crons on a
// best-effort schedule (can drift by many minutes), so we DON'T gate on the exact
// time. `computeAndStoreSnapshot` instead computes at most once per ET calendar
// day (idempotency), so whenever the job actually fires that day it records the
// day's snapshot. `force=true` (or POST) bypasses that once-a-day guard.
async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true" || req.method === "POST";
  try {
    const result = await computeAndStoreSnapshot({ force });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Refresh failed" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
