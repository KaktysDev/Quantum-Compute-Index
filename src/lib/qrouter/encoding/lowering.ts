/**
 * Lowering-rule proofs (G5). Each dialects.ts decomposition is identified here
 * with a phase_exact flag (C1.1). The unitary audit runs against expandDialects
 * — the same path analysis uses — so a wrong rule cannot ship as a comment.
 */

import { expandDialects } from "../dialects";

export interface LoweringRule {
  id: string;
  name: string;
  phase_exact: boolean;
  params: number[];
  qasmCall: string;
  qubits: number;
}

/**
 * The 22 audited rules from Appendix A. `ch` is the correct decomposition
 * (ry(+π/4) before cx). cu1/cu3/crz/csx are marked phase_exact only after the
 * u1 rewrite in dialects.ts; they must not sit under ctrl @ otherwise.
 */
export const LOWERING_RULES: LoweringRule[] = [
  { id: "sx", name: "sx", phase_exact: true, params: [], qasmCall: "sx q[0];", qubits: 1 },
  { id: "sxdg", name: "sxdg", phase_exact: true, params: [], qasmCall: "sxdg q[0];", qubits: 1 },
  { id: "prx", name: "prx", phase_exact: true, params: [0.9, 0.5], qasmCall: "prx(0.9,0.5) q[0];", qubits: 1 },
  { id: "gpi", name: "gpi", phase_exact: true, params: [0.15], qasmCall: "gpi(0.15) q[0];", qubits: 1 },
  { id: "gpi2", name: "gpi2", phase_exact: true, params: [0.2], qasmCall: "gpi2(0.2) q[0];", qubits: 1 },
  { id: "rzx", name: "rzx", phase_exact: true, params: [0.7], qasmCall: "rzx(0.7) q[0],q[1];", qubits: 2 },
  { id: "rxx", name: "rxx", phase_exact: true, params: [0.6], qasmCall: "rxx(0.6) q[0],q[1];", qubits: 2 },
  { id: "ryy", name: "ryy", phase_exact: true, params: [0.55], qasmCall: "ryy(0.55) q[0],q[1];", qubits: 2 },
  { id: "rzz", name: "rzz", phase_exact: true, params: [0.4], qasmCall: "rzz(0.4) q[0],q[1];", qubits: 2 },
  { id: "zz", name: "zz", phase_exact: true, params: [0.25], qasmCall: "zz(0.25) q[0],q[1];", qubits: 2 },
  { id: "ecr", name: "ecr", phase_exact: true, params: [], qasmCall: "ecr q[0],q[1];", qubits: 2 },
  { id: "ms", name: "ms", phase_exact: true, params: [0.1, 0.2], qasmCall: "ms(0.1,0.2) q[0],q[1];", qubits: 2 },
  { id: "ms3", name: "ms", phase_exact: true, params: [0.1, 0.2, 0.3], qasmCall: "ms(0.1,0.2,0.3) q[0],q[1];", qubits: 2 },
  { id: "cu1", name: "cu1", phase_exact: true, params: [0.8], qasmCall: "cu1(0.8) q[0],q[1];", qubits: 2 },
  { id: "iswap", name: "iswap", phase_exact: true, params: [], qasmCall: "iswap q[0],q[1];", qubits: 2 },
  { id: "xy", name: "xy", phase_exact: true, params: [0.9], qasmCall: "xy(0.9) q[0],q[1];", qubits: 2 },
  { id: "crz", name: "crz", phase_exact: true, params: [0.75], qasmCall: "crz(0.75) q[0],q[1];", qubits: 2 },
  { id: "cy", name: "cy", phase_exact: true, params: [], qasmCall: "cy q[0],q[1];", qubits: 2 },
  { id: "ch", name: "ch", phase_exact: true, params: [], qasmCall: "ch q[0],q[1];", qubits: 2 },
  { id: "cu3", name: "cu3", phase_exact: true, params: [0.4, 0.3, 0.2], qasmCall: "cu3(0.4,0.3,0.2) q[0],q[1];", qubits: 2 },
  { id: "csx", name: "csx", phase_exact: true, params: [], qasmCall: "csx q[0],q[1];", qubits: 2 },
  { id: "cphase", name: "cu1", phase_exact: true, params: [0.8], qasmCall: "cphase(0.8) q[0],q[1];", qubits: 2 },
];

