// ──────────────────────────────────────────────────────────────────────────────
// Compute-and-store: the single code path that turns enabled provider keys into a
// stored live QCI snapshot. Shared by the daily cron (/api/cron/refresh) and the
// authenticated on-demand refresh (/api/refresh, the "Refresh index now" button).
//
// Writes go through the service-role admin client because `qci_snapshots` has no
// insert policy for normal users (see supabase/schema.sql) — inserts are
// server-only by design.
// ──────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { fetchAllMetrics } from "@/lib/providers";
import { computeQci } from "./compute";

export interface RefreshResult {
  wrote: boolean;
  source: "live" | "sample";
  /** True when the once-a-day guard short-circuited (non-forced runs only). */
  skipped?: boolean;
  reason?: string;
  price?: number;
  changePct?: number;
  /** Provider ids whose keys were enabled this run. */
  providers?: string[];
  /** Number of constituents (QPUs) in the computed basket. */
  qpus?: number;
  /** Human-readable "Provider · QPU" list for UI feedback. */
  constituents?: string[];
}

/** Current calendar date in America/New_York (for the once-per-day guard). */
function dateEt(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Pull metrics from every enabled provider, compute the chain-linked index, and
 * persist the snapshot (+ raw per-QPU inputs). Returns a structured result.
 *
 * `force` bypasses the "at most one live snapshot per ET day" idempotency guard —
 * always true for the on-demand button so a freshly-added key shows up instantly.
 *
 * Throws on hard failures (admin client misconfigured, DB write error) so callers
 * can surface a 500; returns `{ wrote:false }` for the soft outcomes (guard hit,
 * or no key produced any metrics — the app then keeps showing sample data).
 */
export async function computeAndStoreSnapshot(
  opts: { force?: boolean; now?: Date } = {},
): Promise<RefreshResult> {
  const force = opts.force ?? false;
  const now = opts.now ?? new Date();
  const supabase = createAdminClient();

  // Idempotency: one live snapshot per ET day, unless forced.
  if (!force) {
    const dayStart = `${dateEt(now)}T00:00:00.000Z`;
    const { data: existing } = await supabase
      .from("qci_snapshots")
      .select("id")
      .eq("source", "live")
      .gte("ts", dayStart)
      .limit(1);
    if (existing && existing.length > 0) {
      return { wrote: false, source: "sample", skipped: true, reason: "already ran today" };
    }
  }

  // Load enabled provider keys and decrypt them.
  const { data: keyRows, error: keyErr } = await supabase
    .from("provider_keys")
    .select("provider, encrypted_key, enabled")
    .eq("enabled", true);
  if (keyErr) throw new Error(keyErr.message);

  const keys: Record<string, string> = {};
  for (const row of keyRows ?? []) {
    try {
      keys[row.provider] = decryptSecret(row.encrypted_key);
    } catch (e) {
      console.error(`[refresh] failed to decrypt key for ${row.provider}`, e);
    }
  }

  const rawMetrics = await fetchAllMetrics(keys, now);

  // No keys / no live data yet → keep showing sample data. Nothing to write.
  if (rawMetrics.length === 0) {
    return {
      wrote: false,
      source: "sample",
      reason:
        Object.keys(keys).length === 0
          ? "no enabled provider keys"
          : "enabled providers returned no metrics",
      providers: Object.keys(keys),
    };
  }

  // Previous snapshot for chain-linking (price + vwap + basket).
  const { data: prev } = await supabase
    .from("qci_snapshots")
    .select("price, vwap, components")
    .order("ts", { ascending: false })
    .limit(1);
  const previous =
    prev && prev.length > 0
      ? {
          price: Number(prev[0].price),
          vwap: Number(prev[0].vwap),
          components: (prev[0].components ?? []) as Array<{ provider: string }>,
        }
      : null;

  const snapshot = computeQci(rawMetrics, {
    ts: now.toISOString(),
    previous,
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
  if (insErr) throw new Error(insErr.message);

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

  return {
    wrote: true,
    source: "live",
    price: snapshot.price,
    changePct: snapshot.changePct,
    providers: Object.keys(keys),
    qpus: snapshot.components.length,
    constituents: snapshot.components.map((c) => `${c.provider} · ${c.qpu}`),
  };
}
