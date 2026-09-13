// ─────────────────────────────────────────────────────────────────────────────
// Fleet execution scheduler.
//
// Claims a batch of queued jobs and a batch of active provider polls, advances
// each one, then flushes the webhook outbox. Authenticated with CRON_SECRET and
// invoked by an external scheduler (Vercel Pro Cron, GitHub Actions, a cron box).
//
// The per-job mechanics live in @/lib/qrouter/dispatcher, which is shared with
// the caller-scoped POST /api/v1/jobs/{id}/advance so both paths produce exactly
// the same state transitions and settlement.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { mapWithConcurrency } from "@/lib/qrouter/concurrency";
import { dispatchJob, pollJob, type OrchestratedJob } from "@/lib/qrouter/dispatcher";
import { JOB_LEASE_SECONDS } from "@/lib/qrouter/orchestration";
import { processWebhookDeliveries } from "@/lib/qrouter/webhooks";
import { authorizeCronRequest } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

const WORKER_CONCURRENCY = 8;

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!authorizeCronRequest(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const [{ data: queued, error: claimError }, { data: active, error: pollClaimError }] = await Promise.all([
    admin.rpc("claim_qrouter_jobs", { p_limit: 25, p_lease_seconds: JOB_LEASE_SECONDS }),
    admin.rpc("claim_qrouter_poll_jobs", { p_limit: 25, p_lease_seconds: JOB_LEASE_SECONDS }),
  ]);
  if (claimError) throw claimError;
  if (pollClaimError) throw pollClaimError;

  const dispatched = await mapWithConcurrency((queued ?? []) as OrchestratedJob[], WORKER_CONCURRENCY, async (job) => {
    try {
      await dispatchJob(admin, job);
      return { id: job.id, action: "dispatched" as const };
    } catch (error) {
      console.error(`Failed to dispatch job ${job.id}`, error);
      return { id: job.id, action: "dispatch_failed" as const };
    }
  });
  const polled = await mapWithConcurrency((active ?? []) as OrchestratedJob[], WORKER_CONCURRENCY, async (job) => {
    try {
      await pollJob(admin, job);
      return { id: job.id, action: "polled" as const };
    } catch (error) {
      console.error(`Failed to poll job ${job.id}`, error);
      return { id: job.id, action: "poll_failed" as const };
    }
  });
  const webhookDeliveries = await processWebhookDeliveries(25);
  return NextResponse.json({
    claimed: queued?.length ?? 0,
    polled: active?.length ?? 0,
    webhookDeliveries: webhookDeliveries.claimed,
    updates: [...dispatched, ...polled],
  });
}

// Vercel Cron invokes routes with GET; POST remains available to external schedulers.
export const GET = POST;
