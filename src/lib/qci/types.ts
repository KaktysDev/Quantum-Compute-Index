// ──────────────────────────────────────────────────────────────────────────────
// Shared types for the QCI engine.
// ──────────────────────────────────────────────────────────────────────────────

/** How a provider quotes its price, before normalization to a Normalized Quantum Hour. */
export type PricingUnit = "per_minute" | "per_shot" | "per_task" | "per_nqh";

/**
 * Raw hardware + pricing metrics for a single QPU, as pulled from a provider
 * (or seeded from the benchmark table). This is the input to normalization.
 */
export interface RawQpuMetrics {
  provider: string;
  qpu: string;
  /** The quoted price in `unit` terms (e.g. 96 means $96/min when unit = per_minute). */
  rawPrice: number;
  unit: PricingUnit;
  /** Quantum Volume (effective). For AQ-based vendors this is a defensible QV-equivalent. */
  qv: number;
  /** Circuit Layer Operations Per Second. */
  clops: number;
  /** Median two-qubit gate fidelity in [0, 1] (= 1 − two-qubit error rate). */
  fid2q: number;
  /** Qubit count / available capacity — drives the volume proxy. */
  capacity: number;
  /** Optional live signals (used by the optional market-adjustment layer). */
  queueSeconds?: number;
  demandSignal?: number; // 1.0 = neutral
  stockReturn?: number; // daily equity return of the parent firm, e.g. 0.012 = +1.2%
}

/** Metrics after normalization — ready to feed the index formula. */
export interface NormalizedQpuMetrics {
  provider: string;
  qpu: string;
  /** Price per Normalized Quantum Hour (USD). */
  pricePerNqh: number;
  qv: number;
  clops: number;
  fid2q: number;
  /** Qubit count / width — carried through from the raw metrics for display. */
  capacity: number;
  /** Volume proxy V_trans = capacity × demand signal. */
  volume: number;
  queueSeconds?: number;
  demandSignal?: number;
  stockReturn?: number;
}

/** Data freshness of a constituent on the refresh that produced it. */
export type ProviderDataStatus = "active" | "stale";

/** Per-QPU contribution returned alongside the computed index (for the dashboard breakdown). */
export interface QpuComponent extends NormalizedQpuMetrics {
  pqf: number;
  weight: number; // V_trans · PQF
  /** Share of the final index this QPU contributed (0..1). */
  share: number;
  /**
   * Whether this constituent's metrics were pulled fresh this refresh ("active")
   * or carried forward from the last successful pull because the provider was
   * offline ("stale"). Absent on snapshots recorded before this was tracked.
   */
  status?: ProviderDataStatus;
}

/** A computed QCI data point. */
export interface QciSnapshot {
  /** ISO timestamp of the snapshot. */
  ts: string;
  /** The headline QCI level (anchored to 1000 at inception). */
  price: number;
  /** Percent change vs the previous snapshot. */
  changePct: number;
  /** Raw PQF-weighted VWAP in USD/NQH (pre-normalization to index level). */
  vwap: number;
  /** Per-QPU breakdown. */
  components: QpuComponent[];
  /** "live" once real provider keys produce data, "sample" otherwise. */
  source: "live" | "sample";
}

/** Tunable coefficients & base constants for the QCI formula. */
export interface QciConfig {
  qvBase: number;
  clopsBase: number;
  alpha: number; // weight on scale (Quantum Volume)
  beta: number; // weight on speed (CLOPS)
  gamma: number; // weight on accuracy (two-qubit fidelity)
}