export const LOWERABLE = new Set(LOWERING_RULES.map((rule) => rule.name));

/** Pauli / standard matrices used as G5 references. q[0] is the LSB of the state index. */
const I = [[c(1, 0), c(0, 0)], [c(0, 0), c(1, 0)]];
const X = [[c(0, 0), c(1, 0)], [c(1, 0), c(0, 0)]];
const Y = [[c(0, 0), c(0, -1)], [c(0, 1), c(0, 0)]];
const Z = [[c(1, 0), c(0, 0)], [c(0, 0), c(-1, 0)]];
const H = scale([[c(1, 0), c(1, 0)], [c(1, 0), c(-1, 0)]], 1 / Math.SQRT2);

function c(re: number, im: number) {
  return { re, im };
}

function scale(m: Array<Array<{ re: number; im: number }>>, k: number) {
  return m.map((row) => row.map((cell) => ({ re: cell.re * k, im: cell.im * k })));
}

function mul(a: { re: number; im: number }, b: { re: number; im: number }) {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function add(a: { re: number; im: number }, b: { re: number; im: number }) {
  return { re: a.re + b.re, im: a.im + b.im };
}

function matMul(a: Array<Array<{ re: number; im: number }>>, b: Array<Array<{ re: number; im: number }>>) {
  const n = a.length;
  const out = Array.from({ length: n }, () => Array.from({ length: n }, () => c(0, 0)));
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < n; k += 1) {
      for (let j = 0; j < n; j += 1) out[i][j] = add(out[i][j], mul(a[i][k], b[k][j]));
    }
  }
  return out;
}

function kron(a: Array<Array<{ re: number; im: number }>>, b: Array<Array<{ re: number; im: number }>>) {
  const out: Array<Array<{ re: number; im: number }>> = [];
  for (let i = 0; i < a.length; i += 1) {
    for (let k = 0; k < b.length; k += 1) {
      const row: Array<{ re: number; im: number }> = [];
      for (let j = 0; j < a[i].length; j += 1) {
        for (let l = 0; l < b[k].length; l += 1) row.push(mul(a[i][j], b[k][l]));
      }
      out.push(row);
    }
  }
  return out;
}

function expITheta(theta: number) {
  return c(Math.cos(theta), Math.sin(theta));
}

function rz(theta: number) {
  return [[expITheta(-theta / 2), c(0, 0)], [c(0, 0), expITheta(theta / 2)]];
}

function rx(theta: number) {
  const c0 = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return [[c(c0, 0), c(0, -s)], [c(0, -s), c(c0, 0)]];
}

function ry(theta: number) {
  const c0 = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return [[c(c0, 0), c(-s, 0)], [c(s, 0), c(c0, 0)]];
}

function u1(lambda: number) {
  return [[c(1, 0), c(0, 0)], [c(0, 0), expITheta(lambda)]];
}

function controlled(targetOn1: Array<Array<{ re: number; im: number }>>) {
  // control = q[0] (LSB), target = q[1]. Basis |q1 q0>.
  const out = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => c(0, 0)));
  // control 0: identity on |q1 0>
  out[0][0] = c(1, 0);
  out[2][2] = c(1, 0);
  // control 1: apply targetOn1 to q1 while q0=1. Indices 1 (|00 wait| q1=0 q0=1) and 3 (|11>).
  out[1][1] = targetOn1[0][0];
  out[1][3] = targetOn1[0][1];
  out[3][1] = targetOn1[1][0];
  out[3][3] = targetOn1[1][1];
  return out;
}

function tensorExp(pauli: Array<Array<{ re: number; im: number }>>, theta: number) {
  // exp(-i θ/2 P) for P² = I: cos(θ/2) I - i sin(θ/2) P
  const n = pauli.length;
  const ident = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? c(1, 0) : c(0, 0))));
  const ct = Math.cos(theta / 2);
  const st = Math.sin(theta / 2);
  return ident.map((row, i) => row.map((cell, j) => add(
    { re: cell.re * ct, im: cell.im * ct },
    { re: pauli[i][j].im * st, im: -pauli[i][j].re * st },
  )));
}

