import type { RawQpuMetrics } from "@/lib/qci/types";

/** Deterministic [-1, 1] value from a string + day, for gentle daily drift. */
export function dailyDrift(seed: string, date: Date = new Date()): number {
  const day = Math.floor(date.getTime() / 86_400_000);
  let h = 2166136261 ^ day;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  // map to [-1, 1]
  return (((h >>> 0) % 20001) - 10000) / 10000;
}

/**
 * Apply small, deterministic daily variation to a benchmark QPU record so the
 * live index visibly moves day to day. (Stand-in until real API metrics are wired.)
 */
export function withDailyDrift(base: RawQpuMetrics, date: Date = new Date()): RawQpuMetrics {
  const d = dailyDrift(`${base.provider}:${base.qpu}`, date);
  return {
    ...base,
    rawPrice: base.rawPrice * (1 + 0.03 * d), // ±3% price wiggle
    clops: Math.round(base.clops * (1 + 0.02 * d)),
    fid2q: Math.min(0.9999, base.fid2q * (1 + 0.001 * d)),
    queueSeconds: Math.max(0, 300 + 600 * d),
    demandSignal: 1 + 0.05 * d,
  };
}
