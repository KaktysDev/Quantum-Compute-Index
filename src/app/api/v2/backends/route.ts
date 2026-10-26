import { NextResponse } from "next/server";
import { publicBackend } from "@/lib/qrouter/catalog";
import { advertisedCapabilities } from "@/lib/qrouter/encoding";
import { requestId, v2Problem } from "@/lib/qrouter/v2-http";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { backendsForPrincipal } from "@/lib/qrouter/scopes";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestIdValue = requestId(request);
  try {
    const principal = await resolvePrincipal(request);
    const { backends: catalog } = await loadPublicRoutingContext();
    const data = backendsForPrincipal(principal, catalog).map((backend) => ({
      ...publicBackend(backend),
      capabilities: advertisedCapabilities(backend),
    }));
    return NextResponse.json({ object: "list", data, qci: null, pricing_method: "native-v2", automatic_execution_intent: "simulate" }, { headers: { "x-request-id": requestIdValue } });
  } catch (error) {
    return v2Problem(request, requestIdValue, error);
  }
}
