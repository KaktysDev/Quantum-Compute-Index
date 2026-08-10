// ──────────────────────────────────────────────────────────────────────────────
// Routing lens — how QRouter's policies rank TODAY'S priced basket.
//
// WHAT THIS IS, AND WHAT IT IS NOT
// This is not a replay of live traffic and it does not dispatch anything. It
// answers one question, from the same published point the index is drawn from:
//
//     "Under policy P, which machine would a job land on right now, and why?"
//
// That makes it a real computation on real numbers rather than an illustration.
// Every input below comes from the day's IndexPoint — price from the seller's
// rate card, capability from the operator's calibration, queue from the live
// control plane, staleness from the ledger. Nothing is invented for the picture.
//
// The weights are QRouter's own published policy weights (see the routing
// fabric page), so a reader comparing the two surfaces sees one system rather
// than two that happen to share a name.
//
// WHY NORMALISE RATHER THAN SCORE RAW
// The four axes have incompatible units — dollars, seconds, a dimensionless
// capability, a probability. Min-max normalisation across the day's basket puts
// them on one 0..1 scale where 1 is always "best in today's field", so a weight
// of 35 means the same thing on every axis. It also makes the ranking relative
// to the market as it actually is today, which is the honest reading: "cheapest
// available", not "cheap against some pinned threshold".
// ──────────────────────────────────────────────────────────────────────────────

import type { DeviceDerived } from "./types";

export type PolicyId = "balanced" | "cost" | "speed" | "quality";

export interface PolicyWeights {
  cost: number;
  queue: number;
  fidelity: number;
  reliability: number;
}

export interface Policy {
  id: PolicyId;
  label: string;
  /** One line on what this policy optimises for, in the reader's terms. */
  blurb: string;
  weights: PolicyWeights;
}

/**
 * The four shipped policies, with the weights the router actually uses.
 *
 * Kept in this order deliberately: balanced first because it is the default,
 * then the three single-axis policies in the order a user tends to want them.
 */
export const POLICIES: Policy[] = [
  {
    id: "balanced",
    label: "Balanced",
    blurb: "No single axis dominates — the default when a job has no stated preference.",
    weights: { cost: 35, queue: 25, fidelity: 25, reliability: 15 },
  },
  {
    id: "cost",
    label: "Cheapest",
    blurb: "Price per hour dominates. Use when the circuit is small and the budget is the constraint.",
    weights: { cost: 70, queue: 15, fidelity: 10, reliability: 5 },
  },
  {
    id: "speed",
    label: "Fastest",
    blurb: "Queue depth dominates. Use when a result is needed now and cost is secondary.",
    weights: { cost: 15, queue: 65, fidelity: 10, reliability: 10 },
  },
  {
    id: "quality",
    label: "Highest fidelity",
    blurb: "Capability dominates. Use when the circuit is deep enough that error, not price, decides.",
    weights: { cost: 10, queue: 10, fidelity: 65, reliability: 15 },
  },
];

export interface AxisScore {
  /** Normalised 0..1, where 1 is the best value in today's field. */
  score: number;
  /** The underlying figure, in its own units. Undefined when not reported. */
  raw?: number;
  /** True when this axis had no datum and was scored as neutral. */
  imputed: boolean;
}

export interface RankedDevice {
  device: DeviceDerived;
  /** Weighted total, 0..1. */
  score: number;
  axes: {
    cost: AxisScore;
    queue: AxisScore;
    fidelity: AxisScore;
    reliability: AxisScore;
  };
  /** Axis that contributed the most to this device's score. */
  decidedBy: keyof PolicyWeights;
}

export interface Ranking {
  ranked: RankedDevice[];
  winner: RankedDevice | null;
  /**
   * Axes that no device reported today. Their weight is redistributed across
   * the remaining axes rather than being scored as zero — a missing input must
   * not read as a bad one, which is the same rule the index itself follows.
   */
  missingAxes: Array<keyof PolicyWeights>;
  /** Weights actually applied, after redistributing any missing axis. */
  effectiveWeights: PolicyWeights;
}

/**
 * Min-max normalise to 0..1. `invert` flips the sense so that lower-is-better
 * axes (price, queue) still come out with 1 = best.
 *
 * A degenerate field — one device, or every value identical — returns 0.5 for
 * everything rather than 1 or 0. Handing a lone device a perfect score on every
 * axis would make the ranking look decisive when it has nothing to compare.
 */
