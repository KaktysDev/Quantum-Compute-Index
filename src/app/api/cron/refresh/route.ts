import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { fetchAllMetrics } from "@/lib/providers";
import { computeQci } from "@/lib/qci/compute";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Current hour/minute/date in America/New_York. */
function nowEt(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // must be configured
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "true" || req.method === "POST";

  const now = new Date();
  const et = nowEt(now);

  // The cron is scheduled for the morning ET, but Vercel fires crons on a
  // best-effort schedule (can drift by many minutes), so we DON'T gate on the
  // exact time. Instead we compute at most once per ET calendar day
  // (idempotency below) — whenever the job actually fires that day, it records
  // the day's snapshot. `force=true` bypasses the once-a-day guard.

  let supabase;
  try {
    supabase = createAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Admin client error" },
      { status: 500 },
    );
  }

  // Idempotency: one live snapshot per ET day.
  if (!force) {
    const dayStart = `${et.date}T00:00:00.000Z`;
    const { data: existing } = await supabase
      .from("qci_snapshots")
      .select("id")
      .eq("source", "live")
      .gte("ts", dayStart)
      .limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ skipped: true, reason: "already ran today" });
    }
  }

  // Load enabled provider keys and decrypt them.
  const { data: keyRows, error: keyErr } = await supabase
    .from("provider_keys")
    .select("provider, encrypted_key, enabled")
    .eq("enabled", true);
  if (keyErr) {
    return NextResponse.json({ error: keyErr.message }, { status: 500 });
  }

  const keys: Record<string, string> = {};
  for (const row of keyRows ?? []) {
    try {
      keys[row.provider] = decryptSecret(row.encrypted_key);
    } catch (e) {
      console.error(`[cron] failed to decrypt key for ${row.provider}`, e);
    }
  }

  const rawMetrics = await fetchAllMetrics(keys, now);

  // No keys / no live data yet → the app keeps showing sample data. Nothing to write.
  if (rawMetrics.length === 0) {
    return NextResponse.json({
      wrote: false,
      source: "sample",
      reason: "no enabled provider keys produced metrics",
    });
  }

  // Previous price for % change.
  const { data: prev } = await supabase
    .from("qci_snapshots")
    .select("price")
    .order("ts", { ascending: false })
    .limit(1);
  const previousPrice = prev && prev.length > 0 ? Number(prev[0].price) : undefined;

  const snapshot = computeQci(rawMetrics, {
    ts: now.toISOString(),
    previousPrice,
    source: "live",
  });

  const { error: insErr } = await supabase.from("qci_snapshots").insert({
    ts: snapshot.ts,
    price: snapshot.price,
    change_pct: snapshot.changePct,
    vwap: snapshot.vwap,
    components: snapshot.components,
    source: "live",
  });
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Persist raw per-QPU inputs for auditability ("oracle integrity").
  const metricRows = snapshot.components.map((c) => ({
    snapshot_ts: snapshot.ts,
    provider: c.provider,
    qpu: c.qpu,
    price_per_nqh: c.pricePerNqh,
    qv: c.qv,
    clops: c.clops,
    fid_2q: c.fid2q,
    queue_seconds: c.queueSeconds ?? null,
    pqf: c.pqf,
    raw: c,
  }));
  await supabase.from("provider_metrics").insert(metricRows);

  return NextResponse.json({
    wrote: true,
    source: "live",
    price: snapshot.price,
    changePct: snapshot.changePct,
    providers: Object.keys(keys),
    qpus: snapshot.components.length,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
