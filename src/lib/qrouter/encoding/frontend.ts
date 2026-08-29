/**
 * Semantic frontend: OpenQASM 2/3 text → GateProgram (§5.4, Phase 2).
 * Include policy is an allow-list (D17). Control-flow keywords are statement-
 * scoped so identifiers like `input_state` and comments mentioning "for" are
 * not rejected (D12). User-defined gate bodies are resolved (D14).
 */

import { evaluateParam } from "../dialects";
import type { InputFormat } from "../types";
import { EncodingError } from "./types";
import type { ClbitRef, GateDef, GateProgram, ParamExpr, QubitRef, Stmt, Workload, WorkloadKind } from "./types";
import { FRONTEND_VERSION } from "./types";

export const ALLOWED_INCLUDES = new Set(["qelib1.inc", "stdgates.inc"]);

const GATE_CALL = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(.*)$/s;
const CONTROL_OPS = new Set(["if", "for", "while", "switch"]);
const TIMING_OPS = new Set(["delay", "duration", "stretch", "defcal", "cal"]);

export function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

export function assertIncludePolicy(source: string) {
  for (const match of source.matchAll(/\binclude\s+"([^"]+)"\s*;/gi)) {
    const name = match[1].replace(/\\/g, "/").split("/").pop() ?? match[1];
    if (match[1].includes("..") || match[1].startsWith("/") || match[1].includes("\\") || !ALLOWED_INCLUDES.has(name)) {
      throw new EncodingError(
        `Filesystem and non-standard includes are not allowed. "${match[1]}" is not in the standard include allow-list (${[...ALLOWED_INCLUDES].join(", ")}).`,
      );
    }
  }
}

function splitTopLevel(source: string): string[] {
  const text = stripComments(source);
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const semicolon = text.indexOf(";", cursor);
    const brace = text.indexOf("{", cursor);
    if (brace !== -1 && (semicolon === -1 || brace < semicolon)) {
      let depth = 0;
      let end = brace;
      for (; end < text.length; end += 1) {
        if (text[end] === "{") depth += 1;
        if (text[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (depth !== 0) throw new EncodingError("Unbalanced braces in program.");
      parts.push(text.slice(cursor, end + 1).trim());
      cursor = end + 1;
      continue;
    }
    if (semicolon === -1) {
      const tail = text.slice(cursor).trim();
      if (tail) parts.push(tail);
      break;
    }
    const raw = text.slice(cursor, semicolon).trim();
    if (raw) parts.push(raw);
    cursor = semicolon + 1;
  }
  return parts.filter(Boolean);
}

function parseParams(raw: string | undefined): ParamExpr[] {
  if (!raw?.trim()) return [];
  return raw.split(",").map((piece) => piece.trim()).filter(Boolean).map((expression) => {
    try {
      return { kind: "number" as const, value: evaluateParam(expression) };
    } catch {
      return { kind: "symbol" as const, expression };
    }
  });
}

function parseRefs(list: string, kind: "q" | "c"): Array<QubitRef | ClbitRef> {
  return list.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/.exec(item);
    if (!match) throw new EncodingError(`Could not parse ${kind === "q" ? "qubit" : "clbit"} reference "${item}".`);
    return { register: match[1], index: match[2] === undefined ? null : Number(match[2]) };
  });
}

function parseQubitRefs(list: string): QubitRef[] {
  return parseRefs(list, "q") as QubitRef[];
}

