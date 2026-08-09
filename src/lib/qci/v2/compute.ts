// ──────────────────────────────────────────────────────────────────────────────
// The orchestrator: observations + yesterday's ledger → today's IndexPoint.
//
// Reading order for the whole engine:
//   quality.ts    how price is deflated by capability          (the hedonic step)
//   ledger.ts     which devices are allowed to speak today     (the state machine)
//   tornqvist.ts  how their relatives are aggregated           (the link)
//   cost.ts       the companion cost-basis series
//   this file     wiring, plus coverage and attribution
// ──────────────────────────────────────────────────────────────────────────────

import { deviceCost } from "./cost";
import {
  DEFAULT_LEDGER,
  reconcileLedger,
  stalenessDays,
  type LedgerConfig,
  type LedgerEntry,
} from "./ledger";
import { DEFAULT_HEDONIC, type HedonicConfig } from "./quality";
import { MODALITY_POWER_KW } from "./registry";
import {
  DEFAULT_LINK,
  linkPeriod,
  weightedGeoMean,
  type LinkConfig,
  type MatchedPair,
} from "./tornqvist";
import {
  QCI_INCEPTION_LEVEL,
  QCI_METHODOLOGY_VERSION,
  type DeviceDerived,
  type DeviceObservation,
  type FactorObservation,
  type IndexPoint,
} from "./types";

export interface ComputeInput {
  observations: DeviceObservation[];
  factors: FactorObservation[];
  /** Yesterday's ledger. Empty on the very first run. */
  previousLedger: Map<string, LedgerEntry>;
  /** Yesterday's published level. Null on the very first run. */
  previousLevel: number | null;
  /** ET calendar date of this run, "YYYY-MM-DD". */
  today: string;
  ts?: string;
  hedonic?: HedonicConfig;
  link?: LinkConfig;
  ledger?: LedgerConfig;
}

export interface ComputeOutput {
  point: IndexPoint;
  /** The ledger to persist for the next run. */
  ledger: Map<string, LedgerEntry>;
  /** Devices whose large price move is being held for corroboration. */
  held: Array<{ id: string; from: number; to: number }>;
  retired: string[];
}

/**
 * Expenditure share of a device, pre-capping.
 *
 * Share = price per hour × hours of capacity offered. Every eligible device
 * offers the same 24 hours, so the hours term is common and cancels, leaving
 * share ∝ hourly rate. That is the correct expenditure weighting: a $7,000/hr
 * machine genuinely represents more of the market's spend than a $2,500/hr one.
 *
 * Weight caps in tornqvist.ts then stop that from becoming domination — without
 * them, IonQ's four devices at $7,000/hr would carry over half the index.
 */
