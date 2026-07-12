import { circuitDepth, parseQASM } from "quantum-computer-js";
import { parseString } from "qasm-ts";
import type { CircuitAnalysis, InputFormat } from "./types";

export class CircuitValidationError extends Error {
  constructor(message: string, public details: string[] = []) { super(message); this.name = "CircuitValidationError"; }
}

export function toOpenQasm2(source: string, format: InputFormat): string {
  if (format === "openqasm2") return source;
  if (/\b(def|defcal|cal|while|for|switch|input|output|duration|stretch)\b/.test(source)) throw new CircuitValidationError("This OpenQASM 3 program uses constructs outside the universal transpiler subset.");
  let qasm = source.replace(/OPENQASM\s+3(?:\.0)?\s*;/i, "OPENQASM 2.0;").replace(/include\s+"stdgates\.inc"\s*;/i, 'include "qelib1.inc";').replace(/\bqubit\s*\[(\d+)]\s+(\w+)\s*;/g, "qreg $2[$1];").replace(/\bbit\s*\[(\d+)]\s+(\w+)\s*;/g, "creg $2[$1];").replace(/\bcnot\b/g, "cx").replace(/(\w+)\s*=\s*measure\s+(\w+)\s*;/g, "measure $2 -> $1;").replace(/(\w+)\[(\d+)]\s*=\s*measure\s+(\w+)\[(\d+)]\s*;/g, "measure $3[$4] -> $1[$2];");
  if (!/include\s+"qelib1\.inc"/.test(qasm)) qasm = qasm.replace(/OPENQASM 2\.0;/, 'OPENQASM 2.0;\ninclude "qelib1.inc";');
  return qasm;
}

export function analyzeCircuit(source: string, format: InputFormat): CircuitAnalysis {
  if (!source.trim()) throw new CircuitValidationError("Circuit source is required.");
  if (Buffer.byteLength(source, "utf8") > 256_000) throw new CircuitValidationError("Circuit source exceeds 256 KB.");
  const normalizedQasm2 = toOpenQasm2(source, format).replace(/;\s*(?=[^\n])/g, ";\n");
  if (!/^\s*OPENQASM\s+2\.0\s*;/i.test(normalizedQasm2)) throw new CircuitValidationError("An OPENQASM 2.0 or 3.0 header is required.");
  try { parseString(normalizedQasm2, 2); } catch (error) { throw new CircuitValidationError("OpenQASM could not be parsed.", [error instanceof Error ? error.message : String(error)]); }
  const circuit = parseQASM(normalizedQasm2);
  if (!circuit.numQubits || !/\bqreg\s+\w+\[\d+]/.test(normalizedQasm2)) throw new CircuitValidationError("No quantum register was declared.");
  const gateCounts: Record<string, number> = {}; let twoQubitGates = 0;
  for (const gate of circuit.gates) { const name=gate.type.toLowerCase(); gateCounts[name]=(gateCounts[name]??0)+1; if(gate.control!==undefined||gate.control2!==undefined||gate.target2!==undefined)twoQubitGates++; }
  const measurements=(normalizedQasm2.match(/\bmeasure\b/g)??[]).length;
  if(measurements)gateCounts.measure=measurements;
  const classicalBits=[...normalizedQasm2.matchAll(/\bcreg\s+\w+\[(\d+)]/g)].reduce((sum,match)=>sum+Number(match[1]),0);
  const gates=circuit.gates.length,weighted=gates+twoQubitGates*4+circuit.numQubits*2;
  return { qubits:circuit.numQubits,classicalBits,depth:circuitDepth(circuit),gates,twoQubitGates,measurements,gateCounts,complexity:weighted<80?"light":weighted<500?"medium":"heavy",normalizedQasm2 };
}
