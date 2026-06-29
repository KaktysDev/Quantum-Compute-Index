// ──────────────────────────────────────────────────────────────────────────────
// Optional market-adjustment layer.
//
// The pure PDF formula (formula.ts) uses three hardware factors (QV, CLOPS,
// fidelity). The original product vision also wanted queue times, demand, and
// equity prices to "adjust for supply-demand volatility and accessibility".
//
// This layer keeps that vision OUT of the pure index and instead applies an
// optional multiplier on top. It defaults to 1.0× (identity), so it has no
// effect unless explicitly enabled — the index stays faithful to the PDF.
// ──────────────────────────────────────────────────────────────────────────────

import type { NormalizedQpuMetrics } from "./types";

export interface MarketAdjustConfig {
  enabled: boolean;
  /** Longer queues reduce accessibility → small downward pull. */
  queueWeight: number;
  /** Higher demand pushes price up. */
  demandWeight: number;
  /** Parent-firm equity moves feed through to the index. */
  stockWeight: number;
}

export const DEFAULT_MARKET_ADJUST: MarketAdjustConfig = {
  enabled: false, // identity by default — pure PDF index
  queueWeight: 0.05,
  demandWeight: 0.1,
  stockWeight: 0.05,
};

/**
 * Compute a multiplier (around 1.0) from aggregate live signals.
 * Returns 1.0 exactly when disabled or when no signals are present.
 */
export function marketMultiplier(
  metrics: NormalizedQpuMetrics[],
  cfg: MarketAdjustConfig = DEFAULT_MARKET_ADJUST,
): number {
  if (!cfg.enabled || metrics.length === 0) return 1;

  const avg = (pick: (m: NormalizedQpuMetrics) => number | undefined) => {
    const vals = metrics.map(pick).filter((v): v is number => typeof v === "number");
    if (vals.length === 0) return undefined;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  let mult = 1;

  // Queue: normalize seconds to an hour scale; longer queue → lower index.
  const queue = avg((m) => m.queueSeconds);
  if (queue !== undefined) {
    mult -= cfg.queueWeight * Math.min(queue / 3600, 1);
  }

  // Demand: demandSignal is centered at 1.0; deviation moves the index.
  const demand = avg((m) => m.demandSignal);
  if (demand !== undefined) {
    mult += cfg.demandWeight * (demand - 1);
  }

  // Equity: average daily return of parent firms.
  const stock = avg((m) => m.stockReturn);
  if (stock !== undefined) {
    mult += cfg.stockWeight * stock;
  }

  // Clamp to a sane band so the adjustment can never dominate the index.
  return Math.min(Math.max(mult, 0.8), 1.2);
}
