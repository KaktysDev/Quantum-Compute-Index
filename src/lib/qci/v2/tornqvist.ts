// ──────────────────────────────────────────────────────────────────────────────
// Matched-sample Törnqvist chain index.
//
// THE DEFECT THIS REPLACES
// v1 computed a LEVEL each day from absolute prices, then derived the move by
// dividing consecutive levels:
//     price_t = price_{t-1} · (vwap_t / vwap_{t-1})       … same basket
//     price_t = price_{t-1}                                … basket changed
// Two things go wrong. First, because the level is a weighted mean over
// whichever devices happened to answer, a device appearing or disappearing
// changes the mean even when no price moved — the "random burst" when a model
// goes offline. Second, the guard against that (carry the level over unchanged
// on any composition change) throws away the genuine price movement of every
// device that DID report that day.
//
// The fix is the standard one from official price statistics: never compare
// levels across different samples. Compare each device only against ITSELF, and
// aggregate the resulting relatives:
//
//     ln( I_t / I_{t-1} )  =  Σ_{d ∈ M_t}  w̄_d · ln( π_d,t / π_d,t-1 )
//
//     M_t  = devices with a usable observation in BOTH t-1 and t (matched sample)
//     w̄_d = ½ ( s_d,t-1 + s_d,t )              (Törnqvist weights)
//     s_d  = expenditure share of device d
//     π_d  = quality-adjusted price (quality.ts)
//
// Consequences that matter here:
//
//  • A device joining or leaving is a NON-EVENT. It simply is not in M_t, so it
//    contributes nothing. Its price LEVEL never enters the index — only its own
//    subsequent price CHANGES do. Adding QuEra can no longer reprice the index.
//
//  • Anything constant over time cancels exactly, because every term is a
//    ratio. That is what licenses the assumed per-modality layer rates and the
//    arbitrary hedonic reference points in quality.ts: they are identical in
//    both periods, so ln(π_t/π_{t-1}) is untouched by them.
//
//  • A stale carried-forward value contributes exactly ZERO movement rather
//    than a spurious one. In v1, carrying a value forward still changed the
//    weighted mean whenever the rest of the basket moved; here an unchanged
//    value has ln(1) = 0. Missing data cannot manufacture a price move.
//
//  • Törnqvist is a superlative index (Diewert 1976) — exact for a translog
//    cost function and second-order approximate to any twice-differentiable
//    one, which is why national statistical offices prefer it to a chained
//    Laspeyres for this job. It is also far less prone to chain drift.
//
// Devices that are missing from M_t are, in effect, imputed with the change of
// the matched cohort. That is the "all-items / class-mean imputation" that the
// ILO CPI Manual (2020, ch. 6) and Eurostat's HICP guidance prescribe for
// temporarily unavailable items — the same guidance issued at scale when
// COVID-19 made whole item classes unobservable.
// ──────────────────────────────────────────────────────────────────────────────

/** One device's paired observation across the two periods being linked. */
export interface MatchedPair {
  id: string;
  provider: string;
  /** Quality-adjusted price in the previous period. */
  prevPrice: number;
  /** Quality-adjusted price in the current period. */
  currPrice: number;
  /** Raw USD/QPU-hour in the previous period (for the price/quality split). */
  prevHeadline: number;
  /** Raw USD/QPU-hour in the current period. */
  currHeadline: number;
  /** Expenditure share in the previous period, pre-normalisation. */
  prevShare: number;
  /** Expenditure share in the current period, pre-normalisation. */
  currShare: number;
}

export interface LinkConfig {
  /** Maximum share any single device may carry. Excess is redistributed. */
  deviceWeightCap: number;
  /** Maximum share any single PROVIDER may carry across all its devices. */
  providerWeightCap: number;
  /**
   * Coverage below which the point is published as "provisional" rather than
   * "final". Not a suppression threshold — the index still computes; the label
   * tells a reader how much of the basket actually spoke that day.
   */
  provisionalBelowCoverage: number;
}

export const DEFAULT_LINK: LinkConfig = {
  deviceWeightCap: 0.25,
  providerWeightCap: 0.4,
  provisionalBelowCoverage: 0.6,
};

