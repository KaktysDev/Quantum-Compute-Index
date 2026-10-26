import { evaluateParam } from "../dialects";

/**
 * Converts core-gate OpenQASM 2 to OpenQASM 3. Braket's dialect names the CNOT
 * gate `cnot`, while the standard-library dialect (stdgates.inc, used by IBM)
 * keeps `cx` — so the rename is dialect-specific.
 */
const BRAKET_GATE_NAMES: Record<string, string> = {
  cx: "cnot", cnot: "cnot",
  sdg: "si", si: "si",
  tdg: "ti", ti: "ti",
  ccx: "ccnot", toffoli: "ccnot", ccnot: "ccnot",
  id: "i",
};

export function qasm2ToQasm3(source: string, dialect: "braket" | "stdgates" = "braket") {
  let output = source
    .replace(/OPENQASM\s+2\.0\s*;/i, "OPENQASM 3.0;")
    .replace(/include\s+"qelib1\.inc"\s*;/i, 'include "stdgates.inc";')
    .replace(/\bqreg\s+(\w+)\[(\d+)]\s*;/g, "qubit[$2] $1;")
    .replace(/\bcreg\s+(\w+)\[(\d+)]\s*;/g, "bit[$2] $1;")
    .replace(/measure\s+(\w+)\s*->\s*(\w+)\s*;/g, "$2 = measure $1;")
    .replace(/measure\s+(\w+)\[(\d+)]\s*->\s*(\w+)\[(\d+)]\s*;/g, "$3[$4] = measure $1[$2];");
  if (dialect === "braket") {
    output = output.replace(/^\s*include\s+"stdgates\.inc"\s*;\s*$/im, "");
    output = output.replace(/\b(cx|cnot|sdg|si|tdg|ti|ccx|toffoli|ccnot|id)\b/g, (name) => BRAKET_GATE_NAMES[name] ?? name);
    output = output.replace(/\bu1\s*\(([^)]+)\)/g, "rz($1)");
    output = output.replace(/\bu2\s*\(([^,]+),([^)]+)\)\s+([^;]+);/g, (_, phi, lambda, wire) => `rz(${lambda.trim()}) ${wire}; ry(pi/2) ${wire}; rz(${phi.trim()}) ${wire};`);
    output = output.replace(/\b(?:u3|u)\s*\(([^,]+),([^,]+),([^)]+)\)\s+([^;]+);/g, (_, theta, phi, lambda, wire) => `rz(${lambda.trim()}) ${wire}; ry(${theta.trim()}) ${wire}; rz(${phi.trim()}) ${wire};`);
  }
  return output;
}


/**
 * Converts core-gate OpenQASM 2 (the output of dialect expansion + transpile)
 * into IonQ's QIS gate JSON. Throws on anything it cannot faithfully express so
 * a circuit is never silently altered before hardware execution.
 */
