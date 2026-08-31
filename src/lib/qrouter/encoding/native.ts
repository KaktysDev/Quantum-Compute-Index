/**
 * Native-program encoders for catalog backends that do not consume OpenQASM
 * on the wire. Each converter fails closed on anything it cannot express, so a
 * circuit is never silently altered before hardware or a partner bridge runs it.
 *
 *   quantum-inspire  → cQASM 1.0 (Starmon-5 / QI compiler)
 *   xanadu, quandela → photonic dual-rail IR for the approved execution bridge
 *
 * Dual-rail is the textbook optical-qubit mapping (one photon, two modes per
 * logical qubit). Single-qubit gates become beamsplitters and phase shifters;
 * two-qubit gates are first-class IR operations the native-input bridge is
 * contracted to implement (Quandela's catalog name is `postprocessed cnot`).
 * QRouter does not invent a linear-optical CNOT decomposition.
 */

import { evaluateParam } from "../dialects";
import type { Backend } from "../types";
import { EncodingError } from "./types";

export const NATIVE_ENCODER_PROVIDERS = new Set(["xanadu", "quandela", "quantum-inspire"]);

export function usesNativeEncoder(backend: Pick<Backend, "provider">) {
  return NATIVE_ENCODER_PROVIDERS.has(backend.provider);
}

const PI = Math.PI;

