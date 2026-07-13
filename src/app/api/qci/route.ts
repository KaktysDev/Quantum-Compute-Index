import { NextResponse } from "next/server";
import { getLatestSnapshot, getProviderSeries, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

/** Public endpoint: current QCI + recent history (for the landing page & polling). */
export async function GET() {
  const [latest, series, providerSeries] = await Promise.all([
    getLatestSnapshot(),
    getSeries(365),
    getProviderSeries(365),
  ]);
  return NextResponse.json(
    { latest, series, providerSeries },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
