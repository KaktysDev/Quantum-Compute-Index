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

/**
 * Unlocks jobs parked as awaiting_payment once credits arrive. Jobs whose quote
 * is still valid are reserved and queued atomically in SQL; expired quotes are
 * re-issued from the stored routing decision (same accepted rates, fresh
 * validity window) and queued through the same atomic RPC.
 */
export async function requeueAwaitingPaymentJobs(admin: AdminClient, organizationId: string) {
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
  return outcomes;
}