function normalise(values: Array<number | undefined>, invert: boolean): AxisScore[] {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const flat = finite.length === 0 || !Number.isFinite(min) || max === min;
  return values.map((v) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return { score: 0.5, raw: undefined, imputed: true };
    }
    if (flat) return { score: 0.5, raw: v, imputed: false };
    const t = (v - min) / (max - min);
    return { score: invert ? 1 - t : t, raw: v, imputed: false };
  });
}

/** Freshness as a reliability proxy, on the ledger's own retirement horizon. */
function reliabilityOf(d: DeviceDerived): number {
  if (d.fresh) return 1;
  return Math.max(0, 1 - d.staleDays / 45);
}

/**
 * Rank the day's priced basket under one policy.
 *
 * Devices with no usable price are dropped outright — the router cannot quote a
 * job it has no rate for, which is the same reason they never enter the index.
 */
export function rankDevices(devices: DeviceDerived[], policy: Policy): Ranking {
  const usable = devices.filter((d) => Number.isFinite(d.pricePerHour) && d.pricePerHour > 0);
  if (usable.length === 0) {
    return {
      ranked: [],
      winner: null,
      missingAxes: [],
      effectiveWeights: policy.weights,
    };
  }

  const cost = normalise(usable.map((d) => d.pricePerHour), true);
  const queue = normalise(usable.map((d) => d.queueSeconds), true);
  const fidelity = normalise(usable.map((d) => d.capability), false);
  const reliability = normalise(usable.map((d) => reliabilityOf(d)), false);

  // An axis nobody reported carries no information. Zeroing its weight and
  // redistributing keeps the score on the same 0..1 scale instead of silently
  // dragging every device toward the neutral 0.5 the imputation handed out.
  const missingAxes: Array<keyof PolicyWeights> = [];
  if (queue.every((q) => q.imputed)) missingAxes.push("queue");

  const base: PolicyWeights = { ...policy.weights };
  for (const axis of missingAxes) base[axis] = 0;
  const totalWeight = base.cost + base.queue + base.fidelity + base.reliability;
  const effectiveWeights: PolicyWeights =
    totalWeight > 0
      ? {
          cost: base.cost / totalWeight,
          queue: base.queue / totalWeight,
          fidelity: base.fidelity / totalWeight,
          reliability: base.reliability / totalWeight,
        }
      : { cost: 0.25, queue: 0.25, fidelity: 0.25, reliability: 0.25 };

  const ranked: RankedDevice[] = usable.map((device, i) => {
    const axes = {
      cost: cost[i],
      queue: queue[i],
      fidelity: fidelity[i],
      reliability: reliability[i],
    };
    const contributions = {
      cost: axes.cost.score * effectiveWeights.cost,
      queue: axes.queue.score * effectiveWeights.queue,
      fidelity: axes.fidelity.score * effectiveWeights.fidelity,
      reliability: axes.reliability.score * effectiveWeights.reliability,
    };
    const score =
      contributions.cost + contributions.queue + contributions.fidelity + contributions.reliability;
    const decidedBy = (Object.keys(contributions) as Array<keyof PolicyWeights>).reduce((a, b) =>
      contributions[b] > contributions[a] ? b : a,
    );
    return { device, score, axes, decidedBy };
  });

  // Ties break on device id so the winner does not flicker between renders of
  // the same point — a routing view that changes its mind on refresh with no
  // new data is indistinguishable from one that is broken.
  ranked.sort((a, b) => b.score - a.score || a.device.id.localeCompare(b.device.id));

  return { ranked, winner: ranked[0] ?? null, missingAxes, effectiveWeights };
}

export const AXIS_LABEL: Record<keyof PolicyWeights, string> = {
  cost: "Cost",
  queue: "Queue",
  fidelity: "Fidelity",
  reliability: "Reliability",
};

/** What each axis is actually read from, said plainly. */
export const AXIS_SOURCE: Record<keyof PolicyWeights, string> = {
  cost: "Published hourly rate",
  queue: "Live queue depth from the control plane",
  fidelity: "Capability from published calibration",
  reliability: "How recently the operator reported the machine",
};
