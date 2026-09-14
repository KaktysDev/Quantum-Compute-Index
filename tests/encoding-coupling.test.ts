import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { BACKENDS } from "@/lib/qrouter/catalog";
import {
  buildExecutionEnvelope,
  couplingSatisfaction,
  encodeForBackend,
  profileBackend,
  routeToCoupling,
  satisfies,
  shortestCouplingPath,
} from "@/lib/qrouter/encoding";
import type { Backend } from "@/lib/qrouter/types";

const HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';
const BELL = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`;
const STARMON = [[0, 2], [2, 0], [1, 2], [2, 1], [2, 3], [3, 2], [2, 4], [4, 2]];

function catalog(id: string, available = true): Backend {
  const backend = BACKENDS.find((item) => item.id === id);
  if (!backend) throw new Error(`Missing ${id}`);
  return { ...backend, available };
}

function undirectedOnMap(map: number[][], a: number, b: number) {
  return map.some(([left, right]) => (left === a && right === b) || (left === b && right === a));
}

function twoQubitOps(qasm: string) {
  return [...qasm.matchAll(/\b(cx|cz|cnot|swap)\s+q\[(\d+)]\s*,\s*q\[(\d+)]/gi)].map((match) => ({
    name: match[1].toLowerCase(),
    a: Number(match[2]),
    b: Number(match[3]),
  }));
}

describe("coupling satisfaction + SWAP routing", () => {
  it("records the Bell pair and accepts Starmon-5 with a SWAP-routing note", () => {
    const envelope = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 32, routing_mode: "balanced" });
    expect(envelope.requirements.connectivity.pairs).toEqual([[0, 1]]);
    expect(envelope.requirements.connectivity.needs_routing).toBe(true);
    const verdict = satisfies(envelope.requirements, profileBackend(catalog("qi-starmon-5", true)));
    expect(verdict.ok, verdict.ok ? "" : verdict.failures.map((item) => item.message).join("; ")).toBe(true);
    if (verdict.ok) expect(verdict.notes.join(" ")).toMatch(/SWAP|hop|routing/i);
  });

  it("fails a two-qubit pair that has no path on the coupling map", () => {
    const envelope = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 32, routing_mode: "balanced" });
    const cap = {
      ...profileBackend(catalog("qi-starmon-5", true)),
      connectivity: { kind: "coupling_map" as const, coupling_map: [[0, 2], [2, 0]] as [number, number][] },
    };
    const verdict = satisfies(envelope.requirements, cap);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.failures.some((item) => item.code === "connectivity")).toBe(true);
    }
    expect(couplingSatisfaction([[0, 1]], [[0, 2], [2, 0]]).ok).toBe(false);
  });

  it("does not fail IBM-style target connectivity with an empty coupling map", () => {
    const envelope = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 32, routing_mode: "balanced" });
    const verdict = satisfies(envelope.requirements, profileBackend(catalog("ibm-brisbane", true)));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.notes.join(" ")).toMatch(/compiler will route/i);
  });

  it("inserts SWAP so every remaining cx/cz/swap is an edge of the Starmon plus-map", () => {
    expect(shortestCouplingPath(STARMON, 0, 1)).toEqual([0, 2, 1]);
    const routed = routeToCoupling(BELL, STARMON);
    expect(routed.qasm).toMatch(/\bswap\b/i);
    const ops = twoQubitOps(routed.qasm);
    expect(ops.some((op) => op.name === "cx" || op.name === "cnot")).toBe(true);
    for (const op of ops) {
      expect(undirectedOnMap(STARMON, op.a, op.b), `${op.name} q[${op.a}],q[${op.b}] is off-map`).toBe(true);
    }
    expect(routed.layout.logicalToPhysical[0]).toBeDefined();
    expect(routed.layout.routingPermutation.length).toBeGreaterThanOrEqual(2);
  });

  it("expands whole-register two-qubit refs into undirected pairs once", () => {
    const twoReg = buildExecutionEnvelope({
      source: `${HEADER}qreg a[2];\nqreg b[2];\ncreg c[2];\ncx a,b;\nmeasure a -> c;`,
      format: "openqasm2",
      shots: 8,
      routing_mode: "balanced",
    });
    expect(twoReg.requirements.connectivity.pairs).toEqual([[0, 2], [1, 3]]);
  });

  it("keeps local SWAP layout off decode_map so histograms are not remapped twice", () => {
    const routed = routeToCoupling(BELL, STARMON);
    const envelope = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 32, routing_mode: "balanced" });
    const analysis = analyzeCircuit(BELL, "openqasm2");
    const local = encodeForBackend({
      envelope,
      backend: catalog("qi-starmon-5", true),
      analysis,
      transpilation: {
        qasm: routed.qasm,
        backendId: "qi-starmon-5",
        compiler: "local",
        layout: routed.layout,
      } as never,
      quoteBinding: "binding",
    });
    expect(local.decode_map.layout).toBeNull();

    const qiskit = encodeForBackend({
      envelope,
      backend: catalog("qi-starmon-5", true),
      analysis,
      transpilation: {
        qasm: routed.qasm,
        backendId: "qi-starmon-5",
        compiler: "qiskit",
        layout: { logicalToPhysical: { 0: 1, 1: 0 } },
      } as never,
      quoteBinding: "binding",
    });
    expect(qiskit.decode_map.layout?.logical_to_physical).toEqual({ 0: 1, 1: 0 });
  });

  it("keeps nativeProgramFor free of coupling imports — SWAP is a single transpiler pass", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/lib/qrouter/encoding/native.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from "\.\/coupling"/);
    expect(source).not.toMatch(/qasmRespectingCoupling/);
  });
});
