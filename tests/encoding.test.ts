import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { expandDialects } from "@/lib/qrouter/dialects";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { overlayExecute } from "@/lib/qrouter/encoding";
import {
  advertisedCapabilities,
  buildExecutionEnvelope,
  cacheKey,
  cachedTranspile,
  decodeProviderResult,
  encodeForBackend,
  expandedUnitary,
  jcsHash,
  LOWERING_RULES,
  maxUnitaryError,
  nativeProgramFor,
  normalizeBitOrder,
  OP,
  profileBackend,
  publicEncoding,
  buildEncodingPreview,
  encodingTargets,
  quoteOverlayApplies,
  referenceUnitary,
  resetComposeCaches,
  resolveOpId,
  satisfies,
  selectedBundleForBackend,
  slimJobForClient,
  slimJobForList,
  slimJobForOwner,
  stageStory,
  whyRouted,
} from "@/lib/qrouter/encoding";
import { qasm2ToIonqCircuit, ionqMeasurementMap, qasm2ToQasm3 } from "@/lib/qrouter/execution";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import * as providerTargets from "@/lib/qrouter/providerTargets";
import { simulateCircuit } from "@/lib/qrouter/simulator";
import * as transpiler from "@/lib/qrouter/transpiler";
import { assertTargetAllowedV2 } from "@/lib/qrouter/scopes";
import { V2ApiError } from "@/lib/qrouter/v2-http";
import { createCircuitResource, createExecutionGroup } from "@/lib/qrouter/v2-service";
import type { Backend, TranspilationResult } from "@/lib/qrouter/types";
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

  it("reuses envelope identity for the same source and not for different programs", () => {
    const first = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 128, routing_mode: "balanced" });
    const second = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 128, routing_mode: "balanced" });
    expect(second).toBe(first);
    expect(second.id).toBe(first.id);
    const otherShots = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 256, routing_mode: "balanced" });
    expect(otherShots.id).not.toBe(first.id);
    const otherSource = buildExecutionEnvelope({
      source: `${HEADER}qreg q[1];\ncreg c[1];\nx q[0];\nmeasure q -> c;`,
      format: "openqasm2",
      shots: 128,
      routing_mode: "balanced",
    });
    expect(otherSource.id).not.toBe(first.id);
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

  it("keeps capability fingerprints stable across fetches", () => {
    const first = profileBackend(catalog("qci-aer-gpu"));
    const second = profileBackend(catalog("qci-aer-gpu"));
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(second).toBe(first);
  });

  it("reuses a native providerProgram instead of re-encoding", () => {
    const qi = catalog("qi-starmon-5");
    const analysis = analyzeCircuit(BELL, "openqasm2");
    const program = nativeProgramFor(qi, analysis.normalizedQasm2);
    const envelope = buildExecutionEnvelope({ source: BELL, format: "openqasm2", shots: 32, routing_mode: "balanced" });
    const bundle = encodeForBackend({
      envelope,
      backend: qi,
      analysis,
      transpilation: { qasm: analysis.normalizedQasm2, providerProgram: JSON.stringify(program) } as never,
      quoteBinding: "binding",
    });
    expect(bundle.payload).toBe(program.format === "cqasm-1.0" ? program.source : JSON.stringify(program));
  });

  it("prepares Aer together with an encoder-backed failover without serializing compiles", async () => {
    const prepared = await prepareExecution({
      backends: [catalog("qci-aer-gpu"), catalog("qi-starmon-5")],
      analysis: analyzeCircuit(BELL, "openqasm2"),
      shots: 32,
      target: "auto",
      mode: "balanced",
      source: BELL,
      format: "openqasm2",
    });
    expect(prepared.bundles.length).toBeGreaterThanOrEqual(1);
    expect(prepared.encoding.compiled.length).toBeGreaterThanOrEqual(1);
    expect(prepared.decision.selected.id).toMatch(/qci-aer-gpu|qi-starmon-5/);
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
    expect(second.envelope.provenance.source_sha256).toBe(first.envelope.provenance.source_sha256);
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
    const created = await createCircuitResource(principal, { name: undefined, circuit: BELL, format: "openqasm2" }, crypto.randomUUID());
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
    expect(encoding.selected_bundle).toMatchObject({ payload_bytes: new TextEncoder().encode("OPENQASM 2.0;\nqreg q[1];").length });
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
    const owner = slimJobForOwner({
      id: "job-owner",
      source: "OPENQASM 2.0;\nqreg q[1];",
      analysis: { qubits: 1, normalizedQasm2: "secret", encoding: { selected_bundle: { payload: "native", backend_id: "ibm-brisbane" } } },
      route_decision: { encoding: { selected_bundle: { payload: "native", backend_id: "ibm-brisbane" } } },
    });
    expect(owner.source).toBe("OPENQASM 2.0;\nqreg q[1];");
    expect(owner.analysis).not.toHaveProperty("normalizedQasm2");
    expect((owner.route_decision as { encoding: { selected_bundle: Record<string, unknown> } }).encoding.selected_bundle).not.toHaveProperty("payload");
    expect((owner.route_decision as { encoding: { selected_bundle: Record<string, unknown> } }).encoding.selected_bundle.backend_id).toBe("ibm-brisbane");
  });

  it("refuses a primary encoding bundle when dispatching a different backend", () => {
    const encoding = {
      selected_bundle: {
        id: "primary",
        backend_id: "ibm-brisbane",
        media_type: "application/qpy",
        payload: "ibm-qpy",
        bit_order: "q0_right" as const,
        verification: "checked" as const,
        quote_binding: "binding" as const,
        metrics: { qubits: 2, depth: 3, ops: {}, two_qubit_ops: 1 },
        decode_map: { bit_order: "q0_right" as const, registers: [], measurement_map: [], layout: null, result_types: [] as string[] },
      },
    };
    expect(selectedBundleForBackend(encoding as never, "ibm-brisbane")?.payload).toBe("ibm-qpy");
    expect(selectedBundleForBackend(encoding as never, "ionq-aria-1")).toBeUndefined();
    expect(selectedBundleForBackend({ selected_bundle: { payload: "legacy" } } as never, "ionq-aria-1")).toBeUndefined();
  });

  it("does not reuse a capability profile when the coupling map changes", () => {
    const base = catalog("iqm-garnet");
    const first = profileBackend({ ...base, couplingMap: [[0, 1], [1, 2], [2, 3]] });
    const second = profileBackend({ ...base, couplingMap: [[0, 1], [1, 3], [2, 3]] });
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("keeps compile-cache keys from colliding across verify flags or colon-bearing fields", () => {
    expect(cacheKey("sha", "a:b", "c", 2, 42, true)).not.toBe(cacheKey("sha", "a", "b:c", 2, 42, true));
    expect(cacheKey("sha", "ibm", "fp", 2, 42, true)).not.toBe(cacheKey("sha", "ibm", "fp", 2, 42, false));
  });

  it("keeps Activity-list rows to table columns", () => {
    const row = slimJobForList({
      id: "job-2",
      name: "Bell",
      status: "queued",
      selected_backend_id: "qci-aer-gpu",
      shots: 1024,
      created_at: "2026-09-13T00:00:00.000Z",
      updated_at: "2026-09-13T00:00:01.000Z",
      started_at: null,
      completed_at: null,
      quotes: [{ total: 0.01 }],
      source: "OPENQASM 2.0;",
      analysis: { qubits: 2, depth: 4, complexity: "trivial", encoding: { envelope_id: "keep-off-list" } },
      route_decision: { selected: { id: "qci-aer-gpu" }, encoding: { envelope_id: "keep-off-list" } },
      result: { counts: { "00": 512 } },
      error: { message: "no" },
    });
    expect(row).toMatchObject({
      id: "job-2",
      name: "Bell",
      status: "queued",
      selected_backend_id: "qci-aer-gpu",
      shots: 1024,
      analysis: { qubits: 2, depth: 4, complexity: "trivial" },
    });
    expect(row).not.toHaveProperty("source");
    expect(row).not.toHaveProperty("route_decision");
    expect(row).not.toHaveProperty("result");
    expect(row).not.toHaveProperty("error");
    expect(row.analysis).not.toHaveProperty("encoding");
  });

  it("strips providerResult and secrets from owner-visible results", () => {
    const owner = slimJobForOwner({
      id: "job-result",
      source: "OPENQASM 2.0;\nqreg q[1];",
      result: {
        counts: { "0": 10 },
        metadata: { providerResult: { raw: "OPENQASM 2.0;" }, bit_order: "q0_right" },
      },
      error: { message: "Bearer sk-secret failed", stack: "IBM_QUANTUM_TOKEN=abc" },
    });
    expect(owner.source).toBe("OPENQASM 2.0;\nqreg q[1];");
    expect(owner.result).toEqual({ counts: { "0": 10 }, metadata: { bit_order: "q0_right" } });
    expect(JSON.stringify(owner.result)).not.toContain("providerResult");
    expect(owner.error).toEqual({ message: "Bearer [redacted] failed" });
    expect(owner.error).not.toHaveProperty("stack");
  });
});

