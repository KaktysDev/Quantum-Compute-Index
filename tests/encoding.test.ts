import { describe, expect, it } from "vitest";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { expandDialects } from "@/lib/qrouter/dialects";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { overlayExecute } from "@/lib/qrouter/encoding";
import {
  advertisedCapabilities,
  buildExecutionEnvelope,
  decodeProviderResult,
  expandedUnitary,
  jcsHash,
  LOWERING_RULES,
  maxUnitaryError,
  nativeProgramFor,
  normalizeBitOrder,
  OP,
  profileBackend,
  publicEncoding,
  referenceUnitary,
  resolveOpId,
  satisfies,
  slimJobForClient,
  stageStory,
  whyRouted,
} from "@/lib/qrouter/encoding";
import { qasm2ToIonqCircuit, ionqMeasurementMap, qasm2ToQasm3 } from "@/lib/qrouter/execution";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { simulateCircuit } from "@/lib/qrouter/simulator";
import { assertTargetAllowedV2 } from "@/lib/qrouter/scopes";
import { V2ApiError } from "@/lib/qrouter/v2-http";
import { createCircuitResource, createExecutionGroup } from "@/lib/qrouter/v2-service";
import type { Backend } from "@/lib/qrouter/types";
import type { Principal } from "@/lib/qrouter/auth";

const HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';
const BELL = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`;
const CH_REPRO = `${HEADER}qreg q[2];\ncreg c[2];\nx q[0];\nh q[1];\nch q[0],q[1];\nmeasure q -> c;`;

function catalog(id: string, available = true): Backend {
  const backend = BACKENDS.find((item) => item.id === id);
  if (!backend) throw new Error(`Missing ${id}`);
  return { ...backend, available };
}

describe("G5 lowering proofs", () => {
  it("reproduces the paper ch circuit as 01, not 11", () => {
    const analysis = analyzeCircuit(CH_REPRO, "openqasm2");
    expect(analysis.normalizedQasm2).toMatch(/ry\(0?\.785/);
    const result = simulateCircuit(analysis, 512);
    const top = Object.entries(result.counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    expect(top).toBe("01");
    expect(result.counts["11"] ?? 0).toBe(0);
  });

  it.each(LOWERING_RULES)("matches the reference unitary for $id", (rule) => {
    const error = maxUnitaryError(expandedUnitary(rule), referenceUnitary(rule), rule.phase_exact);
    expect(error).toBeLessThan(1e-9);
  });

  it("marks cu3 as not phase-exact until it is used under a modifier (C1.1)", () => {
    const cu3 = LOWERING_RULES.find((rule) => rule.id === "cu3");
    expect(cu3?.phase_exact).toBe(false);
  });
});

describe("frontend policy (D12, D14, D17)", () => {
  it("does not reject identifiers or comments that mention control-flow words", () => {
    const source = `${HEADER}// waiting for the measurement\nqreg input_state[1];\ncreg c[1];\nh input_state[0];\nmeasure input_state -> c;`;
    expect(() => analyzeCircuit(source, "openqasm2")).not.toThrow();
  });

  it("rejects a filesystem include before the worker is reached", () => {
    expect(() => analyzeCircuit(`${HEADER}include "../../etc/passwd";\nqreg q[1];\nh q[0];`, "openqasm2")).toThrow(/allow-list/);
  });

  it("expands provider-native gates inside user-defined gate bodies", () => {
    const expanded = expandDialects(`${HEADER}gate myecr a,b { ecr a,b; }\nqreg q[2];\nmyecr q[0],q[1];`);
    expect(expanded).toMatch(/gate myecr a,b/);
    expect(expanded).toMatch(/rzx|h q|cx /);
    expect(expanded).not.toMatch(/\becr\b/);
  });
});

