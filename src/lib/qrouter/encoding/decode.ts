/**
 * Typed result decode (§5.10, C1.2). Source bit order is recorded, then
 * normalised to the platform convention q0_right. Registers stay bounded.
 * Quasi-probabilities are never clipped. Synthesised counts are labelled.
 */

import type { NormalizedResult } from "../results";
import { PLATFORM_BIT_ORDER, RES_SCHEMA } from "./types";
import type { BitOrder, DecodeMap, ResultData, ResultSet, SyntheticFlag } from "./types";

const DECODER_VERSION = "qee-decode-1.0.0";

function numericMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([, item]) => typeof item !== "number" || !Number.isFinite(item))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function isBinary(value: string) {
  return /^[01]+$/.test(value);
}

function integerToBits(value: string, width: number, sourceOrder: BitOrder) {
  const bits = Number(value).toString(2).padStart(width, "0");
  return sourceOrder === "q0_left" ? bits : bits;
}

export function normalizeBitOrder(bits: string, source: BitOrder, target: BitOrder = PLATFORM_BIT_ORDER) {
  if (source === target) return bits;
  return [...bits].reverse().join("");
}

function padBits(bits: string, width: number) {
  return bits.padStart(width, "0");
}

function keyWidth(keys: string[], fallback: number) {
  return Math.max(fallback, ...keys.map((key) => {
    const fields = key.trim().split(/\s+/);
    if (fields.length > 1) return fields.reduce((sum, field) => sum + field.length, 0);
    if (/^\d+$/.test(key) && !isBinary(key)) return Number(key).toString(2).length;
    return key.replace(/[|>]/g, "").length;
  }), 1);
}

export function rewriteStates(
  values: Record<string, number>,
  sourceOrder: BitOrder,
  width: number,
): { map: Record<string, number>; registersPreserved: boolean } {
  const registersPreserved = Object.keys(values).some((key) => /\s/.test(key));
  const map: Record<string, number> = {};
  for (const [state, value] of Object.entries(values)) {
    if (registersPreserved) {
      const fields = state.trim().split(/\s+/).map((field) => {
        const clean = field.replace(/[|>]/g, "");
        const bits = /^\d+$/.test(clean) && !isBinary(clean) ? integerToBits(clean, clean.length, sourceOrder) : clean;
        return normalizeBitOrder(bits, sourceOrder);
      });
      const key = fields.join(" ");
      map[key] = (map[key] ?? 0) + value;
      continue;
    }
    const clean = state.replace(/[|>]/g, "");
    const bits = /^\d+$/.test(clean) && !isBinary(clean)
      ? integerToBits(clean, width, sourceOrder)
      : padBits(clean, width);
    const key = normalizeBitOrder(bits, sourceOrder);
    map[key] = (map[key] ?? 0) + value;
  }
  return { map, registersPreserved };
}

function applyLayout(bits: string, decodeMap: DecodeMap | undefined) {
  if (!decodeMap?.layout) return { bits, applied: false };
  const physicalToLogical: Record<number, number> = {};
  for (const [logical, physical] of Object.entries(decodeMap.layout.logical_to_physical)) {
    physicalToLogical[Number(physical)] = Number(logical);
  }
  const permutation = decodeMap.layout.routing_permutation;
  const chars = [...bits];
  const width = chars.length;
  const logical = Array.from({ length: width }, () => "0");
  for (let physical = 0; physical < width; physical += 1) {
    const routed = permutation?.[physical] ?? physical;
    const qubit = physicalToLogical[routed] ?? physicalToLogical[physical] ?? physical;
    if (qubit >= 0 && qubit < width) logical[width - 1 - qubit] = chars[width - 1 - physical];
  }
  return { bits: logical.join(""), applied: true };
}

function applyMeasurementMap(bits: string, decodeMap: DecodeMap | undefined) {
  if (!decodeMap?.measurement_map.length) return bits;
  const clWidth = decodeMap.registers.reduce((sum, register) => sum + register.width, 0) || bits.length;
  const clbits = Array.from({ length: clWidth }, () => "0");
  for (const { qubit, clbit } of decodeMap.measurement_map) {
    const from = bits.length - 1 - qubit;
    if (from >= 0 && from < bits.length && clbit >= 0 && clbit < clWidth) {
      clbits[clWidth - 1 - clbit] = bits[from];
    }
  }
  return clbits.join("");
}

