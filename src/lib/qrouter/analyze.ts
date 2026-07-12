import QuantumCircuit from "quantum-circuit";
import type { CircuitAnalysis, InputFormat } from "./types";

const MAX_SOURCE_BYTES = 256_000;
const MAX_LOCAL_QUBITS = 30;

export class CircuitValidationError extends Error {
  constructor(message: string, public details: string[] = []) {
    super(message);
    this.name = "CircuitValidationError";
  }
}

export function toOpenQasm2(source: string, format: InputFormat): string {
  if (format === "openqasm2") return source;

  if (/\b(def|defcal|cal|while|for|switch|input|output|duration|stretch)\b/.test(source)) {
    throw new CircuitValidationError("This OpenQASM 3 program uses constructs not yet supported by the universal transpiler.");
  }

  let qasm = source
    .replace(/OPENQASM\s+3(?:\.0)?\s*;/i, "OPENQASM 2.0;")
    .replace(/include\s+"stdgates\.inc"\s*;/i, 'include "qelib1.inc";')
    .replace(/\bqubit\s*\[(\d+)]\s+(\w+)\s*;/g, "qreg $2[$1];")
    .replace(/\bbit\s*\[(\d+)]\s+(\w+)\s*;/g, "creg $2[$1];")
    .replace(/\bcnot\b/g, "cx")
    .replace(/(\w+)\s*=\s*measure\s+(\w+)\s*;/g, "measure $2 -> $1;")
    .replace(/(\w+)\[(\d+)]\s*=\s*measure\s+(\w+)\[(\d+)]\s*;/g, "measure $3[$4] -> $1[$2];");

  if (!/include\s+"qelib1\.inc"/.test(qasm)) {
    qasm = qasm.replace(/OPENQASM 2\.0;/, 'OPENQASM 2.0;\ninclude "qelib1.inc";');
  }
  return qasm;
}

export function analyzeCircuit(source: string, format: InputFormat): CircuitAnalysis {
  if (!source.trim()) throw new CircuitValidationError("Circuit source is required.");
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    throw new CircuitValidationError("Circuit source exceeds the 256 KB limit.");
  }

  const normalizedQasm2 = toOpenQasm2(source, format);
  const circuit = new QuantumCircuit() as QuantumCircuit & { numQubits: number };
  let parserErrors: unknown[] = [];
  circuit.importQASM(normalizedQasm2, (errors: unknown) => {
    if (Array.isArray(errors)) parserErrors = errors;
    else if (errors) parserErrors = [errors];
  }, false);
  if (parserErrors.length) {
    throw new CircuitValidationError("OpenQASM could not be parsed.", parserErrors.map(String));
  }
  if (!circuit.numQubits) throw new CircuitValidationError("No quantum register was declared.");

  const raw = circuit.exportRaw() as {
    cregs?: Array<{ len: number }>;
    program?: Array<{ name: string; wires: number[] }>;
  };
  const program = raw.program ?? [];
  const gateCounts: Record<string, number> = {};
  let twoQubitGates = 0;
  let measurements = 0;
  for (const operation of program) {
    gateCounts[operation.name] = (gateCounts[operation.name] ?? 0) + 1;
    if (operation.wires.length > 1) twoQubitGates += 1;
    if (operation.name === "measure") measurements += 1;
  }

  const gates = program.filter((operation) => operation.name !== "measure").length;
  const weighted = gates + twoQubitGates * 4 + circuit.numQubits * 2;
  return {
    qubits: circuit.numQubits,
    classicalBits: (raw.cregs ?? []).reduce((sum, register) => sum + register.len, 0),
    depth: circuit.numCols(), gates, twoQubitGates, measurements, gateCounts,
    complexity: weighted < 80 ? "light" : weighted < 500 ? "medium" : "heavy",
    normalizedQasm2,
  };
}

export function assertLocalSimulationLimit(analysis: CircuitAnalysis) {
  if (analysis.qubits > MAX_LOCAL_QUBITS) {
    throw new CircuitValidationError(`Local simulation supports at most ${MAX_LOCAL_QUBITS} qubits.`);
  }
}

