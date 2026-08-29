/**
 * Provider-dialect normalization: rewrites OpenQASM 2 written against any
 * provider's native or extended gate vocabulary (IBM ecr/sx/rzx, IonQ
 * gpi/gpi2/ms in turns, IQM prx, Rigetti cphase/xy/iswap, ...) into a core
 * qelib1 gate set every downstream consumer understands (analysis, local
 * simulation, the Qiskit compiler worker, and per-provider program builders).
 *
 * G5 (tests/encoding.test.ts) proves every lowering rule against a reference
 * operator. State-vector spot checks also live in tests/dialects.test.ts.
 * A comment is not a proof — the CI gate is.
 */

const PI = Math.PI;

/** Gates passed through untouched. Everything downstream accepts these. */
export const CORE_GATES = new Set([
  "x", "y", "z", "h", "s", "sdg", "t", "tdg",
  "rx", "ry", "rz", "u1", "u2", "u3",
  "cx", "cz", "swap", "ccx", "id",
]);

/** Pure renames applied before decomposition lookup. */
const GATE_ALIASES: Record<string, string> = {
  cnot: "cx",
  toffoli: "ccx",
  si: "sdg",
  ti: "tdg",
  v: "sx",
  vi: "sxdg",
  not: "x",
  p: "u1",
  phase: "u1",
  cp: "cu1",
  cphase: "cu1",
  u: "u3",
};

export class DialectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DialectError";
  }
}

/** Evaluates a QASM parameter expression (numbers, pi, + - * / and parentheses). */
export function evaluateParam(expression: string): number {
  const input = expression.trim();
  let index = 0;
  const peek = () => input[index];
  const skip = () => { while (index < input.length && /\s/.test(input[index])) index += 1; };
  function parsePrimary(): number {
    skip();
    if (peek() === "(") {
      index += 1;
      const value = parseAddSub();
      skip();
      if (peek() !== ")") throw new DialectError(`Unbalanced parentheses in parameter "${expression}".`);
      index += 1;
      return value;
    }
    if (peek() === "-") { index += 1; return -parsePrimary(); }
    if (peek() === "+") { index += 1; return parsePrimary(); }
    const rest = input.slice(index);
    const pi = /^(pi|π)/i.exec(rest);
    if (pi) { index += pi[0].length; return PI; }
    const num = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(rest);
    if (num) { index += num[0].length; return Number(num[0]); }
    throw new DialectError(`Could not evaluate parameter "${expression}".`);
  }
  function parseMulDiv(): number {
    let value = parsePrimary();
    for (;;) {
      skip();
      if (peek() === "*") { index += 1; value *= parsePrimary(); }
      else if (peek() === "/") { index += 1; value /= parsePrimary(); }
      else return value;
    }
  }
  function parseAddSub(): number {
    let value = parseMulDiv();
    for (;;) {
      skip();
      if (peek() === "+") { index += 1; value += parseMulDiv(); }
      else if (peek() === "-") { index += 1; value -= parseMulDiv(); }
      else return value;
    }
  }
  const result = parseAddSub();
  skip();
  if (index < input.length) throw new DialectError(`Could not evaluate parameter "${expression}".`);
  if (!Number.isFinite(result)) throw new DialectError(`Parameter "${expression}" is not a finite number.`);
  return result;
}

type Statement = { name: string; params: number[]; args: string[] };
const stmt = (name: string, params: number[], args: string[]): Statement => ({ name, params, args });

/**
 * Decompositions into (recursively) core gates. `a`, `b`, `c` are the qubit
 * arguments in order; params are already evaluated to numbers. IonQ gpi/gpi2/ms
 * parameters are in turns per the IonQ native-gate specification.
 */
