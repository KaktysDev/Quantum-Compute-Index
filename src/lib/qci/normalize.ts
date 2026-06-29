// ──────────────────────────────────────────────────────────────────────────────
// Unit normalization.
//
// Providers quote prices in incompatible units ($/min, $/shot, $/task). To feed
// the index we convert everything to a single unit: price per Normalized Quantum
// Hour (NQH). The two constants below are the calibration knobs.
//
//   1 NQH ≡ MINUTES_PER_NQH minutes of reservation time
//   1 NQH ≡ SHOTS_PER_NQH shots executed
//
// These are explicit, documented assumptions (the "unit mismatch" caveat). They
// mainly set the inception reference; because the displayed QCI is anchored to
// 1000 at inception, the absolute choice does not distort the index *level* —
// only the relative movement of live prices over time matters.
// ──────────────────────────────────────────────────────────────────────────────

import type { NormalizedQpuMetrics, RawQpuMetrics } from "./types";

/** 1 Normalized Quantum Hour = 60 minutes of reserved compute. */
export const MINUTES_PER_NQH = 60;

/**
 * 1 Normalized Quantum Hour = this many shots. Default chosen so the seed
 * providers land in a comparable price band. Tune when real data arrives.
 */
export const SHOTS_PER_NQH = 60_000;

/** Assumed tasks per NQH for per-task pricing. */
export const TASKS_PER_NQH = 120;

/** Convert a raw quoted price into USD per Normalized Quantum Hour. */
export function pricePerNqh(rawPrice: number, unit: RawQpuMetrics["unit"]): number {
  switch (unit) {
    case "per_minute":
      return rawPrice * MINUTES_PER_NQH;
    case "per_shot":
      return rawPrice * SHOTS_PER_NQH;
    case "per_task":
      return rawPrice * TASKS_PER_NQH;
    case "per_nqh":
    default:
      return rawPrice;
  }
}

/** Normalize a raw QPU record into the shape the formula expects. */
export function normalize(m: RawQpuMetrics): NormalizedQpuMetrics {
  const demand = m.demandSignal ?? 1;
  return {
    provider: m.provider,
    qpu: m.qpu,
    pricePerNqh: pricePerNqh(m.rawPrice, m.unit),
    qv: m.qv,
    clops: m.clops,
    fid2q: m.fid2q,
    // Volume proxy: capacity scaled by a demand signal (defaults to neutral 1.0).
    volume: m.capacity * demand,
    queueSeconds: m.queueSeconds,
    demandSignal: m.demandSignal,
    stockReturn: m.stockReturn,
  };
}

export function normalizeAll(metrics: RawQpuMetrics[]): NormalizedQpuMetrics[] {
  return metrics.map(normalize);
}