function parseBody(block: string): Stmt[] {
  const inner = block.replace(/^[^{]*\{/, "").replace(/\}$/, "");
  return splitTopLevel(inner).flatMap((statement) => parseStatement(statement));
}

function parseStatement(raw: string): Stmt[] {
  const text = raw.trim();
  if (!text) return [];
  if (/^gate\s+/i.test(text) || /^opaque\s+/i.test(text)) return [];
  if (/^if\s*\(/i.test(text)) {
    const match = /^if\s*\(([^)]+)\)\s*([\s\S]+)$/i.exec(text);
    if (!match) throw new EncodingError("Malformed if statement.");
    const thenRaw = match[2].trim();
    const then = thenRaw.startsWith("{") ? parseBody(thenRaw) : parseStatement(thenRaw);
    return [{ op: "if", cond: match[1].trim(), then }];
  }
  if (/^for\s+/i.test(text)) {
    const match = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+(\[[^\]]+\]|[^\s{]+)\s*([\s\S]+)$/i.exec(text);
    if (!match) throw new EncodingError("Malformed for statement.");
    return [{ op: "for", var: match[1], range: match[2], body: match[3].trim().startsWith("{") ? parseBody(match[3]) : parseStatement(match[3]) }];
  }
  if (/^while\s*\(/i.test(text)) {
    const match = /^while\s*\(([^)]+)\)\s*([\s\S]+)$/i.exec(text);
    if (!match) throw new EncodingError("Malformed while statement.");
    return [{ op: "while", cond: match[1].trim(), body: match[2].trim().startsWith("{") ? parseBody(match[2]) : parseStatement(match[2]) }];
  }
  if (/^switch\s*\(/i.test(text)) {
    const match = /^switch\s*\(([^)]+)\)\s*([\s\S]+)$/i.exec(text);
    if (!match) throw new EncodingError("Malformed switch statement.");
    return [{ op: "switch", subject: match[1].trim(), cases: [{ match: "*", body: parseBody(match[2]) }] }];
  }
  if (/^barrier\b/i.test(text)) {
    const args = text.replace(/^barrier\b/i, "").trim();
    return [{ op: "barrier", qubits: args ? parseQubitRefs(args) : [] }];
  }
  if (/^reset\b/i.test(text)) {
    const args = parseQubitRefs(text.replace(/^reset\b/i, "").trim());
    return args.map((qubit) => ({ op: "reset" as const, qubit }));
  }
  if (/^delay\b/i.test(text)) {
    const match = /^delay\s*(?:\[[^\]]+])?\s*(?:\(([^)]*)\))?\s*(.*)$/i.exec(text);
    return [{ op: "delay", duration: match?.[1] ?? "0", qubits: parseQubitRefs(match?.[2] ?? "") }];
  }
  const measureQasm2 = /^measure\s+(.+?)\s*->\s*(.+)$/i.exec(text);
  if (measureQasm2) {
    const qubits = parseQubitRefs(measureQasm2[1]);
    const clbits = parseRefs(measureQasm2[2], "c") as ClbitRef[];
    const count = Math.min(qubits.length, clbits.length);
    return Array.from({ length: count }, (_, index) => ({ op: "measure" as const, qubit: qubits[index], clbit: clbits[index] }));
  }
  const measureQasm3 = /^(.+?)\s*=\s*measure\s+(.+)$/i.exec(text);
  if (measureQasm3) {
    const clbits = parseRefs(measureQasm3[1], "c") as ClbitRef[];
    const qubits = parseQubitRefs(measureQasm3[2]);
    const count = Math.min(qubits.length, clbits.length);
    return Array.from({ length: count }, (_, index) => ({ op: "measure" as const, qubit: qubits[index], clbit: clbits[index] }));
  }
  const call = GATE_CALL.exec(text);
  if (!call || /^(OPENQASM|include|qreg|creg|qubit|bit|input|output)\b/i.test(call[1])) return [];
  return [{
    op: "gate",
    name: call[1].toLowerCase() === "cnot" ? "cx" : call[1].toLowerCase(),
    params: parseParams(call[2]),
    qubits: parseQubitRefs(call[3] ?? ""),
    modifiers: [],
  }];
}

