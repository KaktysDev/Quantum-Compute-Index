// ──────────────────────────────────────────────────────────────────────────────
// Snapshot store — the single read path for "current QCI" and "QCI history".
// Reads live snapshots from Supabase when available; otherwise falls back to the
// deterministic sample series so the app always renders. SERVER-side use only.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sampleSeries, sampleSnapshot, type SamplePoint } from "./sample";
import type { QciSnapshot, QpuComponent } from "./types";

/** How many recorded snapshots to chart (plenty of headroom for daily points). */
const SERIES_LIMIT = 1000;

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

/**
 * QCI history for the chart, as UNIX-second points.
 * Uses REAL recorded snapshots as soon as there is at least one; only falls back
 * to the deterministic sample series when nothing has been recorded yet.
 */
export async function getSeries(days = 120): Promise<SamplePoint[]> {
  if (!isSupabaseConfigured()) return sampleSeries(days);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_snapshots")
      .select("ts, price")
      .order("ts", { ascending: true })
      .limit(SERIES_LIMIT);
    if (error || !data || data.length === 0) return sampleSeries(days);

    // Every recorded snapshot becomes a point (de-dupe identical timestamps).
    const seen = new Set<number>();
    const points: SamplePoint[] = [];
    for (const row of data as Array<{ ts: string; price: number }>) {
      const t = Math.floor(new Date(row.ts).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      points.push({ time: t, value: Number(row.price) });
    }
    return points;
  } catch {
    return sampleSeries(days);
  }
}
