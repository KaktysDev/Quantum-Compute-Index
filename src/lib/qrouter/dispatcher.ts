// ─────────────────────────────────────────────────────────────────────────────
// Job execution mechanics: dispatch one job to a provider, poll one active job.
//
// This module was lifted verbatim out of /api/internal/jobs so a second caller
// can reuse it. The scheduler route still owns the fleet-wide loop (claim a
// batch, dispatch, poll, flush webhooks); `advanceJob` below owns the
// single-job, caller-scoped variant used by the terminal client and the
// console, which cannot wait for a cron that may not be deployed.
//
// Routing, transpilation, pricing and settlement are NOT implemented here —
// they are called through the same functions the scheduler already used
// (transpileForBackend, submitToProvider, finalize_qrouter_job), so both entry
// points produce identical state transitions and identical billing.
// ─────────────────────────────────────────────────────────────────────────────

import { analyzeCircuit } from "./analyze";
import { storeArtifact } from "./artifacts";
import { encodeForBackend } from "./encoding/adapters";
import { buildExecutionEnvelope, selectedBundleForBackend, selectedBundleView } from "./encoding/compose";
import type { DecodeMap, ExecutionBundle } from "./encoding/types";
import { cancelProviderJob, getProviderStatus, submitToProvider } from "./execution";
import { JOB_LEASE_SECONDS, nextAttemptCandidate, orchestrationError, retryDelaySeconds } from "./orchestration";
import { resolveProviderTarget } from "./providerTargets";
import { providerPrice, totalPrice } from "./pricing";
import { normalizeProviderResult } from "./results";
import { analysisFromTranspilation, transpileForBackend } from "./transpiler";
import type { CircuitAnalysis, InputFormat, JobStatus, RouteDecision, TranspilationResult } from "./types";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type PersistedAnalysis = CircuitAnalysis & { transpilation?: Omit<TranspilationResult, "providerProgram"> };

export type OrchestratedJob = {
  id: string;
  organization_id: string;
  input_format: InputFormat;
  source: string;
  shots: number;
  status: JobStatus;
  selected_backend_id: string;
  provider_job_id: string | null;
  quote_id: string | null;
  route_decision: RouteDecision;
  analysis: PersistedAnalysis;
  failover_enabled: boolean;
  max_attempts: number;
  execution_timeout_seconds: number;
  execution_deadline_at: string | null;
  timeout_failover_pending: boolean;
};
export type BillingEvidence = { status: "unknown" | "estimated" | "confirmed" | "internal-tariff"; estimated: number | null; actual?: number | null; ambiguous?: boolean };
export type JobAttempt = { attempt: number; backend_id: string; provider_job_id: string | null; status: string; request?: { billing?: BillingEvidence }; response?: { billing?: BillingEvidence } };

function usageOf(attempts: JobAttempt[]) {
  return attempts.map((attempt) => {
    const billing = attempt.response?.billing ?? attempt.request?.billing;
    return { backendId: attempt.backend_id, cost: billing?.actual, confirmed: billing?.status === "confirmed" || billing?.status === "internal-tariff", ambiguous: billing?.ambiguous };
  });
}


/** Missing vendor usage remains distinct from a reported zero-dollar attempt. */
export function summarizeAttemptUsage(attempts: JobAttempt[], decision: RouteDecision) {
  let estimate = 0;
  let actual = 0;
  let estimateComplete = true;
  let confirmed = attempts.length > 0;
  for (const attempt of attempts) {
    const billing = attempt.response?.billing ?? attempt.request?.billing;
    const expected = billing?.estimated ?? decision.candidates.find((c) => c.backend.id === attempt.backend_id)?.estimatedProviderCost;
    if (expected != null && Number.isFinite(expected) && expected >= 0) estimate += expected;
    else estimateComplete = false;
    if ((billing?.status === "confirmed" || billing?.status === "internal-tariff")
      && !billing.ambiguous && billing.actual != null && Number.isFinite(billing.actual) && billing.actual >= 0) actual += billing.actual;
    else confirmed = false;
  }
  return { estimated: estimateComplete ? estimate : null, actual: confirmed ? actual : null, confirmed };
}