function fakeTranspile(backend: Backend, qasm: string): TranspilationResult {
  const metrics = { qubits: 2, classicalBits: 2, depth: 3, gates: 3, twoQubitGates: 1, operations: { h: 1, cx: 1, measure: 2 } };
  return {
    qasm,
    backendId: backend.id,
    compiler: "local",
    optimizationLevel: 2,
    seedTranspiler: 42,
    before: metrics,
    after: metrics,
    layout: null,
    equivalent: true,
    improvement: { depthPercent: 0, gatePercent: 0 },
    target: { backendId: backend.id, basisGates: backend.basisGates, connectivity: backend.connectivity },
  };
}

describe("compile cache isolation", () => {
  afterEach(() => {
    resetComposeCaches();
    vi.restoreAllMocks();
  });

  it("does not serve an unverified compile as a verified one, and retries after a failed coalesce", async () => {
    const verified = fakeTranspile(catalog("qci-aer-gpu"), "verified");
    const unverified = fakeTranspile(catalog("qci-aer-gpu"), "unverified");
    const v = cacheKey("sha", "qci-aer-gpu", "fp", 2, 42, true);
    const nv = cacheKey("sha", "qci-aer-gpu", "fp", 2, 42, false);
    let computes = 0;
    await expect(cachedTranspile(v, async () => {
      computes += 1;
      throw new Error("compiler down");
    })).rejects.toThrow("compiler down");
    const [left, right] = await Promise.all([
      cachedTranspile(nv, async () => {
        computes += 1;
        return unverified;
      }),
      cachedTranspile(nv, async () => {
        computes += 1;
        return unverified;
      }),
    ]);
    const checked = await cachedTranspile(v, async () => {
      computes += 1;
      return verified;
    });
    expect(left).toBe(right);
    expect(left.qasm).toBe("unverified");
    expect(checked.qasm).toBe("verified");
    expect(computes).toBe(3);
  });

  it("does not reuse a compile after the resolved coupling map changes", async () => {
    const backend = catalog("iqm-garnet", true);
    const mapA = { ...backend, connectivity: "custom" as const, couplingMap: [[0, 1], [1, 2]] };
    const mapB = { ...backend, connectivity: "custom" as const, couplingMap: [[0, 1], [1, 3]] };
    vi.spyOn(providerTargets, "resolveProviderTarget")
      .mockResolvedValueOnce(mapA)
      .mockResolvedValueOnce(mapB);
    vi.spyOn(transpiler, "transpileForBackend").mockImplementation(async (target) => (
      fakeTranspile(target, `MAP:${JSON.stringify(target.couplingMap)}`)
    ));

    const input = {
      backends: [backend],
      analysis: analyzeCircuit(BELL, "openqasm2"),
      shots: 32,
      target: "iqm-garnet" as const,
      mode: "balanced" as const,
      source: BELL,
      format: "openqasm2" as const,
    };
    const first = await prepareExecution(input);
    const second = await prepareExecution(input);
    expect(first.transpilation.qasm).toBe("MAP:[[0,1],[1,2]]");
    expect(second.transpilation.qasm).toBe("MAP:[[0,1],[1,3]]");
  });
});

