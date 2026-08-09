// ──────────────────────────────────────────────────────────────────────────────
// Hedonic quality model.
//
// WHY THIS EXISTS
// The v1 index used its quality factor (PQF) as a VWAP *weight*:
//     I = Σ(P·V·PQF) / Σ(V·PQF)
// That answers "what is the average price per hour, weighted toward the better
// machines" — which means a device getting BETTER pulls the index toward that
// device's own price. A genuine quality improvement therefore showed up as a
// composition shift, and could move the headline in either direction depending
// on whether the improving device happened to be expensive or cheap.
//
// The correct construct for "what does quantum capability cost" is to DEFLATE
// the price by quality, not to weight by it:
//
//     π_d = P_d / q_d          USD per Quantum Capability Unit-hour
//
// Now a chip that doubles its usable width at an unchanged $/hour halves π_d,
// and the index says — correctly — that quantum compute got cheaper. This is
// the standard hedonic treatment used for ICT goods in official price
// statistics (BLS Handbook of Methods ch. 14; Eurostat Handbook on Hedonic
// Quality Adjustment). With ~a dozen constituents there are far too few
// observations to *estimate* implicit characteristic prices by regression, so
// v2 uses a SPECIFIED hedonic function with published coefficients — the same
// fallback official statisticians use when regression is not viable.
//
// TWO CHARACTERISTICS
//
// 1. Effective width  m_d — the largest square circuit the device can actually
//    run. A width-m, depth-m circuit contains ≈ m²/2 two-qubit gates, so the
//    expected number of errors is ≈ m²·ε₂/2. Requiring that to stay at or below
//    one error gives the achievable width
//
//        m_d = min( n_d , floor( sqrt(2 / ε₂,d) ) )
//
//    i.e. a device is limited either by how many qubits it has or by how fast
//    its errors accumulate, whichever binds first. This is the standard
//    heuristic behind Quantum Volume (Cross et al., Phys. Rev. A 100, 032328,
//    2019), and it needs only two numbers — qubit count and median two-qubit
//    error — which EVERY vendor we track publishes. That is what makes it
//    comparable across superconducting, trapped-ion, neutral-atom and photonic
//    hardware, where no single vendor benchmark (QV, #AQ, CLOPS) is available
//    for all of them.
//
//    Note m enters LINEARLY, not as 2^m. Quantum Volume is exponential in the
//    width, so using it raw would let one device's capability exceed the rest
//    of the market by ten orders of magnitude and collapse the index onto a
//    single constituent. Working in log-capability (log2(2^m) = m) is both the
//    standard treatment for exponentially-scaling characteristics and exactly
//    what "algorithmic qubits" is reaching for.
//
// 2. Layer rate  f_d — circuit layers executed per second, the throughput term.
//    A user buying an hour cares how many samples that hour yields.
//
// COMBINED, Cobb–Douglas (the standard log-linear hedonic form):
//
//     q_d = (m_d / m_ref)^α · (f_d / f_ref)^β        α + β = 1
//
// Three properties earn this form its place:
//   • Scale-free. m_ref and f_ref are arbitrary constants that CANCEL exactly
//     in the period-over-period ratio the index actually uses, so they can
//     never bias a move.
//   • Log-linear, so Δln q = α·Δln m + β·Δln f decomposes additively — that is
//     what makes the price/quality attribution on the QCI map exact rather
//     than approximate.
//   • Bounded response. A 10% width gain produces a 7.5% quality gain, not a
//     discontinuity.
// ──────────────────────────────────────────────────────────────────────────────

import type { DeviceObservation, Modality } from "./types";

export interface HedonicConfig {
  /** Elasticity of quality with respect to effective width. */
  alpha: number;
  /** Elasticity of quality with respect to layer rate. Fixed at 1 − alpha. */
  beta: number;
  /** Reference width. Arbitrary — cancels in the index ratio. */
  widthRef: number;
  /** Reference layer rate (Hz). Arbitrary — cancels in the index ratio. */
  layerRateRef: number;
}

