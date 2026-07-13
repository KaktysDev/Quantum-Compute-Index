import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as createJob } from "@/app/api/v1/jobs/route";
import { POST as createProject } from "@/app/api/v1/projects/route";
import { GET as listRepositoryJobs, POST as createRepositoryJob } from "@/app/api/v1/repository-jobs/route";
import { sampleProviderSeries, sampleSnapshot } from "@/lib/qci/sample";
import { analyzeCircuit, CircuitValidationError } from "@/lib/qrouter/analyze";
import { BACKENDS, withQciSnapshot } from "@/lib/qrouter/catalog";
import { demoJobs, demoProjects } from "@/lib/qrouter/demo-store";
import { normalizeCircuitPath, normalizeRef, normalizeRepository } from "@/lib/qrouter/repositories";
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
    demoJobs.clear();
    demoProjects.clear();
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

  it("normalizes repository coordinates and rejects source traversal", () => {
    expect(normalizeRepository("https://github.com/acme/quantum.git")).toBe("acme/quantum");
    expect(normalizeRef("feature/router-v2")).toBe("feature/router-v2");
    expect(normalizeCircuitPath("circuits/bell.qasm")).toBe("circuits/bell.qasm");
    expect(() => normalizeRef("../main")).toThrow("invalid");
    expect(() => normalizeCircuitPath("../secret.qasm")).toThrow("invalid");
  });

  it("imports and deploys a commit-pinned repository circuit", async () => {
    const repositoryConfig = JSON.stringify({ circuit: "circuits/bell.qasm", shots: 256, routing_mode: "cost", optimization_level: 3 });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith("/repos/acme/quantum")) return Response.json({ full_name: "acme/quantum", html_url: "https://github.com/acme/quantum", default_branch: "main", private: true, updated_at: "2026-07-13T12:00:00Z" });
      if (url.includes("/repos/acme/quantum/git/trees/main")) return Response.json({ tree: [
        { path: "circuits/bell.qasm", type: "blob", sha: "circuit-sha", size: bell.length },
        { path: "qrouter.json", type: "blob", sha: "config-sha", size: repositoryConfig.length },
      ] });
      if (url.includes("/contents/qrouter.json")) return Response.json({ content: Buffer.from(repositoryConfig).toString("base64"), encoding: "base64", sha: "config-sha", size: repositoryConfig.length, html_url: "https://github.com/acme/quantum/blob/main/qrouter.json" });
      if (url.includes("/contents/circuits/bell.qasm")) return Response.json({ content: Buffer.from(bell).toString("base64"), encoding: "base64", sha: "circuit-sha", size: bell.length, html_url: "https://github.com/acme/quantum/blob/main/circuits/bell.qasm" });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const authorization = "Bearer qci_test_local_development";
    const projectResponse = await createProject(new Request("http://localhost/api/v1/projects", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ repository: "acme/quantum", production_branch: "main" }),
    }));
    const project = await projectResponse.json();
    expect(projectResponse.status).toBe(201);
    expect(project).toMatchObject({ repository: "acme/quantum", production_branch: "main", circuit_path: "circuits/bell.qasm", settings: { shots: 256, routingMode: "cost", optimizationLevel: 3 } });

    const deploymentResponse = await createRepositoryJob(new Request("http://localhost/api/v1/repository-jobs", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ project_id: project.id, deployment_id: "deploy-test-1", settings: { shots: 256, target: "auto", routingMode: "cost", optimizationLevel: 3 } }),
    }));
    const deployment = await deploymentResponse.json();
    expect(deploymentResponse.status).toBe(201);
    expect(deployment).toMatchObject({
      status: "completed",
      selected_backend_id: "qci-aer-gpu",
      analysis: { transpilation: { compiler: "local", optimizationLevel: 3 } },
      deployment: { project_id: project.id, repository: "acme/quantum", ref: "main", path: "circuits/bell.qasm", sha: "circuit-sha" },
    });

    const listResponse = await listRepositoryJobs(new Request(`http://localhost/api/v1/repository-jobs?project_id=${project.id}`, { headers: { authorization } }));
    const list = await listResponse.json();
    expect(listResponse.status).toBe(200);
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ id: deployment.id, project_id: project.id, status: "completed" });
  });

  it("routes through the live QCI quote model", () => {
    const analysis = analyzeCircuit(bell, "openqasm2");
    const decision = routeCircuit({ backends: BACKENDS, analysis, shots: 1024, target: "auto", mode: "balanced", qciSnapshotId: 42, qciTimestamp: "2026-07-11T00:00:00Z" });
    expect(decision.selected.id).toBe("qci-aer-gpu");
    const quote = buildQuote(decision, analysis, 1024);
    expect(quote.total).toBeGreaterThan(0);
    expect(quote.rateSnapshot.qciSnapshotId).toBe(42);
  });

  it("anchors every sample provider history to its current normalized rate", () => {
    const now = new Date("2026-07-12T14:00:00Z");
    const snapshot = sampleSnapshot(now);
    const series = sampleProviderSeries(90, now);
    for (const component of snapshot.components) {
      expect(series[component.provider]).toHaveLength(90);
      expect(series[component.provider].at(-1)?.value).toBeCloseTo(component.pricePerNqh, 2);
    }
  });

  it("transpiles, reprices, and executes submitted jobs through one pipeline", async () => {
    const response = await createJob(new Request("http://localhost/api/v1/jobs", {
      method: "POST",
      headers: {
        authorization: "Bearer qci_test_local_development",
        "content-type": "application/json",
        "idempotency-key": "compiled-bell-test",
      },
      body: JSON.stringify({ circuit: bell, shots: 256, target: "auto", optimization_level: 3 }),
    }));
    const job = await response.json();
    expect(response.status).toBe(201);
    expect(job).toMatchObject({
      status: "completed",
      selected_backend_id: "qci-aer-gpu",
      analysis: { transpilation: { compiler: "local", optimizationLevel: 3, backendId: "qci-aer-gpu" } },
      quote: { rateSnapshot: { backend: "qci-aer-gpu", qciMethod: "provider-rate-v1" } },
    });
    expect(Object.values(job.result.counts as Record<string, number>).reduce((sum, count) => sum + count, 0)).toBe(256);
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
