import { NextResponse } from "next/server";
import { getPublicQci } from "@/lib/qci/v2/store";

export const dynamic = "force-dynamic";

/**
 * Public endpoint: the current index and its history.
 *
 * Serves the SAME published v2 point as the landing page, /pricing and the
 * console tab. It used to serve v1's snapshot table, which meant a caller
 * polling this endpoint got a different price than the page that linked them to
 * it — and, when v1 had no rows, a seeded random walk presented as history.
 *
 * `latest.source` is kept for compatibility with older clients, but it can now
 * only ever be "live": nothing here is generated.
 */
export async function GET() {
  const qci = await getPublicQci(365);
  return NextResponse.json(
    {
      hasData: qci.hasData,
      unit: "USD per QPU-hour",
      latest: {
        ts: qci.ts,
        usdPerQpuHour: qci.usdPerQpuHour,
        changePct: qci.changePct,
        level: qci.level,
        costBasisPerHour: qci.costBasisPerHour,
        machines: qci.machines,
        providers: qci.providers,
        source: "live" as const,
      },
      series: qci.series,
      ...(qci.emptyReason ? { emptyReason: qci.emptyReason } : {}),
    },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}
