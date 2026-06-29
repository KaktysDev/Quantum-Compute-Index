// ──────────────────────────────────────────────────────────────────────────────
// Snapshot store — the single read path for "current QCI" and "QCI history".
// Reads live snapshots from Supabase when available; otherwise falls back to the
// deterministic sample series so the app always renders. SERVER-side use only.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sampleSeries, sampleSnapshot, type SamplePoint } from "./sample";
import type { QciSnapshot, QpuComponent } from "./types";

/** Minimum live rows before we prefer real data over the sample series. */
const MIN_LIVE_ROWS = 2;

interface SnapshotRow {
  ts: string;
  price: number;
  change_pct: number;
  vwap: number | null;
  components: QpuComponent[] | null;
  source: "live" | "sample";
}

function rowToSnapshot(r: SnapshotRow): QciSnapshot {
  return {
    ts: r.ts,
    price: Number(r.price),
    changePct: Number(r.change_pct),
    vwap: r.vwap ? Number(r.vwap) : 0,
    components: r.components ?? [],
    source: r.source,
  };
}

/** Latest QCI snapshot (live if present, else deterministic sample). */
export async function getLatestSnapshot(): Promise<QciSnapshot> {
  if (!isSupabaseConfigured()) return sampleSnapshot();
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_snapshots")
      .select("ts, price, change_pct, vwap, components, source")
      .order("ts", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return sampleSnapshot();
    return rowToSnapshot(data[0] as SnapshotRow);
  } catch {
    return sampleSnapshot();
  }
}

/** Daily QCI series for the chart (live if we have enough rows, else sample). */
export async function getSeries(days = 120): Promise<SamplePoint[]> {
  if (!isSupabaseConfigured()) return sampleSeries(days);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_snapshots")
      .select("ts, price")
      .order("ts", { ascending: false })
      .limit(days);
    if (error || !data || data.length < MIN_LIVE_ROWS) return sampleSeries(days);

    // De-dupe to one point per calendar day, ascending.
    const byDay = new Map<string, number>();
    for (const row of data as Array<{ ts: string; price: number }>) {
      const day = row.ts.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, Number(row.price));
    }
    return Array.from(byDay.entries())
      .map(([time, value]) => ({ time, value }))
      .sort((a, b) => a.time.localeCompare(b.time));
  } catch {
    return sampleSeries(days);
  }
}