export function qasm2ToIonqCircuit(source: string) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, "");
  const offsets = new Map<string, { offset: number; size: number }>();
  let total = 0;
  for (const match of text.matchAll(/\bqreg\s+([A-Za-z_][A-Za-z0-9_]*)\s*\[(\d+)]/g)) {
    offsets.set(match[1], { offset: total, size: Number(match[2]) });
    total += Number(match[2]);
  }

  const wire = (argument: string): number[] => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?$/.exec(argument.trim());
    const register = match ? offsets.get(match[1]) : undefined;
    if (!match || !register) throw new Error(`IonQ conversion failed: unknown qubit "${argument.trim()}".`);
    if (match[2] === undefined) return Array.from({ length: register.size }, (_, index) => register.offset + index);
    const index = Number(match[2]);
    if (index >= register.size) throw new Error(`IonQ conversion failed: qubit index out of range in "${argument.trim()}".`);
    return [register.offset + index];
  };

  const gates: Array<Record<string, unknown>> = [];
  const single = (gate: string, target: number, rotation?: number) =>
    gates.push(rotation === undefined ? { gate, target } : { gate, rotation, target });
  const cnot = (control: number, target: number) => gates.push({ gate: "cnot", control, target });
  const u3 = (target: number, theta: number, phi: number, lambda: number) => {
    single("rz", target, lambda);
    single("ry", target, theta);
    single("rz", target, phi);
  };
  const toffoli = (a: number, b: number, c: number) => {
    single("h", c); cnot(b, c); single("ti", c); cnot(a, c); single("t", c); cnot(b, c); single("ti", c);
    cnot(a, c); single("t", b); single("t", c); single("h", c); cnot(a, b); single("t", a); single("ti", b); cnot(a, b);
  };

  for (const rawStatement of text.split(";")) {
    const statement = rawStatement.trim();
    if (!statement) continue;
    if (/^(OPENQASM|include|qreg|creg|barrier)\b/i.test(statement)) continue;
    if (/^measure\b/i.test(statement)) continue;
    if (/^if\s*\(/.test(statement)) throw new Error("IonQ conversion failed: classically-controlled gates are not supported.");
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s+(.+)$/s.exec(statement);
    if (!match) throw new Error(`IonQ conversion failed: could not parse "${statement.slice(0, 60)}".`);
    const name = match[1].toLowerCase();
    const params = (match[2] ?? "").split(",").map((piece) => piece.trim()).filter(Boolean).map(evaluateParam);
    const argRows = match[3].split(",").map((argument) => wire(argument));
    const arity = argRows.length;
    const broadcast = Math.max(...argRows.map((row) => row.length));
    if (argRows.some((row) => row.length !== 1 && row.length !== broadcast)) {
      throw new Error(`IonQ conversion failed: mismatched register sizes in "${statement.slice(0, 60)}".`);
    }
    for (let step = 0; step < broadcast; step += 1) {
      const wires = argRows.map((row) => (row.length === 1 ? row[0] : row[step]));
      const [a, b, c] = wires;
      if (arity === 1) {
        if (["h", "x", "y", "z", "s", "t"].includes(name)) single(name, a);
        else if (name === "sdg") single("si", a);
        else if (name === "tdg") single("ti", a);
        else if (name === "sx" || name === "v") single("v", a);
        else if (name === "sxdg" || name === "vi") single("vi", a);
        else if (name === "id") continue;
        else if (["rx", "ry", "rz"].includes(name)) single(name, a, params[0]);
        else if (name === "u1" || name === "p") single("rz", a, params[0]);
        else if (name === "u2") u3(a, Math.PI / 2, params[0], params[1]);
        else if (name === "u3" || name === "u") u3(a, params[0], params[1], params[2]);
        else throw new Error(`IonQ conversion failed: gate "${name}" is not supported.`);
      } else if (arity === 2) {
        if (name === "cx" || name === "cnot") cnot(a, b);
        else if (name === "cz") { single("h", b); cnot(a, b); single("h", b); }
        else if (name === "swap") gates.push({ gate: "swap", targets: [a, b] });
        else throw new Error(`IonQ conversion failed: gate "${name}" is not supported.`);
      } else if (arity === 3 && (name === "ccx" || name === "toffoli")) {
        toffoli(a, b, c);
      } else {
        throw new Error(`IonQ conversion failed: gate "${name}" is not supported.`);
      }
    }
  }
  return gates;
}

/** Classical mapping that qasm2ToIonqCircuit must not drop (D5). */
export function ionqMeasurementMap(source: string) {
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
  const map: Array<{ qubit: number; clbit: number }> = [];
  for (const match of text.matchAll(/\bmeasure\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[(\d+)])?\s*;/g)) {
    const q = qOffsets.get(match[1]);
    const c = cOffsets.get(match[3]);
    if (!q || !c) throw new Error(`IonQ conversion failed: measurement map is missing a register in "${match[0]}".`);
    if (match[2] !== undefined && match[4] !== undefined) {
      map.push({ qubit: q.offset + Number(match[2]), clbit: c.offset + Number(match[4]) });
    } else {
      const width = Math.min(q.size, c.size);
      for (let index = 0; index < width; index += 1) map.push({ qubit: q.offset + index, clbit: c.offset + index });
    }
  }
  if (!map.length) throw new Error("IonQ conversion failed: the measurement map is empty; a circuit is never submitted without its classical mapping.");
  return map;
}