export interface LinkResult {
  /** ln(I_t / I_{t-1}). Zero when the matched sample is empty. */
  logChange: number;
  /** Portion of `logChange` from headline USD/hour moving. */
  priceLogChange: number;
  /** Portion from quality changing (negative quality change raises price). */
  qualityLogChange: number;
  /** Final capped, normalised weight actually used per device. */
  weights: Map<string, number>;
  /** Per-device contribution to `logChange`; sums to it. */
  contributions: Array<{ id: string; provider: string; contribution: number }>;
}

/**
 * Cap weights at the device and provider level, redistributing the excess
 * proportionally across uncapped devices. Iterated to a fixed point because
 * redistributing can push another device over its own cap.
 *
 * Capping matters here because the basket is small and expenditure share is
 * proportional to the hourly rate: without it, four IonQ devices at $7,000/hr
 * would carry over half the index and the QCI would be an IonQ tracker.
 * S&P and MSCI apply the same construction to capped indices.
 */
export function capWeights(
  raw: Array<{ id: string; provider: string; share: number }>,
  cfg: LinkConfig = DEFAULT_LINK,
): Map<string, number> {
  const total = raw.reduce((a, r) => a + Math.max(r.share, 0), 0);
  const weights = new Map<string, number>();
  if (total <= 0 || raw.length === 0) {
    // Degenerate input (e.g. every price zero) → fall back to equal weights so
    // the index still moves on the relatives rather than silently freezing.
    for (const r of raw) weights.set(r.id, raw.length > 0 ? 1 / raw.length : 0);
    return weights;
  }
  for (const r of raw) weights.set(r.id, Math.max(r.share, 0) / total);

  const byProvider = new Map<string, string[]>();
  for (const r of raw) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r.id);
    byProvider.set(r.provider, list);
  }

  // Caps must be FEASIBLE before they can be applied. The most weight a cap set
  // can absorb is Σ_providers min(providerCap, deviceCount × deviceCap); if that
  // is below 1 the constraints contradict each other and the redistribution loop
  // below oscillates forever instead of converging. (Concretely: six devices
  // across three providers under a 0.25 device cap and a 0.40 provider cap can
  // hold at most 0.90 — there is nowhere to put the remaining 0.10.)
  //
  // When they conflict, the DEVICE cap yields and the PROVIDER cap holds. The
  // provider cap is the one carrying the actual editorial guarantee — that the
  // QCI cannot quietly become a tracker for whichever vendor happens to list the
  // most machines — so it is relaxed only when it is unsatisfiable on its own
  // terms (fewer providers than 1/cap).
  const providerCap = Math.max(cfg.providerWeightCap, 1 / byProvider.size);
  const counts = [...byProvider.values()].map((ids) => ids.length);
  const capacityAt = (dc: number) =>
    counts.reduce((a, n) => a + Math.min(providerCap, n * dc), 0);

  let deviceCap = Math.max(cfg.deviceWeightCap, 1 / raw.length);
  if (capacityAt(deviceCap) < 1) {
    // Capacity is monotonic and piecewise linear in deviceCap; bisect for the
    // smallest value that makes the constraint set satisfiable.
    let lo = deviceCap;
    let hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (capacityAt(mid) >= 1) hi = mid;
      else lo = mid;
    }
    deviceCap = hi;
  }

  for (let pass = 0; pass < 32; pass++) {
    let adjusted = false;
    const frozen = new Set<string>();

    // Provider cap first — it is the coarser constraint.
    for (const [, ids] of byProvider) {
      const sum = ids.reduce((a, id) => a + (weights.get(id) ?? 0), 0);
      if (sum > providerCap + 1e-12) {
        const scale = providerCap / sum;
        for (const id of ids) {
          weights.set(id, (weights.get(id) ?? 0) * scale);
          frozen.add(id);
        }
        adjusted = true;
      }
    }
    for (const r of raw) {
      const w = weights.get(r.id) ?? 0;
      if (w > deviceCap + 1e-12) {
        weights.set(r.id, deviceCap);
        frozen.add(r.id);
        adjusted = true;
      }
    }
    if (!adjusted) break;

    // Redistribute the shortfall across everything not pinned this pass.
    const used = raw.reduce((a, r) => a + (weights.get(r.id) ?? 0), 0);
    const slack = 1 - used;
    if (Math.abs(slack) < 1e-12) break;
    const free = raw.filter((r) => !frozen.has(r.id));
    const freeSum = free.reduce((a, r) => a + (weights.get(r.id) ?? 0), 0);
    if (free.length === 0 || freeSum <= 0) {
      // Everything is pinned — normalise and accept the caps as they stand.
      const t = used > 0 ? used : 1;
      for (const r of raw) weights.set(r.id, (weights.get(r.id) ?? 0) / t);
      break;
    }
    for (const r of free) {
      weights.set(r.id, (weights.get(r.id) ?? 0) * (1 + slack / freeSum));
    }
  }

  // Final normalisation guards against accumulated float error.
  const sum = raw.reduce((a, r) => a + (weights.get(r.id) ?? 0), 0);
  if (sum > 0) for (const r of raw) weights.set(r.id, (weights.get(r.id) ?? 0) / sum);
  return weights;
}

