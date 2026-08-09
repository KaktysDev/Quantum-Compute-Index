// ──────────────────────────────────────────────────────────────────────────────
// The device ledger — v2's replacement for carryForward.ts.
//
// WHAT WAS WRONG WITH THE FREEZE MECHANISM
// v1's rule was "if we cannot reach a provider, reuse yesterday's row". That is
// the right instinct and the wrong implementation, for four reasons:
//
//   1. No decay and no limit. A provider offline for six months still sat in
//      the basket at full weight, indefinitely, presented as current.
//   2. It suppressed variance. A carried device reported a price every day, so
//      the index looked confident on days when half the market was silent.
//      Nothing published told a reader which days those were.
//   3. Returning devices jumped. Six months of accumulated real price change
//      landed in a single day's move.
//   4. `mergeWithCarryForward` carried UNKNOWN provider names "defensively",
//      so a typo or a renamed backend could pin a phantom constituent forever.
//
// WHAT v2 DOES INSTEAD
// The ledger is an explicit per-device state machine. Its job is to decide, for
// each device each day, exactly one question: *may this device contribute a
// price relative to today's index?* Everything else follows.
//
//   active              observed today and last time → contributes its relative
//   linking-in          first observation, or first after a gap → contributes
//                       NOTHING today; its level is adopted, never its change
//   unobserved          missed today → contributes nothing; imputed with the
//                       cohort by construction (see tornqvist.ts)
//   pending-confirmation a price move large enough to be a parse error is held
//                       for one more observation before it may enter
//   retired             unobserved past the staleness limit → leaves the basket
//
// Because the index compounds log RATIOS of matched pairs, a device that
// contributes nothing contributes *exactly zero*, not a distortion. That is the
// structural difference from v1, where a carried row still shifted a weighted
// mean. Missing data can no longer manufacture a price move — which is the
// whole complaint this rewrite exists to answer.
// ──────────────────────────────────────────────────────────────────────────────

import { capability, effectiveWidth, type HedonicConfig, DEFAULT_HEDONIC } from "./quality";
import {
  TIER_RANK,
  type DeviceObservation,
  type ExclusionReason,
  type Modality,
  type PriceBasis,
  type SourceTier,
} from "./types";

export type DeviceState =
  | "active"
  | "linking-in"
  | "unobserved"
  | "pending-confirmation"
  | "retired";

export interface LedgerEntry {
  id: string;
  provider: string;
  device: string;
  modality: Modality;
  region: string;
  usState?: string;
  euCountry?: string;

  /** The price the index is currently using, USD/QPU-hour. */
  acceptedPricePerHour: number;
  priceBasis: PriceBasis;
  /** Capability derived from the SMOOTHED quality inputs. */
  acceptedCapability: number;
  /** acceptedPricePerHour / acceptedCapability. */
  acceptedQualityAdjustedPrice: number;
  acceptedWidth: number;

  /**
   * Trailing raw observations of the noisy quality inputs, newest last.
   * Calibration data genuinely swings between runs; the index is meant to price
   * SUSTAINED capability, so these are reduced to a median before use.
   */
  errorHistory: number[];
  qubitHistory: number[];
  layerRate: number;

  /**
   * Weakest tier among the fields feeding this device's quality, so the UI can
   * say which constituents are running on a provider-typical default rather
   * than a measurement. `layerRate` is excluded: it is an `assumed` per-modality
   * constant by design and cancels exactly in the index ratio, so counting it
   * would mark every device in the basket as assumed and say nothing.
   *
   * Optional because ledgers persisted before this field existed deserialise
   * without it; readers treat a missing value as unknown rather than as primary.
   */
  qualityTier?: SourceTier;
  /** Feeds that reported this device, when more than one did. */
  sources?: string[];

  /** ISO date (ET) of the most recent fresh observation. */
  lastObservedOn: string | null;
  /** ISO date the accepted values were last updated. */
  acceptedOn: string;
  consecutiveMissingDays: number;

