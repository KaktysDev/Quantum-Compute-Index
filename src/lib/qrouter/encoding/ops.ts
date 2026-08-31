/**
 * Canonical operation identities (C1.3). Requirements and capabilities compare
 * OpIds, not provider spellings — sdg and si are one identity; sx/v likewise.
 */

export interface OpId {
  key: string;
  arity: { qubits: number; params: number };
  definition: "unitary" | "opaque";
}

const ops = new Map<string, OpId>();

function define(key: string, qubits: number, params: number, definition: OpId["definition"] = "unitary"): OpId {
  const op: OpId = { key, arity: { qubits, params }, definition };
  ops.set(key, op);
  return op;
}

export const OP = {
  id: define("op:id", 1, 0),
  x: define("op:x", 1, 0),
  y: define("op:y", 1, 0),
  z: define("op:z", 1, 0),
  h: define("op:h", 1, 0),
  s: define("op:s", 1, 0),
  sdg: define("op:sdg", 1, 0),
  t: define("op:t", 1, 0),
  tdg: define("op:tdg", 1, 0),
  sx: define("op:sx", 1, 0),
  sxdg: define("op:sxdg", 1, 0),
  rx: define("op:rx", 1, 1),
  ry: define("op:ry", 1, 1),
  rz: define("op:rz", 1, 1),
  u1: define("op:u1", 1, 1),
  u2: define("op:u2", 1, 2),
  u3: define("op:u3", 1, 3),
  prx: define("op:prx", 1, 2),
  gpi: define("op:gpi", 1, 1),
  gpi2: define("op:gpi2", 1, 1),
  cx: define("op:cx", 2, 0),
  cz: define("op:cz", 2, 0),
  swap: define("op:swap", 2, 0),
  ecr: define("op:ecr", 2, 0),
  rzx: define("op:rzx", 2, 1),
  rxx: define("op:rxx", 2, 1),
  ryy: define("op:ryy", 2, 1),
  rzz: define("op:rzz", 2, 1),
  zz: define("op:zz", 2, 1),
  ms: define("op:ms", 2, 3),
  cu1: define("op:cu1", 2, 1),
  iswap: define("op:iswap", 2, 0),
  xy: define("op:xy", 2, 1),
  crz: define("op:crz", 2, 1),
  cy: define("op:cy", 2, 0),
  ch: define("op:ch", 2, 0),
  csx: define("op:csx", 2, 0),
  cu3: define("op:cu3", 2, 3),
  ccx: define("op:ccx", 3, 0),
  measure: define("op:measure", 1, 0, "opaque"),
  reset: define("op:reset", 1, 0, "opaque"),
  barrier: define("op:barrier", 0, 0, "opaque"),
};

/** Provider / dialect spellings → OpId. */
const ALIASES: Record<string, string> = {
  cnot: "op:cx",
  ccnot: "op:ccx",
  toffoli: "op:ccx",
  not: "op:x",
  si: "op:sdg",
  ti: "op:tdg",
  v: "op:sx",
  vi: "op:sxdg",
  p: "op:u1",
  phase: "op:u1",
  u: "op:u3",
  cp: "op:cu1",
  cphase: "op:cu1",
  i: "op:id",
  identity: "op:id",
};

export function resolveOpId(name: string): OpId | undefined {
  const lower = name.toLowerCase();
  const aliased = ALIASES[lower];
  if (aliased) return ops.get(aliased);
  return ops.get(`op:${lower}`);
}

export function requireOpId(name: string): OpId {
  const op = resolveOpId(name);
  if (!op) throw new Error(`Unknown operation "${name}" — not in the OpId registry.`);
  return op;
}

/** Adapter-local rendering: OpId → the token this provider's wire format uses. */
export const RENDER: Record<string, Record<string, string>> = {
  qiskit: {
    "op:sdg": "sdg", "op:tdg": "tdg", "op:sx": "sx", "op:sxdg": "sxdg", "op:cx": "cx", "op:ccx": "ccx", "op:id": "id",
  },
  ionq_qis: {
    "op:sdg": "si", "op:tdg": "ti", "op:sx": "v", "op:sxdg": "vi", "op:cx": "cnot", "op:ccx": "cnot", "op:id": "id",
  },
  braket: {
    "op:sdg": "si", "op:tdg": "ti", "op:sx": "v", "op:sxdg": "vi", "op:cx": "cnot", "op:ccx": "ccnot", "op:id": "i",
  },
};

export function renderOp(family: keyof typeof RENDER, opid: string, fallback: string) {
  return RENDER[family][opid] ?? fallback;
}

export function opIdsFromTokens(tokens: string[]): InstructionLike[] {
  return tokens.map((token) => {
    const op = resolveOpId(token);
    return {
      opid: op?.key ?? `op:${token.toLowerCase()}`,
      name: token,
      provider_token: token,
      arity: op?.arity ?? { qubits: 0, params: 0 },
    };
  });
}

interface InstructionLike {
  opid: string;
  name: string;
  provider_token: string;
  arity: { qubits: number; params: number };
}
