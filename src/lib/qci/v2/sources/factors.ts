// ──────────────────────────────────────────────────────────────────────────────
// External cost factors — energy, cryogens, capital and FX.
//
// These feed the COST BASIS, not the headline price. The distinction is the
// single most important design decision in v2 and it is worth stating plainly:
//
//   A price index must measure prices. If electricity tariffs were allowed to
//   push the QCI around, the number would stop being "what quantum compute
//   costs to buy" and become an opaque blend of a price and a forecast.
//
// So the factors are published as a companion series — the bottom-up marginal
// cost of a QPU-hour — plus the ratio between the two. That ratio is the
// genuinely interesting number, and it is the honest way to answer "does energy
// drive the price of quantum compute?" (Short version, from the real numbers in
// cost.ts: no, not yet, by about two orders of magnitude. The map shows that
// rather than implying a sensitivity that does not exist.)
//
// MIXED FREQUENCY IS REAL AND IS NOT HIDDEN
// Every collector reports the source's own effective date. The honest cadences,
// verified against the live endpoints:
//
//   FX (ECB reference rates) ................ daily, business days
//   US electricity (EIA retail sales) ....... MONTHLY, ~2-month lag
//   EU electricity (Eurostat nrg_pc_205) .... BI-ANNUAL
//   Interest rates (US Treasury) ............ monthly average (daily via FRED)
//   Industrial gases PPI (BLS, helium proxy)  MONTHLY
//   Helium spot ............................. NO FEED EXISTS (USGS is annual)
//
// A daily index built on a bi-annual input is not "daily data" for that input,
// and pretending otherwise is how a number stops being trustworthy. Each factor
// therefore travels with its `observedAt` and its `maxAgeDays`, and the UI shows
// both. What updates daily is the PRICE side; the cost side updates when its
// sources do.
//
// Every collector here FAILS SOFT. A factor outage must never stop the index —
// it degrades the cost basis to its pinned default and says so.
// ──────────────────────────────────────────────────────────────────────────────

import type { FactorObservation, Observation, SourceTier } from "../types";

const DAY = 86_400_000;

function iso(d: Date): string {
  return d.toISOString();
}

/** Build a factor with full provenance. */
function factor(
  id: string,
  group: string,
  label: string,
  unit: string,
  value: number,
  opts: {
    tier: SourceTier;
    source: string;
    citation?: string;
    observedAt: string;
    maxAgeDays: number;
  },
): FactorObservation {
  return {
    id,
    group,
    label,
    unit,
    observation: {
      value,
      tier: opts.tier,
      source: opts.source,
      citation: opts.citation,
      observedAt: opts.observedAt,
      fetchedAt: iso(new Date()),
      maxAgeDays: opts.maxAgeDays,
    },
  };
}

async function getJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Pinned defaults ───────────────────────────────────────────────────────────
// Used when a source is unreachable or its key is not configured. These are
// `assumed` tier and are visible as such in the UI. They exist so the cost model
// always produces a number rather than a hole; they are never used for prices.
/**
 * The level of the industrial-gas PPI that `CONSUMABLES_RATE` is calibrated
 * against — the DENOMINATOR the consumables term is rebased on.
 *
 * This must be a real level of the series, not a notional 100. PCU325120325120
 * is a 1982-base index currently running near 288, so dividing by 100 would
 * multiply the consumables term by ~2.9 the instant the feed answered — an
 * 18% jump in the published cost basis caused by nothing but a unit mismatch,
 * indistinguishable on the chart from a real cryogen shock. That is exactly the
 * class of silent artefact the v2 rewrite exists to remove.
 *
 * Two jobs were previously collapsed into one constant: "what to use when the
 * feed is down" and "what level the rate was calibrated at". They are separate
 * now, and the pinned default below is deliberately set EQUAL to this base so a
 * defaulted run yields an adjustment of exactly 1.0 rather than a silent
 * re-levelling.
 *
 * Re-verify against the series when revisiting CONSUMABLES_RATE.
 */
