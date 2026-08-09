// ──────────────────────────────────────────────────────────────────────────────
// QCI v2 — shared types.
//
// The organising idea of v2 is that EVERY number that reaches the index is an
// `Observation`: a value plus where it came from, when it was measured, and how
// much we trust it. v1 mixed live pulls, hard-coded constants and carried-forward
// history into the same plain `number` fields, which made it impossible to tell
// a genuine price move from a feed outage. Provenance is therefore not optional
// metadata here — it is part of the value.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * How authoritative a datum is. Mirrors the tiering used by benchmark
 * administrators (IOSCO PFB Principle 7: "data sufficiency" / hierarchy of
 * inputs) — the index prefers the highest available tier for every field and
 * records which tier it actually used.
 *
 *   primary   — the seller's own machine-readable rate card or the operator's
 *               own telemetry (AWS Price List API, IBM backend properties).
 *   official  — a government / central-bank / statistical-agency series
 *               (EIA, Eurostat, ECB, BLS, US Treasury).
 *   published — a documented figure from the vendor or a peer-reviewed source
 *               that is not machine-readable, pinned with a citation and a
 *               review date (e.g. IBM's $96/min list rate).
 *   modelled  — derived from other observations by a documented formula.
 *   assumed   — an engineering default. Only ever used for quantities that
 *               CANCEL in the index ratio (see `index.ts`); never for prices.
 */
export type SourceTier = "primary" | "official" | "published" | "modelled" | "assumed";

/** Ranking used when two sources offer the same field. Lower wins. */
export const TIER_RANK: Record<SourceTier, number> = {
  primary: 0,
  official: 1,
  published: 2,
  modelled: 3,
  assumed: 4,
};

/**
 * A single measured quantity with full provenance.
 *
 * `observedAt` is when the SOURCE says the value was true, not when we fetched
 * it — that distinction is what makes staleness measurable.
 */
export interface Observation<T = number> {
  value: T;
  tier: SourceTier;
  /** Stable id of the collector that produced it, e.g. "aws.pricelist.braket". */
  source: string;
  /** Human-readable citation or URL, shown in the UI and the audit trail. */
  citation?: string;
  /** ISO timestamp the value was true as of (source-reported where available). */
  observedAt: string;
  /** ISO timestamp we fetched it. */
  fetchedAt: string;
  /**
   * Days after `observedAt` beyond which this datum must not be reused.
   * Prices from a rate card stay valid for a long time (rate cards change
   * rarely); calibration data goes stale within days.
   */
  maxAgeDays: number;
  /** Set when the value was reused from an earlier run rather than re-fetched. */
  carried?: boolean;
  /** Age in days at the moment it was used. Filled in by the staleness pass. */
  ageDays?: number;
}

/** Modality drives the cost model and the default throughput assumptions. */
export type Modality =
  | "superconducting"
  | "trapped-ion"
  | "neutral-atom"
  | "photonic"
  | "spin";

/** How a device's headline price is quoted by its seller. */
export type PriceBasis =
  | "reservation-hour" // seller publishes $/hour of exclusive access — preferred
  | "metered-minute" // seller publishes $/minute of execution time
  | "shot-implied"; // derived from $/shot × measured shots-per-hour

/**
 * One device on one day, after every collector has run.
 *
 * Fields are Observations rather than numbers precisely so that
 * `matchedTornqvist` can refuse to move the index on a field that was not
 * actually re-measured.
 */
export interface DeviceObservation {
  /** Stable key: "<provider>:<device>", lowercased. Never changes for a device. */
  id: string;
  provider: string;
  device: string;
  modality: Modality;
  /** Region the hardware physically sits in — keys the energy/FX factors. */
  region: string;
  /** US state code, when the hardware is in the US. Selects the EIA tariff. */
  usState?: string;
  /** EU country code, when the hardware is in Europe. Selects the Eurostat tariff. */
  euCountry?: string;

  /** USD per QPU-hour of exclusive access. THE price. */
  pricePerHour: Observation;
  priceBasis: PriceBasis;

  /** Physical qubit / mode count. */
  qubits: Observation;
  /** Median two-qubit gate error in [0,1). Photonic devices use the documented analogue. */
  twoQubitError: Observation;
  /** Circuit layers executed per second at full width. */
  layerRate: Observation;

  /** Whether the seller reported the device as available to run work today. */
  online: Observation<boolean>;
  /** Seconds of queue, when the provider exposes it. Diagnostic only. */
  queueSeconds?: Observation;

  /** Secondary price series, kept for the shot-implied sub-index and display. */
  pricePerShot?: Observation;
  pricePerTask?: Observation;
}

/** A non-device input that the cost model consumes (energy, cryogens, rates…). */
export interface FactorObservation {
  /** Stable key, e.g. "energy.us.industrial.va". */
  id: string;
  /** Grouping shown on the map: "energy" | "cryogenics" | "capital" | "labour" | "fx". */
  group: string;
  label: string;
  unit: string;
  observation: Observation;
}

/** Per-device numbers the index derived, exposed for audit and for the UI map. */
export interface DeviceDerived {
  id: string;
  provider: string;
  device: string;
  modality: Modality;
  region: string;

  /** USD per QPU-hour, as observed. */
  pricePerHour: number;
  priceBasis: PriceBasis;

  /** Largest square circuit the device can run with expected error ≤ 1. */
  effectiveWidth: number;
  /** Capability delivered per hour, in comparable units (see quality.ts). */
  capability: number;
  /** pricePerHour / capability — USD per Quantum Capability Unit-hour. */
  qualityAdjustedPrice: number;

  /** Expenditure share used to weight this device on this day, in [0,1]. */
  weight: number;
  /** True when every field feeding the price and quality was re-measured today. */
  fresh: boolean;
  /** Worst staleness (days) across the fields that feed price and quality. */
  staleDays: number;

  /** Bottom-up marginal cost of one QPU-hour, USD (see cost.ts). */
  costPerHour?: number;
  /** pricePerHour / costPerHour. */
  costCoverage?: number;
}

/**
 * Why the index moved. Every published point carries this so a reader can see
 * whether a move was a real repricing, a quality change, or a coverage change.
 */
export interface IndexAttribution {
  /** Total log change of the index this period. */
  totalLogChange: number;
  /** Portion explained by headline prices moving, holding quality fixed. */
  priceLogChange: number;
  /** Portion explained by devices getting better/worse at the same price. */
  qualityLogChange: number;
  /** Per-device contribution to `totalLogChange` (sums to it). */
  byDevice: Array<{ id: string; provider: string; contribution: number }>;
  /** Per-provider aggregation of the above. */
  byProvider: Array<{ provider: string; contribution: number }>;
}

/** Reasons a device was in the basket but not in today's matched sample. */
export type ExclusionReason =
  | "not-observed-today"
  | "not-observed-previously"
  | "offline"
  | "stale-beyond-limit"
  | "reentry-cooldown"
  | "ineligible"
  | "retired";

export interface IndexPoint {
  /** ISO timestamp. One point per ET calendar day. */
  ts: string;
  /** Chain-linked index level. Anchored to 1000 at inception. */
  level: number;
  /** Headline USD per QPU-hour: weighted mean over the matched sample. */
  usdPerQpuHour: number;
  /** USD per Quantum Capability Unit-hour — the quality-adjusted price. */
  usdPerQcu: number;
  /** Percent change of `level` vs the previous point. */
  changePct: number;

  /**
   * Share of the basket (by weight) that was actually re-measured today, in
   * [0,1]. Published alongside the level so a reader can discount a thin day
   * rather than mistaking imputation for information.
   */
  coverage: number;
  /** Number of devices in the matched sample. */
  matched: number;
  /** Devices in the basket that did not make the matched sample, with reasons. */
  excluded: Array<{ id: string; reason: ExclusionReason }>;

  /** "final" when coverage cleared the threshold, "provisional" otherwise. */
  status: "final" | "provisional";
  attribution: IndexAttribution;
  devices: DeviceDerived[];
  factors: FactorObservation[];

  /** Bottom-up cost basis of one QPU-hour across the basket, USD. */
  costBasisPerHour?: number;
  /** usdPerQpuHour / costBasisPerHour — how far price sits above marginal cost. */
  costCoverageRatio?: number;
  /**
   * Basket-weighted cost decomposition, USD per QPU-hour. Summing to
   * `costBasisPerHour`. This is what the QCI map draws on its cost side, and it
   * is what makes the honest answer visible: energy is a real, live, tracked
   * input and it is also roughly a thousandth of the total.
   */
  costComponents?: {
    energy: number;
    consumables: number;
    labour: number;
    capital: number;
    /** d ln(cost) / d ln(electricity price). Equals the energy share. */
    energyElasticity: number;
    /** Total continuous electrical draw of the basket's hardware, kW. */
    basketPowerKw: number;
  };

  /** Methodology version that produced this point. Never recomputed in place. */
  methodology: string;
}

/** Index level at inception, S&P-style. */
export const QCI_INCEPTION_LEVEL = 1000;

/** Bumped whenever the computation changes in a way that breaks comparability. */
export const QCI_METHODOLOGY_VERSION = "qci-2.0.0";