describe("OpId registry (C1.3)", () => {
  it("treats provider spellings as one identity", () => {
    expect(resolveOpId("sdg")?.key).toBe(OP.sdg.key);
    expect(resolveOpId("si")?.key).toBe(OP.sdg.key);
    expect(resolveOpId("sx")?.key).toBe(OP.sx.key);
    expect(resolveOpId("v")?.key).toBe(OP.sx.key);
    expect(resolveOpId("vi")?.key).toBe(OP.sxdg.key);
    expect(resolveOpId("cnot")?.key).toBe(OP.cx.key);
    expect(resolveOpId("ccnot")?.key).toBe(OP.ccx.key);
  });
});

describe("satisfies()", () => {
  it("accepts a gate Bell circuit on Aer, IBM, IonQ, Braket, QI, and photonic adapters", () => {
    const envelope = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 128, routing_mode: "balanced" });
    for (const id of ["qci-aer-gpu", "ibm-brisbane", "ionq-aria-1", "iqm-garnet", "qi-starmon-5", "xanadu-borealis"]) {
      const verdict = satisfies(envelope.requirements, profileBackend(catalog(id, true)));
      expect(verdict.ok, `${id}: ${verdict.ok ? "" : verdict.failures.map((item) => item.message).join("; ")}`).toBe(true);
    }
  });

  it("rejects dynamic control flow on a static IBM profile", () => {
    const source = `OPENQASM 3.0;\ninclude "stdgates.inc";\nqubit[1] q;\nbit[1] c;\nc[0] = measure q[0];\nif (c[0]) { x q[0]; }`;
    const envelope = buildExecutionEnvelope({ source, format: "openqasm3", shots: 32, routing_mode: "balanced" });
    expect(envelope.workload.kind).toBe("dynamic");
    const verdict = satisfies(envelope.requirements, profileBackend(catalog("ibm-brisbane", true)));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.failures.some((item) => item.code === "control_flow" || item.code === "feedback" || item.code === "mid_circuit")).toBe(true);
  });
});

describe("provider wire encodings", () => {
  it("emits IonQ v/vi and a measurement map", () => {
    const source = `${HEADER}qreg q[2];\ncreg c[2];\nsx q[0];\nsxdg q[1];\nmeasure q[0] -> c[0];\nmeasure q[1] -> c[1];`;
    const circuit = qasm2ToIonqCircuit(source);
    expect(circuit).toEqual(expect.arrayContaining([
      expect.objectContaining({ gate: "v", target: 0 }),
      expect.objectContaining({ gate: "vi", target: 1 }),
    ]));
    expect(ionqMeasurementMap(source)).toEqual([
      { qubit: 0, clbit: 0 },
      { qubit: 1, clbit: 1 },
    ]);
  });

  it("fails closed when IonQ has no measurements", () => {
    expect(() => ionqMeasurementMap(`${HEADER}qreg q[1];\nh q[0];`)).toThrow(/measurement map is empty/);
  });

  it("renames Braket gates si/ti/ccnot", () => {
    const qasm = qasm2ToQasm3(`${HEADER}qreg q[3];\ncreg c[3];\nsdg q[0];\ntdg q[1];\nccx q[0],q[1],q[2];`, "braket");
    expect(qasm).toContain("si ");
    expect(qasm).toContain("ti ");
    expect(qasm).toContain("ccnot ");
    expect(qasm).not.toMatch(/\bcx\b/);
  });

  it("encodes QI to cQASM and photonic backends to dual-rail IR", () => {
    const analysis = analyzeCircuit(BELL, "openqasm2");
    expect(nativeProgramFor(catalog("qi-starmon-5"), analysis.normalizedQasm2).format).toBe("cqasm-1.0");
    expect(nativeProgramFor(catalog("xanadu-borealis"), analysis.normalizedQasm2).format).toBe("photonic-dual-rail");
  });
});