export const INDUSTRIAL_GAS_PPI_BASE = 288.182;
/** Period of the level above, so a reader can check it against the source. */
export const INDUSTRIAL_GAS_PPI_BASE_PERIOD = "2026-06";

export const DEFAULT_FACTORS = {
  /** USD/kWh, US industrial average. */
  usIndustrialElectricity: 0.0834,
  /** USD/kWh, EU industrial average (band IC, excl. recoverable taxes). */
  euIndustrialElectricity: 0.1712,
  /** USD per EUR. */
  usdPerEur: 1.08,
  /** Nominal discount rate used for capital recovery, as a decimal. */
  discountRate: 0.042,
  /**
   * Index level, BLS PPI industrial gas manufacturing (helium proxy). Equal to
   * the rebase base by construction — see INDUSTRIAL_GAS_PPI_BASE.
   */
  industrialGasPpi: INDUSTRIAL_GAS_PPI_BASE,
} as const;

// ── FX: ECB reference rates (no auth, verified working) ──────────────────────
/**
 * The ECB Data Portal publishes the euro reference rates as SDMX. We request
 * `csvdata` because it is far cheaper to parse than the JSON envelope and the
 * series is a single observation.
 *
 * Series EXR.D.USD.EUR.SP00.A is USD per 1 EUR, published each TARGET business
 * day at ~16:00 CET. On weekends and TARGET holidays the latest observation is
 * simply the prior business day — which is correct, not stale.
 */
export async function fetchUsdPerEur(): Promise<FactorObservation | null> {
  try {
    const url =
      "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let text: string;
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "text/csv" } });
      if (!res.ok) throw new Error(`ECB → HTTP ${res.status}`);
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    const header = lines[0].split(",");
    const cols = lines[1].split(",");
    const periodIdx = header.indexOf("TIME_PERIOD");
    const valueIdx = header.indexOf("OBS_VALUE");
    if (periodIdx < 0 || valueIdx < 0) return null;
    const value = Number(cols[valueIdx]);
    if (!Number.isFinite(value) || value <= 0) return null;
    return factor("fx.usd_per_eur", "fx", "USD per EUR", "USD/EUR", value, {
      tier: "official",
      source: "ecb.data-portal.exr",
      citation: "ECB euro foreign exchange reference rates (EXR.D.USD.EUR.SP00.A)",
      observedAt: `${cols[periodIdx]}T16:00:00Z`,
      maxAgeDays: 7,
    });
  } catch (e) {
    console.error("[qci/factors] ECB FX fetch failed", e);
    return null;
  }
}

// ── US electricity: EIA Open Data v2 (free key) ──────────────────────────────
interface EiaResponse {
  response?: { data?: Array<{ period?: string; price?: number; stateid?: string }> };
}

/**
 * Industrial retail electricity price in cents/kWh for the states our tracked
 * hardware actually sits in.
 *
 * MONTHLY, published with roughly a two-month lag — this is the real cadence of
 * US retail electricity statistics, not a limitation of the integration. We use
 * the INDUSTRIAL sector because a quantum lab buys on an industrial tariff, and
 * retail rather than wholesale because that is what an operator actually pays.
 *
 * Free key: https://www.eia.gov/opendata/register.php  (env EIA_API_KEY)
 */
