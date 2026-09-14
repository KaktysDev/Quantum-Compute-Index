import { afterEach, describe, expect, it } from "vitest";
import { GET as getJobV2 } from "@/app/api/v2/jobs/[id]/route";
import { GET as getExecutionResultV2 } from "@/app/api/v2/executions/[id]/result/route";
import { GET as getTranspiled } from "@/app/api/v1/jobs/[id]/transpiled/route";
import { demoJobs, type StoredJob } from "@/lib/qrouter/demo-store";
import { demoV2Groups } from "@/lib/qrouter/v2-demo-store";
import { slimResult } from "@/lib/qrouter/encoding/public";

const QASM = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const LEAK = /OPENQASM|qreg\s+|creg\s+|providerResult|providerProgram|Bearer\s+[A-Za-z0-9]|sk-secret|_API_KEY\s*=/i;

function authed(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer qci_test_local_development",
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function fatV2Result() {
  return {
    counts: { "00": 512, "11": 512 },
    probabilities: { "00": 0.5, "11": 0.5 },
    shots: 1024,
    backend: "qci-aer-gpu",
    source: QASM,
    payload: QASM,
    qasm: QASM,
    artifactQasm: QASM,
    providerProgram: "QPY-SECRET",
    providerResult: { raw: QASM, authorization: "Bearer sk-secret" },
    metadata: {
      normalized: true,
      bit_order: "q0_right",
      providerResult: { raw: QASM, authorization: "Bearer sk-secret" },
      raw: QASM,
    },
  };
}

function fixtureJob(id: string, organizationId = "demo"): StoredJob {
  return {
    id,
    organization_id: organizationId,
    name: "security fixture",
    input_format: "openqasm2",
    source: QASM,
    shots: 1024,
    target: "qci-aer-gpu",
    routing_mode: "balanced",
    status: "completed",
    selected_backend_id: "qci-aer-gpu",
    analysis: {
      qubits: 2,
      depth: 3,
      gates: 5,
      twoQubitGates: 1,
      classicalBits: 2,
      measurements: 2,
      complexity: "light",
      gateCounts: { h: 1, cx: 1, measure: 2 },
      normalizedQasm2: QASM,
      transpilation: {
        qasm: QASM,
        artifactQasm: QASM,
        providerProgram: "QPY-SECRET",
        backendId: "qci-aer-gpu",
        compiler: "local",
        optimizationLevel: 1,
        seedTranspiler: 0,
        before: { qubits: 2, classicalBits: 2, depth: 3, gates: 5, twoQubitGates: 1, operations: { h: 1, cx: 1 } },
        after: { qubits: 2, classicalBits: 2, depth: 3, gates: 5, twoQubitGates: 1, operations: { h: 1, cx: 1 } },
        layout: null,
        equivalent: true,
        improvement: { depthPercent: 0, gatePercent: 0 },
        target: { backendId: "qci-aer-gpu", basisGates: ["h", "cx"], connectivity: "all-to-all" },
      },
    },
    route_decision: {
      selected: { id: "qci-aer-gpu", displayName: "QCI Aer CPU", provider: "qci", kind: "simulator", status: "online", qubits: 30, nativeGates: [], basisGates: [], connectivity: "all-to-all" },
      candidates: [],
      mode: "balanced",
      explanation: ["Local simulator"],
    },
    quote: {
      providerCost: 0.01,
      transpilerFee: 0,
      platformFee: 0.0023,
      total: 0.0123,
      currency: "usd",
      expiresAt: "2026-09-14T01:00:00.000Z",
      rateSnapshot: {},
    },
    result: fatV2Result(),
    error: { message: "IBM_QUANTUM_TOKEN=super-secret", stack: "Bearer sk-secret" },
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-14T00:00:02.000Z",
    completed_at: "2026-09-14T00:00:02.000Z",
  };
}

function seedJob(job: StoredJob) {
  demoJobs.set(job.id, job);
  return job;
}

describe("public result security", () => {
  afterEach(() => {
    for (const [id, job] of demoJobs) {
      if (String(job.name ?? "").includes("security fixture") || String(id).startsWith("sec-")) demoJobs.delete(id);
    }
    for (const id of [...demoV2Groups.keys()]) {
      if (id.startsWith("sec-")) demoV2Groups.delete(id);
    }
  });

  it("drops providerResult and OPENQASM from a fat v2-shaped result after slimResult", () => {
    const slim = slimResult(fatV2Result());
    expect(slim.counts).toEqual({ "00": 512, "11": 512 });
    expect(slim.metadata).toEqual({ normalized: true, bit_order: "q0_right" });
    expect(slim).not.toHaveProperty("source");
    expect(slim).not.toHaveProperty("payload");
    expect(slim).not.toHaveProperty("qasm");
    expect(slim).not.toHaveProperty("providerResult");
    expect(slim).not.toHaveProperty("providerProgram");
    expect(JSON.stringify(slim)).not.toMatch(LEAK);
  });

  it("returns a slim public JSON from v2 GET execution result", async () => {
    const job = seedJob(fixtureJob("sec-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));
    const response = await getExecutionResultV2(
      authed(`http://localhost/api/v2/executions/${job.id}/result`),
      params(job.id),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.counts["00"]).toBe(512);
    expect(body.metadata?.providerResult).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(LEAK);
  });

  it("returns 404 across tenants for v2 results and v1 transpiled downloads", async () => {
    const foreign = seedJob(fixtureJob("sec-foreign-0000-4000-8000-000000000001", "other-org"));
    const result = await getExecutionResultV2(
      authed(`http://localhost/api/v2/executions/${foreign.id}/result`),
      params(foreign.id),
    );
    expect(result.status).toBe(404);

    const transpiled = await getTranspiled(
      authed(`http://localhost/api/v1/jobs/${foreign.id}/transpiled`),
      params(foreign.id),
    );
    expect(transpiled.status).toBe(404);
    expect(await transpiled.text()).not.toMatch(LEAK);
  });

  it("keeps owner QASM on v1 transpiled and slims v2 job execution views", async () => {
    const job = seedJob(fixtureJob("sec-owner-0000-4000-8000-000000000002"));
    const download = await getTranspiled(
      authed(`http://localhost/api/v1/jobs/${job.id}/transpiled`),
      params(job.id),
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("OPENQASM");

    const groupId = "sec-group-0000-4000-8000-000000000003";
    demoV2Groups.set(groupId, {
      id: groupId,
      circuit_id: "sec-circuit-0000-4000-8000-000000000004",
      organization_id: "demo",
      status: "completed",
      metadata: {},
      executions: [{
        id: job.id,
        key: "only",
        status: "completed",
        analysis: job.analysis,
        route_decision: {
          encoding: { selected_bundle: { payload: QASM, backend_id: "qci-aer-gpu" } },
        },
        error: job.error,
        result: fatV2Result(),
        result_available: true,
      }],
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
      error: { message: "IBM_QUANTUM_TOKEN=super-secret", stack: "Bearer sk-secret" },
      idempotency_key: "sec-group",
      request_hash: "sec",
    });

    const listed = await getJobV2(authed(`http://localhost/api/v2/jobs/${groupId}`), params(groupId));
    const payload = await listed.json();
    expect(listed.status).toBe(200);
    expect(payload.data.executions[0].result_available).toBe(true);
    expect(payload.data.executions[0].analysis).not.toHaveProperty("normalizedQasm2");
    expect(payload.data.executions[0].analysis.transpilation).not.toHaveProperty("qasm");
    expect(payload.data.executions[0].error).not.toHaveProperty("stack");
    expect(JSON.stringify(payload)).not.toMatch(LEAK);
  });
});