async function finishJob(admin: AdminClient, job: OrchestratedJob, status: "completed" | "failed" | "cancelled", input: {
  result?: Record<string, unknown>;
  error?: string;
  actualProviderCost?: number;
}) {
  const { data: attemptRows, error: attemptsError } = await admin.from("job_attempts").select("attempt,backend_id,provider_job_id,status,request,response").eq("job_id", job.id).order("attempt");
  if (attemptsError) throw attemptsError;
  const attempts = (attemptRows ?? []) as JobAttempt[];
  const usage = summarizeAttemptUsage(attempts, job.route_decision);
  const { estimated, confirmed } = usage;
  const reconciliation = { status: confirmed ? "confirmed" : "pending", estimatedProviderCost: estimated,
    actualProviderCost: usage.actual, acceptedBudget: job.route_decision.reservedTotal ?? job.route_decision.acceptedBudget,
    attemptCount: attempts.length, providerReportedFinalAttemptCost: input.actualProviderCost ?? null };
  // Events are the durable compatibility record even before the optional summary
  // table migration is installed. Missing usage remains null, never zero.
  const { error: evidenceError } = await admin.from("job_events").insert({ job_id: job.id, type: "job.usage_reconciliation", payload: reconciliation });
  if (evidenceError) throw evidenceError;
  try {
    await admin.from("provider_usage_reconciliation").upsert({ job_id: job.id, organization_id: job.organization_id,
      status: reconciliation.status, estimated_provider_cost: estimated, actual_provider_cost: reconciliation.actualProviderCost,
      accepted_total: job.route_decision.reservedTotal ?? job.route_decision.acceptedBudget ?? 0, customer_charge_ceiling: job.route_decision.reservedTotal ?? job.route_decision.acceptedBudget ?? 0,
      evidence: reconciliation, updated_at: new Date().toISOString() });
  } catch { /* job_events above retains the evidence until the summary migration is installed. */ }
  const { data: changed, error } = await admin.rpc("finalize_qrouter_job", {
    p_job_id: job.id,
    p_status: status,
    p_result: input.result ?? null,
    p_error: input.error ?? null,
    p_actual_provider_cost: attempts.length ? (confirmed ? usage.actual : estimated) : input.actualProviderCost ?? null,
  });
  if (error) throw error;
  if (!changed) return;

  await admin.from("job_events").insert({
    job_id: job.id,
    type: `job.${status}`,
    from_status: job.status,
    to_status: status,
    payload: input.actualProviderCost == null ? {} : { actualProviderCost: input.actualProviderCost },
  });
}

