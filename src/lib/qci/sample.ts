// ──────────────────────────────────────────────────────────────────────────────
// Deterministic sample data.
//
// Until real provider API keys produce live snapshots, the app shows a realistic
// simulated QCI series so the price, chart, and animations look alive. Everything
// here is CLEARLY LABELLED source: "sample" and is fully deterministic (anchored
// to a fixed inception date) — so server and client render identical values and
// the price is stable across reloads, advancing once per day.
// ──────────────────────────────────────────────────────────────────────────────

import { computeQci } from "./compute";
import { SEED_QPUS } from "./seed";
import type { QciSnapshot } from "./types";

export interface SamplePoint {
  time: string; // 'YYYY-MM-DD'
  value: number;
}

const MS_PER_DAY = 86_400_000;
const INCEPTION = "2025-01-01";

/** Small, fast, deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's date in America/New_York as 'YYYY-MM-DD'. */
function todayEt(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

function dateStr(idx: number): string {
  return new Date(idx * MS_PER_DAY).toISOString().slice(0, 10);
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Build the full deterministic index path from inception to today, then return
 * the last `days` points. Today's value is independent of `days`.
 */
export function sampleSeries(days = 120, now: Date = new Date()): SamplePoint[] {
  const endIdx = dayIndex(todayEt(now));
  const startIdx = dayIndex(INCEPTION);
  const points: SamplePoint[] = [];

  let logLevel = 0;
  for (let i = startIdx; i <= endIdx; i++) {
    const rng = mulberry32(Math.imul(i, 2654435761));
    const noise = rng() - 0.5; // [-0.5, 0.5]
    const cycle = Math.sin(i / 22) * 0.0008; // gentle multi-week cycle
    const drift = 0.0005; // slow uptrend — growing quantum demand
    logLevel += drift + 0.012 * noise + cycle;
    points.push({ time: dateStr(i), value: round(1000 * Math.exp(logLevel)) });
  }

  return points.slice(Math.max(0, points.length - days));
}

/** The latest sample snapshot, with a per-QPU breakdown for the dashboard. */
export function sampleSnapshot(now: Date = new Date()): QciSnapshot {
  const series = sampleSeries(2, now);
  const latest = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : latest;

  // Reuse the real engine for a believable component breakdown, then overlay the
  // sample headline price so the chart and breakdown stay consistent.
  const base = computeQci(SEED_QPUS, { source: "sample" });
  const scale = latest.value / (base.price || 1);

  return {
    ts: new Date(`${latest.time}T13:30:00.000Z`).toISOString(),
    price: latest.value,
    changePct: prev.value > 0 ? round(((latest.value - prev.value) / prev.value) * 100, 3) : 0,
    vwap: base.vwap,
    components: base.components.map((c) => ({
      ...c,
      pricePerNqh: round(c.pricePerNqh * scale, 2),
    })),
    source: "sample",
  };
}
