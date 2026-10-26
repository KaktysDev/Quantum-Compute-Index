import { NextResponse } from "next/server";
import { publicBackend } from "@/lib/qrouter/catalog";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";

export const dynamic = "force-dynamic";

export async function GET() {
  const { backends } = await loadPublicRoutingContext();
  return NextResponse.json({
    object: "list",
    data: backends.map(publicBackend),
    qci: null,
    pricingMethod: "native-v2",
    automaticExecutionIntent: "simulate",
    updated_at: new Date().toISOString(),
  });
}
