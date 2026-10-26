import { resolvePrincipal } from "@/lib/qrouter/auth";
import { quoteExperiment } from "@/lib/qrouter/experiment-service";
import { requireScopeV2 } from "@/lib/qrouter/scopes";
import { v2Json } from "@/lib/qrouter/v2-http";
import { v2Route } from "@/lib/qrouter/v2-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:write");
    return v2Json({ object: "experiment_quote", data: await quoteExperiment(principal, (await params).id) }, requestId);
  });
}