/**
 * Published coefficients. Width carries the larger weight because it decides
 * whether a problem is addressable at all, while throughput only decides how
 * many samples you get once it is. The references are the inception-era
 * IBM Eagle-class device (127 qubits, ε₂ ≈ 8e-3 → m ≈ 15; ~1 kHz layer rate),
 * chosen so quality lands near 1.0 for a mid-market device and the printed
 * USD/QCU figure is human-readable.
 *
 * Changing any of these changes the meaning of the level → bump
 * QCI_METHODOLOGY_VERSION and recompute the whole series, never in place.
 */
export const DEFAULT_HEDONIC: HedonicConfig = {
  alpha: 0.75,
  beta: 0.25,
  widthRef: 15,
  layerRateRef: 1000,
};

/**
 * Layer rates used when a vendor does not publish throughput. These are ASSUMED
 * tier and are deliberately per-modality constants: because the index compounds
 * log RATIOS of matched devices, any quantity that is constant over time
 * cancels exactly and can never move the index. An assumption is only allowed
 * into v2 on that condition.
 *
 * Order-of-magnitude figures from published gate times: superconducting
 * two-qubit gates run in tens of ns with ~µs-scale readout and reset;
 * trapped-ion gates are ~100 µs with ms-scale readout; neutral-atom cycles are
 * dominated by ~100 ms atom reloading; photonic rates track the source
 * repetition rate.
 */
export const MODALITY_LAYER_RATE: Record<Modality, number> = {
  superconducting: 1000,
  "trapped-ion": 20,
  "neutral-atom": 5,
  photonic: 500,
  spin: 200,
};

/**
 * Largest square circuit the device can run with expected error ≤ 1.
 *
 *   m = min( qubits , floor( sqrt(2 / ε₂) ) )
 *
 * Clamped to ≥ 1 so a totally broken device still yields a finite, positive
 * quality (an infinite or zero quality would produce ±Infinity in the log
 * ratio and poison the whole day).
 */
export function effectiveWidth(qubits: number, twoQubitError: number): number {
  if (!Number.isFinite(qubits) || qubits < 1) return 1;
  // A zero or negative error would imply unbounded depth; treat anything below
  // the best fidelity ever demonstrated as that floor rather than trusting it.
  const err = Number.isFinite(twoQubitError) ? Math.max(twoQubitError, 1e-5) : 1e-2;
  const errorLimited = Math.floor(Math.sqrt(2 / err));
  return Math.max(1, Math.min(Math.floor(qubits), errorLimited));
}

/** Cobb–Douglas capability, in dimensionless Quantum Capability Units per hour. */
export function capability(
  width: number,
  layerRate: number,
  cfg: HedonicConfig = DEFAULT_HEDONIC,
): number {
  const w = Math.max(width, 1) / cfg.widthRef;
  const f = Math.max(layerRate, 1e-6) / cfg.layerRateRef;
  return Math.pow(w, cfg.alpha) * Math.pow(f, cfg.beta);
}

export interface QualityResult {
  effectiveWidth: number;
  layerRate: number;
  capability: number;
  /** USD per Quantum Capability Unit-hour. */
  qualityAdjustedPrice: number;
  /** True when width was capped by qubit count rather than by error rate. */
  widthLimitedByQubits: boolean;
}

/** Derive the quality terms and the quality-adjusted price for one device. */
export function deviceQuality(
  d: DeviceObservation,
  cfg: HedonicConfig = DEFAULT_HEDONIC,
): QualityResult {
  const qubits = d.qubits.value;
  const err = d.twoQubitError.value;
  const width = effectiveWidth(qubits, err);
  const layerRate = Math.max(d.layerRate.value, 1e-6);
  const q = capability(width, layerRate, cfg);
  const price = Math.max(d.pricePerHour.value, 0);
  return {
    effectiveWidth: width,
    layerRate,
    capability: q,
    qualityAdjustedPrice: q > 0 ? price / q : Number.POSITIVE_INFINITY,
    widthLimitedByQubits: Math.floor(qubits) <= Math.floor(Math.sqrt(2 / Math.max(err, 1e-5))),
  };
}
