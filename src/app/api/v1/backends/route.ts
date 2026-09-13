import { NextResponse } from "next/server";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";

export const dynamic = "force-dynamic";

export async function GET() {
  const { snapshot, backends } = await loadPublicRoutingContext();
  return NextResponse.json({
    object: "list",
    data: backends,
    qci: {
      timestamp: snapshot.ts,
      source: snapshot.source,
      index: snapshot.price,
      pricePerQcHour: snapshot.vwap,
    },
    updated_at: new Date().toISOString(),
  });
}
