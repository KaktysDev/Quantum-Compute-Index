import { afterEach, describe, expect, it } from "vitest";
import { GET as getReport } from "@/app/api/v1/jobs/[id]/report/route";
import { POST as askReport } from "@/app/api/v1/jobs/[id]/report/ask/route";
import { GET as getPdf } from "@/app/api/v1/jobs/[id]/report/pdf/route";
import { GET as getResult } from "@/app/api/v1/jobs/[id]/result/route";
import { GET as getCsv } from "@/app/api/v1/jobs/[id]/result.csv/route";
import { GET as getJob } from "@/app/api/v1/jobs/[id]/route";
import { demoJobs, type StoredJob } from "@/lib/qrouter/demo-store";
import { resetReportCaches } from "@/lib/qrouter/report";
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

function fixtureJob(id: string, organizationId = "demo"): StoredJob {
  return {
    id,
    organization_id: organizationId,
    name: "Bell fixture",
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
      encoding: {
        envelope_id: "env",
        schema_version: "qee/1",
        workload_kind: "gate",
        frontend: { name: "qasm", version: "1" },
        stages: [],
        requirements: { qubits: 2, clbits: 2, instructions: ["h", "cx"], control_flow: [], mid_circuit_measurement: false, feedback: false },
        compiled: [],
        selected_bundle: {
          id: "bundle",
          backend_id: "qci-aer-gpu",
          media_type: "text/qasm2",
          payload: QASM,
          bit_order: "q0_right",
          verification: "checked",
          quote_binding: "binding",
          metrics: { qubits: 2, depth: 3, ops: { h: 1, cx: 1 }, two_qubit_ops: 1 },
          decode_map: {
            bit_order: "q0_right",
            registers: [],
            measurement_map: [{ qubit: 0, clbit: 0 }, { qubit: 1, clbit: 1 }],
            layout: null,
            result_types: ["counts"],
          },
        },
      },
    },
    route_decision: {
      selected: { id: "qci-aer-gpu", displayName: "QCI Aer CPU", provider: "qci", kind: "simulator", status: "online", qubits: 30, nativeGates: [], basisGates: [], connectivity: "all-to-all" },
      candidates: [],
      mode: "balanced",
      explanation: ["Local simulator"],
      encoding: {
        envelope_id: "env",
        schema_version: "qee/1",
        workload_kind: "gate",
        frontend: { name: "qasm", version: "1" },
        stages: [],
        requirements: { qubits: 2, clbits: 2, instructions: ["h"], control_flow: [], mid_circuit_measurement: false, feedback: false },
        compiled: [],
        selected_bundle: {
          id: "bundle",
          backend_id: "qci-aer-gpu",
          media_type: "text/qasm2",
          payload: QASM,
          bit_order: "q0_right",
          verification: "checked",
          quote_binding: "binding",
          metrics: { qubits: 2, depth: 3, ops: {}, two_qubit_ops: 0 },
          decode_map: { bit_order: "q0_right", registers: [], measurement_map: [], layout: null, result_types: [] },
        },
      },
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
    result: {
      counts: { "00": 512, "11": 500, "01": 6, "10": 6 },
      probabilities: { "00": 0.5, "11": 0.48828125, "01": 0.005859375, "10": 0.005859375 },
      shots: 1024,
      backend: "qci-aer-gpu",
      metadata: {
        normalized: true,
        bit_order: "q0_right",
        providerResult: { raw: QASM, authorization: "Bearer sk-secret" },
      },
    },
    error: { message: "IBM_QUANTUM_TOKEN=super-secret", stack: "Bearer sk-secret" },
    created_at: "2026-09-14T00:00:00.000Z",
    updated_at: "2026-09-14T00:00:02.000Z",
    completed_at: "2026-09-14T00:00:02.000Z",
  } as unknown as StoredJob;
}

