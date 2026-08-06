import { resolvePrincipal } from "@/lib/qrouter/auth";
import { requireScopeV2 } from "@/lib/qrouter/scopes";
import { v2Json } from "@/lib/qrouter/v2-http";
import { v2Route } from "@/lib/qrouter/v2-route";
import { getExecutionGroup } from "@/lib/qrouter/v2-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:read");
    const { id } = await params;
    return v2Json({ object: "job", data: await getExecutionGroup(principal, id) }, requestId);
  });
}
