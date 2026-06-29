import { NextResponse } from "next/server";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

/** Public endpoint: current QCI + recent history (for the landing page & polling). */
export async function GET() {
  const [latest, series] = await Promise.all([getLatestSnapshot(), getSeries(120)]);
  return NextResponse.json(
    { latest, series },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