/** Guard the log domain: a non-positive or non-finite price cannot be linked. */
function usable(p: number): boolean {
  return Number.isFinite(p) && p > 0;
}

/**
 * Link one period to the next over the matched sample.
 *
 * The price/quality split uses the identity π = P / q, so
 *     ln(π_t/π_{t-1}) = ln(P_t/P_{t-1}) − ln(q_t/q_{t-1})
 * and because the aggregation is a weighted sum of logs, the two components
 * add EXACTLY to the total. That exactness is what lets the QCI map state
 * "X% of this move was repricing, Y% was hardware getting better" as fact
 * rather than as an approximation.
 */
export function linkPeriod(
  pairs: MatchedPair[],
  cfg: LinkConfig = DEFAULT_LINK,
): LinkResult {
  const valid = pairs.filter(
    (p) => usable(p.prevPrice) && usable(p.currPrice),
  );
  if (valid.length === 0) {
    return {
      logChange: 0,
      priceLogChange: 0,
      qualityLogChange: 0,
      weights: new Map(),
      contributions: [],
    };
  }

  // Törnqvist weight: the average of the two periods' expenditure shares.
  // Capping is applied to that average rather than to each period separately,
  // so the weight a device carries cannot flip between periods.
  const avgShares = valid.map((p) => ({
    id: p.id,
    provider: p.provider,
    share: 0.5 * (Math.max(p.prevShare, 0) + Math.max(p.currShare, 0)),
  }));
  const weights = capWeights(avgShares, cfg);

  let logChange = 0;
  let priceLogChange = 0;
  let qualityLogChange = 0;
  const contributions: LinkResult["contributions"] = [];

  for (const p of valid) {
    const w = weights.get(p.id) ?? 0;
    const rel = Math.log(p.currPrice / p.prevPrice);
    const contribution = w * rel;
    logChange += contribution;
    contributions.push({ id: p.id, provider: p.provider, contribution });

    if (usable(p.prevHeadline) && usable(p.currHeadline)) {
      const priceRel = Math.log(p.currHeadline / p.prevHeadline);
      priceLogChange += w * priceRel;
      // q = P / π, so ln(q_t/q_{t-1}) = priceRel − rel. Quality improving
      // (positive) pushes the quality-adjusted price DOWN, hence the sign.
      qualityLogChange += w * (priceRel - rel) * -1;
    }
  }

  return { logChange, priceLogChange, qualityLogChange, weights, contributions };
}

/**
 * Weighted geometric mean of a set of values under the supplied weights.
 * Used for the headline USD/QPU-hour and USD/QCU figures.
 *
 * Geometric rather than arithmetic because the index itself compounds log
 * changes: a geometric mean of the levels moves consistently with the linked
 * index, whereas an arithmetic mean would drift away from it over time and the
 * two published numbers would slowly disagree.
 */
export function weightedGeoMean(
  items: Array<{ id: string; value: number }>,
  weights: Map<string, number>,
): number {
  let acc = 0;
  let wsum = 0;
  for (const it of items) {
    const w = weights.get(it.id) ?? 0;
    if (w <= 0 || !usable(it.value)) continue;
    acc += w * Math.log(it.value);
    wsum += w;
  }
  return wsum > 0 ? Math.exp(acc / wsum) : 0;
}
