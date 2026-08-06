import { buildQuote } from "./route";
import { analysisFromTranspilation } from "./transpiler";
import type { CircuitAnalysis, RouteDecision, TranspilationResult } from "./types";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

interface ParkedJob {
  id: string;
  shots: number;
  analysis: CircuitAnalysis & { transpilation?: Omit<TranspilationResult, "providerProgram"> };
  route_decision: RouteDecision;
}

interface ParkedExecutionGroupJob extends ParkedJob {
  group_id: string;
}

/**
 * Unlocks jobs parked as awaiting_payment once credits arrive. Jobs whose quote
 * is still valid are reserved and queued atomically in SQL; expired quotes are
 * re-issued from the stored routing decision (same accepted rates, fresh
 * validity window) and queued through the same atomic RPC.
 */
export async function requeueAwaitingPaymentJobs(admin: AdminClient, organizationId: string) {
  const { data: groupData, error: groupError } = await admin.rpc("requeue_awaiting_payment_execution_groups", { p_organization_id: organizationId });
  // A wedged execution group must not block the single-job requeue below: this
  // runs on the Stripe webhook and the purchase path, and throwing here used to
  // stop credits unparking anything else in the organization.
  if (groupError) console.error(`Failed to requeue awaiting_payment execution groups for ${organizationId}`, groupError);
  const groupOutcomes = (groupData ?? []) as Array<{ group_id: string; outcome: "queued" | "awaiting_payment" | "quote_expired" | "error" }>;
  for (const entry of groupOutcomes) {
    if (entry.outcome === "awaiting_payment") break; // balance exhausted; keep FIFO order
    if (entry.outcome !== "quote_expired") continue;
    const { data: jobs, error: jobsError } = await admin.from("jobs")
      .select("id,group_id,shots,analysis,route_decision")
      .eq("group_id", entry.group_id).eq("organization_id", organizationId).eq("status", "awaiting_payment");
    if (jobsError || !jobs?.length) continue;
    try {
      const quotes = (jobs as unknown as ParkedExecutionGroupJob[]).map((job) => {
        const executionAnalysis = job.analysis.transpilation
          ? analysisFromTranspilation(job.analysis.transpilation as TranspilationResult)
          : job.analysis;
        const quote = buildQuote(job.route_decision, executionAnalysis, job.shots);
        return {
          job_id: job.id, provider_cost: quote.providerCost, transpiler_fee: quote.transpilerFee,
          platform_fee: quote.platformFee, total: quote.total, rate_snapshot: quote.rateSnapshot, expires_at: quote.expiresAt,
        };
      });
      const { data: outcome, error: queueError } = await admin.rpc("queue_execution_group_with_quotes", { p_group_id: entry.group_id, p_quotes: quotes });
      if (queueError) throw queueError;
      if (outcome === "awaiting_payment") break;
    } catch (requeueError) {
      console.error(`Failed to reprice awaiting_payment execution group ${entry.group_id}`, requeueError);
    }
  }

  const { data, error } = await admin.rpc("requeue_awaiting_payment_jobs", { p_organization_id: organizationId });
  if (error) throw error;
  const outcomes = (data ?? []) as Array<{ job_id: string; outcome: "queued" | "insufficient" | "quote_expired" }>;

  for (const entry of outcomes) {
    if (entry.outcome !== "quote_expired") continue;
    const { data: job, error: jobError } = await admin.from("jobs")
      .select("id,shots,analysis,route_decision")
      .eq("id", entry.job_id).eq("organization_id", organizationId).maybeSingle();
    if (jobError || !job) continue;
    const parked = job as unknown as ParkedJob;
    try {
      const executionAnalysis = parked.analysis.transpilation
        ? analysisFromTranspilation(parked.analysis.transpilation as TranspilationResult)
        : parked.analysis;
      const quote = buildQuote(parked.route_decision, executionAnalysis, parked.shots);
      const { data: outcome, error: queueError } = await admin.rpc("queue_job_with_quote", {
        p_job_id: parked.id,
        p_provider_cost: quote.providerCost,
        p_transpiler_fee: quote.transpilerFee,
        p_platform_fee: quote.platformFee,
        p_total: quote.total,
        p_rate_snapshot: quote.rateSnapshot,
        p_expires_at: quote.expiresAt,
      });
      if (queueError) throw queueError;
      if (outcome === "awaiting_payment") break; // balance exhausted; keep FIFO order
    } catch (repriceError) {
      console.error(`Failed to reprice awaiting_payment job ${parked.id}`, repriceError);
    }
  }
  return { groups: groupOutcomes, jobs: outcomes };
}