export async function fetchUsElectricity(states: string[]): Promise<FactorObservation[]> {
  const apiKey = process.env.EIA_API_KEY;
  if (!apiKey) return [];
  const out: FactorObservation[] = [];
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      frequency: "monthly",
      "data[0]": "price",
      "facets[sectorid][]": "IND",
      // EIA's v2 API rejects the shorthand `sort=-period` with a 400 as of this
      // writing ("Invalid format for 'sort'. Must provide a sort priority, a
      // sort type, and a sort column") — verified live. The structured form
      // below is what the API actually accepts today; the code below still
      // re-derives the newest row per state itself, so this is belt-and-braces
      // rather than load-bearing.
      "sort[0][column]": "period",
      "sort[0][direction]": "desc",
      length: "60",
    });
    for (const s of states) params.append("facets[stateid][]", s);
    const json = await getJson<EiaResponse>(
      `https://api.eia.gov/v2/electricity/retail-sales/data/?${params}`,
      { timeoutMs: 20_000 },
    );
    const rows = json.response?.data ?? [];
    // Keep only the newest observation per state.
    const newest = new Map<string, { period: string; price: number }>();
    for (const r of rows) {
      if (!r.stateid || !r.period || typeof r.price !== "number") continue;
      const cur = newest.get(r.stateid);
      if (!cur || r.period > cur.period) newest.set(r.stateid, { period: r.period, price: r.price });
    }
    for (const [state, r] of newest) {
      out.push(
        factor(
          `energy.us.${state.toLowerCase()}`,
          "energy",
          `${state} industrial electricity`,
          "USD/kWh",
          // EIA quotes cents per kWh.
          r.price / 100,
          {
            tier: "official",
            source: "eia.v2.retail-sales",
            citation: `US EIA Electric Power Monthly, industrial retail price, ${state}, ${r.period}`,
            // Month-granular: date it to the end of the reported month.
            observedAt: `${r.period}-28T00:00:00Z`,
            maxAgeDays: 120,
          },
        ),
      );
    }
  } catch (e) {
    console.error("[qci/factors] EIA fetch failed", e);
  }
  return out;
}

// ── EU electricity: Eurostat (no auth, verified working) ─────────────────────
/**
 * Eurostat half-year period → the ISO date the figure is effective from.
 *
 * The API returns the period as "2025S2" or "2025-S2" depending on the dataset,
 * so the separator is stripped rather than pattern-matched — an unhandled
 * variant here produced "2025--12-28T00:00:00Z", an invalid date that reads as
 * NaN staleness and silently marks a perfectly good figure as infinitely old.
 * Falls back to the mid-year date rather than emitting an unparseable string.
 */
export function eurostatPeriodToIso(period: string): string {
  const m = /^(\d{4})-?S([12])$/.exec(period.trim());
  if (m) {
    // S1 covers Jan–Jun, S2 covers Jul–Dec; date each to the end of its half.
    return `${m[1]}-${m[2] === "1" ? "06-30" : "12-31"}T00:00:00Z`;
  }
  const year = /^(\d{4})/.exec(period.trim())?.[1];
  return year ? `${year}-06-30T00:00:00Z` : new Date().toISOString();
}

interface EurostatResponse {
  updated?: string;
  value?: Record<string, number>;
  dimension?: {
    geo?: { category?: { index?: Record<string, number>; label?: Record<string, string> } };
    time?: { category?: { index?: Record<string, number> } };
  };
  id?: string[];
  size?: number[];
}

/**
 * Eurostat nrg_pc_205 — industrial electricity prices, band IC.
 *
 * BI-ANNUAL. Eurostat publishes one figure per half-year, so this input moves
 * twice a year and no amount of daily polling changes that. It is included
 * because it is the authoritative EU number and because the cost basis needs a
 * real EU tariff rather than a US one applied to Finnish hardware — not because
 * it contributes daily variation. The UI labels it with its actual period.
 */
