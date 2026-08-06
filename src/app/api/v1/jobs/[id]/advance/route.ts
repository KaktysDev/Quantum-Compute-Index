// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/jobs/{id}/advance — move MY job one step forward.
//
// Execution is normally driven by an external scheduler calling
// /api/internal/jobs with CRON_SECRET. Deployments without that scheduler leave
// every job parked in `queued`, so a client that submits a job and waits waits
// forever. This endpoint lets the job's own owner drive it: same dispatcher,
// same settlement, but scoped to a single job belonging to the caller's
// organization.
//
// It is deliberately NOT a fleet endpoint: it never touches another org's work,
// never bypasses the credit reservation guard, and never runs a job the caller
// has not already been quoted and reserved for.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { advanceJob } from "@/lib/qrouter/dispatcher";
import { apiError } from "@/lib/qrouter/http";
import { requireScope } from "@/lib/qrouter/scopes";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Dispatch compiles the circuit on the Qiskit worker and submits it, which is
// the same work POST /api/v1/jobs does inline.
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    // Advancing dispatches to a provider and settles credits, so it is a write.
    requireScope(principal, "jobs:write");
    const { id } = await params;

    if (principal.demo) {
      // Demo jobs execute inline at creation; there is nothing left to drive.
      const job = demoJobs.get(id);
      if (!job || job.organization_id !== principal.organizationId) {
        return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
      }
      return NextResponse.json({ id, action: "settled", status: job.status });
    }

    const outcome = await advanceJob(createAdminClient(), id, principal.organizationId);
    if (!outcome) {
      return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
    }
    return NextResponse.json({ id, ...outcome });
  } catch (error) {
    return apiError(error);
  }
}
