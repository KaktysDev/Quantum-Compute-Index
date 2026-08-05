import { resolvePrincipal } from "@/lib/qrouter/auth";
import { createCircuitSchema, idempotencyKey } from "@/lib/qrouter/v2";
import { V2ApiError, v2Json } from "@/lib/qrouter/v2-http";
import { v2JsonBody, v2Route } from "@/lib/qrouter/v2-route";
import { createCircuitResource } from "@/lib/qrouter/v2-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return v2Route(request, async (requestId) => {
    const principal = await resolvePrincipal(request);
    const parsed = createCircuitSchema.safeParse(await v2JsonBody(request));
    if (!parsed.success) throw new V2ApiError(400, "invalid_request", "Circuit request is invalid.");
    const key = idempotencyKey(request);
    if (!key) throw new V2ApiError(400, "invalid_idempotency_key", "An Idempotency-Key between 8 and 255 characters is required.");
    const result = await createCircuitResource(principal, parsed.data, key);
    const response = v2Json({ object: "circuit", data: result.circuit }, requestId, { status: result.replayed ? 200 : 201 });
    if (result.replayed) response.headers.set("idempotent-replayed", "true");
    return response;
  });
}