function expenditureShare(pricePerHour: number): number {
  return Math.max(pricePerHour, 0);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Compute one index point.
 *
 * Note what is NOT here: nowhere does the level get recomputed from absolute
 * prices. The level only ever advances by exp(Σ w̄ · Δln π) over the matched
 * sample. That is what makes a device appearing or disappearing structurally
 * incapable of moving the published number.
 */
export function computeIndexPoint(input: ComputeInput): ComputeOutput {
  const hedonic = input.hedonic ?? DEFAULT_HEDONIC;
  const link = input.link ?? DEFAULT_LINK;
  const ledgerCfg = input.ledger ?? DEFAULT_LEDGER;
  const ts = input.ts ?? new Date(`${input.today}T13:30:00Z`).toISOString();

  const reconciled = reconcileLedger({
    observations: input.observations,
    previous: input.previousLedger,
    today: input.today,
    ledgerCfg,
    hedonicCfg: hedonic,
  });

  // ── Link over the matched sample ────────────────────────────────────────────
  const pairs: MatchedPair[] = reconciled.matched.map((m) => ({
    id: m.entry.id,
    provider: m.entry.provider,
    prevPrice: m.prevQualityAdjustedPrice,
    currPrice: m.currQualityAdjustedPrice,
    prevHeadline: m.prevPricePerHour,
    currHeadline: m.currPricePerHour,
    prevShare: expenditureShare(m.prevPricePerHour),
    currShare: expenditureShare(m.currPricePerHour),
  }));

  const linked = linkPeriod(pairs, link);

  const previousLevel =
    input.previousLevel != null && input.previousLevel > 0
      ? input.previousLevel
      : QCI_INCEPTION_LEVEL;
  // Full precision is carried forward; only the DISPLAYED value is rounded.
  // v1 rounded the level to 2dp every day and fed that back into the next day's
  // chain, so a rounding error compounded into the series indefinitely.
  const level = previousLevel * Math.exp(linked.logChange);

  // ── Coverage: how much of the basket actually spoke today ──────────────────
  // Published alongside the level so a thin day is visible rather than being
  // silently presented with the same confidence as a full one.
  const basketIds = new Set<string>([
    ...reconciled.ledger.keys(),
  ]);
  for (const id of basketIds) {
    const e = reconciled.ledger.get(id);
    if (e?.state === "retired") basketIds.delete(id);
  }
  const basketShare = [...basketIds].reduce((a, id) => {
    const e = reconciled.ledger.get(id);
    return a + (e ? expenditureShare(e.acceptedPricePerHour) : 0);
  }, 0);
  const matchedShare = pairs.reduce((a, p) => a + expenditureShare(p.currHeadline), 0);
  const coverage = basketShare > 0 ? Math.min(1, matchedShare / basketShare) : 0;

  // ── Per-device derived values, for the map and the audit trail ─────────────
  const devices: DeviceDerived[] = [];
  for (const [id, entry] of reconciled.ledger) {
    if (entry.state === "retired") continue;
    // The device carries its own location from the registry, so the regional
    // tariff is a direct lookup rather than a guess from the region string.
    const cost = deviceCost(
      { modality: entry.modality, usState: entry.usState, euCountry: entry.euCountry },
      input.factors,
    );
    const stale = stalenessDays(entry, input.today);
    devices.push({
      id,
      provider: entry.provider,
      device: entry.device,
      modality: entry.modality,
      region: entry.region,
      pricePerHour: entry.acceptedPricePerHour,
      priceBasis: entry.priceBasis,
      effectiveWidth: entry.acceptedWidth,
      capability: entry.acceptedCapability,
      qualityAdjustedPrice: entry.acceptedQualityAdjustedPrice,
      weight: linked.weights.get(id) ?? 0,
      fresh: entry.state === "active",
      staleDays: Number.isFinite(stale) ? stale : 9999,
      costPerHour: cost.total,
      costCoverage: cost.total > 0 ? entry.acceptedPricePerHour / cost.total : undefined,
    });
  }

  // ── Headline levels, on the same weights the link used ─────────────────────
  const usdPerQpuHour = weightedGeoMean(
    pairs.map((p) => ({ id: p.id, value: p.currHeadline })),
    linked.weights,
  );
  const usdPerQcu = weightedGeoMean(
    pairs.map((p) => ({ id: p.id, value: p.currPrice })),
    linked.weights,
  );

  // ── Cost basis across the matched sample, on the same weights ──────────────
  const costBasis = weightedGeoMean(
    devices
      .filter((d) => (linked.weights.get(d.id) ?? 0) > 0 && (d.costPerHour ?? 0) > 0)
      .map((d) => ({ id: d.id, value: d.costPerHour as number })),
    linked.weights,
  );

  // ── Cost decomposition, weighted on the same weights as everything else ────
  let energyCost = 0;
  let consumablesCost = 0;
  let labourCost = 0;
  let capitalCost = 0;
  let costWeight = 0;
  let powerKw = 0;
  for (const [id, entry] of reconciled.ledger) {
    if (entry.state === "retired") continue;
    powerKw += MODALITY_POWER_KW[entry.modality] ?? 0;
    const w = linked.weights.get(id) ?? 0;
    if (w <= 0) continue;
    const c = deviceCost(
      { modality: entry.modality, usState: entry.usState, euCountry: entry.euCountry },
      input.factors,
    );
    energyCost += w * c.energy;
    consumablesCost += w * c.consumables;
    labourCost += w * c.labour;
    capitalCost += w * c.capital;
    costWeight += w;
  }
  const costComponents =
    costWeight > 0
      ? {
          energy: round(energyCost / costWeight, 4),
          consumables: round(consumablesCost / costWeight, 2),
          labour: round(labourCost / costWeight, 2),
          capital: round(capitalCost / costWeight, 2),
          energyElasticity: round(
            energyCost / (energyCost + consumablesCost + labourCost + capitalCost || 1),
            6,
          ),
          basketPowerKw: round(powerKw, 1),
        }
      : undefined;

  // ── Attribution ────────────────────────────────────────────────────────────
  const byProviderMap = new Map<string, number>();
  for (const c of linked.contributions) {
    byProviderMap.set(c.provider, (byProviderMap.get(c.provider) ?? 0) + c.contribution);
  }

  const point: IndexPoint = {
    ts,
    level: round(level, 6),
    usdPerQpuHour: round(usdPerQpuHour, 2),
    usdPerQcu: round(usdPerQcu, 2),
    changePct: round((Math.exp(linked.logChange) - 1) * 100, 4),
    coverage: round(coverage, 4),
    matched: pairs.length,
    excluded: reconciled.excluded,
    status: coverage >= link.provisionalBelowCoverage ? "final" : "provisional",
    attribution: {
      totalLogChange: linked.logChange,
      priceLogChange: linked.priceLogChange,
      qualityLogChange: linked.qualityLogChange,
      byDevice: linked.contributions,
      byProvider: [...byProviderMap].map(([provider, contribution]) => ({
        provider,
        contribution,
      })),
    },
    devices,
    factors: input.factors,
    costBasisPerHour: costBasis > 0 ? round(costBasis, 2) : undefined,
    costCoverageRatio:
      costBasis > 0 && usdPerQpuHour > 0 ? round(usdPerQpuHour / costBasis, 3) : undefined,
    costComponents,
    methodology: QCI_METHODOLOGY_VERSION,
  };

  return {
    point,
    ledger: reconciled.ledger,
    held: reconciled.held,
    retired: reconciled.retired,
  };
}

/** Total continuous power drawn by the whole basket, kW — shown on the map. */
export function basketPowerKw(devices: DeviceDerived[]): number {
  return devices.reduce((a, d) => a + (MODALITY_POWER_KW[d.modality] ?? 0), 0);
}