export function largestRemainderCounts(probabilities: Record<string, number>, shots: number) {
  const entries = Object.entries(probabilities).map(([state, probability]) => {
    const exact = probability * shots;
    return { state, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = shots - entries.reduce((sum, item) => sum + item.count, 0);
  entries.sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; remaining > 0 && entries.length; index = (index + 1) % entries.length, remaining -= 1) {
    entries[index].count += 1;
  }
  return Object.fromEntries(entries.map(({ state, count }) => [state, count]));
}

export function decodeProviderResult(input: {
  backendId: string;
  raw: Record<string, unknown> | undefined;
  expectedShots: number;
  decodeMap?: DecodeMap;
  bundleId?: string;
}): ResultSet {
  const payload = input.raw ?? {};
  const sourceOrder: BitOrder = input.decodeMap?.bit_order
    ?? (input.backendId.startsWith("ionq") ? "q0_left" : "q0_right");
  const registerMaps = payload.registers && typeof payload.registers === "object" && !Array.isArray(payload.registers)
    ? Object.entries(payload.registers as Record<string, unknown>)
      .map(([name, value]) => ({ name, map: numericMap(value) }))
      .filter((item): item is { name: string; map: Record<string, number> } => item.map !== null)
    : [];
  const countsSource = numericMap(payload.counts) ?? numericMap(payload.measurementCounts)
    ?? (registerMaps.length === 1 ? registerMaps[0].map : null);
  const probabilitySource = numericMap(payload.probabilities)
    ?? numericMap(payload.measurementProbabilities)
    ?? null;
  const quasiSource = numericMap(payload.quasiDistribution)
    ?? (Array.isArray(payload.quasi_dists) ? numericMap(payload.quasi_dists[0]) : null);
  const synthetic: SyntheticFlag[] = [];
  const data: ResultData[] = [];
  const width = keyWidth([
    ...Object.keys(countsSource ?? {}),
    ...Object.keys(probabilitySource ?? {}),
    ...Object.keys(quasiSource ?? {}),
  ], input.decodeMap?.registers.reduce((sum, register) => sum + register.width, 0) ?? 1);

  const remap = (values: Record<string, number>) => {
    const rewritten = rewriteStates(values, sourceOrder, width);
    if (!input.decodeMap?.layout && !input.decodeMap?.measurement_map.length) return rewritten.map;
    const next: Record<string, number> = {};
    for (const [state, value] of Object.entries(rewritten.map)) {
      if (/\s/.test(state)) {
        next[state] = (next[state] ?? 0) + value;
        continue;
      }
      const laid = applyLayout(state, input.decodeMap);
      const measured = applyMeasurementMap(laid.bits, input.decodeMap);
      next[measured] = (next[measured] ?? 0) + value;
    }
    return next;
  };

  if (quasiSource) {
    const quasi = remap(quasiSource);
    data.push({
      type: "quasi",
      register: input.decodeMap?.registers.map((register) => register.name).join(",") || "meas",
      quasi,
      mitigation: typeof payload.mitigation === "string" ? payload.mitigation : "unspecified",
    });
  }

  const probabilities = probabilitySource ? remap(probabilitySource) : null;
  if (probabilities) {
    data.push({
      type: "probabilities",
      register: input.decodeMap?.registers.map((register) => register.name).join(",") || "meas",
      probabilities,
    });
  }

  let counts = countsSource ? remap(countsSource) : null;
  const shots = Number(payload.shots) > 0
    ? Number(payload.shots)
    : counts
      ? Object.values(counts).reduce((sum, count) => sum + count, 0)
      : input.expectedShots;

  if (!counts && probabilities && Object.values(probabilities).every((value) => value >= 0)) {
    counts = largestRemainderCounts(probabilities, shots);
    synthetic.push({ field: "counts", reason: "derived_from_probabilities", method: "largest_remainder" });
  }

  if (counts) {
    data.push({
      type: "counts",
      register: input.decodeMap?.registers.map((register) => register.name).join(",") || (registerMaps[0]?.name ?? "meas"),
      shots,
      counts,
    });
  }

  if (registerMaps.length > 1) {
    for (const { name, map } of registerMaps) {
      data.push({
        type: "counts",
        register: name,
        shots,
        counts: remap(map),
      });
    }
  }

  return {
    schema_version: RES_SCHEMA,
    bundle_id: input.bundleId ?? "",
    backend_id: input.backendId,
    data,
    provenance: {
      decoder_version: DECODER_VERSION,
      bit_order: PLATFORM_BIT_ORDER,
      source_bit_order: sourceOrder,
      layout_applied: Boolean(input.decodeMap?.layout),
      synthetic,
    },
    raw: payload,
  };
}

export function resultSetToNormalized(result: ResultSet, expectedShots: number): NormalizedResult {
  const counts = result.data.find((item): item is Extract<ResultData, { type: "counts" }> => item.type === "counts");
  const probabilities = result.data.find((item): item is Extract<ResultData, { type: "probabilities" }> => item.type === "probabilities");
  const quasi = result.data.find((item): item is Extract<ResultData, { type: "quasi" }> => item.type === "quasi");
  const shots = counts?.shots ?? expectedShots;
  return {
    counts: counts?.counts ?? {},
    probabilities: probabilities?.probabilities ?? {},
    shots,
    backend: result.backend_id,
    metadata: {
      normalized: true,
      bit_order: result.provenance.bit_order,
      source_bit_order: result.provenance.source_bit_order,
      layout_applied: result.provenance.layout_applied,
      synthetic: result.provenance.synthetic,
      ...(quasi ? { quasi: quasi.quasi, mitigation: quasi.mitigation } : {}),
      result_set: { schema_version: result.schema_version, bundle_id: result.bundle_id, types: result.data.map((item) => item.type) },
    },
  };
}
