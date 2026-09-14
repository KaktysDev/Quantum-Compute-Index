/**
 * Coupling-map satisfaction and local SWAP routing.
 *
 * Catalog IBM/Rigetti/IQM backends often advertise connectivity "target" with
 * no published map — those must not fail closed; the compiler routes. When a
 * map is present (Starmon-5 plus-shaped chip), two-qubit pairs are checked
 * for a path and, at encode time, SWAP-routed onto adjacent physical qubits.
 */

import { parseCoreQasm } from "./native";
import { EncodingError } from "./types";
import type { GateProgram, QubitRef, Stmt } from "./types";
import { expandQubitRef, qubitOffsetMap } from "./frontend";

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

function undirectedAdj(map: number[][]): Map<number, Set<number>> {
  const adj = new Map<number, Set<number>>();
  const add = (from: number, to: number) => {
    const bucket = adj.get(from) ?? new Set<number>();
    bucket.add(to);
    adj.set(from, bucket);
  };
  for (const edge of map) {
    const a = edge[0];
    const b = edge[1];
    if (a === undefined || b === undefined || a === b) continue;
    add(a, b);
    add(b, a);
  }
  return adj;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

/**
 * Undirected two-qubit interactions in the program. Whole-register arguments
 * are broadcast (cx a, b with |a|=|b|=n yields n pairs). Offsets are computed
 * once per call.
 */
export function twoQubitPairs(program: GateProgram): [number, number][] {
  const offsets = qubitOffsetMap(program);
  const seen = new Map<string, [number, number]>();
  const addPair = (a: number, b: number) => {
    if (a === b) return;
    const key = pairKey(a, b);
    if (!seen.has(key)) seen.set(key, a < b ? [a, b] : [b, a]);
  };
  walk(program.body, (statement) => {
    if (statement.op !== "gate" || statement.qubits.length < 2) return;
    const rows = statement.qubits.map((ref: QubitRef) => expandQubitRef(offsets, ref));
    const broadcast = Math.max(...rows.map((row) => row.length));
    if (rows.some((row) => row.length !== 1 && row.length !== broadcast)) {
      throw new EncodingError("Mismatched register sizes in a multi-qubit gate.");
    }
    for (let step = 0; step < broadcast; step += 1) {
      const wires = rows.map((row) => (row.length === 1 ? row[0] : row[step]));
      for (let i = 0; i < wires.length; i += 1) {
        for (let j = i + 1; j < wires.length; j += 1) addPair(wires[i], wires[j]);
      }
    }
  });
  return [...seen.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

export function shortestCouplingPath(map: number[][], from: number, to: number): number[] | null {
  if (from === to) return [from];
  const adj = undirectedAdj(map);
  if (!adj.has(from) || !adj.has(to)) return null;
  const prev = new Map<number, number | null>([[from, null]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    if (node === to) break;
    for (const next of adj.get(node) ?? []) {
      if (prev.has(next)) continue;
      prev.set(next, node);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let node: number | null = to; node !== null; node = prev.get(node) ?? null) path.push(node);
  path.reverse();
  return path;
}

export function couplingSatisfaction(
  pairs: [number, number][],
  couplingMap: number[][],
): { ok: true; hops: number; needsRouting: boolean } | { ok: false; message: string } {
  let hops = 0;
  let needsRouting = false;
  for (const [from, to] of pairs) {
    if (from === to) continue;
    const path = shortestCouplingPath(couplingMap, from, to);
    if (!path) {
      return { ok: false, message: `Coupling map is disconnected for pair (${from}, ${to}).` };
    }
    if (path.length === 2) continue;
    needsRouting = true;
    hops = Math.max(hops, path.length - 1);
  }
  return { ok: true, hops, needsRouting };
}

function formatParam(value: number) {
  const rounded = Math.round(value * 1e12) / 1e12;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function renderGate(name: string, params: number[], wires: number[]) {
  const args = wires.map((wire) => `q[${wire}]`).join(",");
  const suffix = params.length ? `(${params.map(formatParam).join(",")})` : "";
  if (name === "reset") return `reset ${args};`;
  return `${name}${suffix} ${args};`;
}

function parseMeasurePairs(source: string): { clbits: number; measures: Array<{ qubit: number; clbit: number }> } {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const qOffsets = new Map<string, { offset: number; size: number }>();
  const cOffsets = new Map<string, { offset: number; size: number }>();
  let qTotal = 0;
  let cTotal = 0;
  for (const match of text.matchAll(/\bqreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    qOffsets.set(match[1], { offset: qTotal, size: Number(match[2]) });
    qTotal += Number(match[2]);
  }
  for (const match of text.matchAll(/\bcreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    cOffsets.set(match[1], { offset: cTotal, size: Number(match[2]) });
    cTotal += Number(match[2]);
  }
  const wire = (offsets: Map<string, { offset: number; size: number }>, argument: string): number[] => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/.exec(argument.trim());
    const register = match ? offsets.get(match[1]) : undefined;
    if (!match || !register) return [];
    if (match[2] === undefined) return Array.from({ length: register.size }, (_, index) => register.offset + index);
    const index = Number(match[2]);
    if (index >= register.size) return [];
    return [register.offset + index];
  };
  const measures: Array<{ qubit: number; clbit: number }> = [];
  for (const raw of text.split(";")) {
    const statement = raw.trim();
    const match = /^measure\s+(.+?)\s*->\s*(.+)$/i.exec(statement);
    if (!match) continue;
    const qubits = match[1].split(",").flatMap((item) => wire(qOffsets, item));
    const clbits = match[2].split(",").flatMap((item) => wire(cOffsets, item));
    const count = Math.min(qubits.length, clbits.length);
    for (let index = 0; index < count; index += 1) {
      measures.push({ qubit: qubits[index], clbit: clbits[index] });
    }
  }
  return { clbits: cTotal, measures };
}

export type CouplingLayout = {
  logicalToPhysical: Record<number, number>;
  routingPermutation: number[];
};

/**
 * Insert SWAPs so every remaining two-qubit gate sits on an edge of `couplingMap`.
 * Starts from the identity layout. Extra physical qubits on the map (Starmon hub)
 * are allocated so a Bell on q[0],q[1] can SWAP through 2.
 */
export function routeToCoupling(qasm: string, couplingMap: number[][]): { qasm: string; layout: CouplingLayout } {
  const program = parseCoreQasm(qasm);
  const { clbits, measures } = parseMeasurePairs(qasm);
  const mapMax = couplingMap.reduce((max, edge) => Math.max(max, edge[0] ?? 0, edge[1] ?? 0), -1);
  const n = Math.max(program.qubits, mapMax + 1);
  const m = Math.max(clbits, ...measures.map((item) => item.clbit + 1), 0);
  const adj = undirectedAdj(couplingMap);
  const loc = Array.from({ length: n }, (_, index) => index);
  const physToLog = Array.from({ length: n }, (_, index) => index);
  const lines: string[] = [];

  const swapPhysical = (left: number, right: number) => {
    if (left === right) return;
    lines.push(`swap q[${left}],q[${right}];`);
    const logicalLeft = physToLog[left];
    const logicalRight = physToLog[right];
    physToLog[left] = logicalRight;
    physToLog[right] = logicalLeft;
    loc[logicalLeft] = right;
    loc[logicalRight] = left;
  };

  const ensureAdjacent = (physicalFrom: number, physicalTo: number) => {
    if (adj.get(physicalFrom)?.has(physicalTo)) return;
    const path = shortestCouplingPath(couplingMap, physicalFrom, physicalTo);
    if (!path || path.length < 2) {
      throw new EncodingError(
        `Encoding failed: cannot route a two-qubit interaction between physical qubits ${physicalFrom} and ${physicalTo}.`,
      );
    }
    for (let index = 0; index < path.length - 2; index += 1) {
      swapPhysical(path[index], path[index + 1]);
    }
  };

  for (const statement of program.statements) {
    if (statement.name === "measure") continue;
    if (statement.wires.length >= 2) {
      if (statement.wires.length === 2) {
        const [logicalA, logicalB] = statement.wires;
        ensureAdjacent(loc[logicalA], loc[logicalB]);
        lines.push(renderGate(statement.name, statement.params, [loc[logicalA], loc[logicalB]]));
        continue;
      }
      const mapped = statement.wires.map((wire) => loc[wire]);
      for (let i = 0; i < mapped.length; i += 1) {
        for (let j = i + 1; j < mapped.length; j += 1) {
          if (!adj.get(mapped[i])?.has(mapped[j])) {
            throw new EncodingError(
              `Encoding failed: cannot route "${statement.name}" on qubits ${statement.wires.join(",")}; not all pairs are adjacent after layout.`,
            );
          }
        }
      }
      lines.push(renderGate(statement.name, statement.params, mapped));
      continue;
    }
    lines.push(renderGate(statement.name, statement.params, statement.wires.map((wire) => loc[wire])));
  }

  for (const measure of measures) {
    lines.push(`measure q[${loc[measure.qubit]}] -> c[${measure.clbit}];`);
  }

  const logicalToPhysical: Record<number, number> = {};
  for (let logical = 0; logical < n; logical += 1) logicalToPhysical[logical] = loc[logical];
  const routingPermutation = Array.from({ length: n }, (_, index) => index);
  const header = `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[${n}];\ncreg c[${m}];\n`;
  return {
    qasm: `${header}${lines.join("\n")}${lines.length ? "\n" : ""}`,
    layout: { logicalToPhysical, routingPermutation },
  };
}

/** Route when a coupling map is published; otherwise return the source unchanged. */
export function qasmRespectingCoupling(qasm: string, couplingMap?: number[][]) {
  if (!couplingMap?.length) return { qasm, layout: null as CouplingLayout | null };
  const routed = routeToCoupling(qasm, couplingMap);
  return { qasm: routed.qasm, layout: routed.layout };
}
