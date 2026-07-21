// Live pre-flight quote for the chat's job-confirmation card: runs the real
// routing engine (compatibility → constraints → scoring → quote) WITHOUT
// executing anything, so the user confirms against QRouter's numbers — never
// the model's. Mirrors /api/v1/ai/route-advice minus the LLM commentary.

import { NextResponse } from "next/server";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { loadRoutingContext } from "@/lib/qrouter/routingContext";
import { publicTranspilation } from "@/lib/qrouter/transpiler";
import { createJobSchema } from "@/lib/qrouter/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    const parsed = createJobSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { type: "invalid_request", message: "The proposal is invalid.", details: parsed.error.flatten() } },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const analysis = analyzeCircuit(input.circuit, input.format);

    const { snapshot, backends } = await loadRoutingContext(principal.demo);
    const prepared = await prepareExecution({
      backends,
      analysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
      optimizationLevel: input.optimization_level,
    });
    const { decision, quote } = prepared;

    return NextResponse.json({
      analysis: {
        qubits: analysis.qubits,
        depth: analysis.depth,
        gates: analysis.gates,
        twoQubitGates: analysis.twoQubitGates,
        complexity: analysis.complexity,
      },
      compiledAnalysis: prepared.executionAnalysis,
      transpilation: publicTranspilation(prepared.transpilation),
      decision: {
        selected: {
          id: decision.selected.id,
          displayName: decision.selected.displayName,
          provider: decision.selected.provider,
          kind: decision.selected.kind,
          queueSeconds: decision.selected.queueSeconds,
        },
        explanation: decision.explanation,
      },
      quote,
    });
  } catch (error) {
    return apiError(error);
  }
}
