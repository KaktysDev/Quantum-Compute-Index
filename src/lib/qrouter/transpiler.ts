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

/**
 * Gates the quantum-computer-js optimizer understands. It silently DELETES any
 * other operation from the circuit, so optimization only runs when every gate
 * in the analyzed program is on this list.
 */
const LOCAL_OPTIMIZER_GATES = new Set([
  "x", "y", "z", "h", "s", "t", "rx", "ry", "rz", "cx", "swap", "ccx", "measure", "id", "barrier",
]);

function canOptimizeLocally(analysis: CircuitAnalysis) {
  if (/\bgate\s+[A-Za-z_]/.test(analysis.normalizedQasm2)) return false;
  return Object.keys(analysis.gateCounts).every((gate) => LOCAL_OPTIMIZER_GATES.has(gate));
}

/**
 * The local optimizer drops measure statements and renames registers to q/c.
 * Re-derive the original measurements against the flattened register layout so
 * partially-measured circuits keep their exact measurement map.
 */
function remapMeasurements(originalQasm: string) {
  const qubitOffsets = new Map<string, { offset: number; size: number }>();
  const clbitOffsets = new Map<string, { offset: number; size: number }>();
  let qubitTotal = 0;
  let clbitTotal = 0;
  for (const match of originalQasm.matchAll(/\b(qreg|creg)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    const size = Number(match[3]);
    if (match[1] === "qreg") { qubitOffsets.set(match[2], { offset: qubitTotal, size }); qubitTotal += size; }
    else { clbitOffsets.set(match[2], { offset: clbitTotal, size }); clbitTotal += size; }
  }
  const statements: string[] = [];
  for (const match of originalQasm.matchAll(/\bmeasure\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?\s*;/g)) {
    const source = qubitOffsets.get(match[1]);
    const destination = clbitOffsets.get(match[3]);
    if (!source || !destination) return null;
    if (match[2] !== undefined && match[4] !== undefined) {
      statements.push(`measure q[${source.offset + Number(match[2])}] -> c[${destination.offset + Number(match[4])}];`);
    } else if (match[2] === undefined && match[4] === undefined) {
      for (let index = 0; index < Math.min(source.size, destination.size); index += 1) {
        statements.push(`measure q[${source.offset + index}] -> c[${destination.offset + index}];`);
      }
    } else {
      return null;
    }
  }
  return statements;
}

function localTranspile(backend: Backend, analysis: CircuitAnalysis, optimizationLevel: number): TranspilationResult {
  let qasm = analysis.normalizedQasm2;
  let note = "Local pass-through: the circuit uses gates outside the local optimizer set, so it is preserved verbatim. Hardware-aware optimization requires QROUTER_COMPILER_URL.";
  const measurements = analysis.measurements > 0 ? remapMeasurements(analysis.normalizedQasm2) : [];
  if (optimizationLevel > 0 && canOptimizeLocally(analysis) && measurements !== null) {
    const optimized = optimizeCircuit(parseQASM(analysis.normalizedQasm2));
    qasm = circuitToQASM(optimized);
    if (measurements.length) qasm += `\n${measurements.join("\n")}\n`;
    note = "Local all-to-all simulator optimization; full Qiskit verification requires QROUTER_COMPILER_URL.";
  }
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
    verificationNote: note,
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

  try {
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
  } catch (error) {
    // A physical QPU must never run without hardware-aware compilation, so the
    // failure surfaces. A simulator has no coupling constraints to satisfy, so
    // an unreachable compiler degrades to local optimization instead of losing
    // the job — the reason is recorded in the verification note.
    if (backend.kind === "qpu") throw error;
    const reason = error instanceof Error ? error.message : "unknown error";
    const local = localTranspile(backend, analysis, optimizationLevel);
    return {
      ...local,
      verificationNote: `Compiler service unreachable (${reason}); compiled locally instead. ${local.verificationNote ?? ""}`.trim(),
    };
  }
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
