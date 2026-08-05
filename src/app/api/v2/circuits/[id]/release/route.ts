import { resolvePrincipal } from "@/lib/qrouter/auth";
import { v2Json } from "@/lib/qrouter/v2-http";
import { v2Route } from "@/lib/qrouter/v2-route";
import { releaseCircuitResource } from "@/lib/qrouter/v2-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    const { id } = await params;
    return v2Json({ object: "circuit", data: await releaseCircuitResource(principal, id) }, requestId);
  });
}