async function scheduleRetryOrFail(admin: AdminClient, job: OrchestratedJob, attempts: JobAttempt[], message: string) {
  const next = nextAttemptCandidate({
    decision: job.route_decision,
    attemptedBackendIds: attempts.map((attempt) => attempt.backend_id),
    usage: usageOf(attempts),
    failoverEnabled: job.failover_enabled,
    maxAttempts: job.max_attempts,
  });
  if (!next) {
    await finishJob(admin, job, "failed", { error: message });
    return "failed";
  }

  const delaySeconds = retryDelaySeconds(attempts.length);
  const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const { data: changed, error: updateError } = await admin.from("jobs").update({
    status: "queued",
    provider_job_id: null,
    error: { message, retriable: true },
    next_attempt_at: nextAttemptAt,
    lease_expires_at: null,
    execution_deadline_at: null,
    timeout_failover_pending: false,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id).eq("status", job.status).select("id").maybeSingle();
  if (updateError) throw updateError;
  if (!changed) return "unchanged";
  await admin.from("job_events").insert({
    job_id: job.id,
    type: "job.retry_scheduled",
    from_status: job.status,
    to_status: "queued",
    payload: { failedBackend: attempts.at(-1)?.backend_id, nextBackend: next.backend.id, attempt: attempts.length + 1, delaySeconds },
  });
  return "queued";
}

async function persistAttemptEncoding(
  admin: AdminClient,
  job: OrchestratedJob,
  backendId: string,
  transpilation: TranspilationResult,
  encoded?: ExecutionBundle,
) {
  const encoding = encoded && job.route_decision.encoding
    ? { ...job.route_decision.encoding, selected_bundle: selectedBundleView(encoded) }
    : job.route_decision.encoding;
  const analysis = { ...job.analysis, transpilation, encoding };
  // Keep route_decision.selected as the quoted primary — failover cost ceiling
  // is keyed off that winner. Only the live encoding + selected_backend_id move.
  const route_decision = encoding === job.route_decision.encoding
    ? job.route_decision
    : { ...job.route_decision, encoding };
  await Promise.all([
    admin.from("jobs").update({
      analysis,
      route_decision,
      selected_backend_id: backendId,
      updated_at: new Date().toISOString(),
    }).eq("id", job.id),
    storeArtifact({ jobId: job.id, organizationId: job.organization_id, kind: "transpiled", content: transpilation.artifactQasm ?? transpilation.qasm }),
  ]);
  job.analysis = analysis as PersistedAnalysis;
  job.route_decision = route_decision;
  job.selected_backend_id = backendId;
}

async function executionPlanFor(admin: AdminClient, job: OrchestratedJob, backendId: string): Promise<{
  analysis: CircuitAnalysis;
  bundle?: Pick<ExecutionBundle, "media_type" | "payload">;
  decodeMap?: DecodeMap;
}> {
  const candidate = job.route_decision.candidates.find((item) => item.backend.id === backendId);
  if (!candidate) throw new Error(`The route decision does not contain backend ${backendId}.`);

  const existing = job.analysis.transpilation;
  let transpilation: TranspilationResult;
  if (existing?.backendId === backendId) {
    transpilation = existing as TranspilationResult;
  } else {
    const target = await resolveProviderTarget(candidate.backend);
    transpilation = await transpileForBackend(target, analyzeCircuit(job.source, job.input_format), {
      optimizationLevel: existing?.optimizationLevel ?? 2,
      seedTranspiler: existing?.seedTranspiler ?? 42,
      verifyEquivalence: true,
    });
  }

  const analysis = analysisFromTranspilation(transpilation);
  const matching = selectedBundleForBackend(job.route_decision.encoding, backendId);
  if (matching?.payload && matching.media_type) {
    if (existing?.backendId !== backendId) {
      await persistAttemptEncoding(admin, job, backendId, transpilation);
    }
    return { analysis, bundle: { media_type: matching.media_type, payload: matching.payload }, decodeMap: matching.decode_map };
  }

  const encoded = encodeForBackend({
    envelope: buildExecutionEnvelope({
      source: job.source,
      format: job.input_format,
      shots: job.shots,
      routing_mode: job.route_decision.mode,
      failover: { enabled: job.failover_enabled, max_attempts: job.max_attempts },
    }),
    backend: candidate.backend,
    analysis,
    transpilation,
    quoteBinding: "binding",
  });
  await persistAttemptEncoding(admin, job, backendId, transpilation, encoded);
  return { analysis, bundle: { media_type: encoded.media_type, payload: encoded.payload }, decodeMap: encoded.decode_map };
}

export async function dispatchJob(admin: AdminClient, job: OrchestratedJob) {
  const { data, error } = await admin.from("job_attempts").select("attempt,backend_id,provider_job_id,status,request,response").eq("job_id", job.id).order("attempt");
  if (error) throw error;
  const attempts = (data ?? []) as JobAttempt[];
  const unfinished = attempts.at(-1)?.status === "dispatching" ? attempts.at(-1)! : null;
  const candidate = unfinished
    ? job.route_decision.candidates.find((item) => item.backend.id === unfinished.backend_id) ?? null
    : nextAttemptCandidate({
      decision: job.route_decision,
      attemptedBackendIds: attempts.map((attempt) => attempt.backend_id),
      usage: usageOf(attempts),
      failoverEnabled: job.failover_enabled,
      maxAttempts: job.max_attempts,
    });
  if (!candidate) return finishJob(admin, job, "failed", { error: "No quoted failover backend remains." });

  if (job.route_decision.pricingVersion !== "native-v2" || !candidate.compiled || candidate.quoteBinding !== "binding") {
    return finishJob(admin, job, "failed", { error: "The accepted quote predates native pricing or compilation evidence. Request a new quote." });
  }
  const unfinishedBilling = unfinished?.response?.billing ?? unfinished?.request?.billing;
  if (unfinished && candidate.backend.provider !== "qci" && (unfinishedBilling?.status !== "confirmed" || unfinishedBilling.actual !== 0 || unfinishedBilling.ambiguous)) {
    return finishJob(admin, job, "failed", { error: "A prior external submission has an unknown outcome; reconcile it before authorizing another paid submission." });
  }
  const price = providerPrice(candidate.backend, job.shots);
  if (price.error || price.cost == null || candidate.estimatedProviderCost == null || price.cost > candidate.estimatedProviderCost + 1e-6) {
    return finishJob(admin, job, "failed", { error: price.error ?? "The current provider rate exceeds the accepted attempt price." });
  }
  const attemptNumber = unfinished?.attempt ?? attempts.length + 1;
  const attemptToken = `${job.id}-${attemptNumber}`;
  if (!unfinished) {
    const { error: attemptError } = await admin.from("job_attempts").insert({
      job_id: job.id,
      attempt: attemptNumber,
      backend_id: candidate.backend.id,
      status: "dispatching",
      request: { shots: job.shots, idempotencyKey: attemptToken, billing: { status: "confirmed", estimated: price.cost, actual: 0, ambiguous: false } },
    });
    if (attemptError) throw attemptError;
  }

  let submissionStarted = false;
  try {
    const plan = await executionPlanFor(admin, job, candidate.backend.id);
    if (totalPrice(plan.analysis, job.route_decision.providerBudget ?? price.cost) > (job.route_decision.reservedTotal ?? job.route_decision.acceptedBudget ?? 0) + 1e-6) throw new Error("Compiled attempt exceeds the accepted total budget.");
    // Record possible exposure BEFORE the network side effect. Local compile
    // failures above are confirmed zero-cost; a timeout below is ambiguous.
    const { error: exposureError } = await admin.from("job_attempts").update({ request: {
      shots: job.shots, idempotencyKey: attemptToken,
      billing: { status: "unknown", estimated: price.cost, ambiguous: candidate.backend.provider !== "qci" },
    } }).eq("job_id", job.id).eq("attempt", attemptNumber);
    if (exposureError) throw exposureError;
    submissionStarted = true;
    const submission = await submitToProvider(
      candidate.backend.id,
      plan.analysis,
      job.shots,
      attemptToken,
      plan.bundle,
    );
    const status = submission.status === "completed" ? "completed" : "submitted";
    const now = new Date().toISOString();
    const normalizedResult = submission.result ? normalizeProviderResult(candidate.backend.id, submission.result, job.shots, plan.decodeMap) : undefined;
    await admin.from("job_attempts").update({
      provider_job_id: submission.providerJobId,
      status,
      response: { ...(normalizedResult ?? {}), billing: { status: candidate.backend.provider === "qci" ? "internal-tariff" : "estimated", estimated: price.cost, ...(candidate.backend.provider === "qci" ? { actual: price.cost } : {}), ambiguous: false } },
      finished_at: status === "completed" ? now : null,
    }).eq("job_id", job.id).eq("attempt", attemptNumber);

    const { data: changed, error: updateError } = await admin.from("jobs").update({
      status: status === "completed" ? "dispatching" : status,
      selected_backend_id: candidate.backend.id,
      provider_job_id: submission.providerJobId,
      result: normalizedResult ?? null,
      error: null,
      lease_expires_at: null,
      execution_deadline_at: new Date(Date.now() + job.execution_timeout_seconds * 1000).toISOString(),
      timeout_failover_pending: false,
      started_at: now,
      updated_at: now,
    }).eq("id", job.id).eq("status", "dispatching").select("id").maybeSingle();
    if (updateError) throw updateError;
    if (!changed) {
      await cancelProviderJob(candidate.backend.id, submission.providerJobId).catch((cancelError) => {
        console.error(`Failed to cancel raced submission ${submission.providerJobId}`, cancelError);
      });
      return;
    }

    if (status !== "completed") await admin.from("job_events").insert({ job_id: job.id, type: `job.${status}`, from_status: "dispatching", to_status: status, payload: { attempt: attemptNumber, backendId: candidate.backend.id, providerJobId: submission.providerJobId } });
    if (status === "completed") {
      await finishJob(admin, { ...job, status: "dispatching" }, "completed", { result: normalizedResult });
      if (normalizedResult) await storeArtifact({ jobId: job.id, organizationId: job.organization_id, kind: "result", content: JSON.stringify(normalizedResult) }).catch((artifactError) => {
        console.error(`Failed to store result artifact for ${job.id}`, artifactError);
      });
    }
  } catch (executionError) {
    const message = orchestrationError(executionError, "Provider submission failed.");
    const now = new Date().toISOString();
    const billing: BillingEvidence = submissionStarted
      ? { status: "unknown", estimated: price.cost, ambiguous: candidate.backend.provider !== "qci" }
      : { status: "confirmed", estimated: price.cost, actual: 0, ambiguous: false };
    await admin.from("job_attempts").update({ status: "failed", response: { billing }, error: { message }, finished_at: now }).eq("job_id", job.id).eq("attempt", attemptNumber);
    await scheduleRetryOrFail(admin, job, [...attempts.filter((attempt) => attempt.attempt !== attemptNumber), { attempt: attemptNumber, backend_id: candidate.backend.id, provider_job_id: null, status: "failed", response: { billing } }], message);
  }
}

export async function pollJob(admin: AdminClient, job: OrchestratedJob) {
  if (!job.provider_job_id) return;
  try {
    if (job.status !== "cancellation_requested" && job.execution_deadline_at && new Date(job.execution_deadline_at).getTime() <= Date.now() && !job.timeout_failover_pending) {
      await cancelProviderJob(job.selected_backend_id, job.provider_job_id);
      const { data: changed } = await admin.from("jobs").update({ status: "cancellation_requested", timeout_failover_pending: true, lease_expires_at: null, error: { message: "Execution deadline exceeded; provider cancellation requested." }, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", job.status).select("id").maybeSingle();
      if (changed) await admin.from("job_events").insert({ job_id: job.id, type: "job.timeout", from_status: job.status, to_status: "cancellation_requested", payload: { backendId: job.selected_backend_id, deadline: job.execution_deadline_at } });
      return;
    }
    const provider = await getProviderStatus(job.selected_backend_id, job.provider_job_id);
    const terminal = ["completed", "failed", "cancelled"].includes(provider.status);
    const decodeMap = selectedBundleForBackend(job.route_decision.encoding, job.selected_backend_id)?.decode_map;
    const normalizedResult = provider.status === "completed" ? normalizeProviderResult(job.selected_backend_id, provider.result, job.shots, decodeMap) : undefined;
    await admin.from("job_attempts").update({
      status: provider.status,
      response: { ...(normalizedResult ?? provider.result ?? {}), billing: {
        status: provider.actualProviderCost != null && Number.isFinite(provider.actualProviderCost) && provider.actualProviderCost >= 0 ? "confirmed" : job.route_decision.candidates.find((c) => c.backend.id === job.selected_backend_id)?.backend.provider === "qci" ? "internal-tariff" : "estimated",
        estimated: job.route_decision.candidates.find((c) => c.backend.id === job.selected_backend_id)?.estimatedProviderCost ?? null,
        ...(provider.actualProviderCost != null && Number.isFinite(provider.actualProviderCost) && provider.actualProviderCost >= 0 ? { actual: provider.actualProviderCost } : job.route_decision.candidates.find((c) => c.backend.id === job.selected_backend_id)?.backend.provider === "qci" ? { actual: job.route_decision.candidates.find((c) => c.backend.id === job.selected_backend_id)?.estimatedProviderCost ?? null } : {}),
        ambiguous: false,
      } },
      error: provider.error ? { message: provider.error } : null,
      finished_at: terminal ? new Date().toISOString() : null,
    }).eq("job_id", job.id).eq("provider_job_id", job.provider_job_id);

    if (provider.status === "completed") {
      await finishJob(admin, job, "completed", { result: normalizedResult, actualProviderCost: provider.actualProviderCost });
      await storeArtifact({ jobId: job.id, organizationId: job.organization_id, kind: "result", content: JSON.stringify(normalizedResult) }).catch((artifactError) => {
        console.error(`Failed to store result artifact for ${job.id}`, artifactError);
      });
      return;
    }
    if (job.status === "cancellation_requested") {
      if (["failed", "cancelled"].includes(provider.status) && job.timeout_failover_pending) {
        const { data: attempts } = await admin.from("job_attempts").select("attempt,backend_id,provider_job_id,status,request,response").eq("job_id", job.id).order("attempt");
        await scheduleRetryOrFail(admin, job, (attempts ?? []) as JobAttempt[], "Execution deadline exceeded.");
      } else if (["failed", "cancelled"].includes(provider.status)) await finishJob(admin, job, "cancelled", {});
      else await admin.from("jobs").update({ lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "cancellation_requested");
      return;
    }
    if (provider.status === "failed" || provider.status === "cancelled") {
      const { data: attempts } = await admin.from("job_attempts").select("attempt,backend_id,provider_job_id,status,request,response").eq("job_id", job.id).order("attempt");
      await scheduleRetryOrFail(admin, job, (attempts ?? []) as JobAttempt[], provider.error ?? `Provider job ${provider.status}.`);
      return;
    }

    const { data: changed } = await admin.from("jobs").update({ status: provider.status, lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", job.status).select("id").maybeSingle();
    if (changed && provider.status !== job.status) await admin.from("job_events").insert({ job_id: job.id, type: `job.${provider.status}`, from_status: job.status, to_status: provider.status });
  } catch (pollError) {
    console.error(`Failed to poll job ${job.id}`, pollError);
    await admin.from("jobs").update({ lease_expires_at: null, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", job.status);
  }
}

// ── Single-job, caller-scoped advancement ───────────────────────────────────

/** Terminal states: an advance request against one of these is a no-op. */
const SETTLED: JobStatus[] = ["completed", "failed", "cancelled", "awaiting_payment"];
/** States where the provider owns the job and the next step is a status poll. */
const POLLABLE: JobStatus[] = ["submitted", "processing", "cancellation_requested"];

export type AdvanceAction = "dispatched" | "polled" | "waiting" | "settled" | "not_claimable";

export interface AdvanceOutcome {
  action: AdvanceAction;
  status: JobStatus;
  /** Why nothing happened, when action is `waiting` or `not_claimable`. */
  detail?: string;
}

/**
 * Moves ONE job owned by `organizationId` one step forward.
 *
 * This exists because job execution is driven by an external scheduler hitting
 * /api/internal/jobs with CRON_SECRET. A deployment without that scheduler
 * leaves every job sitting in `queued` forever, which is invisible until a user
 * waits on a run that will never start. The terminal client calls this while it
 * waits, so a run completes on any deployment.
 *
 * Safety properties, all of which mirror the fleet scheduler:
 *  · Ownership — every read and every claim is filtered on organization_id, so
 *    a key can only ever advance its own org's jobs.
 *  · Funding — a job is claimable only if it carries a quote AND a matching
 *    `reserve` ledger entry exists, the same defence claim_qrouter_jobs() uses
 *    to keep a hand-inserted row from reaching a provider unbilled.
 *  · Exclusivity — the claim is a conditional UPDATE on the current status (and
 *    the lease, where one applies). Under READ COMMITTED, Postgres re-checks
 *    the predicate after taking the row lock, so exactly one of N concurrent
 *    callers — including the cron scheduler — wins the claim. The loser sees
 *    `waiting` and simply asks again.
 */
export async function advanceJob(
  admin: AdminClient,
  jobId: string,
  organizationId: string,
): Promise<AdvanceOutcome | null> {
  const { data: current, error } = await admin
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!current) return null;

  const job = current as OrchestratedJob;
  if (SETTLED.includes(job.status)) return { action: "settled", status: job.status };

  // Funding guard — identical in effect to the EXISTS clause in
  // claim_qrouter_jobs(). v1 reserves per job; v2 reserves once per execution
  // group, so a group reservation counts for its members too.
  if (!job.quote_id) {
    return { action: "not_claimable", status: job.status, detail: "The job has no quote attached." };
  }
  const groupId = (current as { group_id?: string | null }).group_id ?? null;
  const { data: reservations, error: ledgerError } = await admin
    .from("ledger_entries")
    .select("id")
    .eq("type", "reserve")
    .or(groupId ? `job_id.eq.${jobId},metadata->>group_id.eq.${groupId}` : `job_id.eq.${jobId}`)
    .limit(1);
  if (ledgerError) throw ledgerError;
  if (!reservations || reservations.length === 0) {
    return { action: "not_claimable", status: job.status, detail: "No credit reservation exists for this job." };
  }

  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + JOB_LEASE_SECONDS * 1000).toISOString();

  // ── queued → dispatching (or reclaim a dispatch whose lease expired) ──────
  if (job.status === "queued" || job.status === "dispatching") {
    let claim = admin
      .from("jobs")
      .update({ status: "dispatching", lease_expires_at: leaseUntil, updated_at: nowIso })
      .eq("id", jobId)
      .eq("organization_id", organizationId)
      .eq("status", job.status);
    claim = job.status === "queued"
      ? claim.lte("next_attempt_at", nowIso)
      : claim.lte("lease_expires_at", nowIso);

    const { data: claimed, error: claimError } = await claim.select("*").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      return {
        action: "waiting",
        status: job.status,
        detail: job.status === "queued"
          ? "The job is waiting for its next attempt window, or another worker claimed it."
          : "Another worker holds the dispatch lease.",
      };
    }
    await dispatchJob(admin, claimed as OrchestratedJob);
    const { data: after } = await admin.from("jobs").select("status").eq("id", jobId).maybeSingle();
    return { action: "dispatched", status: (after?.status as JobStatus) ?? "dispatching" };
  }

  // ── submitted / processing / cancellation_requested → poll the provider ──
  if (POLLABLE.includes(job.status) && job.provider_job_id) {
    const { data: leased, error: leaseError } = await admin
      .from("jobs")
      .update({ lease_expires_at: leaseUntil })
      .eq("id", jobId)
      .eq("organization_id", organizationId)
      .eq("status", job.status)
      .or(`lease_expires_at.is.null,lease_expires_at.lte.${nowIso}`)
      .select("*")
      .maybeSingle();
    if (leaseError) throw leaseError;
    if (!leased) {
      return { action: "waiting", status: job.status, detail: "Another worker holds the poll lease." };
    }
    await pollJob(admin, leased as OrchestratedJob);
    const { data: after } = await admin.from("jobs").select("status").eq("id", jobId).maybeSingle();
    return { action: "polled", status: (after?.status as JobStatus) ?? job.status };
  }

  // `created` / `analyzing` / `quoted` / `funds_reserved` are owned by the
  // submit path, which moves them on within the same request.
  return { action: "waiting", status: job.status, detail: "The job has not been queued for execution yet." };
}
