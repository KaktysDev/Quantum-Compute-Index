import { resolvePrincipal } from "@/lib/qrouter/auth";
import { createExperiment, listExperiments } from "@/lib/qrouter/experiment-service";
import { experimentSchema } from "@/lib/qrouter/experiments";
import { requireScopeV2 } from "@/lib/qrouter/scopes";
import { idempotencyKey } from "@/lib/qrouter/v2";
import { V2ApiError, v2Json } from "@/lib/qrouter/v2-http";
import { v2JsonBody, v2Route } from "@/lib/qrouter/v2-route";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:read");
    return v2Json({ object: "list", data: await listExperiments(principal) }, requestId);
  });
}
export async function POST(request: Request) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    requireScopeV2(principal, "jobs:write");
    const parsed = experimentSchema.safeParse(await v2JsonBody(request));
    if (!parsed.success) throw new V2ApiError(400, "invalid_experiment", parsed.error.issues.map((issue) => issue.message).join(" "));
    const key = idempotencyKey(request);
    if (!key) throw new V2ApiError(400, "invalid_idempotency_key", "An Idempotency-Key between 8 and 255 characters is required.");
    const result = await createExperiment(principal, parsed.data, key);
    return v2Json({ object: "experiment", data: result.experiment }, requestId, { status: result.replayed ? 200 : 201, headers: result.replayed ? { "idempotent-replayed": "true" } : {} });
  });
}
