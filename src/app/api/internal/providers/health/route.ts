import { NextResponse } from "next/server";
import { checkProviderConnections } from "@/lib/qrouter/providerHealth";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const providers = await checkProviderConnections();
  return NextResponse.json({
    healthy: providers.filter((provider) => provider.configured).every((provider) => provider.reachable),
    providers,
  });
}
