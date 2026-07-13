// ──────────────────────────────────────────────────────────────────────────────
// Snapshot store — the single read path for "current QCI" and "QCI history".
// Reads live snapshots from Supabase when available; otherwise falls back to the
// deterministic sample series so the app always renders. SERVER-side use only.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { basketKey } from "./compute";
import { sampleProviderSeries, sampleSeries, sampleSnapshot, type ProviderSampleSeries, type SamplePoint } from "./sample";
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

interface SeriesRow {
  ts: string;
  vwap: number | null;
  components: Array<{ provider: string }> | null;
  source: "live" | "sample";
}

/** Sample chart series in $/NQH terms (scale the 1000-anchored path by VWAP). */
function sampleVwapSeries(days: number): SamplePoint[] {
  const snap = sampleSnapshot();
  const scale = snap.price > 0 ? snap.vwap / snap.price : 1;
  return sampleSeries(days).map((p) => ({ time: p.time, value: p.value * scale }));
}

/**
 * VWAP history for the chart (the real $/NQH price of a quantum compute hour),
 * as UNIX-second points.
 *
 * We chart the VWAP — not the 1000-anchored index level — and include ONLY the
 * snapshots that share the CURRENT basket composition. That makes the line start
 * when today's basket was formed, instead of showing the artificial jump from
 * the assembly phase (providers being connected one by one changes the VWAP for
 * composition reasons, not real price moves). Falls back to the deterministic
 * sample series until at least one live snapshot exists.
 */
export async function getSeries(days = 120): Promise<SamplePoint[]> {
  if (!isSupabaseConfigured()) return sampleVwapSeries(days);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_snapshots")
      .select("ts, vwap, components, source")
      .order("ts", { ascending: true })
      .limit(SERIES_LIMIT);
    if (error || !data || data.length === 0) return sampleVwapSeries(days);

    const live = (data as SeriesRow[]).filter((r) => r.source === "live" && r.vwap != null);
    if (live.length === 0) return sampleVwapSeries(days);

    // Keep only snapshots matching the latest basket, so the chart begins at the
    // current basket's first point (no composition-change jumps).
    const latestBasket = basketKey(live[live.length - 1].components ?? []);
    const matching = live.filter((r) => basketKey(r.components ?? []) === latestBasket);
    const rows = matching.length > 0 ? matching : live;

    const seen = new Set<number>();
    const points: SamplePoint[] = [];
    for (const row of rows) {
      const t = Math.floor(new Date(row.ts).getTime() / 1000);
      if (seen.has(t)) continue;
      seen.add(t);
      points.push({ time: t, value: Number(row.vwap) });
    }
    return points;
  } catch {
    return sampleVwapSeries(days);
  }
}

interface ProviderSeriesRow {
  ts: string;
  components: QpuComponent[] | null;
  source: "live" | "sample";
}

/** Provider-level normalized USD/NQH histories for the console market view. */
export async function getProviderSeries(days = 120): Promise<ProviderSampleSeries> {
  if (!isSupabaseConfigured()) return sampleProviderSeries(days);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_snapshots")
      .select("ts,components,source")
      .order("ts", { ascending: true })
      .limit(SERIES_LIMIT);
    if (error || !data || data.length === 0) return sampleProviderSeries(days);

    const cutoff = Date.now() / 1000 - days * 86_400;
    const output: ProviderSampleSeries = {};
    for (const row of data as ProviderSeriesRow[]) {
      if (row.source !== "live") continue;
      const time = Math.floor(new Date(row.ts).getTime() / 1000);
      if (!Number.isFinite(time) || time < cutoff) continue;
      for (const component of row.components ?? []) {
        if (!Number.isFinite(component.pricePerNqh)) continue;
        (output[component.provider] ??= []).push({ time, value: component.pricePerNqh });
      }
    }
    return Object.keys(output).length > 0 ? output : sampleProviderSeries(days);
  } catch {
    return sampleProviderSeries(days);
  }
}
