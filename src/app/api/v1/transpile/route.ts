import { NextResponse } from "next/server";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { loadRoutingContext } from "@/lib/qrouter/routingContext";
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
    const input = parsed.data;
    const originalAnalysis = analyzeCircuit(input.circuit, input.format);
    const { snapshot, backends } = await loadRoutingContext(principal.demo);
    const result = await prepareExecution({
      backends,
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
