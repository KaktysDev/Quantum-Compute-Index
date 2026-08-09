// ──────────────────────────────────────────────────────────────────────────────
// Index health — what the admin view needs to answer one question:
//
//     "Is any number on this platform stale, or quietly hard-coded?"
//
// Everything here is DERIVED, never asserted. The expected feed list comes from
// the registry (which regions the basket actually sits in), the observed values
// come from the published point, and anything expected-but-absent is reported
// with the pinned constant that stood in for it. A feed that has silently gone
// away therefore shows up as a named row saying which constant is being used in
// its place, rather than as an unremarkable gap.
// ──────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { requiredEnergyRegions, REGISTRY } from "./registry";
import { DEFAULT_FACTORS } from "./sources/factors";
import type { IndexPoint, SourceTier } from "./types";

export interface FeedStatus {
  id: string;
  label: string;
  group: string;
  /** The value in force, whether it came from the feed or from a default. */
  value: number;
  unit: string;
  tier: SourceTier;
  source: string;
  citation?: string;
  /** When the source says the value was true. */
  observedAt?: string;
  /** Age of that figure, in days. */
  ageDays?: number;
  /** Days past which the value must not be reused, per the collector. */
  maxAgeDays?: number;
  /** True when the live feed did not report and a pinned constant is in force. */
  usingDefault: boolean;
  /** True when the figure is older than the collector's own limit for it. */
  stale: boolean;
}

/** Every factor the cost model will look up for the current basket. */
export function expectedFeeds(): Array<{ id: string; label: string; group: string; unit: string; fallback: number }> {
  const regions = requiredEnergyRegions(REGISTRY);
  return [
    { id: "fx.usd_per_eur", label: "USD per EUR", group: "fx", unit: "USD/EUR", fallback: DEFAULT_FACTORS.usdPerEur },
    { id: "capital.discount_rate", label: "Discount rate", group: "capital", unit: "decimal", fallback: DEFAULT_FACTORS.discountRate },
    {
      id: "cryogenics.industrial_gas_ppi",
      label: "Industrial gas PPI",
      group: "cryogenics",
      unit: "index",
      fallback: DEFAULT_FACTORS.industrialGasPpi,
    },
    ...regions.usStates.map((s) => ({
      id: `energy.us.${s.toLowerCase()}`,
      label: `${s} industrial electricity`,
      group: "energy",
      unit: "USD/kWh",
      fallback: DEFAULT_FACTORS.usIndustrialElectricity,
    })),
    ...regions.euCountries.map((c) => ({
      id: `energy.eu.${c.toLowerCase()}`,
      label: `${c} industrial electricity`,
      group: "energy",
      unit: "EUR/kWh",
      fallback: DEFAULT_FACTORS.euIndustrialElectricity,
    })),
  ];
}

/**
 * Reconcile the feeds the cost model needs against the ones the published point
 * actually carries.
 */
export function feedStatuses(point: IndexPoint | null, now = Date.now()): FeedStatus[] {
  const observed = new Map((point?.factors ?? []).map((f) => [f.id, f]));
  return expectedFeeds().map((want): FeedStatus => {
    const got = observed.get(want.id);
    if (!got) {
      return {
        ...want,
        value: want.fallback,
        tier: "assumed",
        source: "qci.default",
        citation: `Live source did not report; pinned constant ${want.fallback} ${want.unit} in force`,
        usingDefault: true,
        stale: false,
      };
    }
    const o = got.observation;
    const ageDays = Number.isFinite(Date.parse(o.observedAt))
      ? Math.max(0, (now - Date.parse(o.observedAt)) / 86_400_000)
      : undefined;
    return {
      id: want.id,
      label: got.label || want.label,
      group: got.group,
      value: o.value,
      unit: got.unit || want.unit,
      tier: o.tier,
      source: o.source,
      citation: o.citation,
      observedAt: o.observedAt,
      ageDays,
      maxAgeDays: o.maxAgeDays,
      usingDefault: o.tier === "assumed",
      stale: ageDays != null && o.maxAgeDays != null && ageDays > o.maxAgeDays,
    };
  });
}

export interface RefreshRun {
  started_at: string;
  finished_at: string | null;
  index_date: string | null;
  ok: boolean;
  wrote: boolean;
  reason: string | null;
  error: string | null;
  coverage: number | null;
  matched: number | null;
  observed: number | null;
  warnings: string[] | null;
  price_card_version: string | null;
}

export interface IndexHealth {
  latest: IndexPoint | null;
  latestDate: string | null;
  /** Rows in the raw observation archive for the latest index date. */
  archivedToday: number;
  /** Distinct dates with a published point. */
  pointCount: number;
  runs: RefreshRun[];
  /** Non-fatal problem reading any of the above. */
  error?: string;
}

type Client = SupabaseClient;

/**
 * Load everything the health view shows, from the v2 tables only.
 *
 * The health page used to read `qci_snapshots` — the LEGACY engine's table —
 * while the QCI tab rendered `qci_index_points`. The two run independently, so
 * the page could report a fresh, healthy index at $2,509 while the index the
 * product actually publishes sat at $0. Reading one source removes that whole
 * class of disagreement.
 */
export async function getIndexHealth(supabase: Client): Promise<IndexHealth> {
  try {
    const [pointsRes, runsRes] = await Promise.all([
      supabase
        .from("qci_index_points")
        .select("index_date, point")
        .order("index_date", { ascending: false })
        .limit(400),
      supabase
        .from("qci_refresh_runs")
        .select(
          "started_at, finished_at, index_date, ok, wrote, reason, error, coverage, matched, observed, warnings, price_card_version",
        )
        .order("started_at", { ascending: false })
        .limit(8),
    ]);

    if (pointsRes.error) {
      return {
        latest: null,
        latestDate: null,
        archivedToday: 0,
        pointCount: 0,
        runs: [],
        error: pointsRes.error.message,
      };
    }

    const rows = (pointsRes.data ?? []) as Array<{ index_date: string; point: IndexPoint }>;
    const latestDate = rows[0]?.index_date ?? null;

    let archivedToday = 0;
    if (latestDate) {
      const { count } = await supabase
        .from("qci_observations")
        .select("device_id", { count: "exact", head: true })
        .eq("index_date", latestDate);
      archivedToday = count ?? 0;
    }

    return {
      latest: rows[0]?.point ?? null,
      latestDate,
      archivedToday,
      pointCount: rows.length,
      runs: (runsRes.data ?? []) as RefreshRun[],
      error: runsRes.error?.message,
    };
  } catch (e) {
    return {
      latest: null,
      latestDate: null,
      archivedToday: 0,
      pointCount: 0,
      runs: [],
      error: e instanceof Error ? e.message : "unknown error",
    };
  }
}
