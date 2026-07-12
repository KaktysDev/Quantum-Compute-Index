import { NextResponse } from "next/server";
import type { QpuComponent } from "@/lib/qci/types";
import { getLatestSnapshot } from "@/lib/qci/store";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { withQciSnapshot } from "@/lib/qrouter/catalog";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { createJobSchema } from "@/lib/qrouter/validation";
import { publicTranspilation } from "@/lib/qrouter/transpiler";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = createJobSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { type: "invalid_request", message: "The request body is invalid.", details: parsed.error.flatten() } },
        { status: 400 },
      );
    }
    let snapshot: { id: number | null; ts: string; components: QpuComponent[] };
    if (principal.demo) {
      const latest = await getLatestSnapshot();
      snapshot = { id: null, ts: latest.ts, components: latest.components };
    } else {
      const { data } = await createAdminClient()
        .from("qci_snapshots")
        .select("id,ts,components")
        .order("ts", { ascending: false })
        .limit(1)
        .maybeSingle();
      snapshot = { id: data?.id ?? null, ts: data?.ts ?? new Date().toISOString(), components: (data?.components ?? []) as QpuComponent[] };
    }
    const input = parsed.data;
    const originalAnalysis = analyzeCircuit(input.circuit, input.format);
    const result = await prepareExecution({
      backends: withQciSnapshot(snapshot.components),
      analysis: originalAnalysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
      optimizationLevel: input.optimization_level,
    });
    const transpilation = publicTranspilation(result.transpilation);
    return NextResponse.json({
      object: "transpilation",
      originalAnalysis,
      compiledAnalysis: result.executionAnalysis,
      transpilation,
      route: result.decision,
      quote: result.quote,
    });
  } catch (error) {
    return apiError(error);
  }
}
