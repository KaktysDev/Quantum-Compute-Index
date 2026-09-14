import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { loadOwnedJob, loadOwnedResult, notFound, resultCsv } from "@/lib/qrouter/report";
import { requireScope } from "@/lib/qrouter/scopes";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
    const { id } = await params;
    const job = await loadOwnedJob(principal, id);
    if (!job) return NextResponse.json(notFound(), { status: 404 });
    const result = await loadOwnedResult(principal, job);
    if (!result) return NextResponse.json({ error: { message: "Result is not available." } }, { status: 409 });
    const shots = typeof job.shots === "number" ? job.shots : null;
    const csv = resultCsv(result, shots);
    const short = String(job.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "job";
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="qrouter-result-${short}.csv"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