const DECOMPOSITIONS: Record<string, (params: number[], args: string[]) => Statement[]> = {
  sx: (_p, [a]) => [stmt("sdg", [], [a]), stmt("h", [], [a]), stmt("sdg", [], [a])],
  sxdg: (_p, [a]) => [stmt("s", [], [a]), stmt("h", [], [a]), stmt("s", [], [a])],
  rzx: ([theta], [a, b]) => [
    stmt("h", [], [b]), stmt("cx", [], [a, b]), stmt("rz", [theta], [b]), stmt("cx", [], [a, b]), stmt("h", [], [b]),
  ],
  ecr: (_p, [a, b]) => [
    stmt("rzx", [PI / 4], [a, b]), stmt("x", [], [a]), stmt("rzx", [-PI / 4], [a, b]),
  ],
  rxx: ([theta], [a, b]) => [
    stmt("h", [], [a]), stmt("h", [], [b]),
    stmt("cx", [], [a, b]), stmt("rz", [theta], [b]), stmt("cx", [], [a, b]),
    stmt("h", [], [a]), stmt("h", [], [b]),
  ],
  ryy: ([theta], [a, b]) => [
    stmt("rx", [PI / 2], [a]), stmt("rx", [PI / 2], [b]),
    stmt("cx", [], [a, b]), stmt("rz", [theta], [b]), stmt("cx", [], [a, b]),
    stmt("rx", [-PI / 2], [a]), stmt("rx", [-PI / 2], [b]),
  ],
  rzz: ([theta], [a, b]) => [stmt("cx", [], [a, b]), stmt("rz", [theta], [b]), stmt("cx", [], [a, b])],
  prx: ([theta, phi], [a]) => [stmt("rz", [-phi], [a]), stmt("rx", [theta], [a]), stmt("rz", [phi], [a])],
  gpi: ([turns], [a]) => {
    const lambda = 2 * PI * turns;
    return [stmt("rz", [-lambda], [a]), stmt("x", [], [a]), stmt("rz", [lambda], [a])];
  },
  gpi2: ([turns], [a]) => {
    const lambda = 2 * PI * turns;
    return [stmt("rz", [-lambda], [a]), stmt("rx", [PI / 2], [a]), stmt("rz", [lambda], [a])];
  },
  ms: (params, [a, b]) => {
    const [phi0, phi1] = params;
    const theta = params.length > 2 ? params[2] : 0.25;
    const l0 = 2 * PI * phi0, l1 = 2 * PI * phi1, lt = 2 * PI * theta;
    return [
      stmt("rz", [-l0], [a]), stmt("rz", [-l1], [b]),
      stmt("rxx", [lt], [a, b]),
      stmt("rz", [l0], [a]), stmt("rz", [l1], [b]),
    ];
  },
  zz: ([turns], [a, b]) => [stmt("rzz", [2 * PI * turns], [a, b])],
  cu1: ([theta], [a, b]) => [
    stmt("u1", [theta / 2], [a]),
    stmt("cx", [], [a, b]), stmt("u1", [-theta / 2], [b]), stmt("cx", [], [a, b]),
    stmt("u1", [theta / 2], [b]),
  ],
  iswap: (_p, [a, b]) => [
    stmt("s", [], [a]), stmt("s", [], [b]), stmt("h", [], [a]),
    stmt("cx", [], [a, b]), stmt("cx", [], [b, a]), stmt("h", [], [b]),
  ],
  xy: ([theta], [a, b]) => [stmt("rxx", [-theta / 2], [a, b]), stmt("ryy", [-theta / 2], [a, b])],
  crz: ([theta], [a, b]) => [
    stmt("rz", [theta / 2], [b]), stmt("cx", [], [a, b]), stmt("rz", [-theta / 2], [b]), stmt("cx", [], [a, b]),
  ],
  cy: (_p, [a, b]) => [stmt("sdg", [], [b]), stmt("cx", [], [a, b]), stmt("s", [], [b])],
  ch: (_p, [a, b]) => [stmt("ry", [PI / 4], [b]), stmt("cx", [], [a, b]), stmt("ry", [-PI / 4], [b])],
  cu3: ([theta, phi, lambda], [a, b]) => [
    stmt("u1", [(lambda + phi) / 2], [a]),
    stmt("u1", [(lambda - phi) / 2], [b]),
    stmt("cx", [], [a, b]),
    stmt("u3", [-theta / 2, 0, -(phi + lambda) / 2], [b]),
    stmt("cx", [], [a, b]),
    stmt("u3", [theta / 2, phi, 0], [b]),
  ],
  csx: (_p, [a, b]) => [stmt("h", [], [b]), stmt("cu1", [PI / 2], [a, b]), stmt("h", [], [b])],
};

const EXPECTED_ARITY: Record<string, number> = {
  sx: 1, sxdg: 1, prx: 1, gpi: 1, gpi2: 1,
  rzx: 2, ecr: 2, rxx: 2, ryy: 2, rzz: 2, zz: 2, ms: 2,
  cu1: 2, iswap: 2, xy: 2, crz: 2, cy: 2, ch: 2, cu3: 2, csx: 2,
};

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
}

