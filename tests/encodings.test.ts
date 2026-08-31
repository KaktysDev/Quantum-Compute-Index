import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { BACKENDS } from "@/lib/qrouter/catalog";
import {
  EncodingError,
  adapterFor,
  buildExecutionEnvelope,
  encodeForBackend,
  nativeProgramFor,
  qasm2ToCqasm,
  qasm2ToPhotonicProgram,
} from "@/lib/qrouter/encoding";
import { getProviderStatus, submitToProvider } from "@/lib/qrouter/execution";
import { prepareExecution } from "@/lib/qrouter/pipeline";
import { resolveProviderTarget } from "@/lib/qrouter/providerTargets";
import { resolveProviderLabel, ROUTABLE_PROVIDERS } from "@/lib/qrouter/providers";
import { routeCircuit } from "@/lib/qrouter/route";
import { transpileForBackend, TranspilerUnavailableError } from "@/lib/qrouter/transpiler";
import type { Backend } from "@/lib/qrouter/types";

const HEADER = 'OPENQASM 2.0;\ninclude "qelib1.inc";\n';
const BELL = `${HEADER}qreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`;
const analysis = analyzeCircuit(BELL, "openqasm2");

function catalogBackend(id: string, available = true): Backend {
  const backend = BACKENDS.find((item) => item.id === id);
  if (!backend) throw new Error(`Missing catalog backend ${id}`);
  return { ...backend, available };
}

function withAvailable(ids: string[]) {
  return BACKENDS.map((backend) => ({ ...backend, available: ids.includes(backend.id) || backend.id === "qci-aer-gpu" }));
}

describe("native program encoders", () => {
  it("translates a Bell circuit to cQASM 1.0", () => {
    const cqasm = qasm2ToCqasm(analysis.normalizedQasm2);
    expect(cqasm).toMatch(/^version 1\.0\nqubits 2\n/m);
    expect(cqasm).toContain("H q[0]");
    expect(cqasm).toContain("CNOT q[0], q[1]");
    expect(cqasm).toContain("Measure_z q[0]");
    expect(cqasm).toContain("Measure_z q[1]");
  });

  it("emits Rx/Ry/Rz with the cQASM operand order", () => {
    const source = `${HEADER}qreg q[1];\nrx(pi/2) q[0];\nry(-0.4) q[0];\nrz(1.25) q[0];`;
    const cqasm = qasm2ToCqasm(source);
    expect(cqasm).toMatch(/Rx q\[0], 1\.57079632679/);
    expect(cqasm).toContain("Ry q[0], -0.4");
    expect(cqasm).toContain("Rz q[0], 1.25");
  });

  it("flattens multi-register cQASM wires", () => {
    const cqasm = qasm2ToCqasm(`${HEADER}qreg a[1];\nqreg b[2];\nh a[0];\ncz a[0],b[1];`);
    expect(cqasm).toContain("qubits 3");
    expect(cqasm).toContain("H q[0]");
    expect(cqasm).toContain("CZ q[0], q[2]");
  });

  it("fails closed on classically-controlled gates", () => {
    expect(() => qasm2ToCqasm(`${HEADER}qreg q[1];\ncreg c[1];\nif(c==1) x q[0];`)).toThrow(EncodingError);
  });

  it("encodes a Bell circuit as dual-rail photonic IR", () => {
    const program = qasm2ToPhotonicProgram(analysis.normalizedQasm2, "quandela-perceval");
    expect(program).toMatchObject({ format: "photonic-dual-rail", version: 1, qubits: 2, modes: 4 });
    expect(program.mapping).toEqual([[0, 1], [2, 3]]);
    expect(program.operations.some((operation) => operation.op === "beamsplitter" && operation.modes[0] === 0)).toBe(true);
    expect(program.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "cnot", control: 0, target: 1 }),
    ]));
    const perceval = JSON.parse(program.source) as { components: Array<{ type: string }> };
    expect(perceval.components.map((item) => item.type)).toContain("POSTPROCESSED_CNOT");
  });

  it("renders Xanadu Blackbird for single-qubit dual-rail ops and leaves CNOT as a logical marker", () => {
    const program = qasm2ToPhotonicProgram(analysis.normalizedQasm2, "xanadu-blackbird");
    expect(program.source).toContain("BSgate(");
    expect(program.source).toContain("# qrouter.logical cnot 0 1");
    expect(program.source).toContain("MeasureFock()");
  });

  it("fails hard on Toffoli for photonic backends instead of dropping it", () => {
    const source = `${HEADER}qreg q[3];\nccx q[0],q[1],q[2];`;
    expect(() => qasm2ToPhotonicProgram(source, "quandela-perceval")).toThrow(/not supported/i);
    expect(() => qasm2ToCqasm(source)).not.toThrow();
    expect(qasm2ToCqasm(source)).toContain("Toffoli q[0], q[1], q[2]");
  });
});

