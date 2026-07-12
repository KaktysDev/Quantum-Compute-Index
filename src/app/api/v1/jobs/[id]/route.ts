import { NextResponse } from "next/server";
import { loadArtifact } from "@/lib/qrouter/artifacts";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { getProviderStatus } from "@/lib/qrouter/execution";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    if (principal.demo) {
      const job = demoJobs.get(id);
      if (!job || job.organization_id !== principal.organizationId) {
        return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
      }
      if (["submitted", "processing", "cancellation_requested"].includes(job.status) && job.provider_job_id) {
        const provider = await getProviderStatus(job.selected_backend_id, job.provider_job_id);
        job.status = provider.status;
        job.result = provider.result ?? job.result;
        job.error = provider.error ? { message: provider.error } : null;
        job.updated_at = new Date().toISOString();
        if (["completed", "failed", "cancelled"].includes(provider.status)) job.completed_at = job.updated_at;
      }
      return NextResponse.json(job);
    }
    const admin = createAdminClient();
    const { data: job, error } = await admin
      .from("jobs")
      .select("*")
      .eq("id", id)
      .eq("organization_id", principal.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
    const [{ data: quote }, { data: events }, encryptedResult] = await Promise.all([
      admin.from("quotes").select("*").eq("job_id", id).maybeSingle(),
      admin.from("job_events").select("*").eq("job_id", id).order("id"),
      job.result?.available ? loadArtifact(id, "result") : Promise.resolve(null),
    ]);
    return NextResponse.json({
      ...job,
      result: encryptedResult ? JSON.parse(encryptedResult) : job.result,
      quote,
      events,
    });
  } catch (error) {
    return apiError(error);
  }
}
