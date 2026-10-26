import { resolvePrincipal } from "@/lib/qrouter/auth";
import { experimentEvidence } from "@/lib/qrouter/experiment-service";
import { requireScopeV2 } from "@/lib/qrouter/scopes";
import { v2Json } from "@/lib/qrouter/v2-http";
import { v2Route } from "@/lib/qrouter/v2-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:read");
    const evidence = await experimentEvidence(principal, (await params).id);
    return v2Json({ object: "experiment_evidence", data: evidence }, requestId, { headers: { "cache-control": "private, no-store" } });
  });
}