  /** A large move awaiting a second, corroborating observation. */
  pending?: {
    pricePerHour: number;
    firstSeenOn: string;
    observations: number;
  } | null;

  state: DeviceState;

  /**
   * Price change that happened while the device was unobserved and was
   * therefore never linked into the index. Recorded, not hidden — a persistent
   * non-zero total here would mean outages are biasing the index and the
   * methodology needs revisiting.
   */
  unlinkedLogChange: number;
}

export interface LedgerConfig {
  /** Observations kept for the trailing median of noisy quality inputs. */
  smoothingWindow: number;
  /**
   * A single-period move in the headline price above this (in log terms) is
   * held for one more observation before it may enter the index. 0.15 ≈ 16%.
   *
   * Set above the size of a plausible rate-card adjustment (single-digit to low
   * double-digit percent) and far below the size of a parse failure, which
   * typically lands orders of magnitude out — a $5,000/hr rate misread as $0.50
   * is a log move of −9.2, not −0.16.
   *
   * This is a data-verification control, not a cap: a genuine rate-card change
   * lands in full, one day late. A one-off bad parse never lands at all,
   * because it will not reproduce. Nothing is ever silently rewritten.
   */
  largeMoveLogThreshold: number;
  /** Relative tolerance for "the pending price reappeared unchanged". */
  confirmTolerance: number;
  /** Consecutive missing days after which a device leaves the basket. */
  retireAfterMissingDays: number;
  /** Two-qubit error outside [min,max] is treated as invalid, not as data. */
  minTwoQubitError: number;
  maxTwoQubitError: number;
}

export const DEFAULT_LEDGER: LedgerConfig = {
  smoothingWindow: 7,
  largeMoveLogThreshold: 0.15,
  confirmTolerance: 1e-4,
  retireAfterMissingDays: 45,
  minTwoQubitError: 1e-5,
  maxTwoQubitError: 0.5,
};