export async function fetchEuElectricity(countries: string[]): Promise<FactorObservation[]> {
  if (countries.length === 0) return [];
  const out: FactorObservation[] = [];
  try {
    const params = new URLSearchParams({ format: "JSON", lang: "EN" });
    for (const c of countries) params.append("geo", c);
    // Band IC = 500–2000 MWh/year; excluding VAT and other recoverable taxes,
    // which is what a business actually bears.
    params.append("nrg_cons", "MWH500-1999");
    params.append("tax", "X_TAX");
    params.append("currency", "EUR");
    params.append("unit", "KWH");
    const json = await getJson<EurostatResponse>(
      `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_205?${params}`,
      { timeoutMs: 25_000 },
    );

    const geoIndex = json.dimension?.geo?.category?.index ?? {};
    const geoLabel = json.dimension?.geo?.category?.label ?? {};
    const timeIndex = json.dimension?.time?.category?.index ?? {};
    const dims = json.id ?? [];
    const sizes = json.size ?? [];
    const geoDim = dims.indexOf("geo");
    const timeDim = dims.indexOf("time");
    if (geoDim < 0 || timeDim < 0 || sizes.length !== dims.length) return [];

    // Decode the flat JSON-stat value map back into (geo, time) coordinates.
    const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1));
    const times = Object.entries(timeIndex).sort((a, b) => b[1] - a[1]);
    const newest = new Map<string, { period: string; value: number }>();

    for (const [flat, value] of Object.entries(json.value ?? {})) {
      if (typeof value !== "number") continue;
      let rem = Number(flat);
      const coords: number[] = [];
      for (let i = 0; i < sizes.length; i++) {
        coords.push(Math.floor(rem / strides[i]));
        rem %= strides[i];
      }
      const geoCode = Object.keys(geoIndex).find((k) => geoIndex[k] === coords[geoDim]);
      const period = times.find(([, idx]) => idx === coords[timeDim])?.[0];
      if (!geoCode || !period) continue;
      const cur = newest.get(geoCode);
      if (!cur || period > cur.period) newest.set(geoCode, { period, value });
    }

    for (const [geo, r] of newest) {
      out.push(
        factor(
          `energy.eu.${geo.toLowerCase()}`,
          "energy",
          `${geoLabel[geo] ?? geo} industrial electricity`,
          "EUR/kWh",
          r.value,
          {
            tier: "official",
            source: "eurostat.nrg_pc_205",
            citation: `Eurostat nrg_pc_205, band IC excl. recoverable taxes, ${geo}, ${r.period}`,
            observedAt: eurostatPeriodToIso(r.period),
            // Bi-annual: a figure stays current for a full half-year plus lag.
            maxAgeDays: 400,
          },
        ),
      );
    }
  } catch (e) {
    console.error("[qci/factors] Eurostat fetch failed", e);
  }
  return out;
}

// ── Discount rate: US Treasury FiscalData (no auth, verified working) ────────
interface TreasuryResponse {
  data?: Array<{ record_date?: string; security_desc?: string; avg_interest_rate_amt?: string }>;
}

/**
 * Average interest rate on marketable Treasury Notes — the discount rate for
 * the capital-recovery term in the cost model.
 *
 * Monthly. FRED's DGS10 is daily and would be marginally better, but it needs a
 * key; this endpoint needs none, and the capital-recovery factor is so
 * insensitive to a few basis points that daily granularity buys nothing real.
 */
export async function fetchDiscountRate(): Promise<FactorObservation | null> {
  try {
    const url =
      "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates" +
      "?fields=record_date,security_desc,avg_interest_rate_amt&sort=-record_date&page%5Bsize%5D=40";
    const json = await getJson<TreasuryResponse>(url, { timeoutMs: 20_000 });
    const row = (json.data ?? []).find((r) => r.security_desc === "Treasury Notes");
    const pct = Number(row?.avg_interest_rate_amt);
    if (!row?.record_date || !Number.isFinite(pct)) return null;
    return factor("capital.discount_rate", "capital", "Discount rate", "decimal", pct / 100, {
      tier: "official",
      source: "treasury.fiscaldata.avg-interest-rates",
      citation: `US Treasury average interest rate, marketable Treasury Notes, ${row.record_date}`,
      observedAt: `${row.record_date}T00:00:00Z`,
      maxAgeDays: 90,
    });
  } catch (e) {
    console.error("[qci/factors] Treasury fetch failed", e);
    return null;
  }
}