function seed(job: StoredJob) {
  demoJobs.set(job.id, job);
  return job;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("job results report pipeline", () => {
  afterEach(() => {
    resetReportCaches();
    for (const [id, job] of demoJobs) {
      if (String(job.name ?? "").includes("fixture") || String(id).startsWith("rep-")) demoJobs.delete(id);
    }
  });

  it("builds a report, PDF, CSV, JSON download, and follow-up from real counts without leaking secrets", async () => {
    const job = seed(fixtureJob("rep-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"));

    const reportResponse = await getReport(authed(`http://localhost/api/v1/jobs/${job.id}/report`), params(job.id));
    const report = await reportResponse.json();
    expect(reportResponse.status).toBe(200);
    expect(report.schema).toBe("qrouter.job-report/1");
    expect(report.analytics.available).toBe(true);
    expect(report.analytics.top[0].bitstring).toBe("00");
    expect(report.analytics.top[0].count).toBe(512);
    expect(report.narrative.text).toMatch(/512|00/);
    expect(JSON.stringify(report)).not.toMatch(LEAK);
    expect(report).not.toHaveProperty("source");

    const pdfResponse = await getPdf(authed(`http://localhost/api/v1/jobs/${job.id}/report/pdf`), params(job.id));
    expect(pdfResponse.status).toBe(200);
    expect(pdfResponse.headers.get("content-type")).toBe("application/pdf");
    const pdf = Buffer.from(await pdfResponse.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const pdfText = pdf.toString("latin1");
    expect(pdfText).toMatch(/QRouter/);
    expect(pdfText).toMatch(/QCI Aer CPU|qci-aer-gpu/);
    expect(pdfText).toMatch(/512/);
    expect(pdfText).not.toMatch(LEAK);

    const csvResponse = await getCsv(authed(`http://localhost/api/v1/jobs/${job.id}/result.csv`), params(job.id));
    const csv = await csvResponse.text();
    expect(csvResponse.status).toBe(200);
    expect(csv).toMatch(/^bitstring,count,probability/);
    expect(csv).toMatch(/00,512,/);
    expect(csv).not.toMatch(LEAK);

    const jsonResponse = await getResult(authed(`http://localhost/api/v1/jobs/${job.id}/result`), params(job.id));
    const downloaded = await jsonResponse.json();
    expect(jsonResponse.status).toBe(200);
    expect(downloaded.counts["00"]).toBe(512);
    expect(downloaded.metadata?.providerResult).toBeUndefined();
    expect(JSON.stringify(downloaded)).not.toMatch(LEAK);

    const owner = await (await getJob(authed(`http://localhost/api/v1/jobs/${job.id}`), params(job.id))).json();
    expect(owner.source).toBe(QASM);
    expect(JSON.stringify(owner.result)).not.toMatch(/providerResult|OPENQASM/);
    expect(owner.analysis).not.toHaveProperty("normalizedQasm2");

    const asked = await askReport(authed(`http://localhost/api/v1/jobs/${job.id}/report/ask`, {
      method: "POST",
      body: JSON.stringify({ question: "What is the most frequent bitstring?" }),
    }), params(job.id));
    const answer = await asked.json();
    expect(asked.status).toBe(200);
    expect(answer.answer).toMatch(/00/);
    expect(JSON.stringify(answer)).not.toMatch(LEAK);
  });

  it("returns 404 across tenants and stays honest when results are missing", async () => {
    const foreign = seed(fixtureJob("rep-foreign-0000-4000-8000-000000000001", "other-org"));
    const missing = await getReport(authed(`http://localhost/api/v1/jobs/${foreign.id}/report`), params(foreign.id));
    expect(missing.status).toBe(404);

    const pendingId = "rep-pending-0000-4000-8000-000000000002";
    seed({
      ...fixtureJob(pendingId),
      status: "queued",
      result: null,
      completed_at: null,
    });
    const pending = await (await getReport(authed(`http://localhost/api/v1/jobs/${pendingId}/report`), params(pendingId))).json();
    expect(pending.analytics.available).toBe(false);
    expect(pending.analytics.reason).toMatch(/no measurement results/i);
    expect(pending.narrative.text).toMatch(/no measurement results|has no measurement/i);
    expect(JSON.stringify(pending)).not.toMatch(LEAK);

    const pdf = await getPdf(authed(`http://localhost/api/v1/jobs/${pendingId}/report/pdf`), params(pendingId));
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).toString("latin1")).not.toMatch(LEAK);
  });

  it("rejects an empty follow-up and does not invent counts", async () => {
    const job = seed(fixtureJob("rep-ask-0000-4000-8000-000000000003"));
    const empty = await askReport(authed(`http://localhost/api/v1/jobs/${job.id}/report/ask`, {
      method: "POST",
      body: JSON.stringify({ question: "   " }),
    }), params(job.id));
    expect(empty.status).toBe(400);

    const asked = await askReport(authed(`http://localhost/api/v1/jobs/${job.id}/report/ask`, {
      method: "POST",
      body: JSON.stringify({ question: "What was the fidelity on ibm-brisbane?" }),
    }), params(job.id));
    const body = await asked.json();
    expect(asked.status).toBe(200);
    expect(body.answer).not.toMatch(/ibm-brisbane/i);
    expect(body.answer).not.toMatch(LEAK);
  });

  it("slims a fat provider result before any download", () => {
    const slim = slimResult({
      counts: { "00": 10 },
      metadata: { providerResult: { raw: QASM }, bit_order: "q0_right" },
      source: QASM,
      payload: QASM,
    });
    expect(slim.counts).toEqual({ "00": 10 });
    expect(slim.metadata).toEqual({ bit_order: "q0_right" });
    expect(slim).not.toHaveProperty("source");
    expect(slim).not.toHaveProperty("payload");
  });
});
