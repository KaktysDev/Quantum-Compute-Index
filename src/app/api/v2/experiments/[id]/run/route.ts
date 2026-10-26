import { resolvePrincipal } from "@/lib/qrouter/auth";
import { runExperiment } from "@/lib/qrouter/experiment-service";
import { approveExperimentSchema } from "@/lib/qrouter/experiments";
import { requireScopeV2 } from "@/lib/qrouter/scopes";
import { idempotencyKey } from "@/lib/qrouter/v2";
import { V2ApiError, v2Json } from "@/lib/qrouter/v2-http";
import { v2JsonBody, v2Route } from "@/lib/qrouter/v2-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:write");
    const parsed = approveExperimentSchema.safeParse(await v2JsonBody(request));
    if (!parsed.success) throw new V2ApiError(400, "approval_required", "The definition hash and complete campaign ceiling must be explicitly approved.");
    const key = idempotencyKey(request);
    if (!key) throw new V2ApiError(400, "invalid_idempotency_key", "An Idempotency-Key between 8 and 255 characters is required.");
    const result = await runExperiment(principal, (await params).id, parsed.data, key, requestId);
    return v2Json({ object: "experiment_run", data: result }, requestId, { status: result.outcome === "awaiting_payment" ? 402 : result.replayed ? 200 : 202 });
  });
}