// ── Cryogens: BLS PPI for industrial gases (free key) ────────────────────────
interface BlsResponse {
  status?: string;
  Results?: {
    series?: Array<{
      seriesID?: string;
      data?: Array<{ year?: string; period?: string; value?: string }>;
    }>;
  };
}

/**
 * Helium is the cryogen that matters for superconducting hardware, and there is
 * NO daily helium price feed anywhere — USGS publishes annually, and the BLM
 * auctions that once set a public reference price have ended. The closest
 * regularly-published, machine-readable series is the BLS Producer Price Index
 * for industrial gas manufacturing (NAICS 32512), which is monthly.
 *
 * It is used as a RELATIVE index for the consumables term, never as a helium
 * price. That limitation is stated in the methodology rather than papered over.
 *
 * Free key: https://data.bls.gov/registrationEngine/  (env BLS_API_KEY)
 */
export async function fetchIndustrialGasPpi(): Promise<FactorObservation | null> {
  const seriesId = "PCU325120325120"; // PPI, industrial gas manufacturing
  try {
    const key = process.env.BLS_API_KEY;
    const year = new Date().getUTCFullYear();
    const json = await getJson<BlsResponse>(
      key
        ? "https://api.bls.gov/publicAPI/v2/timeseries/data/"
        : "https://api.bls.gov/publicAPI/v1/timeseries/data/",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesid: [seriesId],
          startyear: String(year - 1),
          endyear: String(year),
          ...(key ? { registrationkey: key } : {}),
        }),
        timeoutMs: 25_000,
      },
    );
    const data = json.Results?.series?.[0]?.data ?? [];
    const latest = data.find((d) => Number.isFinite(Number(d.value)));
    if (!latest?.year || !latest.period) return null;
    const month = latest.period.replace("M", "");
    return factor(
      "cryogenics.industrial_gas_ppi",
      "cryogenics",
      "Industrial gas PPI",
      "index",
      Number(latest.value),
      {
        tier: "official",
        source: "bls.ppi.industrial-gas",
        citation: `BLS PPI series ${seriesId} (industrial gas manufacturing), ${latest.year}-${month}`,
        observedAt: `${latest.year}-${month}-28T00:00:00Z`,
        maxAgeDays: 120,
      },
    );
  } catch (e) {
    console.error("[qci/factors] BLS PPI fetch failed", e);
    return null;
  }
}

/**
 * Collect every factor, in parallel, failing soft.
 *
 * `regions` is the set of places our basket's hardware physically sits, so we
 * only fetch tariffs we will actually use.
 */
export async function collectFactors(regions: {
  usStates: string[];
  euCountries: string[];
}): Promise<FactorObservation[]> {
  const [fx, us, eu, rate, ppi] = await Promise.all([
    fetchUsdPerEur(),
    fetchUsElectricity(regions.usStates),
    fetchEuElectricity(regions.euCountries),
    fetchDiscountRate(),
    fetchIndustrialGasPpi(),
  ]);
  return [fx, ...us, ...eu, rate, ppi].filter((f): f is FactorObservation => f != null);
}

/** Pick a factor by id, falling back to a pinned default marked `assumed`. */
export function factorValue(
  factors: FactorObservation[],
  id: string,
  fallback: number,
  label: string,
  unit: string,
): Observation {
  const found = factors.find((f) => f.id === id);
  if (found) return found.observation;
  return {
    value: fallback,
    tier: "assumed",
    source: "qci.default",
    citation: `Pinned default for ${label} (${fallback} ${unit}) — live source unavailable this run`,
    observedAt: iso(new Date()),
    fetchedAt: iso(new Date()),
    maxAgeDays: 3650,
  };
}

/** Age of an observation in days, relative to `now`. */
export function ageDays(o: Observation, now: Date = new Date()): number {
  const t = Date.parse(o.observedAt);
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - t) / DAY);
}
