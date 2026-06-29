// ──────────────────────────────────────────────────────────────────────────────
// Orchestration: raw provider metrics → normalized → PQF-weighted VWAP →
// index level (anchored at 1000) → optional market adjustment → QciSnapshot.
// ──────────────────────────────────────────────────────────────────────────────

import { computeIndex, QCI_INCEPTION_LEVEL, type IndexResult } from "./formula";
import {
  DEFAULT_MARKET_ADJUST,
  marketMultiplier,
  type MarketAdjustConfig,
} from "./marketAdjust";
import { normalizeAll } from "./normalize";
import { SEED_QPUS } from "./seed";
import type { QciSnapshot, RawQpuMetrics } from "./types";

/**
 * Inception reference VWAP, computed once from the seed benchmark basket.
 * Dividing the live VWAP by this anchors the index at 1000 at inception.
 */
let _referenceVwap: number | null = null;
export function referenceVwap(): number {
  if (_referenceVwap === null) {
    const seed = normalizeAll(SEED_QPUS);
    _referenceVwap = computeIndex(seed).vwap || 1;
  }
  return _referenceVwap;
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export interface ComputeOptions {
  /** ISO timestamp for the snapshot (defaults to now). */
  ts?: string;
  /** Previous index level, to compute the % change. */
  previousPrice?: number;
  source?: "live" | "sample";
  market?: MarketAdjustConfig;
}

/**
 * Compute a QCI snapshot from a set of raw QPU metrics.
 * Returns the headline index level + a per-QPU breakdown.
 */
export function computeQci(
  rawMetrics: RawQpuMetrics[],
  opts: ComputeOptions = {},
): QciSnapshot {
  const market = opts.market ?? DEFAULT_MARKET_ADJUST;
  const ts = opts.ts ?? new Date().toISOString();
  const source = opts.source ?? "live";

  const normalized = normalizeAll(rawMetrics);
  const result: IndexResult = computeIndex(normalized);

  const ref = referenceVwap();
  const mult = marketMultiplier(normalized, market);
  const price = round((QCI_INCEPTION_LEVEL * result.vwap * mult) / ref);

  const changePct =
    opts.previousPrice && opts.previousPrice > 0
      ? round(((price - opts.previousPrice) / opts.previousPrice) * 100, 3)
      : 0;

  return {
    ts,
    price,
    changePct,
    vwap: round(result.vwap, 4),
    components: result.components.map((c) => ({
      ...c,
      pqf: round(c.pqf, 4),
      weight: round(c.weight, 2),
      share: round(c.share, 4),
      pricePerNqh: round(c.pricePerNqh, 2),
    })),
    source,
  };
}
