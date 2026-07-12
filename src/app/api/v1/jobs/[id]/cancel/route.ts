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
    if (["processing", "completed", "failed", "cancelled"].includes(job.status)) return NextResponse.json({ error: { type: "not_cancellable", message: "The provider has started processing this job." } }, { status: 409 });
    if (job.provider_job_id) await cancelProviderJob(job.selected_backend_id, job.provider_job_id);
    const total = Array.isArray(job.quotes) ? job.quotes[0]?.total : job.quotes?.total;
    await admin.from("jobs").update({ status: "cancelled", updated_at: new Date().toISOString(), completed_at: new Date().toISOString() }).eq("id", id);
    if (total) await admin.rpc("release_job_credits", { p_job_id: id, p_amount: total });
    await admin.from("job_events").insert({ job_id: id, type: "job.cancelled", from_status: job.status, to_status: "cancelled" });
    return NextResponse.json({ ...job, status: "cancelled" });
  } catch (error) {
    return apiError(error);
  }
}