describe("typed decode (C1.2, D2–D4)", () => {
  it("records IonQ q0_left and normalises to q0_right", () => {
    const decoded = decodeProviderResult({
      backendId: "ionq-aria-1",
      raw: { probabilities: { "01": 1 }, shots: 10 },
      expectedShots: 10,
    });
    expect(decoded.provenance.source_bit_order).toBe("q0_left");
    expect(decoded.provenance.bit_order).toBe("q0_right");
    const probs = decoded.data.find((item) => item.type === "probabilities");
    expect(probs && "probabilities" in probs ? probs.probabilities : {}).toEqual({ "10": 1 });
    expect(normalizeBitOrder("01", "q0_left")).toBe("10");
  });

  it("keeps register fields instead of collapsing them", () => {
    const decoded = decodeProviderResult({
      backendId: "qci-aer-gpu",
      raw: { counts: { "0 11": 50, "01 1": 50 }, shots: 100 },
      expectedShots: 100,
    });
    const counts = decoded.data.find((item) => item.type === "counts");
    expect(counts && "counts" in counts ? counts.counts : {}).toEqual({ "0 11": 50, "01 1": 50 });
    expect(Object.values(counts && "counts" in counts ? counts.counts : {}).reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it("does not clip quasi-probabilities and labels synthetic counts", () => {
    const decoded = decodeProviderResult({
      backendId: "ibm-brisbane",
      raw: { quasiDistribution: { "00": 1.2, "11": -0.2 }, shots: 1000 },
      expectedShots: 1000,
    });
    const quasi = decoded.data.find((item) => item.type === "quasi");
    expect(quasi && "quasi" in quasi ? quasi.quasi : {}).toEqual({ "00": 1.2, "11": -0.2 });
    expect(decoded.provenance.synthetic.some((item) => item.field === "counts")).toBe(false);
  });
});

describe("JCS + pipeline", () => {
  it("hashes the same envelope body stably", () => {
    const first = jcsHash({ a: 1, b: [true, null], z: "x" });
    const second = jcsHash({ z: "x", b: [true, null], a: 1 });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prepareExecution attaches an encoding trace and a hashed bundle", async () => {
    const prepared = await prepareExecution({
      backends: [catalog("qci-aer-gpu")],
      analysis: analyzeCircuit(BELL, "openqasm2"),
      shots: 64,
      target: "qci-aer-gpu",
      mode: "balanced",
      source: BELL,
      format: "openqasm2",
    });
    expect(prepared.encoding.envelope_id).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.encoding.workload_kind).toBe("gate");
    expect(prepared.encoding.selected_bundle?.decode_map.measurement_map.length).toBeGreaterThan(0);
    expect(prepared.decision.encoding?.stages.map((stage) => stage.id)).toEqual([
      "analyze", "score", "transpile", "route", "execute",
    ]);
    expect(prepared.bundles[0].id).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.encoding.stages.find((stage) => stage.id === "analyze")?.detail).toMatch(/Gate circuit/);
    expect(prepared.encoding.stages.find((stage) => stage.id === "transpile")?.detail).toMatch(/Depth /);
    expect(JSON.stringify(prepared.encoding.stages)).not.toMatch(/envelope /);
  });

  it("reuses a compile when the source hash matches, not the timestamped envelope id", async () => {
    const input = {
      backends: [catalog("qci-aer-gpu")],
      analysis: analyzeCircuit(BELL, "openqasm2"),
      shots: 64,
      target: "qci-aer-gpu" as const,
      mode: "balanced" as const,
      source: BELL,
      format: "openqasm2" as const,
    };
    const first = await prepareExecution(input);
    const second = await prepareExecution(input);
    expect(second.transpilation).toBe(first.transpilation);
    expect(second.envelope.id).not.toBe(first.envelope.id);
  });

  it("advertises per-backend capabilities instead of a single stamp", () => {
    const aer = advertisedCapabilities(catalog("qci-aer-gpu"));
    const photonic = advertisedCapabilities(catalog("xanadu-borealis", true));
    expect(aer.adapter.name).toBe("qci-aer");
    expect(photonic.adapter.name).toBe("photonic");
    expect(photonic.workload_kinds).toContain("photonic");
    expect(aer.result).not.toEqual(photonic.result);
  });
});

describe("D10 v2 test keys", () => {
  it("converts a pinned QPU into a v2 authorization error", () => {
    const principal: Principal = {
      organizationId: "org-qee", userId: "u", apiKeyId: "k", demo: true, environment: "test", scopes: ["jobs:write"],
    };
    expect(() => assertTargetAllowedV2(principal, "ibm-brisbane", BACKENDS)).toThrow(V2ApiError);
  });

  it("blocks a v2 group that pins a QPU with a test key", async () => {
    const principal: Principal = {
      organizationId: `org-qee-${crypto.randomUUID()}`,
      userId: "u",
      apiKeyId: "k-test",
      demo: true,
      environment: "test",
      scopes: ["jobs:write"],
    };
    const created = await createCircuitResource(principal, { circuit: BELL, format: "openqasm2" }, crypto.randomUUID());
    await expect(createExecutionGroup(principal, {
      circuit_id: created.circuit.id,
      metadata: {},
      executions: [{
        key: "qpu",
        target: "ibm-brisbane",
        shots: 16,
        routing_mode: "balanced",
        optimization_level: 1,
        failover: false,
        max_attempts: 1,
        timeout_seconds: 120,
        constraints: {},
      }],
    }, crypto.randomUUID(), "req-qee")).rejects.toMatchObject({ name: "V2ApiError", status: 403 });
  });
});

describe("console stage overlay", () => {
  it("advances Execute from the real job status, not an animation", () => {
    const stages = overlayExecute(undefined, "processing");
    expect(stages.map((stage) => stage.id)).toEqual(["analyze", "transpile", "score", "route", "execute"]);
    expect(stages.find((stage) => stage.id === "execute")?.status).toBe("running");
    expect(overlayExecute(undefined, "completed").find((stage) => stage.id === "execute")?.status).toBe("done");
  });
});

describe("console encoding copy + client slimming", () => {
  it("explains the route in plain language", () => {
    expect(whyRouted({
      selectedId: "ionq-aria-1",
      candidates: [
        { backend: { id: "ionq-aria-1", displayName: "IonQ Aria" }, compatible: true, score: 0.82, rejectionReasons: [] },
        { backend: { id: "qci-aer-gpu", displayName: "QCI Aer GPU" }, compatible: true, score: 0.61, rejectionReasons: [] },
        { backend: { id: "ibm-brisbane", displayName: "IBM Brisbane" }, compatible: false, score: 0, rejectionReasons: ["credentials missing"] },
      ],
    })).toBe("IonQ Aria scored 82 vs QCI Aer GPU at 61 among 2 that fit.");
  });

  it("derives a transpile story from before/after metrics", () => {
    expect(stageStory("transpile", "compile fan-out", {
      transpilation: { before: { depth: 4, gates: 10 }, after: { depth: 7, gates: 14 } },
    })).toBe("Depth 4 → 7 · 10 → 14 gates");
  });

  it("strips QASM from list/quote payloads without touching stored bundles", () => {
    const encoding = publicEncoding({
      envelope_id: "aa",
      selected_bundle: { payload: "OPENQASM 2.0;\nqreg q[1];", id: "bb", metrics: { depth: 1 } },
    });
    expect(encoding.selected_bundle && "payload" in encoding.selected_bundle).toBe(false);
    const slim = slimJobForClient({
      id: "job-1",
      source: "OPENQASM 2.0;\nqreg q[8];",
      analysis: { qubits: 8, normalizedQasm2: "OPENQASM 2.0;\nqreg q[8];", transpilation: { qasm: "huge", before: { depth: 1 }, after: { depth: 2 } } },
      route_decision: { encoding: { selected_bundle: { payload: "native-program" } } },
    });
    expect(slim).not.toHaveProperty("source");
    expect(slim.analysis).not.toHaveProperty("normalizedQasm2");
    expect(slim.analysis.transpilation).not.toHaveProperty("qasm");
    expect(slim.analysis.transpilation).toMatchObject({ before: { depth: 1 }, after: { depth: 2 } });
    expect((slim.route_decision as { encoding: { selected_bundle: Record<string, unknown> } }).encoding.selected_bundle).not.toHaveProperty("payload");
  });
});

