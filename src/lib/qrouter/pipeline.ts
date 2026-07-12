import { buildQuote, routeCircuit } from "./route";
import { resolveProviderTarget } from "./providerTargets";
import { analysisFromTranspilation, transpileForBackend } from "./transpiler";
import type { Backend, CircuitAnalysis, RoutingConstraints, RoutingMode } from "./types";

export async function prepareExecution(input: {
  backends: Backend[];
  analysis: CircuitAnalysis;
  shots: number;
  target: string;
  mode: RoutingMode;
  constraints?: RoutingConstraints;
  qciSnapshotId?: number | null;
  qciTimestamp?: string;
  optimizationLevel?: number;
}) {
  const initialDecision = routeCircuit(input);
  const compilationTarget = await resolveProviderTarget(initialDecision.selected);
  const transpilation = await transpileForBackend(compilationTarget, input.analysis, {
    optimizationLevel: input.optimizationLevel,
    seedTranspiler: 42,
    verifyEquivalence: true,
  });
  const executionAnalysis = analysisFromTranspilation(transpilation);
  const compiledPricing = routeCircuit({
    ...input,
    analysis: executionAnalysis,
    target: initialDecision.selected.id,
  });
  const pricedCandidate = compiledPricing.candidates[0];
  const decision = {
    ...initialDecision,
    candidates: initialDecision.candidates.map((candidate) =>
      candidate.backend.id === pricedCandidate.backend.id
        ? { ...candidate, estimatedProviderCost: pricedCandidate.estimatedProviderCost, estimatedNqh: pricedCandidate.estimatedNqh }
        : candidate,
    ),
    explanation: [
      ...initialDecision.explanation,
      `${transpilation.compiler === "qiskit" ? "Qiskit" : "Local"} optimization level ${transpilation.optimizationLevel}: depth ${transpilation.before.depth} -> ${transpilation.after.depth}, gates ${transpilation.before.gates} -> ${transpilation.after.gates}.`,
    ],
  };
  return {
    decision,
    quote: buildQuote(decision, executionAnalysis, input.shots),
    transpilation,
    executionAnalysis,
  };
}
