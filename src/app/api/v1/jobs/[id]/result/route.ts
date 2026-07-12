import { NextResponse } from "next/server";
import { loadArtifact } from "@/lib/qrouter/artifacts";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { apiError } from "@/lib/qrouter/http";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    if (principal.demo) {
      const job = demoJobs.get(id);
      if (!job || job.organization_id !== principal.organizationId) return NextResponse.json({ error: { message: "Job not found." } }, { status: 404 });
      if (!job.result) return NextResponse.json({ error: { message: "Result is not available." } }, { status: 409 });
      return NextResponse.json(job.result);
    }
    const { data: job } = await createAdminClient().from("jobs").select("id,status").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
    if (!job) return NextResponse.json({ error: { message: "Job not found." } }, { status: 404 });
    const result = await loadArtifact(id, "result");
    if (!result) return NextResponse.json({ error: { message: "Result is not available." } }, { status: 409 });
    return new NextResponse(result, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${id}-result.json"` } });
  } catch (error) {
    return apiError(error);
  }
}
