import { circuitToQASM, optimizeCircuit, parseQASM } from "quantum-computer-js";
import { analyzeCircuit } from "./analyze";
import { verificationStatusOf } from "./encoding/bundle";
import { nativeProgramFor, usesNativeEncoder } from "./encoding/native";
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

function requiresQiskitCompiler(backend: Backend) {
  // Encoder-backed backends map core-gate OpenQASM onto a native program
  // themselves (cQASM / photonic dual-rail). Their device compiler or partner
  // bridge finishes the hardware mapping, so a missing Qiskit worker must not
  // block them the way it blocks IBM / IonQ / Rigetti / IQM.
  return backend.kind === "qpu" && !usesNativeEncoder(backend);
}

function withNativeProgram(result: TranspilationResult, backend: Backend): TranspilationResult {
  if (!usesNativeEncoder(backend)) return result;
  const program = nativeProgramFor(backend, result.qasm);
  const note = program.format === "cqasm-1.0"
    ? `Native cQASM 1.0 program attached for ${backend.displayName}.`
    : `Native ${program.dialect} dual-rail program attached for ${backend.displayName}.`;
  return {
    ...result,
    providerProgram: JSON.stringify(program),
    verificationNote: [result.verificationNote, note].filter(Boolean).join(" "),
  };
}

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
    verificationStatus: verificationStatusOf(null, note),
    verificationNote: note,
    improvement: {
      depthPercent: percent(analysis.depth, compiled.depth),
      gatePercent: percent(analysis.gates, compiled.gates),
    },
    target: { backendId: backend.id, basisGates: backend.basisGates, connectivity: backend.connectivity },
  };
}

function asMetrics(value: unknown, label: string): TranspilationMetrics {
  if (!value || typeof value !== "object") throw new Error(`Compiler returned no ${label} metrics.`);
  const row = value as Record<string, unknown>;
  if (typeof row.qubits !== "number" || typeof row.depth !== "number" || typeof row.gates !== "number") {
    throw new Error(`Compiler returned incomplete ${label} metrics.`);
  }
  return {
    qubits: row.qubits,
    classicalBits: typeof row.classicalBits === "number" ? row.classicalBits : 0,
    depth: row.depth,
    gates: row.gates,
    twoQubitGates: typeof row.twoQubitGates === "number" ? row.twoQubitGates : 0,
    operations: row.operations && typeof row.operations === "object" && !Array.isArray(row.operations)
      ? Object.fromEntries(Object.entries(row.operations).filter(([, count]) => typeof count === "number")) as Record<string, number>
      : {},
  };
}

function parseProviderProgram(value: unknown): TranspilationResult["providerProgram"] {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "format" in value && "data" in value) {
    const format = (value as { format: unknown }).format;
    const data = (value as { data: unknown }).data;
    if (typeof format === "string" && typeof data === "string") return { format, data };
  }
  throw new Error("Compiler returned an unreadable providerProgram.");
}

/** D13: never spread an unvalidated worker payload into TranspilationResult. */
function parseCompilerResult(
  data: Record<string, unknown>,
  backend: Backend,
  optimizationLevel: number,
  seedTranspiler: number,
): TranspilationResult {
  if (typeof data.qasm !== "string" || !data.qasm.trim()) throw new Error("Compiler returned no QASM.");
  const before = asMetrics(data.before, "before");
  const after = asMetrics(data.after, "after");
  const equivalent = data.equivalent === true ? true : data.equivalent === false ? false : null;
  const verificationNote = typeof data.verificationNote === "string" ? data.verificationNote : undefined;
  return {
    qasm: data.qasm,
    artifactQasm: typeof data.artifactQasm === "string" ? data.artifactQasm : undefined,
    providerProgram: parseProviderProgram(data.providerProgram),
    backendId: backend.id,
    compiler: "qiskit",
    optimizationLevel: typeof data.optimizationLevel === "number" ? data.optimizationLevel : optimizationLevel,
    seedTranspiler: typeof data.seedTranspiler === "number" ? data.seedTranspiler : seedTranspiler,
    before,
    after,
    layout: data.layout && typeof data.layout === "object" ? data.layout as Record<string, unknown> : null,
    equivalent,
    verificationStatus: verificationStatusOf(equivalent, verificationNote),
    verificationNote,
    improvement: {
      depthPercent: typeof (data.improvement as { depthPercent?: number } | undefined)?.depthPercent === "number"
        ? (data.improvement as { depthPercent: number }).depthPercent
        : percent(before.depth, after.depth),
      gatePercent: typeof (data.improvement as { gatePercent?: number } | undefined)?.gatePercent === "number"
        ? (data.improvement as { gatePercent: number }).gatePercent
        : percent(before.gates, after.gates),
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
    if (requiresQiskitCompiler(backend)) {
      throw new TranspilerUnavailableError(
        "Physical QPU execution requires the hardware-aware Qiskit compiler service. Configure QROUTER_COMPILER_URL.",
      );
    }
    return withNativeProgram(localTranspile(backend, analysis, optimizationLevel), backend);
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
    return withNativeProgram(parseCompilerResult(data, backend, optimizationLevel, options.seedTranspiler ?? 42), backend);
  } catch (error) {
    // A physical QPU must never run without hardware-aware compilation, so the
    // failure surfaces. It is re-thrown as TranspilerUnavailableError so the
    // v1 responder can report it as an upstream/config outage (503) rather
    // than letting a raw `fetch failed` collapse into an opaque 500.
    // A simulator has no coupling constraints to satisfy, so an unreachable
    // compiler degrades to local optimization instead of losing the job — the
    // reason is recorded in the verification note.
    // Encoder-backed backends (QI / photonic) are the same class as simulators
    // here: their native encoder is the hardware mapping, so they may fall back.
    if (requiresQiskitCompiler(backend)) {
      if (error instanceof TranspilerUnavailableError) throw error;
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new TranspilerUnavailableError(
        `The hardware-aware Qiskit compiler service is unreachable (${reason}), and "${backend.id}" is a physical QPU that cannot run without it.`,
      );
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    const local = localTranspile(backend, analysis, optimizationLevel);
    return withNativeProgram({
      ...local,
      verificationNote: `Compiler service unreachable (${reason}); compiled locally instead. ${local.verificationNote ?? ""}`.trim(),
    }, backend);
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
