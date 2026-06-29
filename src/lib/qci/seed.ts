// ──────────────────────────────────────────────────────────────────────────────
// Seed benchmark table (QCI Research 1.1).
//
// Used for (a) the inception reference VWAP that anchors the index at 1000, and
// (b) sensible per-provider defaults until real API keys produce live metrics.
//
// Provider | QPU Family   | Base Price | QV   | CLOPS | Table PQF (est.)
// IBM      | Eagle/Osprey | $96/min    | 256  | 2500  | 1.00 (base)
// IonQ     | Forte        | $0.08/shot | AQ35 | 500   | 1.35
// Rigetti  | Ankaa        | $0.0009/sh | 64   | 1200  | 0.82
// IQM      | Emerald      | $0.0016/sh | 128  | 1800  | 0.91
// ──────────────────────────────────────────────────────────────────────────────

import type { RawQpuMetrics } from "./types";

export const SEED_QPUS: RawQpuMetrics[] = [
  {
    provider: "IBM",
    qpu: "Eagle/Osprey",
    rawPrice: 96,
    unit: "per_minute",
    qv: 256,
    clops: 2500,
    fid2q: 0.992,
    capacity: 127,
  },
  {
    provider: "IonQ",
    qpu: "Forte",
    rawPrice: 0.08,
    unit: "per_shot",
    // AQ ≈ 35 is a marketing "algorithmic qubits" figure; 2^35 would explode the
    // log term. We use a defensible QV-equivalent (~2^18) that reproduces the
    // table's PQF ≈ 1.35 under the default coefficients.
    qv: 262_144,
    clops: 500,
    fid2q: 0.995,
    capacity: 36,
  },
  {
    provider: "Rigetti",
    qpu: "Ankaa",
    rawPrice: 0.0009,
    unit: "per_shot",
    qv: 64,
    clops: 1200,
    fid2q: 0.985,
    capacity: 84,
  },
  {
    provider: "IQM",
    qpu: "Emerald",
    rawPrice: 0.0016,
    unit: "per_shot",
    qv: 128,
    clops: 1800,
    fid2q: 0.988,
    capacity: 54,
  },
];