describe("route + compile + submit for every catalog family", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.QI_API_KEY;
    delete process.env.QI_EXECUTION_URL;
    delete process.env.XANADU_EXECUTION_URL;
    delete process.env.XANADU_API_KEY;
    delete process.env.QUANDELA_EXECUTION_URL;
    delete process.env.QUANDELA_API_KEY;
    delete process.env.QROUTER_COMPILER_URL;
    delete process.env.VULTR_SIMULATOR_URL;
  });

  it("lists every catalog provider as a routing-diagram target", () => {
    expect(ROUTABLE_PROVIDERS).toEqual([
      "QCI Simulator", "AWS Braket", "IBM Quantum", "IonQ", "Xanadu", "Quandela", "Quantum Inspire",
    ]);
    expect(resolveProviderLabel("quantum inspire")).toBe("Quantum Inspire");
  });

  it.each([
    ["qi-starmon-5", "quantum-inspire"],
    ["xanadu-borealis", "xanadu"],
    ["quandela-mosaiq", "quandela"],
  ] as const)("routes a Bell circuit to %s when the backend is configured", (id, _provider) => {
    const decision = routeCircuit({
      analysis, shots: 128, target: id, mode: "balanced",
      backends: withAvailable([id]),
    });
    expect(decision.selected.id).toBe(id);
    expect(decision.candidates.find((candidate) => candidate.backend.id === id)?.compatible).toBe(true);
  });

  it("resolves QI and photonic targets without a live Braket/IBM adapter", async () => {
    await expect(resolveProviderTarget(catalogBackend("qi-starmon-5"))).resolves.toMatchObject({
      id: "qi-starmon-5",
      connectivity: "custom",
      couplingMap: expect.arrayContaining([[2, 0]]),
    });
    await expect(resolveProviderTarget(catalogBackend("xanadu-borealis"))).resolves.toMatchObject({
      id: "xanadu-borealis",
      connectivity: "all-to-all",
    });
    await expect(resolveProviderTarget(catalogBackend("quandela-mosaiq"))).resolves.toMatchObject({
      id: "quandela-mosaiq",
      connectivity: "all-to-all",
    });
  });

  it("compiles encoder-backed QPUs locally when the Qiskit worker is absent", async () => {
    delete process.env.QROUTER_COMPILER_URL;
    delete process.env.VULTR_SIMULATOR_URL;
    const qi = await transpileForBackend(catalogBackend("qi-starmon-5"), analysis, { optimizationLevel: 1 });
    expect(qi.compiler).toBe("local");
    expect(qi.providerProgram).toContain("version 1.0");
    expect(qi.providerProgram).toContain("CNOT");
    const photonic = await transpileForBackend(catalogBackend("xanadu-borealis"), analysis, { optimizationLevel: 1 });
    expect(photonic.compiler).toBe("local");
    expect(photonic.providerProgram).toContain("photonic-dual-rail");
    await expect(transpileForBackend(catalogBackend("ionq-aria-1"), analysis)).rejects.toBeInstanceOf(TranspilerUnavailableError);
  });

  it("runs prepareExecution for every encoder-backed family", async () => {
    for (const id of ["qi-starmon-5", "xanadu-borealis", "quandela-mosaiq"]) {
      const prepared = await prepareExecution({
        backends: withAvailable([id]),
        analysis,
        shots: 64,
        target: id,
        mode: "balanced",
      });
      expect(prepared.decision.selected.id).toBe(id);
      expect(prepared.quote.total).toBeGreaterThan(0);
      expect(prepared.transpilation.backendId).toBe(id);
      const program = nativeProgramFor(prepared.decision.selected, prepared.executionAnalysis.normalizedQasm2);
      const bundle = prepared.bundles[0];
      if (id === "qi-starmon-5") {
        expect(program.format).toBe("cqasm-1.0");
        expect(bundle.media_type).toBe("text/cqasm");
        expect(bundle.payload).toContain("CNOT");
      } else {
        expect(program.format).toBe("photonic-dual-rail");
        expect(bundle.media_type).toBe("application/json");
        expect(JSON.parse(bundle.payload)).toMatchObject({ format: "photonic-dual-rail" });
      }
    }
  });

  it("submits QI through the execution bridge when one is configured", async () => {
    process.env.QI_EXECUTION_URL = "https://qi-bridge.example.com/";
    process.env.QI_API_KEY = "qi-token";
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "qi-job-1" }, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitToProvider("qi-starmon-5", analysis, 32, "job-qi-1")).resolves.toMatchObject({
      providerJobId: "qi-job-1",
      status: "submitted",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://qi-bridge.example.com/v1/jobs");
    expect(init.headers).toMatchObject({ authorization: "Bearer qi-token", "idempotency-key": "job-qi-1" });
    const body = JSON.parse(String(init.body)) as { encoding: { format: string; source: string }; backend_id: string };
    expect(body.backend_id).toBe("qi-starmon-5");
    expect(body.encoding.format).toBe("cqasm-1.0");
    expect(body.encoding.source).toContain("H q[0]");
  });

  it("submits QI through the Quantum Inspire REST API when no bridge URL is set", async () => {
    process.env.QI_API_KEY = "qi-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json([{ name: "Starmon-5", url: "https://api.quantum-inspire.com/backendtypes/1/" }]))
      .mockResolvedValueOnce(Response.json({ url: "https://api.quantum-inspire.com/projects/9/" }))
      .mockResolvedValueOnce(Response.json({ url: "https://api.quantum-inspire.com/assets/8/" }))
      .mockResolvedValueOnce(Response.json({ id: 77, url: "https://api.quantum-inspire.com/jobs/77/" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(submitToProvider("qi-starmon-5", analysis, 16, "job-direct")).resolves.toMatchObject({
      providerJobId: "77",
      status: "submitted",
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/backendtypes/");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: "Token qi-token" });
    const jobBody = JSON.parse(String((fetchMock.mock.calls[3][1] as RequestInit).body));
    expect(jobBody).toMatchObject({ name: "job-direct", number_of_shots: 16, input: "https://api.quantum-inspire.com/assets/8/" });
  });

  it("polls a completed QI job and reads the histogram", async () => {
    process.env.QI_API_KEY = "qi-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "COMPLETE", results: "https://api.quantum-inspire.com/results/5/" }))
      .mockResolvedValueOnce(Response.json({ histogram: { "0": 0.5, "3": 0.5 }, histogram_qubit_count: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getProviderStatus("qi-starmon-5", "77")).resolves.toMatchObject({
      status: "completed",
      result: { probabilities: { "0": 0.5, "3": 0.5 } },
    });
  });

  it("submits photonic jobs with a dual-rail encoding payload", async () => {
    process.env.XANADU_EXECUTION_URL = "https://xanadu-bridge.example.com";
    process.env.XANADU_API_KEY = "xanadu-token";
    process.env.QUANDELA_EXECUTION_URL = "https://quandela-bridge.example.com";
    process.env.QUANDELA_API_KEY = "quandela-token";
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ id: "bridge-job" }, { status: 202 })));
    vi.stubGlobal("fetch", fetchMock);

    await submitToProvider("xanadu-borealis", analysis, 8, "job-xanadu");
    await submitToProvider("quandela-mosaiq", analysis, 8, "job-quandela");

    const xanadu = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const quandela = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(fetchMock.mock.calls[0][0]).toBe("https://xanadu-bridge.example.com/v1/jobs");
    expect(xanadu.encoding).toMatchObject({ format: "photonic-dual-rail", dialect: "xanadu-blackbird", qubits: 2, modes: 4 });
    expect(xanadu.encoding.source).toContain("BSgate(");
    expect(quandela.encoding.dialect).toBe("quandela-perceval");
    expect(JSON.parse(quandela.encoding.source).components.map((item: { type: string }) => item.type)).toContain("POSTPROCESSED_CNOT");
  });
});

describe("catalog adapter coverage", () => {
  const MEDIA: Record<string, string> = {
    "qci-aer-gpu": "text/qasm2",
    "aws-sv1": "text/qasm3",
    "ibm-brisbane": "text/qasm3",
    "ionq-aria-1": "application/json",
    "rigetti-ankaa-3": "text/qasm3",
    "iqm-garnet": "text/qasm3",
    "xanadu-borealis": "application/json",
    "quandela-mosaiq": "application/json",
    "qi-starmon-5": "text/cqasm",
  };

  it("has an encoding adapter for every catalog backend", () => {
    expect(BACKENDS.map((backend) => backend.id).sort()).toEqual(Object.keys(MEDIA).sort());
    for (const backend of BACKENDS) {
      expect(adapterFor(backend).name).toBeTruthy();
    }
  });

  it("encodes a Bell circuit for every catalog family", () => {
    const envelope = buildExecutionEnvelope({
      source: BELL, format: "openqasm2", shots: 32, routing_mode: "balanced",
    });
    for (const backend of BACKENDS) {
      const bundle = encodeForBackend({
        envelope,
        backend: { ...backend, available: true },
        analysis,
        transpilation: null,
        quoteBinding: "binding",
      });
      expect(bundle.backend_id).toBe(backend.id);
      expect(bundle.media_type).toBe(MEDIA[backend.id]);
      expect(bundle.payload.length).toBeGreaterThan(0);
      if (backend.provider === "xanadu" || backend.provider === "quandela") {
        expect(JSON.parse(bundle.payload)).toMatchObject({ format: "photonic-dual-rail", qubits: 2, modes: 4 });
      }
      if (backend.provider === "quantum-inspire") {
        expect(bundle.payload).toMatch(/^version 1\.0\nqubits 2\n/m);
        expect(bundle.payload).toContain("CNOT q[0], q[1]");
      }
    }
  });

  it("runs prepareExecution for the local Aer simulator", async () => {
    const prepared = await prepareExecution({
      backends: withAvailable(["qci-aer-gpu"]),
      analysis,
      shots: 64,
      target: "qci-aer-gpu",
      mode: "balanced",
    });
    expect(prepared.decision.selected.id).toBe("qci-aer-gpu");
    expect(prepared.bundles[0].media_type).toBe("text/qasm2");
    expect(prepared.quote.total).toBeGreaterThan(0);
  });

  it("refuses photonic Toffoli through the adapter rather than dropping it", () => {
    const source = `${HEADER}qreg q[3];\nccx q[0],q[1],q[2];`;
    const ccx = analyzeCircuit(source, "openqasm2");
    const envelope = buildExecutionEnvelope({
      source, format: "openqasm2", shots: 8, routing_mode: "balanced",
    });
    expect(() => encodeForBackend({
      envelope,
      backend: catalogBackend("quandela-mosaiq"),
      analysis: ccx,
      transpilation: { qasm: ccx.normalizedQasm2 } as never,
      quoteBinding: "binding",
    })).toThrow(/not supported/i);
  });
});
