import { circuitToQASM, optimizeCircuit, parseQASM } from "quantum-computer-js";
import { analyzeCircuit } from "./analyze";
import type { Backend, CircuitAnalysis, TranspilationMetrics, TranspilationResult } from "./types";

export class TranspilerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranspilerUnavailableError";
  }
}

function metrics(analysis: CircuitAnalysis): TranspilationMetrics {
  return {
    qubits: analysis.qubits,
    classicalBits: analysis.classicalBits,
    depth: analysis.depth,
    gates: analysis.gates,
    twoQubitGates: analysis.twoQubitGates,
    operations: analysis.gateCounts,
  };
}

function percent(before: number, after: number) {
  return Math.round(((before - after) / Math.max(before, 1)) * 10_000) / 100;
}

function localTranspile(backend: Backend, analysis: CircuitAnalysis, optimizationLevel: number): TranspilationResult {
  const optimized = optimizeCircuit(parseQASM(analysis.normalizedQasm2));
  let qasm = circuitToQASM(optimized);
  if (analysis.measurements > 0) qasm += "\nmeasure q -> c;\n";
  const compiled = analyzeCircuit(qasm, "openqasm2");
  return {
    qasm,
    backendId: backend.id,
    compiler: "local",
    optimizationLevel,
    seedTranspiler: 42,
    before: metrics(analysis),
    after: metrics(compiled),
    layout: null,
    equivalent: null,
    verificationNote: "Local all-to-all simulator optimization; full Qiskit verification requires QROUTER_COMPILER_URL.",
    improvement: {
      depthPercent: percent(analysis.depth, compiled.depth),
      gatePercent: percent(analysis.gates, compiled.gates),
    },
    target: { backendId: backend.id, basisGates: backend.basisGates, connectivity: backend.connectivity },
  };
}

export async function transpileForBackend(
  backend: Backend,
  analysis: CircuitAnalysis,
  options: { optimizationLevel?: number; seedTranspiler?: number; verifyEquivalence?: boolean } = {},
): Promise<TranspilationResult> {
  const optimizationLevel = options.optimizationLevel ?? 2;
  const workerUrl = process.env.QROUTER_COMPILER_URL ?? process.env.VULTR_SIMULATOR_URL;
  const token = process.env.QROUTER_COMPILER_TOKEN ?? process.env.VULTR_SIMULATOR_TOKEN;

  if (!workerUrl) {
    if (backend.kind === "qpu") {
      throw new TranspilerUnavailableError(
        "Physical QPU execution requires the hardware-aware Qiskit compiler service. Configure QROUTER_COMPILER_URL.",
      );
    }
    return localTranspile(backend, analysis, optimizationLevel);
  }

  const response = await fetch(`${workerUrl.replace(/\/$/, "")}/v1/transpile`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token ?? ""}` },
    body: JSON.stringify({
      qasm: analysis.normalizedQasm2,
      optimization_level: optimizationLevel,
      seed_transpiler: options.seedTranspiler ?? 42,
      verify_equivalence: options.verifyEquivalence ?? true,
      target: {
        backend_id: backend.id,
        provider: backend.provider,
        backend_name: backend.backendName,
        num_qubits: backend.qubits,
        basis_gates: backend.basisGates,
        connectivity: backend.connectivity,
        coupling_map: backend.couplingMap,
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json() as Record<string, unknown> & { detail?: string };
  if (!response.ok) throw new Error(data.detail ?? `Compiler service failed (${response.status}).`);
  return {
    ...(data as unknown as Omit<TranspilationResult, "backendId" | "compiler">),
    backendId: backend.id,
    compiler: "qiskit",
  };
}

export function analysisFromTranspilation(result: TranspilationResult): CircuitAnalysis {
  const weighted = result.after.gates + result.after.twoQubitGates * 4 + result.after.qubits * 2;
  return {
    qubits: result.after.qubits,
    classicalBits: result.after.classicalBits,
    depth: result.after.depth,
    gates: result.after.gates,
    twoQubitGates: result.after.twoQubitGates,
    measurements: result.after.operations.measure ?? 0,
    gateCounts: result.after.operations,
    complexity: weighted < 80 ? "light" : weighted < 500 ? "medium" : "heavy",
    normalizedQasm2: result.qasm,
  };
}

export function publicTranspilation(result: TranspilationResult): Omit<TranspilationResult, "providerProgram"> {
  const output = { ...result };
  delete output.providerProgram;
  return output;
}
