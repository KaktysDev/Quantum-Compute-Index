import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    if (principal.demo) {
      const job = demoJobs.get(id);
      if (!job || job.organization_id !== principal.organizationId) return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
      return NextResponse.json(job);
    }
    const admin = createAdminClient();
    const { data: job, error } = await admin.from("jobs").select("*").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
    if (error) throw error;
    if (!job) return NextResponse.json({ error: { type: "not_found", message: "Job not found." } }, { status: 404 });
    const [{ data: quote }, { data: events }, { data: attempts }] = await Promise.all([
      admin.from("quotes").select("*").eq("job_id", id).maybeSingle(),
      admin.from("job_events").select("*").eq("job_id", id).order("id"),
      admin.from("job_attempts").select("attempt,backend_id,provider_job_id,status,error,started_at,finished_at").eq("job_id", id).order("attempt"),
    ]);
    return NextResponse.json({ ...job, quote, attempts, events });
  } catch (error) {
    return apiError(error);
  }
}