function formatParam(value: number) {
  const rounded = Math.round(value * 1e12) / 1e12;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function renderStatement(statement: Statement) {
  const params = statement.params.length ? `(${statement.params.map(formatParam).join(",")})` : "";
  return `${statement.name}${params} ${statement.args.join(",")};`;
}

function expandStatement(statement: Statement, depth = 0): Statement[] {
  if (depth > 8) throw new DialectError(`Gate "${statement.name}" expansion is too deep.`);
  if (CORE_GATES.has(statement.name)) return [statement];
  const decomposition = DECOMPOSITIONS[statement.name];
  if (!decomposition) throw new DialectError(`Gate "${statement.name}" is not supported by the universal transpiler.`);
  return decomposition(statement.params, statement.args).flatMap((inner) => expandStatement(inner, depth + 1));
}

const GATE_CALL = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s+(.+)$/s;

/**
 * Rewrites provider-native and extended gates in an OpenQASM 2 program into the
 * core qelib1 set. Register declarations, includes, measure, barrier, and reset
 * pass through. User-defined `gate` bodies are expanded (D14); calls to those
 * gates stay as-is. Unknown gates raise DialectError.
 */
export function expandDialects(source: string): string {
  const text = stripComments(source);
  const registers = new Map<string, number>();
  for (const match of text.matchAll(/\bqreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    registers.set(match[1], Number(match[2]));
  }
  const userGates = new Set<string>();
  for (const match of text.matchAll(/\bgate\s+([A-Za-z_][A-Za-z0-9_]*)/g)) userGates.add(match[1]);

  const output: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const semicolon = text.indexOf(";", cursor);
    const brace = text.indexOf("{", cursor);
    if (brace !== -1 && (semicolon === -1 || brace < semicolon)) {
      // Expand provider-native gates inside user-defined `gate` bodies (D14).
      let depth = 0;
      let end = brace;
      for (; end < text.length; end += 1) {
        if (text[end] === "{") depth += 1;
        if (text[end] === "}") { depth -= 1; if (depth === 0) break; }
      }
      if (depth !== 0) throw new DialectError("Unbalanced braces in gate definition.");
      const header = text.slice(cursor, brace).trim();
      const inner = text.slice(brace + 1, end);
      const expandedBody = expandDialects(inner);
      output.push(`${header} {\n${expandedBody}\n}`);
      cursor = end + 1;
      continue;
    }
    if (semicolon === -1) {
      if (text.slice(cursor).trim()) output.push(text.slice(cursor));
      break;
    }
    const raw = text.slice(cursor, semicolon).trim();
    cursor = semicolon + 1;
    if (!raw) continue;

    if (/^(OPENQASM|include|qreg|creg|measure|barrier|reset|opaque)\b/i.test(raw)) {
      output.push(`${raw};`);
      continue;
    }
    if (/^if\s*\(/.test(raw)) {
      const inner = raw.replace(/^if\s*\([^)]*\)\s*/, "");
      const match = GATE_CALL.exec(inner);
      const name = match ? (GATE_ALIASES[match[1].toLowerCase()] ?? match[1].toLowerCase()) : null;
      if (name && !CORE_GATES.has(name) && !userGates.has(match![1])) {
        throw new DialectError(`Conditional "${match![1]}" gates are not supported; use core gates inside if().`);
      }
      output.push(`${raw};`);
      continue;
    }

    const match = GATE_CALL.exec(raw);
    if (!match) { output.push(`${raw};`); continue; }
    const originalName = match[1];
    if (userGates.has(originalName)) { output.push(`${raw};`); continue; }
    const name = GATE_ALIASES[originalName.toLowerCase()] ?? originalName.toLowerCase();
    const argList = match[3].split(",").map((arg) => arg.trim()).filter(Boolean);

    if (CORE_GATES.has(name)) {
      const params = match[2] === undefined ? "" : `(${match[2].trim()})`;
      output.push(`${name}${params} ${argList.join(",")};`);
      continue;
    }
    if (!DECOMPOSITIONS[name]) {
      throw new DialectError(`Gate "${originalName}" is not supported by the universal transpiler.`);
    }

    const params = (match[2] ?? "").split(",").map((piece) => piece.trim()).filter(Boolean).map(evaluateParam);
    const arity = EXPECTED_ARITY[name] ?? argList.length;

    // Broadcast whole-register arguments (e.g. `sx q;`). QASM broadcasts
    // element-wise, so every register argument advances together.
    const expandArgs = (args: string[]): string[][] => {
      const broadcastRegisters = args.filter((arg) => !arg.includes("[") && registers.has(arg));
      if (!broadcastRegisters.length) return [args];
      const sizes = new Set(broadcastRegisters.map((register) => registers.get(register)!));
      if (sizes.size > 1) throw new DialectError(`Gate "${originalName}" broadcasts registers of different sizes.`);
      const size = [...sizes][0];
      const rows: string[][] = [];
      for (let qubit = 0; qubit < size; qubit += 1) {
        rows.push(args.map((arg) => (!arg.includes("[") && registers.has(arg) ? `${arg}[${qubit}]` : arg)));
      }
      return rows;
    };

    for (const args of expandArgs(argList)) {
      if (args.length !== arity) {
        throw new DialectError(`Gate "${originalName}" expects ${arity} qubit argument(s), received ${args.length}.`);
      }
      for (const expanded of expandStatement(stmt(name, params, args))) {
        output.push(renderStatement(expanded));
      }
    }
  }

  return output.join("\n");
}
