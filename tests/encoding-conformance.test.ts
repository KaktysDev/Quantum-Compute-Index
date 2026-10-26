import { afterEach, describe, expect, it, vi } from "vitest";
import { BraketClient } from "@aws-sdk/client-braket";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { buildExecutionEnvelope, decodeProviderResult, encodeForBackend, profileBackend, satisfies } from "@/lib/qrouter/encoding";
import { largestRemainderCounts, resultSetToNormalized } from "@/lib/qrouter/encoding/decode";
import { assertVerificationPolicy, verificationFromTranspile } from "@/lib/qrouter/encoding/bundle";
import { amplitudeV1, angleV1, basisV1, productionRecipes } from "@/lib/qrouter/encoding/recipes";
import { getProviderStatus, qasm2ToQasm3, submitToProvider } from "@/lib/qrouter/execution";
import type { DecodeMap } from "@/lib/qrouter/encoding/types";
import type { TranspilationResult } from "@/lib/qrouter/types";

const HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';
const SOURCE = `${HEADER}qreg q[2];\ncreg c[2];\nx q[0];\nmeasure q[0] -> c[1];\nmeasure q[1] -> c[0];`;
const analysis = analyzeCircuit(SOURCE, "openqasm2");
const backend = { ...BACKENDS.find((item) => item.id === "qci-aer-gpu")!, available: true };
const swapped: DecodeMap = {
  bit_order: "q0_right", result_coordinates: "classical", key_encoding: "binary",
  registers: [{ name: "c", width: 2, offset: 0 }],
  measurement_map: [{ qubit: 0, clbit: 1 }, { qubit: 1, clbit: 0 }], layout: null, result_types: ["counts"],
};
function decoded(raw: Record<string, unknown>, map = swapped) {
  return decodeProviderResult({ backendId: backend.id, raw, expectedShots: 10, decodeMap: map });
}
function counts(raw: Record<string, unknown>, map = swapped) {
  return resultSetToNormalized(decoded(raw, map), 10).counts;
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("result coordinate conformance", () => {
  it("preserves Aer classical assignments instead of applying them twice", () => {
    expect(counts({ counts: { "10": 10 } })).toEqual({ "10": 10 });
    const result = decoded({ counts: { "10": 10 } }, { ...swapped, layout: { logical_to_physical: { 0: 1, 1: 0 }, routing_permutation: [] } });
    expect(result.provenance.layout_applied).toBe(false);
    expect(result.provenance.measurement_map_applied).toBe(false);
  });

  it("maps local logical outcomes exactly once", () => {
    expect(counts({ counts: { "01": 10 }, metadata: { result_coordinates: "logical_qubits" } })).toEqual({ "10": 10 });
  });

  it("applies final physical placement before the classical assignment", () => {
    const map: DecodeMap = { ...swapped, result_coordinates: "physical_qubits", layout: { logical_to_physical: { 0: 1, 1: 0 }, routing_permutation: [] } };
    expect(counts({ counts: { "10": 10 } }, map)).toEqual({ "10": 10 });
    expect(decoded({ counts: { "10": 10 } }, map).provenance.layout_applied).toBe(true);
  });

  it("does not pad a partial classical measurement to the quantum register width", () => {
    const map: DecodeMap = { ...swapped, registers: [{ name: "c", width: 1, offset: 0 }], measurement_map: [{ qubit: 3, clbit: 0 }] };
    expect(counts({ counts: { "1": 10 } }, map)).toEqual({ "1": 10 });
  });

  it("keeps IBM classical registers at their individual widths", () => {
    const map: DecodeMap = { ...swapped, registers: [{ name: "alpha", width: 1, offset: 0 }, { name: "beta", width: 2, offset: 1 }] };
    const result = resultSetToNormalized(decoded({ registers: { alpha: { "1": 10 }, beta: { "01": 10 } } }, map), 10);
    expect(result.metadata.registers).toEqual({ alpha: { "1": 10 }, beta: { "01": 10 } });
  });

  it("expands Braket measured-qubit subsets before logical decoding", () => {
    const map: DecodeMap = { ...swapped, bit_order: "q0_left", result_coordinates: "physical_qubits", measurement_map: [{ qubit: 3, clbit: 1 }, { qubit: 1, clbit: 0 }] };
    expect(counts({ measurementCounts: { "10": 10 }, measuredQubits: [3, 1] }, map)).toEqual({ "10": 10 });
  });

  it("distinguishes decimal key 10 from binary key 10", () => {
    const map: DecodeMap = { ...swapped, registers: [{ name: "c", width: 4, offset: 0 }], measurement_map: [] };
    expect(counts({ counts: { "10": 10 }, metadata: { key_encoding: "decimal" } }, map)).toEqual({ "1010": 10 });
    expect(counts({ counts: { "10": 10 }, metadata: { key_encoding: "binary" } }, map)).toEqual({ "0010": 10 });
  });

  it("labels inferred counts and conserves the requested number of shots", () => {
    const result = decoded({ probabilities: { "00": 1 / 3, "01": 1 / 3, "10": 1 / 3 }, shots: 10 });
    expect(result.provenance.synthetic).toEqual([{ field: "counts", reason: "derived_from_probabilities", method: "largest_remainder" }]);
    expect(Object.values(resultSetToNormalized(result, 10).counts).reduce((a, b) => a + b, 0)).toBe(10);
    expect(() => largestRemainderCounts({ "0": 0.3 }, 10)).toThrow(/normalized/);
  });
});

describe("submitted artifact conformance", () => {
  it("submits the quoted Aer payload even if the analysis source differs", async () => {
    vi.stubEnv("VULTR_SIMULATOR_URL", "https://worker.invalid");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "worker-job" })));
    vi.stubGlobal("fetch", fetcher);
    await submitToProvider(backend.id, analysis, 10, "job", { media_type: "text/qasm2", payload: `${SOURCE}\n// quoted artifact` });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).qasm).toBe(`${SOURCE}\n// quoted artifact`);
  });

  it("consumes exact native bridge payloads instead of regenerating them", async () => {
    vi.stubEnv("QUANDELA_EXECUTION_URL", "https://bridge.invalid");
    vi.stubEnv("QUANDELA_API_KEY", "test-only");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "native-job" })));
    vi.stubGlobal("fetch", fetcher);
    const program = { format: "photonic-dual-rail", marker: "quoted" };
    await submitToProvider("quandela-mosaiq", analysis, 10, "job", { media_type: "application/json", payload: JSON.stringify(program) });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).encoding).toEqual(program);
  });

  it("rejects a changed provider channel before making a request", async () => {
    vi.stubEnv("IONQ_API_KEY", "test-only");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(submitToProvider("ionq-aria-1", analysis, 10, "job", { media_type: "application/vnd.amazon.braket.openqasm+json", payload: "{}" })).rejects.toThrow(/new quote/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("submits the exact Braket action captured by the quote", async () => {
    vi.stubEnv("BRAKET_OUTPUT_BUCKET", "test-bucket");
    const send = vi.spyOn(BraketClient.prototype, "send").mockResolvedValue({ quantumTaskArn: "test-arn" } as never);
    const payload = '{ "braketSchemaHeader": {"name":"braket.ir.openqasm.program","version":"1"}, "source":"quoted program" }';
    await submitToProvider("aws-sv1", analysis, 10, "job", { media_type: "application/vnd.amazon.braket.openqasm+json", payload });
    expect((send.mock.calls[0][0] as { input: { action: string } }).input.action).toBe(payload);
  });

  it("keeps IonQ probabilities as probabilities until labelled count synthesis", async () => {
    vi.stubEnv("IONQ_API_KEY", "test-only");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", shots: 10, metadata: { qrouter_qubits: "2" }, results: { probabilities: { "1": 1 / 3, "2": 1 / 3, "3": 1 / 3 } } })))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    const status = await getProviderStatus("ionq-aria-1", "ionq-job");
    expect(status.result?.counts).toBeUndefined();
    const result = decodeProviderResult({ backendId: "ionq-aria-1", raw: status.result, expectedShots: 10 });
    expect(result.provenance.synthetic[0]?.field).toBe("counts");
  });

  it("renders all operands on every Braket U2 decomposition instruction", () => {
    const qasm = qasm2ToQasm3(`${HEADER}qreg q[1];\nu2(0.2,0.3) q[0];`);
    expect(qasm).toContain("rz(0.3) q[0]; ry(pi/2) q[0]; rz(0.2) q[0];");
  });
});

describe("honest verification and preparation", () => {
  it("reports numerical checks as checked and enforces explicit policy", () => {
    const metric = { qubits: 2, classicalBits: 2, depth: 1, gates: 1, twoQubitGates: 0, operations: { x: 1, measure: 2 } };
    const transpilation: TranspilationResult = { qasm: SOURCE, backendId: backend.id, compiler: "qiskit", optimizationLevel: 0, seedTranspiler: 42, before: metric, after: metric, layout: null, equivalent: true, target: { backendId: backend.id, basisGates: backend.basisGates, connectivity: backend.connectivity }, improvement: { depthPercent: 0, gatePercent: 0 } };
    const report = verificationFromTranspile(transpilation, profileBackend(backend));
    expect(report.status).toBe("checked");
    expect(report.gates_run.find((gate) => gate.gate === "G1")?.status).toBe("checked");
    expect(() => assertVerificationPolicy("unsupported", "checked")).toThrow(/requires checked/);
    expect(() => assertVerificationPolicy("unsupported", "unsupported")).not.toThrow();
    const envelope = structuredClone(buildExecutionEnvelope({ source: SOURCE, format: "openqasm2", shots: 10, routing_mode: "balanced" }));
    envelope.policy.verification.minimum_status = "checked";
    expect(() => encodeForBackend({ envelope, backend, analysis, transpilation: null, quoteBinding: "binding" })).toThrow(/requires checked/);
  });

  it("resolves custom gate requirements without adding an unsupported custom opcode", () => {
    const source = `${HEADER}gate myh a { h a; }\nqreg q[1];\ncreg c[1];\nmyh q[0];\nmeasure q -> c;`;
    const envelope = buildExecutionEnvelope({ source, format: "openqasm2", shots: 10, routing_mode: "balanced" });
    expect(envelope.requirements.instructions.map((item) => item.name)).toEqual(["h", "measure"]);
    expect(satisfies(envelope.requirements, profileBackend(backend)).ok).toBe(true);
  });

  it("refuses false amplitude preparation and invalid stable recipe input", () => {
    expect(() => amplitudeV1.build({ values: [0, 0, 1, 0] })).toThrow(/unavailable/);
    expect(() => amplitudeV1.estimate({ values: [0, 0, 1, 0] })).toThrow(/unavailable/);
    expect(productionRecipes().map((recipe) => recipe.id)).toEqual(["basis/v1", "angle/v1"]);
    expect(() => basisV1.build({ values: [0.5] })).toThrow(/0 or 1/);
    expect(() => angleV1.build({ values: [Number.NaN] })).toThrow(/finite/);
  });
});
