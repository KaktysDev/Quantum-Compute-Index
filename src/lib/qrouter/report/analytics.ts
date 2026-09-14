/**
 * Researcher analytics computed only from stored job results.
 * Never invents counts, probabilities, fidelity, or expected distributions.
 */

import { bitOrderLabel } from "@/lib/qrouter/encoding/public";
import type { BitstringRow, MeasurementPair, ResultAnalytics } from "./types";

export const HISTOGRAM_CAP = 32;
export const TOP_CAP = 16;
export const EXPECTED_CAP = 12;

export function asNumericMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "number" && Number.isFinite(item)) out[key] = item;
  }
  return Object.keys(out).length ? out : null;
}

export function countsAreSynthetic(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const synthetic = (metadata as { synthetic?: unknown }).synthetic;
  if (!Array.isArray(synthetic)) return false;
  return synthetic.some((flag) => flag && typeof flag === "object" && (flag as { field?: unknown }).field === "counts");
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function shannonEntropy(weights: number[]): number | null {
  const total = weights.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return null;
  let entropy = 0;
  for (const value of weights) {
    if (!(value > 0)) continue;
    const p = value / total;
    entropy -= p * Math.log2(p);
  }
  return Number.isFinite(entropy) ? entropy : null;
}

function rankedRows(
  counts: Record<string, number> | null,
  probabilities: Record<string, number> | null,
  shots: number | null,
  cap: number,
): BitstringRow[] {
  const keys = new Set<string>([
    ...(counts ? Object.keys(counts) : []),
    ...(probabilities ? Object.keys(probabilities) : []),
  ]);
  const observed = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;
  const denom = shots && shots > 0 ? shots : observed > 0 ? observed : null;
  const rows: BitstringRow[] = [];
  for (const bitstring of keys) {
    const count = counts && Number.isFinite(counts[bitstring]) ? counts[bitstring] : null;
    const probability = probabilities && Number.isFinite(probabilities[bitstring])
      ? probabilities[bitstring]
      : count != null && denom
        ? count / denom
        : null;
    rows.push({ bitstring, count, probability });
  }
  rows.sort((a, b) => {
    const aRank = a.count ?? a.probability ?? 0;
    const bRank = b.count ?? b.probability ?? 0;
    return bRank - aRank || a.bitstring.localeCompare(b.bitstring);
  });
  return rows.slice(0, cap);
}

function measurementMapFrom(value: unknown): MeasurementPair[] {
  if (!Array.isArray(value)) return [];
  const pairs: MeasurementPair[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const qubit = finiteNumber((item as { qubit?: unknown }).qubit);
    const clbit = finiteNumber((item as { clbit?: unknown }).clbit);
    if (qubit == null || clbit == null) continue;
    pairs.push({ qubit, clbit });
  }
  return pairs;
}

function expectedFrom(metadata: Record<string, unknown> | null, shots: number | null): BitstringRow[] | null {
  if (!metadata) return null;
  const raw = metadata.expected ?? metadata.ideal ?? metadata.ideal_counts ?? metadata.expected_counts;
  const counts = asNumericMap(raw);
  if (!counts) {
    const probs = asNumericMap(metadata.expected_probabilities ?? metadata.ideal_probabilities);
    if (!probs) return null;
    return rankedRows(null, probs, shots, EXPECTED_CAP);
  }
  return rankedRows(counts, null, shots, EXPECTED_CAP);
}

export function computeAnalytics(input: {
  counts?: unknown;
  probabilities?: unknown;
  shots?: unknown;
  requestedShots?: unknown;
  metadata?: unknown;
  measurementMap?: unknown;
  layoutMapped?: unknown;
}): ResultAnalytics {
  const counts = asNumericMap(input.counts);
  const probabilities = asNumericMap(input.probabilities);
  const metadata = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : null;
  const synthetic = countsAreSynthetic(metadata);
  const requested = finiteNumber(input.requestedShots);
  const observedFromResult = finiteNumber(input.shots);
  const observedFromCounts = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : null;
  const shotsObserved = observedFromResult ?? observedFromCounts;
  const available = Boolean(counts || probabilities);

  if (!available) {
    return {
      available: false,
      reason: "This job has no measurement results yet.",
      shotsRequested: requested,
      shotsObserved: null,
      shotsMatch: null,
      distinctStates: 0,
      top: [],
      histogram: [],
      shannonEntropyBits: null,
      probabilityEntropyBits: null,
      maxProbability: null,
      mostProbable: null,
      countsAreSynthetic: synthetic,
      probabilitiesPresent: false,
      measurementMap: measurementMapFrom(input.measurementMap),
      layoutMapped: finiteNumber(input.layoutMapped),
      fidelity: finiteNumber(metadata?.fidelity),
      stderr: finiteNumber(metadata?.stderr ?? metadata?.standard_error),
      expected: expectedFrom(metadata, requested),
      notes: [],
    };
  }

  const histogram = rankedRows(counts, probabilities, shotsObserved, HISTOGRAM_CAP);
  const top = histogram.slice(0, TOP_CAP);
  const distinctStates = (counts ? Object.keys(counts).length : 0) || (probabilities ? Object.keys(probabilities).length : 0);
  const notes: string[] = [];
  const bitOrder = readString(metadata?.bit_order);
  const sourceBitOrder = readString(metadata?.source_bit_order);
  const layoutApplied = typeof metadata?.layout_applied === "boolean" ? metadata.layout_applied : undefined;

  if (synthetic) {
    notes.push("Shot counts were derived from probabilities (largest-remainder), not a hardware shot histogram.");
  }
  if (bitOrder) notes.push(`Bitstrings are shown in ${bitOrderLabel(bitOrder)}.`);
  if (sourceBitOrder && sourceBitOrder !== bitOrder) {
    notes.push(`The provider originally reported ${bitOrderLabel(sourceBitOrder)}; QRouter remapped them to the platform order.`);
  }
  if (layoutApplied) notes.push("A compiled layout was applied when decoding measurement bits.");
  if (requested != null && shotsObserved != null && requested !== shotsObserved) {
    notes.push(`Requested ${requested.toLocaleString()} shots; the stored result totals ${shotsObserved.toLocaleString()}.`);
  }
  if (metadata?.quasi && typeof metadata.quasi === "object") {
    notes.push("A quasi-probability distribution is present in the result metadata. Negative values were not clipped.");
  }

  const countEntropy = counts && !synthetic ? shannonEntropy(Object.values(counts)) : null;
  const probabilityEntropy = probabilities ? shannonEntropy(Object.values(probabilities)) : null;
  const head = top[0];

  return {
    available: true,
    shotsRequested: requested,
    shotsObserved,
    shotsMatch: requested != null && shotsObserved != null ? requested === shotsObserved : null,
    distinctStates,
    top,
    histogram,
    shannonEntropyBits: countEntropy,
    probabilityEntropyBits: countEntropy == null ? probabilityEntropy : null,
    maxProbability: head?.probability ?? null,
    mostProbable: head?.bitstring ?? null,
    countsAreSynthetic: synthetic,
    probabilitiesPresent: Boolean(probabilities),
    bitOrder,
    sourceBitOrder,
    layoutApplied,
    measurementMap: measurementMapFrom(input.measurementMap),
    layoutMapped: finiteNumber(input.layoutMapped),
    fidelity: finiteNumber(metadata?.fidelity),
    stderr: finiteNumber(metadata?.stderr ?? metadata?.standard_error),
    expected: expectedFrom(metadata, shotsObserved ?? requested),
    notes,
  };
}
