import { z } from "zod";

const probabilities = z.record(z.string().regex(/^[01]{1,128}$/), z.number().finite().min(0).max(1))
  .superRefine((values, context) => {
    const entries = Object.entries(values);
    if (!entries.length || entries.length > 4096) context.addIssue({ code: "custom", message: "Supply 1–4096 reference outcomes." });
    if (Math.abs(entries.reduce((sum, [, p]) => sum + p, 0) - 1) > 1e-9) context.addIssue({ code: "custom", message: "Reference probabilities must sum to one." });
    if (new Set(entries.map(([key]) => key.length)).size !== 1) context.addIssue({ code: "custom", message: "Reference bitstrings must have the same width." });
  });

export const experimentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(10).max(2000),
  circuit_id: z.string().uuid(),
  previous_version_id: z.string().uuid().optional(),
  execution_intent: z.enum(["simulate", "hardware"]),
  targets: z.array(z.string().min(1).max(120)).min(1).max(5).refine((v) => new Set(v).size === v.length, "Targets must be unique."),
  shots: z.number().int().min(100).max(1_000_000),
  max_total_cost: z.number().finite().positive().max(100_000),
  reference: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("distribution"), probabilities, provenance: z.string().trim().min(5).max(1000) }).strict(),
    z.object({ kind: z.literal("none"), reason: z.string().trim().min(10).max(1000) }).strict(),
  ]),
  success_criterion: z.discriminatedUnion("metric", [
    z.object({ metric: z.literal("total_variation_distance"), max_distance: z.number().min(0).max(1), confidence: z.number().min(0.8).max(0.999) }).strict(),
    z.object({ metric: z.literal("record_only") }).strict(),
  ]),
}).strict().superRefine((input, context) => {
  if (input.reference.kind === "none" && input.success_criterion.metric !== "record_only") {
    context.addIssue({ code: "custom", path: ["success_criterion"], message: "A distribution criterion requires a reference distribution." });
  }
});

export const approveExperimentSchema = z.object({
  approved_definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
  approved_max_total_cost: z.number().finite().positive(),
}).strict();

export type ExperimentDefinition = z.infer<typeof experimentSchema>;
export interface ExperimentResource {
  id: string;
  organization_id: string;
  version: number;
  definition: ExperimentDefinition;
  definition_hash: string;
  source_hash: string;
  created_at: string;
  released_at: string | null;
}

export interface ExperimentRun {
  id: string;
  experiment_id: string;
  organization_id: string;
  group_id: string | null;
  created_at: string;
  approved_definition_hash: string;
  approved_max_total_cost: number;
  preparation_status: "preparing" | "not_submitted" | "accepted";
  preparation_error: { message: string } | null;
  updated_at: string;
}

export interface DistributionAssessment {
  status: "pass" | "fail" | "inconclusive" | "record_only";
  reason: string;
  distance: number | null;
  interval: [number, number] | null;
  shots: number | null;
  confidence: number | null;
}

/** A simultaneous Hoeffding bound over reference outcomes plus all other outcomes.
 * Collapsing outcomes with reference probability zero preserves TV distance.
 * This conservative interval assumes independent shots from a fixed distribution;
 * it does not certify a device or establish an advantage over classical methods.
 */
export function assessDistribution(definition: ExperimentDefinition, result: unknown): DistributionAssessment {
  const empty = { distance: null, interval: null, shots: null, confidence: null };
  if (definition.success_criterion.metric === "record_only" || definition.reference.kind === "none") {
    return { ...empty, status: "record_only", reason: "No statistical acceptance criterion was specified." };
  }
  const criterion = definition.success_criterion;
  if (!result || typeof result !== "object") return { ...empty, status: "inconclusive", reason: "Measurement results are not available." };
  const payload = result as Record<string, unknown>;
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  if (Array.isArray(metadata.synthetic) && metadata.synthetic.some((flag) => flag && typeof flag === "object" && (flag as { field?: unknown }).field === "counts")) {
    return { ...empty, status: "inconclusive", reason: "Synthetic counts cannot establish sampling confidence." };
  }
  const counts = payload.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return { ...empty, status: "inconclusive", reason: "An observed shot histogram is required." };
  const entries = Object.entries(counts);
  const reference = definition.reference.probabilities;
  const width = Object.keys(reference)[0].length;
  if (!entries.length || entries.some(([key, value]) => !new RegExp(`^[01]{${width}}$`).test(key) || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) {
    return { ...empty, status: "inconclusive", reason: "Counts are invalid or do not use the reference classical-bit coordinates." };
  }
  const observed = counts as Record<string, number>;
  const shots = Object.values(observed).reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(shots) || shots <= 0 || payload.shots !== shots) return { ...empty, status: "inconclusive", reason: "Observed counts and reported shot total must agree." };
  const support = Object.entries(reference).filter(([, p]) => p > 0).map(([key]) => key);
  const otherMass = Object.entries(observed).filter(([key]) => !(reference[key] > 0)).reduce((sum, [, count]) => sum + count / shots, 0);
  const distance = (support.reduce((sum, key) => sum + Math.abs((observed[key] ?? 0) / shots - reference[key]), 0) + otherMass) / 2;
  const categories = support.length + (support.length < 2 ** width ? 1 : 0);
  const radius = Math.min(1, categories / 2 * Math.sqrt(Math.log(2 * categories / (1 - criterion.confidence)) / (2 * shots)));
  const interval: [number, number] = [Math.max(0, distance - radius), Math.min(1, distance + radius)];
  const status = interval[1] <= criterion.max_distance ? "pass" : interval[0] > criterion.max_distance ? "fail" : "inconclusive";
  return { status, distance, interval, shots, confidence: criterion.confidence,
    reason: status === "inconclusive" ? "The confidence interval crosses the acceptance threshold; more evidence is needed." : `The confidence interval is ${status === "pass" ? "within" : "outside"} the specified distance threshold.` };
}
