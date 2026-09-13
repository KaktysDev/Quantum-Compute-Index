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
const PUBLIC_QCI_TTL_MS = 60_000;

function publicWindow(days: number) {
  if (!Number.isFinite(days)) return 365;
  return Math.min(Math.max(Math.floor(days), 1), SERIES_LIMIT);
}

function seriesLimit(days: number) {
  return Math.min(publicWindow(days) + 1, SERIES_LIMIT);
}

export function resetPublicQciCache() {
  publicQciCache.clear();
}

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
 * Load the series the QCI tab and public charts need.
 *
 * History is scalar columns only. Each `point` blob is a full IndexPoint
 * (devices, factors, attribution) — pulling it for every day blocked first
 * paint on the landing page and the console QCI tab, and nothing that calls
 * this function reads `deviceSeries`. The map gets today's point from a
 * second, single-row query.
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
    const [{ data, error }, latestRes] = await Promise.all([
      supabase
        .from("qci_index_points")
        .select(
          "ts, index_date, level, change_pct, usd_per_qpu_hour, usd_per_qcu, coverage, matched, status, cost_basis_per_hour",
        )
        .order("index_date", { ascending: false })
        .limit(seriesLimit(days)),
      supabase
        .from("qci_index_points")
        .select("point")
        .order("index_date", { ascending: false })
        .limit(1),
    ]);

    const readError = error ?? latestRes.error;
    if (readError) {
      // Distinguish "table not created yet" from a real failure — the former is
      // the expected state before the migration is applied.
      const missing = /relation .* does not exist|schema cache/i.test(readError.message);
      return empty(
        missing
          ? "The QCI v2 tables do not exist yet. Apply supabase/qci-v2.sql."
          : `Could not read the index: ${readError.message}`,
      );
    }
    if (!data || data.length === 0) {
      return empty("No index points recorded yet. Run a refresh to compute the first one.");
    }

    const rows = (data as unknown as PointRow[]).slice().reverse();
    const cutoff = Date.now() / 1000 - publicWindow(days) * 86_400;

    const series: QciSeries = { level: [], usdPerQpuHour: [], usdPerQcu: [], costBasis: [] };

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
    }

    const latest = !latestRes.error && latestRes.data?.[0]
      ? (latestRes.data[0] as { point: IndexPoint }).point
      : null;

    return {
      hasData: true,
      latest,
      series,
      deviceSeries: {},
    };
  } catch (e) {
    return empty(
      `Could not read the index: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
}

/**
 * The published headline, for every PUBLIC surface: landing, pricing, /api/qci.
 *
 * WHY THIS EXISTS
 * Those pages read v1's `getLatestSnapshot()`, which publishes a different
 * quantity under the same words. On 12 Aug 2026 the console said $5,317 per
 * QPU-hour while the landing page said $2,509.81 per "QC-hour" and the pricing
 * page repeated the second figure — two prices for one product, on one site,
 * three clicks apart. Worse, v1 falls back to `sampleSeries()` when it has
 * nothing, so a visitor could be shown a random walk with no way to tell.
 *
 * One function, one number, every surface. It returns `hasData: false` rather
 * than inventing anything, and callers are expected to render that state.
 */
export interface PublicQci {
  hasData: boolean;
  /** Headline USD per QPU-hour, 0 when nothing is published. */
  usdPerQpuHour: number;
  /** Day-over-day move, in percent. */
  changePct: number;
  /** Chain-linked level, 1,000 at inception. */
  level: number;
  /** Modelled cost to produce an hour, when the cost model ran. */
  costBasisPerHour: number | null;
  /** ISO timestamp of the published point. */
  ts: string | null;
  machines: number;
  providers: number;
  /** USD/QPU-hour history — the series every public chart draws. */
  series: SeriesPoint[];
  emptyReason?: string;
}

const PUBLIC_QCI_CACHE_MAX = 8;
const publicQciCache = new Map<number, { expiresAt: number; value: PublicQci }>();

function emptyPublic(reason: string): PublicQci {
  return {
    hasData: false,
    usdPerQpuHour: 0,
    changePct: 0,
    level: 0,
    costBasisPerHour: null,
    ts: null,
    machines: 0,
    providers: 0,
    series: [],
    emptyReason: reason,
  };
}

function rememberPublicQci(days: number, value: PublicQci): PublicQci {
  if (publicQciCache.has(days)) publicQciCache.delete(days);
  publicQciCache.set(days, { expiresAt: Date.now() + PUBLIC_QCI_TTL_MS, value });
  while (publicQciCache.size > PUBLIC_QCI_CACHE_MAX) {
    const first = publicQciCache.keys().next().value;
    if (first === undefined) break;
    publicQciCache.delete(first);
  }
  return value;
}

export async function getPublicQci(days = 365): Promise<PublicQci> {
  const window = publicWindow(days);
  const cached = publicQciCache.get(window);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!isSupabaseConfigured()) {
    return rememberPublicQci(
      window,
      emptyPublic("Supabase is not configured — set NEXT_PUBLIC_SUPABASE_URL and keys."),
    );
  }

  try {
    const supabase = await createClient();
    // Public surfaces only need the headline point plus the USD/QPU-hour
    // series. Reusing getQciView() pulled every historical `point` blob
    // (devices, factors, attribution) for a payload the landing page discarded.
    const [latestRes, seriesRes] = await Promise.all([
      supabase
        .from("qci_index_points")
        .select("point")
        .order("index_date", { ascending: false })
        .limit(1),
      supabase
        .from("qci_index_points")
        .select("ts, usd_per_qpu_hour, coverage, status")
        .order("index_date", { ascending: false })
        .limit(seriesLimit(window)),
    ]);

    const readError = latestRes.error ?? seriesRes.error;
    if (readError) {
      const missing = /relation .* does not exist|schema cache/i.test(readError.message);
      const value = emptyPublic(
        missing
          ? "The QCI v2 tables do not exist yet. Apply supabase/qci-v2.sql."
          : `Could not read the index: ${readError.message}`,
      );
      return missing ? rememberPublicQci(window, value) : value;
    }

    const latest = (latestRes.data?.[0] as { point?: IndexPoint } | undefined)?.point ?? null;
    if (!latest) {
      return rememberPublicQci(
        window,
        emptyPublic("No index points recorded yet. Run a refresh to compute the first one."),
      );
    }

    const cutoff = Date.now() / 1000 - window * 86_400;
    const series: SeriesPoint[] = [];
    for (const row of (seriesRes.data ?? []) as Array<{
      ts: string;
      usd_per_qpu_hour: number | string | null;
      coverage: number | string;
      status: "final" | "provisional";
    }>) {
      const time = seconds(row.ts);
      if (!Number.isFinite(time) || time < cutoff) continue;
      const perHour = num(row.usd_per_qpu_hour);
      if (perHour != null && perHour > 0) {
        series.push({ time, value: perHour, coverage: num(row.coverage) ?? 0, status: row.status });
      }
    }
    series.sort((a, b) => a.time - b.time);

    return rememberPublicQci(window, {
      hasData: true,
      usdPerQpuHour: latest.usdPerQpuHour,
      changePct: latest.changePct,
      level: latest.level,
      costBasisPerHour: latest.costBasisPerHour ?? null,
      ts: latest.ts,
      machines: latest.devices?.length ?? 0,
      providers: new Set((latest.devices ?? []).map((d) => d.provider)).size,
      series,
    });
  } catch (e) {
    return emptyPublic(`Could not read the index: ${e instanceof Error ? e.message : "unknown error"}`);
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
