// ──────────────────────────────────────────────────────────────────────────────
// THE QCI FORMULA  (QCI Research 1.1 — Lahoda & Flowers)
//
// Base index (PQF-weighted Volumetric Weighted Average Price):
//
//        Σ ( P_trans · V_trans · PQF )
//   I =  ─────────────────────────────
//             Σ ( V_trans · PQF )
//
// Performance Quality Factor per QPU:
//
//   PQF_i = α · ( log2(QV_i) / log2(QV_base) )
//         + β · ( CLOPS_i / CLOPS_base )
//         + γ · ( F_2q_i )
//
//   where  P_trans  = price per Normalized Quantum Hour (USD)   [see normalize.ts]
//          V_trans  = volume proxy (capacity × demand)          [see types.ts]
//          QV_base  = 256, CLOPS_base = 2500  (IBM Eagle-class base)
//          α, β, γ  = market-weighted importance of scale / speed / accuracy
//
// NOTE: The benchmark table in the research doc lists *estimated* PQF values
// (e.g. IonQ AQ = 2^35) that are not literal outputs of this formula. We
// implement the formula faithfully and treat the table as seed/defaults only.
// ──────────────────────────────────────────────────────────────────────────────

import type {
  NormalizedQpuMetrics,
  QciConfig,
  QpuComponent,
} from "./types";

/**
 * Default coefficients. Calibrated so an IBM Eagle-class base QPU
 * (QV 256, CLOPS 2500, fidelity ≈ 0.992) yields PQF ≈ 1.00:
 *   0.40·1 + 0.20·1 + 0.40·0.992 ≈ 0.997
 * These are the primary tuning knobs for the index — adjust to taste.
 */
export const DEFAULT_CONFIG: QciConfig = {
  qvBase: 256,
  clopsBase: 2500,
  alpha: 0.4, // scale  (Quantum Volume)
  beta: 0.2, // speed  (CLOPS)
  gamma: 0.4, // accuracy (two-qubit fidelity)
};

/** Index level at inception — the QCI is anchored here, S&P-style. */
export const QCI_INCEPTION_LEVEL = 1000;

/** Performance Quality Factor for a single QPU. */
export function computePqf(
  m: Pick<NormalizedQpuMetrics, "qv" | "clops" | "fid2q">,
  cfg: QciConfig = DEFAULT_CONFIG,
): number {
  const qv = Math.max(m.qv, 2); // guard log2 domain
  const scale = Math.log2(qv) / Math.log2(cfg.qvBase);
  const speed = m.clops / cfg.clopsBase;
  const accuracy = m.fid2q;
  return cfg.alpha * scale + cfg.beta * speed + cfg.gamma * accuracy;
}

export interface IndexResult {
  /** PQF-weighted VWAP in USD per Normalized Quantum Hour. */
  vwap: number;
  /** Per-QPU breakdown (pqf, weight, share). */
  components: QpuComponent[];
}

/**
 * Core index: PQF-weighted VWAP across all qualifying QPUs.
 * Returns the raw VWAP (USD/NQH) plus a per-QPU breakdown.
 */
export function computeIndex(
  metrics: NormalizedQpuMetrics[],
  cfg: QciConfig = DEFAULT_CONFIG,
): IndexResult {
  let numerator = 0; // Σ P · V · PQF
  let denominator = 0; // Σ V · PQF

  const partial: Array<{ m: NormalizedQpuMetrics; pqf: number; weight: number }> = [];

  for (const m of metrics) {
    const pqf = computePqf(m, cfg);
    const weight = m.volume * pqf;
    numerator += m.pricePerNqh * weight;
    denominator += weight;
    partial.push({ m, pqf, weight });
  }

  const vwap = denominator > 0 ? numerator / denominator : 0;

  const components: QpuComponent[] = partial.map(({ m, pqf, weight }) => ({
    ...m,
    pqf,
    weight,
    share: denominator > 0 ? weight / denominator : 0,
  }));

  return { vwap, components };
}
