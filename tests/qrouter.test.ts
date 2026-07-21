import { afterEach, describe, expect, it, vi } from "vitest";
import { BraketClient } from "@aws-sdk/client-braket";
import { POST as createChat } from "@/app/api/chat/route";
import { POST as createChatQuote } from "@/app/api/chat/quote/route";
import { GET as listBackends } from "@/app/api/v1/backends/route";
import { POST as createJob } from "@/app/api/v1/jobs/route";
import { POST as createRouteAdvice } from "@/app/api/v1/ai/route-advice/route";
import { POST as createProject } from "@/app/api/v1/projects/route";
import { GET as listRepositoryJobs, POST as createRepositoryJob } from "@/app/api/v1/repository-jobs/route";
import { sampleProviderSeries, sampleSnapshot } from "@/lib/qci/sample";
import { createAIChatCompletion } from "@/lib/ai/inference";
import { canAccessConsole } from "@/lib/access";
import { analyzeCircuit, CircuitValidationError } from "@/lib/qrouter/analyze";
import { BACKENDS, withQciSnapshot } from "@/lib/qrouter/catalog";
import { demoJobs, demoProjects } from "@/lib/qrouter/demo-store";
import { normalizeCircuitPath, normalizeRef, normalizeRepository } from "@/lib/qrouter/repositories";
import { nextAttemptCandidate, retryDelaySeconds } from "@/lib/qrouter/orchestration";
import { applyProviderHealth } from "@/lib/qrouter/providerHealth";
import { normalizeProviderResult } from "@/lib/qrouter/results";
import { validateWebhookDestination } from "@/lib/qrouter/webhooks";
import { buildQuote, routeCircuit } from "@/lib/qrouter/route";
import { simulateCircuit } from "@/lib/qrouter/simulator";
import { getProviderStatus, submitToProvider } from "@/lib/qrouter/execution";
import { transpileForBackend, TranspilerUnavailableError } from "@/lib/qrouter/transpiler";
import { validateWaitlistSubmission } from "@/lib/waitlist";

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
    vi.restoreAllMocks();
    delete process.env.IONQ_API_KEY;
    delete process.env.QROUTER_COMPILER_URL;
    delete process.env.VULTR_SIMULATOR_URL;
    delete process.env.VULTR_SIMULATOR_TOKEN;
    delete process.env.VULTR_INFERENCE_API_KEY;
    delete process.env.VULTR_INFERENCE_BASE_URL;
    delete process.env.VULTR_MAIN_MODEL;
    delete process.env.VULTR_FALLBACK_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENROUTER_MAIN_MODEL;
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    delete process.env.OPENROUTER_SITE_URL;
    delete process.env.OPENROUTER_APP_NAME;
    delete process.env.OPENROUTER_PROVIDER_ORDER;
    delete process.env.OPENROUTER_ALLOW_FALLBACKS;
    delete process.env.OPENROUTER_DATA_COLLECTION;
    delete process.env.AI_PROVIDER_ORDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.BRAKET_OUTPUT_BUCKET;
    demoJobs.clear();
    demoProjects.clear();
  });

  it("reads console access from the database and fails closed on error", async () => {
    const rpc = (result: { data: unknown; error: unknown }) => ({ rpc: async () => result });

    expect(await canAccessConsole(rpc({ data: true, error: null }))).toBe(true);
    expect(await canAccessConsole(rpc({ data: false, error: null }))).toBe(false);
    // Migration not run / RPC missing → nobody gets in.
    expect(await canAccessConsole(rpc({ data: null, error: { code: "PGRST202" } }))).toBe(false);
    expect(
      await canAccessConsole({
        rpc: async () => {
          throw new Error("network unreachable");
        },
      }),
    ).toBe(false);
  });

  it("validates and normalizes complete waitlist profiles", () => {
    const valid = validateWaitlistSubmission({
      name: "  Ada Lovelace ",
      email: "ADA@EXAMPLE.COM",
      linkedin: "https://www.linkedin.com/in/ada-lovelace",
      jobTitle: "Quantum developer",
      quantumExperience: "developer",
      referralSource: "university",
    });
    expect(valid).toMatchObject({
      ok: true,
      submission: { name: "Ada Lovelace", email: "ada@example.com", quantumExperience: "developer" },
    });

    expect(validateWaitlistSubmission({
      name: "Ada",
      email: "ada@example.com",
      linkedin: "http://example.com/ada",
      jobTitle: "Developer",
      quantumExperience: "expert",
      referralSource: "unknown",
    })).toMatchObject({ ok: false });
  });

  it("analyzes a Bell circuit", () => {
    const analysis = analyzeCircuit(bell, "openqasm2");
    expect(analysis).toMatchObject({ qubits: 2, classicalBits: 2, gates: 2, twoQubitGates: 1, complexity: "light" });
  });

  it("analyzes semicolon-delimited OpenQASM on one line", () => {
    const analysis = analyzeCircuit('OPENQASM 2.0; include "qelib1.inc"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;', "openqasm2");
    expect(analysis).toMatchObject({ qubits: 2, classicalBits: 2, gates: 2, twoQubitGates: 1, measurements: 2 });
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

  it("fails over only to an untried backend within the accepted quote", () => {
    const analysis = analyzeCircuit(bell, "openqasm2");
    const decision = routeCircuit({ backends: BACKENDS, analysis, shots: 1024, target: "auto", mode: "balanced" });
    const primary = decision.candidates.find((candidate) => candidate.backend.id === decision.selected.id)!;
    decision.candidates.push(
      { ...primary, backend: { ...primary.backend, id: "quoted-fallback", displayName: "Quoted fallback" }, score: primary.score - 0.01 },
      { ...primary, backend: { ...primary.backend, id: "expensive-fallback", displayName: "Expensive fallback" }, estimatedProviderCost: primary.estimatedProviderCost + 1, score: primary.score - 0.02 },
    );

    expect(nextAttemptCandidate({ decision, attemptedBackendIds: [], failoverEnabled: true, maxAttempts: 3 })?.backend.id).toBe(decision.selected.id);
    expect(nextAttemptCandidate({ decision, attemptedBackendIds: [decision.selected.id], failoverEnabled: true, maxAttempts: 3 })?.backend.id).toBe("quoted-fallback");
    expect(nextAttemptCandidate({ decision, attemptedBackendIds: [decision.selected.id], failoverEnabled: false, maxAttempts: 3 })).toBeNull();
    expect(nextAttemptCandidate({ decision, attemptedBackendIds: [decision.selected.id, "quoted-fallback"], failoverEnabled: true, maxAttempts: 3 })).toBeNull();
    expect([retryDelaySeconds(1), retryDelaySeconds(2), retryDelaySeconds(10)]).toEqual([5, 10, 300]);
  });

  it("opens a routing circuit breaker after two fresh health failures", () => {
    const checkedAt = new Date().toISOString();
    const oneFailure = applyProviderHealth(BACKENDS, [{ backend_id: "qci-aer-gpu", configured: true, reachable: false, consecutive_failures: 1, detail: "timeout", checked_at: checkedAt }]);
    const twoFailures = applyProviderHealth(BACKENDS, [{ backend_id: "qci-aer-gpu", configured: true, reachable: false, consecutive_failures: 2, detail: "timeout", checked_at: checkedAt }]);
    expect(oneFailure[0]).toMatchObject({ status: "degraded", available: true });
    expect(twoFailures[0]).toMatchObject({ status: "offline", available: false, health: { consecutiveFailures: 2 } });
  });

  it("normalizes Braket-style measurements and preserves shot totals", () => {
    const result = normalizeProviderResult("aws-sv1", { measurementProbabilities: { "00": 0.501, "11": 0.499 } }, 101);
    expect(result).toMatchObject({ backend: "aws-sv1", shots: 101, probabilities: { "00": 0.501, "11": 0.499 }, metadata: { normalized: true } });
    expect(Object.values(result.counts).reduce((sum, count) => sum + count, 0)).toBe(101);
  });

  it("blocks private webhook destinations", async () => {
    await expect(validateWebhookDestination("https://10.0.0.1/hooks")).rejects.toThrow("private network");
    await expect(validateWebhookDestination("http://localhost:9000/hooks")).resolves.toBeInstanceOf(URL);
  });

  it("generates route advice from a deterministic router decision", async () => {
    process.env.VULTR_INFERENCE_API_KEY = "test-inference-key";
    process.env.VULTR_INFERENCE_BASE_URL = "https://inference.test/v1";
    process.env.VULTR_MAIN_MODEL = "test/main-model";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      expect(url).toBe("https://inference.test/v1/chat/completions");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "test/main-model", stream: false });
      expect(body.messages[1].content).toContain("qci-aer-gpu");
      return Response.json({
        model: "test/main-model",
        choices: [{ message: { content: "- QCI Aer GPU is the fastest low-cost match.\n- Try reducing two-qubit gates next." } }],
        usage: { total_tokens: 42 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await createRouteAdvice(new Request("http://localhost/api/v1/ai/route-advice", {
      method: "POST",
      headers: { authorization: "Bearer qci_test_local_development", "content-type": "application/json" },
      body: JSON.stringify({ circuit: bell, shots: 256, target: "auto", routing_mode: "balanced" }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      model: "test/main-model",
      inference_provider: "vultr",
      decision: { selected: { id: "qci-aer-gpu" } },
      analysis: { qubits: 2, complexity: "light" },
    });
    expect(payload.advice).toContain("QCI Aer GPU");
  });

  it("uses Gemini to explain but not alter the QCI route", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_MODEL = "gemini-3.5-flash";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input instanceof Request ? input.url : input)).toContain("/models/gemini-3.5-flash:streamGenerateContent?alt=sse");
      expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-gemini-key");
      const body = JSON.parse(String(init?.body));
      expect(body.systemInstruction.parts[0].text).toContain("QCI Engine has already selected");
      expect(body.contents[0].parts[0].text).toContain("qci-aer-gpu");
      return new Response([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "QCI selected the simulator because it is compatible.", thought: false }] } }] })}`,
        `data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 9, totalTokenCount: 49 } })}`,
        "",
      ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await createRouteAdvice(new Request("http://localhost/api/v1/ai/route-advice", {
      method: "POST",
      headers: { authorization: "Bearer qci_test_local_development", "content-type": "application/json" },
      body: JSON.stringify({ circuit: bell, shots: 256, target: "auto", routing_mode: "balanced" }),
    }));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      advice_source: "gemini",
      model: "gemini-3.5-flash",
      advice: "QCI selected the simulator because it is compatible.",
      decision: { selected: { id: "qci-aer-gpu" } },
      qci: { source: "sample" },
      usage: { totalTokens: 49 },
    });
  });

  it("streams the Gemini console assistant with live QCI context", async () => {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.systemInstruction.parts[0].text).toContain("routing layer for quantum compute");
      expect(body.systemInstruction.parts[0].text).toContain("qci-aer-gpu");
      return new Response([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Use auto routing for this Bell circuit.", thought: false }] } }] })}`,
        `data: ${JSON.stringify({ usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8, totalTokenCount: 38 } })}`,
        "",
      ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await createChat(new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { authorization: "Bearer qci_test_local_development", "content-type": "application/json" },
      body: JSON.stringify({ message: "Which backend should run a Bell circuit?" }),
    }));
    const events = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(events).toContain("event: text");
    expect(events).toContain("Use auto routing for this Bell circuit.");
    expect(events).toContain("event: usage");
    expect(events).toContain("event: done");
  });

  it("sends OpenRouter attribution and provider routing options", async () => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.test/api/v1";
    process.env.OPENROUTER_MAIN_MODEL = "openai/test-model";
    process.env.OPENROUTER_SITE_URL = "https://qrouter.test";
    process.env.OPENROUTER_APP_NAME = "QRouter Tests";
    process.env.OPENROUTER_PROVIDER_ORDER = "Fireworks,Together";
    process.env.OPENROUTER_DATA_COLLECTION = "deny";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input instanceof Request ? input.url : input)).toBe("https://openrouter.test/api/v1/chat/completions");
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-openrouter-key");
      expect(headers.get("http-referer")).toBe("https://qrouter.test");
      expect(headers.get("x-openrouter-title")).toBe("QRouter Tests");
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "openai/test-model",
        stream: false,
        usage: { include: true },
        provider: {
          order: ["Fireworks", "Together"],
          allow_fallbacks: true,
          data_collection: "deny",
        },
      });
      return Response.json({
        model: "openai/test-model",
        provider: "Fireworks",
        choices: [{ message: { content: [{ type: "text", text: "OpenRouter is ready." }] } }],
        usage: { total_tokens: 12, cost: 0.0001 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAIChatCompletion({
      messages: [{ role: "user", content: "ping" }],
    })).resolves.toMatchObject({
      content: "OpenRouter is ready.",
      model: "openai/test-model",
      provider: "openrouter",
      upstreamProvider: "Fireworks",
      usage: { total_tokens: 12, cost: 0.0001 },
    });
  });

  it("prefers Vultr credits and fails over to OpenRouter", async () => {
    process.env.VULTR_INFERENCE_API_KEY = "test-vultr-key";
    process.env.VULTR_INFERENCE_BASE_URL = "https://vultr.test/v1";
    process.env.VULTR_MAIN_MODEL = "vultr/main";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.test/api/v1";
    process.env.OPENROUTER_MAIN_MODEL = "openrouter/auto";
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      urls.push(url);
      if (url.startsWith("https://vultr.test")) {
        return Response.json({ error: { message: "Vultr is temporarily busy", code: 429 } }, { status: 429 });
      }
      return Response.json({
        model: "openai/fallback-model",
        provider: "Together",
        choices: [{ message: { content: "Answered by the backup." } }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAIChatCompletion({
      messages: [{ role: "user", content: "ping" }],
    })).resolves.toMatchObject({ provider: "openrouter", upstreamProvider: "Together" });
    expect(urls).toEqual([
      "https://vultr.test/v1/chat/completions",
      "https://openrouter.test/api/v1/chat/completions",
    ]);
  });

  it("keeps QCI advice available when optional OpenRouter commentary fails", async () => {
    process.env.OPENROUTER_API_KEY = "bad-openrouter-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.test/api/v1";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      error: { message: "OpenRouter key is invalid", code: 401 },
    }, { status: 401 })));

    const response = await createRouteAdvice(new Request("http://localhost/api/v1/ai/route-advice", {
      method: "POST",
      headers: { authorization: "Bearer qci_test_local_development", "content-type": "application/json" },
      body: JSON.stringify({ circuit: bell, shots: 256, target: "auto", routing_mode: "balanced" }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      advice_source: "qci-engine",
      model: "qci-engine",
      decision: { selected: { id: "qci-aer-gpu" } },
      commentary_warnings: ["OpenRouter key is invalid"],
    });
    expect(response.status).toBe(200);
  });

  it("lists backends with QCI snapshot pricing and provenance", async () => {
    const expected = sampleSnapshot();
    const response = await listBackends();
    const payload = await response.json();
    const ionq = payload.data.find((backend: { id: string }) => backend.id === "ionq-aria-1");
    const expectedIonq = expected.components.find((component) => /ionq/i.test(component.provider));
    expect(response.status).toBe(200);
    expect(payload.qci).toMatchObject({ source: "sample", index: expected.price, pricePerQcHour: expected.vwap });
    expect(ionq.pricePerNqh).toBe(expectedIonq?.pricePerNqh);
  });

  it("uses the same compiled QCI quote for chat confirmation and job execution", async () => {
    const requestBody = { circuit: bell, shots: 256, target: "auto", routing_mode: "balanced", optimization_level: 3 };
    const quoteResponse = await createChatQuote(new Request("http://localhost/api/chat/quote", {
      method: "POST",
      headers: { authorization: "Bearer qci_test_local_development", "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    }));
    const preview = await quoteResponse.json();
    const jobResponse = await createJob(new Request("http://localhost/api/v1/jobs", {
      method: "POST",
      headers: { authorization: "Bearer qci_test_local_development", "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    }));
    const job = await jobResponse.json();
    expect(quoteResponse.status).toBe(200);
    expect(jobResponse.status).toBe(201);
    expect(preview.transpilation).toMatchObject({ backendId: "qci-aer-gpu", optimizationLevel: 3 });
    expect(preview.quote).toMatchObject({
      providerCost: job.quote.providerCost,
      transpilerFee: job.quote.transpilerFee,
      platformFee: job.quote.platformFee,
      total: job.quote.total,
      rateSnapshot: job.quote.rateSnapshot,
    });
    expect(preview.decision.selected.id).toBe(job.selected_backend_id);
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

  it("submits and polls Qiskit jobs through the Vultr worker contract", async () => {
    process.env.VULTR_SIMULATOR_URL = "https://simulator.example.com/";
    process.env.VULTR_SIMULATOR_TOKEN = "vultr-worker-token";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "vultr-job-1", status: "submitted", createdAt: 1 }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ status: "completed", result: { counts: { "00": 16, "11": 16 }, shots: 32 } }));
    vi.stubGlobal("fetch", fetchMock);

    const analysis = analyzeCircuit(bell, "openqasm2");
    await expect(submitToProvider("qci-aer-gpu", analysis, 32, "qrouter-job-1")).resolves.toMatchObject({
      providerJobId: "vultr-job-1",
      status: "submitted",
    });
    await expect(getProviderStatus("qci-aer-gpu", "vultr-job-1")).resolves.toMatchObject({
      status: "completed",
      result: { shots: 32 },
    });

    const [submitUrl, submitInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(submitUrl).toBe("https://simulator.example.com/v1/jobs");
    expect(submitInit.headers).toMatchObject({
      authorization: "Bearer vultr-worker-token",
      "idempotency-key": "qrouter-job-1",
    });
    expect(JSON.parse(String(submitInit.body))).toMatchObject({ qasm: analysis.normalizedQasm2, shots: 32 });
    expect(fetchMock.mock.calls[1][0]).toBe("https://simulator.example.com/v1/jobs/vultr-job-1");
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({ authorization: "Bearer vultr-worker-token" });
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

  it("falls back to Amazon Braket when direct IonQ credentials are absent", async () => {
    process.env.AWS_ACCESS_KEY_ID = "test-aws-key";
    process.env.BRAKET_OUTPUT_BUCKET = "test-results";
    const send = vi.spyOn(BraketClient.prototype, "send").mockResolvedValue({ quantumTaskArn: "arn:aws:braket:us-east-1:123:quantum-task/test" } as never);
    const analysis = analyzeCircuit(bell, "openqasm2");
    await expect(submitToProvider("ionq-aria-1", analysis, 32, "job-attempt-1")).resolves.toMatchObject({
      providerJobId: "arn:aws:braket:us-east-1:123:quantum-task/test",
      status: "submitted",
    });
    expect(send).toHaveBeenCalledOnce();
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