function formatParam(value: number) {
  const rounded = Math.round(value * 1e12) / 1e12;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

interface QasmProgram {
  qubits: number;
  statements: Array<{ name: string; params: number[]; wires: number[] }>;
}

/**
 * Parses core-gate OpenQASM 2 into a flat-wire program. Register declarations
 * are concatenated in declaration order, matching IonQ's converter.
 */
export function parseCoreQasm(source: string): QasmProgram {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const offsets = new Map<string, { offset: number; size: number }>();
  let total = 0;
  for (const match of text.matchAll(/\bqreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    offsets.set(match[1], { offset: total, size: Number(match[2]) });
    total += Number(match[2]);
  }
  if (!total) throw new EncodingError("Encoding failed: no quantum register was declared.");

  const wire = (argument: string): number[] => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/.exec(argument.trim());
    const register = match ? offsets.get(match[1]) : undefined;
    if (!match || !register) throw new EncodingError(`Encoding failed: unknown qubit "${argument.trim()}".`);
    if (match[2] === undefined) return Array.from({ length: register.size }, (_, index) => register.offset + index);
    const index = Number(match[2]);
    if (index >= register.size) throw new EncodingError(`Encoding failed: qubit index out of range in "${argument.trim()}".`);
    return [register.offset + index];
  };

  const statements: QasmProgram["statements"] = [];
  for (const rawStatement of text.split(";")) {
    const statement = rawStatement.trim();
    if (!statement) continue;
    if (/^(OPENQASM|include|qreg|creg|barrier)\b/i.test(statement)) continue;
    if (/^if\s*\(/.test(statement)) throw new EncodingError("Encoding failed: classically-controlled gates are not supported.");
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(.*)$/s.exec(statement);
    if (!match) throw new EncodingError(`Encoding failed: could not parse "${statement.slice(0, 60)}".`);
    const name = match[1].toLowerCase();
    const rest = match[3].trim();
    if (name === "measure") {
      const measured = rest.replace(/\s*->\s*.*$/, "").trim();
      if (!measured) throw new EncodingError("Encoding failed: measure is missing qubit arguments.");
      for (const argument of measured.split(",")) {
        for (const qubit of wire(argument)) statements.push({ name: "measure", params: [], wires: [qubit] });
      }
      continue;
    }
    if (!rest) throw new EncodingError(`Encoding failed: gate "${name}" is missing qubit arguments.`);
    const params = (match[2] ?? "").split(",").map((piece) => piece.trim()).filter(Boolean).map(evaluateParam);
    const argRows = rest.split(",").map((argument) => wire(argument));
    const broadcast = Math.max(...argRows.map((row) => row.length));
    if (argRows.some((row) => row.length !== 1 && row.length !== broadcast)) {
      throw new EncodingError(`Encoding failed: mismatched register sizes in "${statement.slice(0, 60)}".`);
    }
    for (let step = 0; step < broadcast; step += 1) {
      const wires = argRows.map((row) => (row.length === 1 ? row[0] : row[step]));
      statements.push({ name, params, wires });
    }
  }
  return { qubits: total, statements };
}

const CQASM_FIXED: Record<string, string> = {
  h: "H", x: "X", y: "Y", z: "Z", s: "S", sdg: "Sdag", t: "T", tdg: "Tdag",
  cx: "CNOT", cnot: "CNOT", cz: "CZ", swap: "SWAP", ccx: "Toffoli", toffoli: "Toffoli",
};

/**
 * Core-gate OpenQASM 2 → cQASM 1.0. Starmon-5's compiler accepts this dialect
 * and finishes the native mapping; unsupported gates fail closed.
 */
export function qasm2ToCqasm(source: string): string {
  const program = parseCoreQasm(source);
  const lines = [`version 1.0`, `qubits ${program.qubits}`];
  const emit = (gate: string, wires: number[], params: number[] = []) => {
    const args = wires.map((wire) => `q[${wire}]`).join(", ");
    const suffix = params.length ? `, ${params.map(formatParam).join(", ")}` : "";
    lines.push(`${gate} ${args}${suffix}`);
  };

  for (const statement of program.statements) {
    const { name, params, wires } = statement;
    const [a, b, c] = wires;
    if (name === "measure") { emit("Measure_z", [a]); continue; }
    if (name === "id" || name === "i") continue;
    if (name === "reset") { emit("prep_z", [a]); continue; }
    if (name === "rx" || name === "ry" || name === "rz") {
      if (params[0] === undefined) throw new EncodingError(`cQASM conversion failed: ${name} is missing its angle.`);
      emit(name[0]!.toUpperCase() + name.slice(1), [a], [params[0]]);
      continue;
    }
    if (name === "u1" || name === "p") { emit("Rz", [a], [params[0]]); continue; }
    if (name === "u2") {
      emit("Rz", [a], [params[1]]);
      emit("Ry", [a], [PI / 2]);
      emit("Rz", [a], [params[0]]);
      continue;
    }
    if (name === "u3" || name === "u") {
      emit("Rz", [a], [params[2]]);
      emit("Ry", [a], [params[0]]);
      emit("Rz", [a], [params[1]]);
      continue;
    }
    const mapped = CQASM_FIXED[name];
    if (!mapped) throw new EncodingError(`cQASM conversion failed: gate "${name}" is not supported.`);
    if ((mapped === "CNOT" || mapped === "CZ" || mapped === "SWAP") && wires.length !== 2) {
      throw new EncodingError(`cQASM conversion failed: ${mapped} expects 2 qubits.`);
    }
    if (mapped === "Toffoli" && wires.length !== 3) {
      throw new EncodingError(`cQASM conversion failed: Toffoli expects 3 qubits.`);
    }
    emit(mapped, mapped === "Toffoli" ? [a, b, c] : wires);
  }
  return `${lines.join("\n")}\n`;
}

export type PhotonicOp =
  | { op: "beamsplitter"; modes: [number, number]; theta: number; phi: number }
  | { op: "phase"; mode: number; phi: number }
  | { op: "swap"; modes: [number, number] }
  | { op: "cnot"; control: number; target: number }
  | { op: "cz"; control: number; target: number }
  | { op: "measure"; qubit: number; modes: [number, number] };

export interface PhotonicProgram {
  format: "photonic-dual-rail";
  version: 1;
  dialect: "xanadu-blackbird" | "quandela-perceval";
  qubits: number;
  modes: number;
  mapping: number[][];
  operations: PhotonicOp[];
  source: string;
}

function rails(qubit: number): [number, number] {
  return [2 * qubit, 2 * qubit + 1];
}

/**
 * Dual-rail photonic IR. Each logical qubit occupies two consecutive modes
 * (|0⟩ = photon in the even mode, |1⟩ = photon in the odd mode).
 */
export function qasm2ToPhotonicProgram(source: string, dialect: PhotonicProgram["dialect"]): PhotonicProgram {
  const program = parseCoreQasm(source);
  const mapping = Array.from({ length: program.qubits }, (_, qubit) => rails(qubit));
  const operations: PhotonicOp[] = [];

  const bs = (qubit: number, theta = PI / 4, phi = 0) => {
    const [m0, m1] = rails(qubit);
    operations.push({ op: "beamsplitter", modes: [m0, m1], theta, phi });
  };
  const phase = (qubit: number, phi: number) => {
    operations.push({ op: "phase", mode: rails(qubit)[1], phi });
  };
  const swapRails = (qubit: number) => {
    const [m0, m1] = rails(qubit);
    operations.push({ op: "swap", modes: [m0, m1] });
  };
  const hadamard = (qubit: number) => bs(qubit);
  const rz = (qubit: number, phi: number) => phase(qubit, phi);
  const rx = (qubit: number, theta: number) => { hadamard(qubit); rz(qubit, theta); hadamard(qubit); };
  const ry = (qubit: number, theta: number) => {
    phase(qubit, -PI / 2);
    hadamard(qubit);
    rz(qubit, theta);
    hadamard(qubit);
    phase(qubit, PI / 2);
  };

  for (const statement of program.statements) {
    const { name, params, wires } = statement;
    const [a, b] = wires;
    if (name === "measure") {
      operations.push({ op: "measure", qubit: a, modes: rails(a) });
      continue;
    }
    if (name === "id" || name === "i") continue;
    if (wires.length === 1) {
      if (name === "h") hadamard(a);
      else if (name === "x") swapRails(a);
      else if (name === "z") rz(a, PI);
      else if (name === "y") { rz(a, PI); swapRails(a); }
      else if (name === "s") rz(a, PI / 2);
      else if (name === "sdg") rz(a, -PI / 2);
      else if (name === "t") rz(a, PI / 4);
      else if (name === "tdg") rz(a, -PI / 4);
      else if (name === "rx") rx(a, params[0]);
      else if (name === "ry") ry(a, params[0]);
      else if (name === "rz" || name === "u1" || name === "p") rz(a, params[0]);
      else if (name === "u2") { rz(a, params[1]); ry(a, PI / 2); rz(a, params[0]); }
      else if (name === "u3" || name === "u") { rz(a, params[2]); ry(a, params[0]); rz(a, params[1]); }
      else throw new EncodingError(`Photonic conversion failed: gate "${name}" is not supported.`);
    } else if (wires.length === 2) {
      if (name === "cx" || name === "cnot") operations.push({ op: "cnot", control: a, target: b });
      else if (name === "cz") operations.push({ op: "cz", control: a, target: b });
      else if (name === "swap") {
        operations.push({ op: "cnot", control: a, target: b });
        operations.push({ op: "cnot", control: b, target: a });
        operations.push({ op: "cnot", control: a, target: b });
      } else {
        throw new EncodingError(`Photonic conversion failed: gate "${name}" is not supported.`);
      }
    } else if (wires.length === 3 && (name === "ccx" || name === "toffoli")) {
      throw new EncodingError(`Photonic conversion failed: gate "${name}" is not supported.`);
    } else {
      throw new EncodingError(`Photonic conversion failed: gate "${name}" is not supported.`);
    }
  }

  return {
    format: "photonic-dual-rail",
    version: 1,
    dialect,
    qubits: program.qubits,
    modes: program.qubits * 2,
    mapping,
    operations,
    source: dialect === "xanadu-blackbird" ? renderBlackbird(program.qubits, operations) : renderPerceval(program.qubits, operations),
  };
}

function renderBlackbird(qubits: number, operations: PhotonicOp[]) {
  const lines = ["name qrouter", "version 1.0"];
  for (const operation of operations) {
    if (operation.op === "beamsplitter") {
      lines.push(`BSgate(${formatParam(operation.theta)}, ${formatParam(operation.phi)}) | [${operation.modes[0]}, ${operation.modes[1]}]`);
    } else if (operation.op === "phase") {
      lines.push(`Rgate(${formatParam(operation.phi)}) | [${operation.mode}]`);
    } else if (operation.op === "swap") {
      lines.push(`BSgate(${formatParam(PI / 2)}, 0) | [${operation.modes[0]}, ${operation.modes[1]}]`);
    } else if (operation.op === "cnot") {
      lines.push(`# qrouter.logical cnot ${operation.control} ${operation.target}`);
    } else if (operation.op === "cz") {
      lines.push(`# qrouter.logical cz ${operation.control} ${operation.target}`);
    } else if (operation.op === "measure") {
      lines.push(`MeasureFock() | [${operation.modes[0]}, ${operation.modes[1]}]`);
    }
  }
  if (!operations.some((operation) => operation.op === "measure")) {
    const modes = Array.from({ length: qubits * 2 }, (_, index) => index).join(", ");
    lines.push(`MeasureFock() | [${modes}]`);
  }
  return `${lines.join("\n")}\n`;
}

function renderPerceval(qubits: number, operations: PhotonicOp[]) {
  const components: Array<Record<string, unknown>> = [];
  for (const operation of operations) {
    if (operation.op === "beamsplitter") {
      components.push({ type: "BS", offset: operation.modes[0], theta: operation.theta, phi: operation.phi });
    } else if (operation.op === "phase") {
      components.push({ type: "PS", offset: operation.mode, phi: operation.phi });
    } else if (operation.op === "swap") {
      components.push({ type: "PERM", perm: [1, 0], offset: operation.modes[0] });
    } else if (operation.op === "cnot") {
      components.push({ type: "POSTPROCESSED_CNOT", control: operation.control, target: operation.target });
    } else if (operation.op === "cz") {
      components.push({ type: "POSTPROCESSED_CZ", control: operation.control, target: operation.target });
    } else if (operation.op === "measure") {
      components.push({ type: "MEASURE", qubit: operation.qubit, modes: operation.modes });
    }
  }
  return JSON.stringify({ nMode: qubits * 2, encoding: "dual-rail", components });
}

export type NativeProgram =
  | { format: "cqasm-1.0"; source: string; qubits: number }
  | PhotonicProgram;

export function nativeProgramFor(backend: Pick<Backend, "id" | "provider" | "displayName">, qasm: string): NativeProgram {
  if (backend.provider === "quantum-inspire") {
    const source = qasm2ToCqasm(qasm);
    const qubits = Number(/^qubits\s+(\d+)/m.exec(source)?.[1] ?? 0);
    return { format: "cqasm-1.0", source, qubits };
  }
  if (backend.provider === "xanadu") return qasm2ToPhotonicProgram(qasm, "xanadu-blackbird");
  if (backend.provider === "quandela") return qasm2ToPhotonicProgram(qasm, "quandela-perceval");
  throw new EncodingError(`${backend.displayName} does not have a native program encoder.`);
}
