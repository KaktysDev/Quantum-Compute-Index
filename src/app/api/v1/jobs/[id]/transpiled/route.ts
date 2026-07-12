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
    let qasm: string | null = null;
    if (principal.demo) {
      const job = demoJobs.get(id);
      if (!job || job.organization_id !== principal.organizationId) return NextResponse.json({ error: { message: "Job not found." } }, { status: 404 });
      const transpilation = (job.analysis as CircuitAnalysisWithTranspilation).transpilation;
      qasm = transpilation?.artifactQasm ?? transpilation?.qasm ?? job.analysis.normalizedQasm2;
    } else {
      const { data: job } = await createAdminClient().from("jobs").select("id").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
      if (!job) return NextResponse.json({ error: { message: "Job not found." } }, { status: 404 });
      qasm = await loadArtifact(id, "transpiled");
    }
    if (!qasm) return NextResponse.json({ error: { message: "Transpiled artifact is not available." } }, { status: 409 });
    return new NextResponse(qasm, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${id}-transpiled.qasm"` } });
  } catch (error) {
    return apiError(error);
  }
}

interface CircuitAnalysisWithTranspilation {
  normalizedQasm2: string;
  transpilation?: { qasm?: string; artifactQasm?: string };
}
