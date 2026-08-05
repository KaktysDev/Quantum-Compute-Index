import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { requestId, v2Problem } from "@/lib/qrouter/v2-http";
import { getExecutionArtifact } from "@/lib/qrouter/v2-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestIdValue = requestId(request);
  try {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    const transpiled = await getExecutionArtifact(principal, id, "transpiled");
    return new NextResponse(transpiled, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-request-id": requestIdValue } });
  } catch (error) {
    return v2Problem(request, requestIdValue, error);
  }
}