describe("encoding preview plan", () => {
  it("covers every catalog backend with a named encoder", () => {
    const targets = encodingTargets();
    expect(targets.map((item) => item.id).sort()).toEqual(BACKENDS.map((item) => item.id).sort());
    expect(targets.every((item) => item.encodingLabel && item.modality)).toBe(true);
  });

  it("stays pending until a backend is chosen", () => {
    const plan = buildEncodingPreview({ shots: 1024, targetId: "auto", phase: "quoting" });
    expect(plan.encodingId).toBe("pending-route");
    expect(plan.source).toBe("pending");
    expect(plan.headline).toMatch(/scoring backends/i);
    expect(plan.resources.find((item) => item.key === "shots")?.value).toBe("1,024");
  });

  it("updates encoder, modality, and warnings when the backend changes", () => {
    const ibm = buildEncodingPreview({ targetId: "ibm-brisbane", shots: 512, qubits: 5, format: "openqasm2" });
    expect(ibm.encodingId).toBe("ibm-isa");
    expect(ibm.modality).toBe("superconducting");
    expect(ibm.transform).toMatch(/ISA/i);

    const ionq = buildEncodingPreview({ targetId: "ionq-aria-1", shots: 512, qubits: 5 });
    expect(ionq.encodingId).toBe("ionq-qis");
    expect(ionq.modality).toBe("trapped-ion");
    expect(ionq.transform).toMatch(/measurement/i);

    const photonic = buildEncodingPreview({ targetId: "xanadu-borealis", shots: 512, qubits: 4 });
    expect(photonic.encodingId).toBe("photonic-dual-rail");
    expect(photonic.modality).toBe("photonic");
    expect(photonic.resources.find((item) => item.key === "modes")?.value).toBe("8");
    expect(photonic.warnings.some((item) => /8 optical modes/.test(item))).toBe(true);

    const cqasm = buildEncodingPreview({ targetId: "qi-starmon-5", shots: 128, qubits: 2 });
    expect(cqasm.encodingId).toBe("cqasm-1.0");
    expect(cqasm.formatLabel).toBe("cQASM 1.0");
  });

  it("flags oversized and large-shot jobs", () => {
    const overflow = buildEncodingPreview({ targetId: "qi-starmon-5", qubits: 12, shots: 8 });
    expect(overflow.warnings.some((item) => /exceed/i.test(item))).toBe(true);
    const heavy = buildEncodingPreview({ targetId: "qci-aer-gpu", qubits: 24, shots: 250_000 });
    expect(heavy.warnings.some((item) => /2ⁿ/.test(item))).toBe(true);
    expect(heavy.warnings.some((item) => /250,000/.test(item))).toBe(true);
  });

  it("ignores a stale encoding trace when the target changes", () => {
    const plan = buildEncodingPreview({
      targetId: "ionq-aria-1",
      selectedId: "ibm-brisbane",
      shots: 1024,
      encoding: {
        schema_version: "qee/1",
        envelope_id: "env",
        workload_kind: "gate",
        frontend: { name: "qee", version: "1" },
        stages: [],
        requirements: { qubits: 2, clbits: 2, instructions: ["h", "cx"], control_flow: [], mid_circuit_measurement: false, feedback: false },
        selected_bundle: {
          id: "b",
          backend_id: "ibm-brisbane",
          media_type: "application/qpy",
          payload_bytes: 2048,
          bit_order: "q0_right",
          verification: "checked",
          quote_binding: "binding",
          metrics: { qubits: 2, depth: 3, ops: { h: 1, cx: 1 }, two_qubit_ops: 1 },
          decode_map: { bit_order: "q0_right", registers: [], measurement_map: [], layout: null, result_types: [] },
        },
        compiled: [],
      },
    });
    expect(plan.encodingId).toBe("ionq-qis");
    expect(plan.source).toBe("catalog");
    expect(plan.warnings.some((item) => /different backend/.test(item))).toBe(true);
    expect(plan.resources.find((item) => item.key === "payload")?.value).toBe("—");
  });

  it("overlays compiled resources from a matching trace", () => {
    const plan = buildEncodingPreview({
      targetId: "qci-aer-gpu",
      shots: 4096,
      encoding: {
        schema_version: "qee/1",
        envelope_id: "env",
        workload_kind: "gate",
        frontend: { name: "qee", version: "1" },
        stages: [],
        requirements: { qubits: 2, clbits: 2, instructions: ["h"], control_flow: [], mid_circuit_measurement: false, feedback: false },
        selected_bundle: {
          id: "b",
          backend_id: "qci-aer-gpu",
          media_type: "text/qasm2",
          payload_bytes: 80,
          bit_order: "q0_right",
          verification: "checked",
          quote_binding: "binding",
          metrics: { qubits: 2, depth: 2, ops: { h: 1, cx: 1 }, two_qubit_ops: 1 },
          decode_map: {
            bit_order: "q0_right",
            registers: [{ name: "c", width: 2, offset: 0 }],
            measurement_map: [{ qubit: 0, clbit: 0 }, { qubit: 1, clbit: 1 }],
            layout: null,
            result_types: ["counts"],
          },
        },
        compiled: [],
      },
    });
    expect(plan.source).toBe("trace");
    expect(plan.resources.find((item) => item.key === "payload")?.value).toBe("80 B");
    expect(plan.resources.find((item) => item.key === "shots")?.value).toBe("4,096");
    expect(plan.mappings.some((item) => item.label === "Measurements" && item.detail.includes("2"))).toBe(true);
  });

  it("surfaces compute-type pins and mismatches", () => {
    const pending = buildEncodingPreview({ targetId: "auto", kind: "qpu", phase: "quoting" });
    expect(pending.parameters.find((item) => item.name === "Compute type")?.value).toBe("Physical QPU");
    expect(pending.parameters.find((item) => item.name === "Backend")?.effect).toMatch(/physical qpu/i);

    const mismatch = buildEncodingPreview({ targetId: "qci-aer-gpu", kind: "qpu", qubits: 2, shots: 8 });
    expect(mismatch.warnings.some((item) => /pinned to qpu/.test(item))).toBe(true);
    expect(mismatch.parameters.find((item) => item.name === "Compute type")?.effect).toMatch(/conflicts/);

    const sim = buildEncodingPreview({ targetId: "qci-aer-gpu", kind: "simulator", qubits: 2, shots: 8 });
    expect(sim.parameters.find((item) => item.name === "Compute type")?.value).toBe("Simulator");
    expect(sim.warnings.some((item) => /pinned to/.test(item))).toBe(false);
  });

  it("only overlays a quote for the target it was fetched for", () => {
    expect(quoteOverlayApplies("ibm-brisbane", "ibm-brisbane")).toBe(true);
    expect(quoteOverlayApplies("ibm-brisbane", "ionq-aria-1")).toBe(false);
    expect(quoteOverlayApplies("ibm-brisbane", "auto")).toBe(false);
    expect(quoteOverlayApplies(null, "auto")).toBe(false);
    expect(quoteOverlayApplies(undefined, "qci-aer-gpu")).toBe(false);
  });
});