function median(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function push(history: number[], value: number, window: number): number[] {
  const next = [...history, value];
  return next.length > window ? next.slice(next.length - window) : next;
}

/** A quality reading we refuse to trust is treated as absent, never as zero. */
function validError(v: number | undefined, cfg: LedgerConfig): boolean {
  return (
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= cfg.minTwoQubitError &&
    v <= cfg.maxTwoQubitError
  );
}

function validPrice(v: number | undefined): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Least authoritative of a set of tiers — the honest label for a composite. */
function weakestTier(tiers: SourceTier[]): SourceTier {
  return tiers.reduce((worst, t) => (TIER_RANK[t] > TIER_RANK[worst] ? t : worst), "primary");
}

export interface ReconcileInput {
  /** Today's fresh observations, already filtered to eligible devices. */
  observations: DeviceObservation[];
  /** Yesterday's ledger, keyed by device id. */
  previous: Map<string, LedgerEntry>;
  /** ET calendar date of this run, "YYYY-MM-DD". */
  today: string;
  ledgerCfg?: LedgerConfig;
  hedonicCfg?: HedonicConfig;
}

export interface ReconcileOutput {
  /** The ledger to persist for tomorrow. */
  ledger: Map<string, LedgerEntry>;
  /** Devices eligible to contribute a relative to today's link. */
  matched: Array<{
    entry: LedgerEntry;
    prevQualityAdjustedPrice: number;
    prevPricePerHour: number;
    currQualityAdjustedPrice: number;
    currPricePerHour: number;
  }>;
  /** Devices carried in the basket but not contributing today, with reasons. */
  excluded: Array<{ id: string; reason: ExclusionReason }>;
  /** Devices that left the basket entirely this run. */
  retired: string[];
  /** Devices whose large move is being held pending corroboration. */
  held: Array<{ id: string; from: number; to: number }>;
}

/**
 * Advance every device's state by one period and report which ones may
 * contribute a price relative.
 *
 * Reconciliation is deliberately total: every device in either the incoming
 * observations OR the previous ledger gets a decision and a recorded reason.
 * Nothing falls through silently, which is what makes each published point
 * reproducible from its own stored row.
 */
export function reconcileLedger(input: ReconcileInput): ReconcileOutput {
  const cfg = input.ledgerCfg ?? DEFAULT_LEDGER;
  const hedonic = input.hedonicCfg ?? DEFAULT_HEDONIC;
  const { today } = input;

  const ledger = new Map<string, LedgerEntry>();
  const matched: ReconcileOutput["matched"] = [];
  const excluded: ReconcileOutput["excluded"] = [];
  const retired: string[] = [];
  const held: ReconcileOutput["held"] = [];

  const observedById = new Map<string, DeviceObservation>();
  for (const o of input.observations) observedById.set(o.id, o);

  // ── Devices with a fresh observation today ────────────────────────────────
  for (const [id, obs] of observedById) {
    const prev = input.previous.get(id);
    const priceOk = validPrice(obs.pricePerHour.value);
    const online = obs.online.value !== false;

    // A device the seller reports as down, or that reports no usable price, is
    // treated exactly like an unobserved device — never as a zero-priced one.
    if (!priceOk) {
      handleMissing(id, prev, "not-observed-today");
      continue;
    }
    if (!online && prev) {
      handleMissing(id, prev, "offline");
      continue;
    }

    const errHistory = validError(obs.twoQubitError.value, cfg)
      ? push(prev?.errorHistory ?? [], obs.twoQubitError.value, cfg.smoothingWindow)
      : (prev?.errorHistory ?? []);
    const qubitHistory = push(
      prev?.qubitHistory ?? [],
      Math.max(1, Math.floor(obs.qubits.value)),
      cfg.smoothingWindow,
    );

    // Smoothing the noisy inputs is what keeps calibration jitter out of the
    // headline. A trailing median rather than a mean, so one bad calibration
    // run cannot drag the level.
    const smoothedError = errHistory.length > 0 ? median(errHistory) : cfg.maxTwoQubitError;
    const smoothedQubits = qubitHistory.length > 0 ? median(qubitHistory) : 1;
    const layerRate = obs.layerRate.value > 0 ? obs.layerRate.value : (prev?.layerRate ?? 1);

    const width = effectiveWidth(smoothedQubits, smoothedError);
    const cap = capability(width, layerRate, hedonic);
    const price = obs.pricePerHour.value;
    const qap = cap > 0 ? price / cap : Number.NaN;

    const base: LedgerEntry = {
      id,
      provider: obs.provider,
      device: obs.device,
      modality: obs.modality,
      region: obs.region,
      usState: obs.usState,
      euCountry: obs.euCountry,
      acceptedPricePerHour: price,
      priceBasis: obs.priceBasis,
      acceptedCapability: cap,
      acceptedQualityAdjustedPrice: qap,
      acceptedWidth: width,
      errorHistory: errHistory,
      qubitHistory,
      layerRate,
      qualityTier: weakestTier([obs.qubits.tier, obs.twoQubitError.tier]),
      sources: obs.mergedFrom,
      lastObservedOn: today,
      acceptedOn: today,
      consecutiveMissingDays: 0,
      pending: null,
      state: "active",
      unlinkedLogChange: prev?.unlinkedLogChange ?? 0,
    };

    // ── First ever sighting, or first after a gap: LINK IN, do not jump ─────
    // The device's price LEVEL is adopted so it can be displayed and can anchor
    // tomorrow's relative. Its price CHANGE across the gap is deliberately not
    // linked — attributing weeks of drift to one day is precisely the artefact
    // this rewrite removes. The unlinked amount is recorded, not discarded.
    if (!prev || prev.state === "retired" || !Number.isFinite(prev.acceptedQualityAdjustedPrice)) {
      ledger.set(id, { ...base, state: "linking-in" });
      excluded.push({ id, reason: prev ? "reentry-cooldown" : "not-observed-previously" });
      continue;
    }
    if (prev.state === "unobserved") {
      const gap =
        Number.isFinite(qap) && prev.acceptedQualityAdjustedPrice > 0
          ? Math.log(qap / prev.acceptedQualityAdjustedPrice)
          : 0;
      ledger.set(id, {
        ...base,
        state: "linking-in",
        unlinkedLogChange: (prev.unlinkedLogChange ?? 0) + gap,
      });
      excluded.push({ id, reason: "reentry-cooldown" });
      continue;
    }

    // ── Large-move verification ────────────────────────────────────────────
    const moveLog =
      prev.acceptedPricePerHour > 0 ? Math.abs(Math.log(price / prev.acceptedPricePerHour)) : 0;
    const pending = prev.pending;
    const corroborates =
      pending != null &&
      Math.abs(price - pending.pricePerHour) <=
        cfg.confirmTolerance * Math.max(Math.abs(pending.pricePerHour), 1e-9);

    if (moveLog > cfg.largeMoveLogThreshold && !corroborates) {
      // Hold. The index uses the previously accepted values, so today's
      // contribution is exactly ln(1) = 0 — no move, in either direction.
      ledger.set(id, {
        ...prev,
        errorHistory: errHistory,
        qubitHistory,
        layerRate,
        lastObservedOn: today,
        consecutiveMissingDays: 0,
        state: "pending-confirmation",
        pending: {
          pricePerHour: price,
          firstSeenOn: pending?.firstSeenOn ?? today,
          observations: (pending?.observations ?? 0) + 1,
        },
      });
      held.push({ id, from: prev.acceptedPricePerHour, to: price });
      matched.push({
        entry: prev,
        prevQualityAdjustedPrice: prev.acceptedQualityAdjustedPrice,
        prevPricePerHour: prev.acceptedPricePerHour,
        currQualityAdjustedPrice: prev.acceptedQualityAdjustedPrice,
        currPricePerHour: prev.acceptedPricePerHour,
      });
      continue;
    }

    // Normal path (including a held move that has now reproduced): accept and
    // contribute the relative against the last accepted values.
    ledger.set(id, base);
    matched.push({
      entry: base,
      prevQualityAdjustedPrice: prev.acceptedQualityAdjustedPrice,
      prevPricePerHour: prev.acceptedPricePerHour,
      currQualityAdjustedPrice: qap,
      currPricePerHour: price,
    });
  }

  // ── Devices in the basket with no observation today ───────────────────────
  for (const [id, prev] of input.previous) {
    if (observedById.has(id)) continue;
    handleMissing(id, prev, "not-observed-today");
  }

  function handleMissing(id: string, prev: LedgerEntry | undefined, reason: ExclusionReason) {
    if (!prev) {
      // Observed today but unusable, and never seen before → nothing to carry.
      excluded.push({ id, reason: "not-observed-previously" });
      return;
    }
    const missing = prev.consecutiveMissingDays + 1;
    if (missing > cfg.retireAfterMissingDays) {
      // Leaves the basket outright rather than being presented as current.
      // A later reappearance links in fresh, so no catch-up jump can occur.
      ledger.set(id, { ...prev, state: "retired", consecutiveMissingDays: missing });
      retired.push(id);
      excluded.push({ id, reason: "stale-beyond-limit" });
      return;
    }
    ledger.set(id, {
      ...prev,
      state: "unobserved",
      consecutiveMissingDays: missing,
      pending: null,
    });
    excluded.push({ id, reason });
  }

  return { ledger, matched, excluded, retired, held };
}

/** Days since a ledger entry last saw a fresh observation. */
export function stalenessDays(entry: LedgerEntry, today: string): number {
  if (!entry.lastObservedOn) return Number.POSITIVE_INFINITY;
  const a = Date.parse(`${entry.lastObservedOn}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}
