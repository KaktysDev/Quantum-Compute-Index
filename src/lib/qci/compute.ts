// ──────────────────────────────────────────────────────────────────────────────
// Orchestration: raw provider metrics → one representative device per provider →
// PQF-weighted VWAP → CHAIN-LINKED index level.
//
// The index is chain-linked (like the S&P 500's divisor): it only moves when the
// *prices* of a stable basket move. When the basket composition changes (a
// provider is connected/removed, or comes on/offline), the level is carried over
// unchanged — so adding a provider never creates an artificial jump. Subsequent
// days then track that new basket's price moves. The very first snapshot anchors
// to 1000.
// ──────────────────────────────────────────────────────────────────────────────

import { computeIndex, QCI_INCEPTION_LEVEL, type IndexResult } from "./formula";
import {
  DEFAULT_MARKET_ADJUST,
  marketMultiplier,
  type MarketAdjustConfig,
} from "./marketAdjust";
import { normalizeAll } from "./normalize";
import type { QciSnapshot, RawQpuMetrics } from "./types";

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Collapse a provider's fleet to ONE representative device (highest capacity,
 * tie-broken by best fidelity). Prevents a provider that exposes many identical
 * machines (e.g. IBM's 3 near-identical Heron devices) from being counted 3×.
 */
export function collapseOnePerProvider(metrics: RawQpuMetrics[]): RawQpuMetrics[] {
  const byProvider = new Map<string, RawQpuMetrics>();
  for (const m of metrics) {
    const cur = byProvider.get(m.provider);
    if (
      !cur ||
      m.capacity > cur.capacity ||
      (m.capacity === cur.capacity && m.fid2q > cur.fid2q)
    ) {
      byProvider.set(m.provider, m);
    }
  }
  return [...byProvider.values()];
}

/** Provider-level basket signature (we keep one device per provider). */
export function basketKey(items: Array<{ provider: string }>): string {
  return [...new Set(items.map((i) => i.provider))].sort().join("|");
}

/** The previous snapshot needed for chain-linking. */
export interface PreviousSnapshot {
  price: number;
  vwap: number;
  components: Array<{ provider: string }>;
}

export interface ComputeOptions {
  ts?: string;
  source?: "live" | "sample";
  /** Previous snapshot, for chain-linking. Omit for the first (anchors to 1000). */
  previous?: PreviousSnapshot | null;
  market?: MarketAdjustConfig;
}

/**
 * Compute a QCI snapshot: one device per provider, PQF-weighted VWAP, chain-linked
 * to the previous snapshot so composition changes don't move the level.
 */
export function computeQci(
  rawMetrics: RawQpuMetrics[],
  opts: ComputeOptions = {},
): QciSnapshot {
  const market = opts.market ?? DEFAULT_MARKET_ADJUST;
  const ts = opts.ts ?? new Date().toISOString();
  const source = opts.source ?? "live";

  const collapsed = collapseOnePerProvider(rawMetrics);
  const normalized = normalizeAll(collapsed);
  const result: IndexResult = computeIndex(normalized);
  const mult = marketMultiplier(normalized, market);
  const vwap = result.vwap * mult; // performance-adjusted VWAP for this basket

  const prev = opts.previous;
  const curBasket = basketKey(collapsed);

  let price: number;
  if (!prev || prev.price <= 0 || prev.vwap <= 0) {
    // First snapshot → anchor to inception.
    price = QCI_INCEPTION_LEVEL;
  } else if (basketKey(prev.components ?? []) === curBasket) {
    // Same basket → move proportionally to the VWAP (chain-link).
    price = prev.price * (vwap / prev.vwap);
  } else {
    // Composition changed → carry the level over (no artificial jump).
    price = prev.price;
  }
  price = round(price);

  const changePct =
    prev && prev.price > 0 ? round(((price - prev.price) / prev.price) * 100, 3) : 0;

  return {
    ts,
    price,
    changePct,
    vwap: round(vwap, 4),
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
