import { NextResponse } from "next/server";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { resolvePrincipal } from "@/lib/qrouter/auth";
import { apiError } from "@/lib/qrouter/http";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { loadRoutingContext } from "@/lib/qrouter/routingContext";
import { publicEncoding, slimAnalysis, slimRouteDecision, slimTranspilation } from "@/lib/qrouter/encoding";
import { assertTargetAllowed, backendsForPrincipal, requireScope } from "@/lib/qrouter/scopes";
import { createJobSchema } from "@/lib/qrouter/validation";
import { publicTranspilation } from "@/lib/qrouter/transpiler";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const principal = await resolvePrincipal(request);
    requireScope(principal, "jobs:read");
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
    assertTargetAllowed(principal, input.target, backends);
    const result = await prepareExecution({
      backends: backendsForPrincipal(principal, backends),
      analysis: originalAnalysis,
      shots: input.shots,
      target: input.target,
      mode: input.routing_mode,
      constraints: input.constraints,
      qciSnapshotId: snapshot.id,
      qciTimestamp: snapshot.ts,
      optimizationLevel: input.optimization_level,
      source: input.circuit,
      format: input.format,
    });
    const decision = slimRouteDecision(result.decision);
    return NextResponse.json({
      object: "transpilation",
      originalAnalysis: {
        qubits: originalAnalysis.qubits,
        classicalBits: originalAnalysis.classicalBits,
        depth: originalAnalysis.depth,
        gates: originalAnalysis.gates,
        twoQubitGates: originalAnalysis.twoQubitGates,
        measurements: originalAnalysis.measurements,
        complexity: originalAnalysis.complexity,
        workloadKind: originalAnalysis.workloadKind,
        gateCounts: originalAnalysis.gateCounts,
      },
      compiledAnalysis: slimAnalysis(result.executionAnalysis),
      transpilation: slimTranspilation(publicTranspilation(result.transpilation)),
      route: {
        selected: {
          id: decision.selected.id,
          displayName: decision.selected.displayName,
          provider: decision.selected.provider,
          kind: decision.selected.kind,
          queueSeconds: decision.selected.queueSeconds,
        },
        explanation: decision.explanation,
        encoding: decision.encoding ? publicEncoding(decision.encoding) : decision.encoding,
        candidates: decision.candidates.map((candidate) => ({
          backend: {
            id: candidate.backend.id,
            displayName: candidate.backend.displayName,
            kind: candidate.backend.kind,
            provider: candidate.backend.provider,
          },
          compatible: candidate.compatible,
          score: candidate.score,
          estimatedProviderCost: candidate.estimatedProviderCost,
          rejectionReasons: candidate.rejectionReasons,
          quoteBinding: candidate.quoteBinding,
          compiled: candidate.compiled,
        })),
      },
      quote: result.quote,
      encoding: publicEncoding(result.encoding),
    });
  } catch (error) {
    return apiError(error);
  }
}
