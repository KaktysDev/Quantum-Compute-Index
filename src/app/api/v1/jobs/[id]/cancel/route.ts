import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { cancelProviderJob } from "@/lib/qrouter/execution";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    if (principal.demo) {
      const job = demoJobs.get(id);
      if (!job || job.organization_id !== principal.organizationId) return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
      if (["processing", "completed", "failed", "cancelled"].includes(job.status)) return NextResponse.json({ error: { type: "not_cancellable", message: "This job can no longer be cancelled." } }, { status: 409 });
      job.status = "cancelled";
      job.updated_at = new Date().toISOString();
      return NextResponse.json(job);
    }
    const admin = createAdminClient();
    const { data: job, error } = await admin.from("jobs").select("*, quotes(total)").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
    if (["completed", "failed", "cancelled"].includes(job.status)) return NextResponse.json({ error: { type: "not_cancellable", message: "This job is already terminal." } }, { status: 409 });
    if (job.status === "cancellation_requested") return NextResponse.json(job);
    if (["submitted", "processing"].includes(job.status) && job.provider_job_id) {
      const { data: changed, error: updateError } = await admin.from("jobs").update({ status: "cancellation_requested", timeout_failover_pending: false, updated_at: new Date().toISOString() }).eq("id", id).eq("status", job.status).select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!changed) return NextResponse.json({ error: { type: "conflict", message: "The job changed while cancellation was requested." } }, { status: 409 });
      try {
        await cancelProviderJob(job.selected_backend_id, job.provider_job_id);
      } catch (cancelError) {
        await admin.from("jobs").update({ status: job.status, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "cancellation_requested");
        throw cancelError;
      }
      await admin.from("job_events").insert({ job_id: id, type: "job.cancellation_requested", from_status: job.status, to_status: "cancellation_requested" });
      return NextResponse.json({ ...job, status: "cancellation_requested" }, { status: 202 });
    }

    const completedAt = new Date().toISOString();
    const { data: changed, error: updateError } = await admin.rpc("finalize_qrouter_job", { p_job_id: id, p_status: "cancelled", p_result: null, p_error: null, p_actual_provider_cost: null });
    if (updateError) throw updateError;
    if (!changed) return NextResponse.json({ error: { type: "conflict", message: "The job changed while cancellation was requested." } }, { status: 409 });
    await admin.from("job_events").insert({ job_id: id, type: "job.cancelled", from_status: job.status, to_status: "cancelled" });
    return NextResponse.json({ ...job, status: "cancelled", completed_at: completedAt });
  } catch (error) {
    return apiError(error);
  }
}
