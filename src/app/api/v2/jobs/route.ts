import { resolvePrincipal } from "@/lib/qrouter/auth";
import { requireScopeV2 } from "@/lib/qrouter/scopes";
import { createExecutionGroupSchema, idempotencyKey } from "@/lib/qrouter/v2";
import { V2ApiError, v2Json } from "@/lib/qrouter/v2-http";
import { v2JsonBody, v2Route } from "@/lib/qrouter/v2-route";
import { createExecutionGroup } from "@/lib/qrouter/v2-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:write");
    const parsed = createExecutionGroupSchema.safeParse(await v2JsonBody(request));
    if (!parsed.success) throw new V2ApiError(400, "invalid_request", "Job request is invalid.");
    const key = idempotencyKey(request);
    if (!key) throw new V2ApiError(400, "invalid_idempotency_key", "An Idempotency-Key between 8 and 255 characters is required.");
    const result = await createExecutionGroup(principal, parsed.data, key, requestId);
    const status = result.replayed ? 200 : result.outcome === "awaiting_payment" ? 402 : 202;
    const response = v2Json({ object: "job", data: result.group, ...(result.outcome === "awaiting_payment" ? { error: { code: "insufficient_credits", message: "Add credits before running this task." } } : {}) }, requestId, { status });
    if (result.replayed) response.headers.set("idempotent-replayed", "true");
    return response;
  });
}