function parseGateDef(raw: string): GateDef | null {
  const match = /^gate\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*([^{]*)\{([\s\S]*)\}$/i.exec(raw.trim());
  if (!match) return null;
  return {
    name: match[1],
    params: (match[2] ?? "").split(",").map((item) => item.trim()).filter(Boolean),
    args: match[3].trim().split(/[,\s]+/).map((item) => item.trim()).filter(Boolean),
    body: splitTopLevel(match[4]).flatMap((statement) => parseStatement(statement)),
  };
}

export function parseGateProgram(source: string, format: InputFormat): GateProgram {
  if (!source.trim()) throw new EncodingError("Circuit source is required.");
  if (Buffer.byteLength(source, "utf8") > 256_000) throw new EncodingError("Circuit source exceeds the 256 KB limit.");
  assertIncludePolicy(source);

  const qubits: GateProgram["qubits"] = [];
  const clbits: GateProgram["clbits"] = [];
  const params: GateProgram["params"] = [];
  const gate_defs: Record<string, GateDef> = {};
  const body: Stmt[] = [];

  for (const statement of splitTopLevel(source)) {
    const qreg = /^(?:qreg|qubit)\s*(?:\[(\d+)]\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/i.exec(statement);
    if (qreg) {
      qubits.push({ name: qreg[2], size: Number(qreg[1] ?? qreg[3] ?? 1) });
      continue;
    }
    const creg = /^(?:creg|bit)\s*(?:\[(\d+)]\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/i.exec(statement);
    if (creg) {
      clbits.push({ name: creg[2], size: Number(creg[1] ?? creg[3] ?? 1) });
      continue;
    }
    const input = /^(?:input|output)\s+\w+\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(statement);
    if (input) {
      params.push({ name: input[1] });
      continue;
    }
    if (/^gate\s+/i.test(statement)) {
      const def = parseGateDef(statement);
      if (def) gate_defs[def.name] = def;
      continue;
    }
    if (/^(OPENQASM|include)\b/i.test(statement)) continue;
    body.push(...parseStatement(statement));
  }

  if (!qubits.length) throw new EncodingError("No quantum register was declared.");
  return { qubits, clbits, params, body, gate_defs };
}

function walk(statements: Stmt[], visit: (statement: Stmt) => void) {
  for (const statement of statements) {
    visit(statement);
    if (statement.op === "if") {
      walk(statement.then, visit);
      if (statement.else) walk(statement.else, visit);
    } else if (statement.op === "for" || statement.op === "while") {
      walk(statement.body, visit);
    } else if (statement.op === "switch") {
      for (const entry of statement.cases) walk(entry.body, visit);
    }
  }
}

export function classifyWorkload(program: GateProgram): WorkloadKind {
  let control = false;
  let timing = false;
  let measureSeen = false;
  let gateAfterMeasure = false;
  walk(program.body, (statement) => {
    if (CONTROL_OPS.has(statement.op)) control = true;
    if (statement.op === "delay" || TIMING_OPS.has(statement.op)) timing = true;
    if (statement.op === "measure") measureSeen = true;
    else if (statement.op === "gate" && measureSeen) gateAfterMeasure = true;
  });
  if (timing) return "timed";
  if (control || gateAfterMeasure) return "dynamic";
  return "gate";
}

export function workloadFromSource(source: string, format: InputFormat, shots: number): Workload {
  const program = parseGateProgram(source, format);
  const kind = classifyWorkload(program);
  if (kind === "timed") return { kind: "timed", program, shots };
  if (kind === "dynamic") return { kind: "dynamic", program, shots };
  return { kind: "gate", program, shots };
}

export function flattenQubit(program: GateProgram, ref: QubitRef): number {
  let offset = 0;
  for (const register of program.qubits) {
    if (register.name === ref.register) {
      if (ref.index == null) return offset;
      if (ref.index >= register.size) throw new EncodingError(`Qubit index out of range: ${ref.register}[${ref.index}].`);
      return offset + ref.index;
    }
    offset += register.size;
  }
  throw new EncodingError(`Unknown qubit register "${ref.register}".`);
}

export function flattenClbit(program: GateProgram, ref: ClbitRef): number {
  let offset = 0;
  for (const register of program.clbits) {
    if (register.name === ref.register) {
      if (ref.index == null) return offset;
      if (ref.index >= register.size) throw new EncodingError(`Clbit index out of range: ${ref.register}[${ref.index}].`);
      return offset + ref.index;
    }
    offset += register.size;
  }
  throw new EncodingError(`Unknown classical register "${ref.register}".`);
}

export function measurementMap(program: GateProgram): Array<{ qubit: number; clbit: number }> {
  const map: Array<{ qubit: number; clbit: number }> = [];
  walk(program.body, (statement) => {
    if (statement.op !== "measure") return;
    const qubit = statement.qubit.index == null
      ? program.qubits.find((register) => register.name === statement.qubit.register)
      : null;
    const clbit = statement.clbit.index == null
      ? program.clbits.find((register) => register.name === statement.clbit.register)
      : null;
    if (qubit && clbit) {
      const width = Math.min(qubit.size, clbit.size);
      for (let index = 0; index < width; index += 1) {
        map.push({
          qubit: flattenQubit(program, { register: statement.qubit.register, index }),
          clbit: flattenClbit(program, { register: statement.clbit.register, index }),
        });
      }
      return;
    }
    map.push({ qubit: flattenQubit(program, statement.qubit), clbit: flattenClbit(program, statement.clbit) });
  });
  return map;
}

export function registerLayout(program: GateProgram) {
  let offset = 0;
  return program.clbits.map((register) => {
    const entry = { name: register.name, width: register.size, offset };
    offset += register.size;
    return entry;
  });
}

export function frontendInfo() {
  return { name: "qee-qasm", version: FRONTEND_VERSION };
}

export function sourceMetrics(program: GateProgram) {
  let gates = 0;
  let twoQubitGates = 0;
  let measurements = 0;
  const gateCounts: Record<string, number> = {};
  walk(program.body, (statement) => {
    if (statement.op === "measure") {
      measurements += 1;
      gateCounts.measure = (gateCounts.measure ?? 0) + 1;
      return;
    }
    if (statement.op !== "gate") return;
    gates += 1;
    if (statement.qubits.length > 1) twoQubitGates += 1;
    gateCounts[statement.name] = (gateCounts[statement.name] ?? 0) + 1;
  });
  const qubits = program.qubits.reduce((sum, register) => sum + register.size, 0);
  const classicalBits = program.clbits.reduce((sum, register) => sum + register.size, 0);
  const depth = gates;
  const weighted = gates + twoQubitGates * 4 + qubits * 2;
  return {
    qubits,
    classicalBits,
    depth,
    gates,
    twoQubitGates,
    measurements,
    gateCounts,
    complexity: (weighted < 80 ? "light" : weighted < 500 ? "medium" : "heavy") as "light" | "medium" | "heavy",
  };
}