export function referenceUnitary(rule: LoweringRule): Array<Array<{ re: number; im: number }>> {
  const [p0, p1, p2] = rule.params;
  switch (rule.id) {
    case "sx":
      return [[c(0.5, 0.5), c(0.5, -0.5)], [c(0.5, -0.5), c(0.5, 0.5)]];
    case "sxdg":
      return [[c(0.5, -0.5), c(0.5, 0.5)], [c(0.5, 0.5), c(0.5, -0.5)]];
    case "prx":
      return matMul(rz(-p1), matMul(rx(p0), rz(p1)));
    case "gpi": {
      const phi = 2 * Math.PI * p0;
      return [[c(0, 0), expITheta(-phi)], [expITheta(phi), c(0, 0)]];
    }
    case "gpi2": {
      const phi = 2 * Math.PI * p0;
      return matMul(rz(-phi), matMul(rx(Math.PI / 2), rz(phi)));
    }
    case "rzx":
      return tensorExp(kron(X, Z), p0);
    case "rxx":
      return tensorExp(kron(X, X), p0);
    case "ryy":
      return tensorExp(kron(Y, Y), p0);
    case "rzz":
      return tensorExp(kron(Z, Z), p0);
    case "zz":
      return tensorExp(kron(Z, Z), 2 * Math.PI * p0);
    case "ecr": {
      const rzxPlus = tensorExp(kron(X, Z), Math.PI / 4);
      const rzxMinus = tensorExp(kron(X, Z), -Math.PI / 4);
      return matMul(rzxMinus, matMul(kron(I, X), rzxPlus));
    }
    case "ms":
    case "ms3": {
      const theta = rule.id === "ms3" ? p2 : 0.25;
      const l0 = 2 * Math.PI * p0;
      const l1 = 2 * Math.PI * p1;
      const lt = 2 * Math.PI * theta;
      const pre = kron(rz(-l1), rz(-l0));
      const rxx = tensorExp(kron(X, X), lt);
      const post = kron(rz(l1), rz(l0));
      return matMul(post, matMul(rxx, pre));
    }
    case "cu1":
    case "cphase":
      return controlled(u1(p0));
    case "iswap": {
      const out = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => (i === j ? c(1, 0) : c(0, 0))));
      out[1][1] = c(0, 0);
      out[2][2] = c(0, 0);
      out[1][2] = c(0, 1);
      out[2][1] = c(0, 1);
      return out;
    }
    case "xy": {
      const rxx = tensorExp(kron(X, X), -p0 / 2);
      const ryy = tensorExp(kron(Y, Y), -p0 / 2);
      return matMul(ryy, rxx);
    }
    case "crz":
      return controlled(rz(p0));
    case "cy":
      return controlled(Y);
    case "ch":
      return controlled(H);
    case "cu3": {
      const u3 = matMul(rz(p2), matMul(ry(p0), rz(p1)));
      return controlled(u3);
    }
    case "csx":
      return controlled([[c(0.5, 0.5), c(0.5, -0.5)], [c(0.5, -0.5), c(0.5, 0.5)]]);
    default:
      throw new Error(`No reference unitary for ${rule.id}`);
  }
}

export function maxUnitaryError(
  got: Array<Array<{ re: number; im: number }>>,
  ref: Array<Array<{ re: number; im: number }>>,
  phaseExact = false,
) {
  let phase = c(1, 0);
  if (!phaseExact) {
    let best = 0;
    let entry = c(1, 0);
    for (let i = 0; i < ref.length; i += 1) {
      for (let j = 0; j < ref.length; j += 1) {
        const mag = Math.hypot(ref[i][j].re, ref[i][j].im);
        if (mag > best) {
          best = mag;
          const g = got[i][j];
          const r = ref[i][j];
          // phase such that e^{-iφ} got ≈ ref → φ from got/ref
          if (Math.hypot(g.re, g.im) > 1e-12 && mag > 1e-12) {
            const conjR = { re: r.re, im: -r.im };
            const ratio = mul(g, conjR);
            const norm = mag * mag;
            entry = { re: ratio.re / norm, im: ratio.im / norm };
            const n = Math.hypot(entry.re, entry.im) || 1;
            phase = { re: entry.re / n, im: entry.im / n };
          }
        }
      }
    }
  }
  let max = 0;
  for (let i = 0; i < ref.length; i += 1) {
    for (let j = 0; j < ref.length; j += 1) {
      const aligned = mul(got[i][j], { re: phase.re, im: -phase.im });
      max = Math.max(max, Math.hypot(aligned.re - ref[i][j].re, aligned.im - ref[i][j].im));
    }
  }
  return max;
}

