// ──────────────────────────────────────────────────────────────────────────────
// Read path for the v2 index. SERVER-side only.
//
// ONE RULE: THIS MODULE NEVER INVENTS DATA.
//
// v1's read path fell back to `sampleSeries()`, a mulberry32 pseudo-random walk
// seeded from the day number, whenever the database was empty or unreachable:
//
//     logLevel += drift + 0.012 * noise + cycle;
//     points.push({ value: round(1000 * Math.exp(logLevel)) });
//
// It rendered as a chart on the landing page and the QCI tab. It was labelled
// "sample", but a plausible-looking line with plausible-looking daily moves
// reads as history to anyone who is not reading the legend — and the per-provider
// variant went further, deriving each provider's "beta" from the character codes
// of its name. That is the "it makes up some numbers" problem, and no amount of
// labelling fixes it.
//
// v2 returns an empty series and an explicit `hasData: false` instead. A blank
// chart that says "no observations yet" is worth more than a beautiful one that
// is not true.
// ──────────────────────────────────────────────────────────────────────────────

import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { IndexPoint } from "./types";

/** How many points to chart. Daily cadence, so this is a few years of headroom. */
const SERIES_LIMIT = 1200;

export interface SeriesPoint {
  /** UNIX seconds, to match the charting library. */
  time: number;
  value: number;
  /** Coverage on that day, so the UI can de-emphasise thin points. */
  coverage: number;
  status: "final" | "provisional";
}

export interface QciSeries {
  /** Chain-linked index level. */
  level: SeriesPoint[];
  /** Headline USD per QPU-hour. */
  usdPerQpuHour: SeriesPoint[];
  /** Quality-adjusted USD per capability unit-hour. */
  usdPerQcu: SeriesPoint[];
  /** Modelled marginal cost of a QPU-hour. */
  costBasis: SeriesPoint[];
}

export interface QciView {
  hasData: boolean;
  latest: IndexPoint | null;
  series: QciSeries;
  /** Per-device USD/QPU-hour history, keyed by device id. */
  deviceSeries: Record<string, SeriesPoint[]>;
  /** Human-readable reason there is no data, when there is none. */
  emptyReason?: string;
}

const EMPTY_SERIES: QciSeries = {
  level: [],
  usdPerQpuHour: [],
  usdPerQcu: [],
  costBasis: [],
};

function empty(reason: string): QciView {
  return {
    hasData: false,
    latest: null,
    series: EMPTY_SERIES,
    deviceSeries: {},
    emptyReason: reason,
  };
}

interface PointRow {
  ts: string;
  index_date: string;
  level: number | string;
  change_pct: number | string;
  usd_per_qpu_hour: number | string | null;
  usd_per_qcu: number | string | null;
  coverage: number | string;
  matched: number;
  status: "final" | "provisional";
  cost_basis_per_hour: number | string | null;
  point: IndexPoint;
}

function seconds(ts: string): number {
  return Math.floor(new Date(ts).getTime() / 1000);
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Load the full view the QCI tab needs, in one query.
 *
 * Unlike v1's `getSeries`, this does NOT filter history down to snapshots that
 * share the current basket. That filter was a workaround for v1's composition
 * jumps — it hid them by truncating the chart back to whenever the basket last
 * changed, which is why history kept disappearing. Under the matched-sample link
 * composition changes no longer create jumps, so the whole series is comparable
 * and all of it is shown.
 */
export async function getQciView(days = 365): Promise<QciView> {
  if (!isSupabaseConfigured()) {
    return empty("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and keys.");
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_index_points")
      .select(
        "ts, index_date, level, change_pct, usd_per_qpu_hour, usd_per_qcu, coverage, matched, status, cost_basis_per_hour, point",
      )
      .order("index_date", { ascending: true })
      .limit(SERIES_LIMIT);

    if (error) {
      // Distinguish "table not created yet" from a real failure — the former is
      // the expected state before the migration is applied.
      const missing = /relation .* does not exist|schema cache/i.test(error.message);
      return empty(
        missing
          ? "The QCI v2 tables do not exist yet. Apply supabase/qci-v2.sql."
          : `Could not read the index: ${error.message}`,
      );
    }
    if (!data || data.length === 0) {
      return empty("No index points recorded yet. Run a refresh to compute the first one.");
    }

    const rows = data as unknown as PointRow[];
    const cutoff = Date.now() / 1000 - days * 86_400;

    const series: QciSeries = { level: [], usdPerQpuHour: [], usdPerQcu: [], costBasis: [] };
    const deviceSeries: Record<string, SeriesPoint[]> = {};

    for (const row of rows) {
      const time = seconds(row.ts);
      if (!Number.isFinite(time) || time < cutoff) continue;
      const coverage = num(row.coverage) ?? 0;
      const base = { time, coverage, status: row.status };

      const level = num(row.level);
      if (level != null) series.level.push({ ...base, value: level });
      const perHour = num(row.usd_per_qpu_hour);
      if (perHour != null && perHour > 0) series.usdPerQpuHour.push({ ...base, value: perHour });
      const perQcu = num(row.usd_per_qcu);
      if (perQcu != null && perQcu > 0) series.usdPerQcu.push({ ...base, value: perQcu });
      const cost = num(row.cost_basis_per_hour);
      if (cost != null && cost > 0) series.costBasis.push({ ...base, value: cost });

      for (const d of row.point?.devices ?? []) {
        if (!Number.isFinite(d.pricePerHour) || d.pricePerHour <= 0) continue;
        (deviceSeries[d.id] ??= []).push({ ...base, value: d.pricePerHour });
      }
    }

    return {
      hasData: true,
      latest: rows[rows.length - 1].point,
      series,
      deviceSeries,
    };
  } catch (e) {
    return empty(
      `Could not read the index: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
}

/** Just the latest point — for the landing page and the routing engine. */
export async function getLatestPoint(): Promise<IndexPoint | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("qci_index_points")
      .select("point")
      .order("index_date", { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    return (data[0] as { point: IndexPoint }).point;
  } catch {
    return null;
  }
}
