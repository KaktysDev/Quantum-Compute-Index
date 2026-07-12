import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCircuit, CircuitValidationError } from "@/lib/qrouter/analyze";
import { BACKENDS, withQciSnapshot } from "@/lib/qrouter/catalog";
import { buildQuote, routeCircuit } from "@/lib/qrouter/route";
import { simulateCircuit } from "@/lib/qrouter/simulator";
import { getProviderStatus, submitToProvider } from "@/lib/qrouter/execution";
import { transpileForBackend, TranspilerUnavailableError } from "@/lib/qrouter/transpiler";

const bell = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

describe("QRouter circuit pipeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.IONQ_API_KEY;
    delete process.env.QROUTER_COMPILER_URL;
    delete process.env.VULTR_SIMULATOR_URL;
  });

  it("analyzes a Bell circuit", () => {
    const analysis = analyzeCircuit(bell, "openqasm2");
    expect(analysis).toMatchObject({ qubits: 2, classicalBits: 2, gates: 2, twoQubitGates: 1, complexity: "light" });
  });

  it("normalizes the supported OpenQASM 3 subset", () => {
    const analysis = analyzeCircuit("OPENQASM 3.0; include \"stdgates.inc\"; qubit[2] q; bit[2] c; h q[0]; cnot q[0],q[1]; c = measure q;", "openqasm3");
    expect(analysis.normalizedQasm2).toContain("qreg q[2]");
    expect(analysis.twoQubitGates).toBe(1);
  });

  it("rejects non-QASM input", () => {
    expect(() => analyzeCircuit("not qasm", "openqasm2")).toThrow(CircuitValidationError);
  });

  it("routes through the live QCI quote model", () => {
    const analysis = analyzeCircuit(bell, "openqasm2");
    const decision = routeCircuit({ backends: BACKENDS, analysis, shots: 1024, target: "auto", mode: "balanced", qciSnapshotId: 42, qciTimestamp: "2026-07-11T00:00:00Z" });
    expect(decision.selected.id).toBe("qci-aer-gpu");
    const quote = buildQuote(decision, analysis, 1024);
    expect(quote.total).toBeGreaterThan(0);
    expect(quote.rateSnapshot.qciSnapshotId).toBe(42);
  });

  it("does not let pricing snapshots overwrite physical qubit limits", () => {
    const backends = withQciSnapshot([{ provider: "IonQ", capacity: 999, clops: 123, queueSeconds: 1, fid2q: 0.9, pricePerNqh: 10, status: "live" } as never]);
    expect(backends.find((backend) => backend.id === "ionq-aria-1")).toMatchObject({ qubits: 25, clops: 123 });
  });

  it("produces correlated Bell measurements", async () => {
    const result = await simulateCircuit(analyzeCircuit(bell, "openqasm2"), 512);
    expect(Object.keys(result.counts).every((state) => state === "00" || state === "11")).toBe(true);
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(512);
  });

  it("optimizes simulator circuits without a remote compiler", async () => {
    const backend = BACKENDS.find((candidate) => candidate.id === "qci-aer-gpu")!;
    const result = await transpileForBackend(backend, analyzeCircuit(bell, "openqasm2"), { optimizationLevel: 3 });
    expect(result).toMatchObject({ backendId: "qci-aer-gpu", compiler: "local", optimizationLevel: 3 });
    expect(result.qasm).toContain("OPENQASM 2.0");
  });

  it("refuses physical execution when the hardware compiler is unavailable", async () => {
    const backend = BACKENDS.find((candidate) => candidate.id === "ionq-aria-1")!;
    await expect(transpileForBackend(backend, analyzeCircuit(bell, "openqasm2"))).rejects.toBeInstanceOf(TranspilerUnavailableError);
  });

  it("serializes a compiled circuit to the IonQ v0.4 QIS contract", async () => {
    process.env.IONQ_API_KEY = "test-token";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "ionq-job" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const analysis = analyzeCircuit(bell, "openqasm2");
    await expect(submitToProvider("ionq-aria-1", analysis, 500, "job-123")).resolves.toMatchObject({ providerJobId: "ionq-job" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.ionq.co/v0.4/jobs");
    expect(init.headers).toMatchObject({ authorization: "apiKey test-token" });
    expect(body).toMatchObject({ type: "ionq.circuit.v1", shots: 500, metadata: { qrouter_qubits: "2" }, input: { qubits: 2, gateset: "qis" } });
    expect(body.input.circuit.map((gate: { gate: string }) => gate.gate)).toEqual(["h", "cnot"]);
  });

  it("normalizes IonQ integer result states to fixed-width bitstrings", async () => {
    process.env.IONQ_API_KEY = "test-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "completed", shots: 100, metadata: { qrouter_qubits: "3" }, results: { probabilities: { url: "/results" } } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ "0": 0.4, "7": 0.6 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cost: 0.25 })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getProviderStatus("ionq-aria-1", "ionq-job")).resolves.toMatchObject({
      status: "completed",
      actualProviderCost: 0.25,
      result: { probabilities: { "000": 0.4, "111": 0.6 }, counts: { "000": 40, "111": 60 } },
    });
  });
});