type Complex = { re: number; im: number };
type Matrix = Array<Array<Complex>>;

function apply1q(state: Complex[], gate: Matrix, wire: number, _qubits: number) {
  const next = state.map(() => c(0, 0));
  const dim = state.length;
  for (let index = 0; index < dim; index += 1) {
    const bit = (index >> wire) & 1;
    const base = index - (bit << wire);
    for (let out = 0; out < 2; out += 1) {
      const dest = base + (out << wire);
      next[dest] = add(next[dest], mul(gate[out][bit], state[index]));
    }
  }
  return next;
}

function applyCx(state: Complex[], control: number, target: number) {
  const out = state.map(() => c(0, 0));
  for (let index = 0; index < state.length; index += 1) {
    const dest = ((index >> control) & 1) === 1 ? index ^ (1 << target) : index;
    out[dest] = add(out[dest], state[index]);
  }
  return out;
}

function coreGate(name: string, params: number[]): Matrix {
  switch (name) {
    case "id": return I;
    case "x": return X;
    case "y": return Y;
    case "z": return Z;
    case "h": return H;
    case "s": return u1(Math.PI / 2);
    case "sdg": return u1(-Math.PI / 2);
    case "t": return u1(Math.PI / 4);
    case "tdg": return u1(-Math.PI / 4);
    case "rx": return rx(params[0]);
    case "ry": return ry(params[0]);
    case "rz": return rz(params[0]);
    case "u1": return u1(params[0]);
    case "u2": return matMul(rz(params[1]), matMul(ry(Math.PI / 2), rz(params[0])));
    case "u3": return matMul(rz(params[2]), matMul(ry(params[0]), rz(params[1])));
    default: throw new Error(`G5 audit cannot apply core gate "${name}".`);
  }
}

function columnsToMatrix(columns: Complex[][]): Matrix {
  const n = columns.length;
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => columns[col][row]));
}

/**
 * Operator of `expandDialects(rule)` on the computational basis (q0 = LSB).
 * This is the CI gate: a comment is not a proof.
 */
export function expandedUnitary(rule: LoweringRule): Matrix {
  const source = `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[${rule.qubits}];\n${rule.qasmCall}`;
  const expanded = expandDialects(source);
  const dim = 2 ** rule.qubits;
  const columns: Complex[][] = [];
  for (let basis = 0; basis < dim; basis += 1) {
    let state = Array.from({ length: dim }, (_, index) => c(index === basis ? 1 : 0, 0));
    for (const raw of expanded.split(";")) {
      const statement = raw.trim();
      if (!statement || /^(OPENQASM|include|qreg)\b/i.test(statement)) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(.*)$/.exec(statement);
      if (!match) continue;
      const name = match[1].toLowerCase();
      const params = match[2] ? match[2].split(",").map((item) => Number(item.trim())) : [];
      const wires = [...match[3].matchAll(/\[(\d+)]/g)].map((item) => Number(item[1]));
      if (name === "cx") state = applyCx(state, wires[0], wires[1]);
      else if (name === "cz") {
        state = apply1q(state, H, wires[1], rule.qubits);
        state = applyCx(state, wires[0], wires[1]);
        state = apply1q(state, H, wires[1], rule.qubits);
      } else if (name === "swap") {
        state = applyCx(state, wires[0], wires[1]);
        state = applyCx(state, wires[1], wires[0]);
        state = applyCx(state, wires[0], wires[1]);
      } else {
        state = apply1q(state, coreGate(name, params), wires[0], rule.qubits);
      }
    }
    columns.push(state);
  }
  return columnsToMatrix(columns);
}
