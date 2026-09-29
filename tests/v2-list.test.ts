import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { decodeCursor, encodeCursor } from "@/lib/qrouter/v2";
import { demoV2Circuits, demoV2Groups } from "@/lib/qrouter/v2-demo-store";
import { cancelExecution, createCircuitResource, createExecutionGroup, listCircuits, listExecutionGroups } from "@/lib/qrouter/v2-service";
import { GET as listJobsRoute } from "@/app/api/v2/jobs/route";
import { GET as listCircuitsRoute } from "@/app/api/v2/circuits/route";
import { GET as listV1Jobs } from "@/app/api/v1/jobs/route";

const bell = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const execution = (key: string) => ({ key, target: "qci-aer-gpu", shots: 32, routing_mode: "balanced" as const, optimization_level: 2, failover: false, max_attempts: 1, timeout_seconds: 60, constraints: {} });

function principal(org: string): Principal {
  return { organizationId: org, userId: null, apiKeyId: "key", demo: true };
}

async function seed(owner: Principal, name: string, keys: string[]) {
  const { circuit } = await createCircuitResource(owner, { circuit: bell, format: "openqasm2", name }, `circuit-${name}-${owner.organizationId}`);
  const { group } = await createExecutionGroup(owner, { circuit_id: circuit.id, metadata: { name }, executions: keys.map(execution) }, `job-${name}-${owner.organizationId}`, "request");
  return { circuit, group };
}

describe("v2 list endpoints", () => {
  beforeEach(() => {
    demoV2Circuits.clear();
    demoV2Groups.clear();
    demoJobs.clear();
  });

  it("round-trips cursors and rejects anything else", () => {
    const cursor = encodeCursor("2026-09-28T18:38:19.123456+00:00", "0b8f5d8e-6f0c-4d5a-9a44-1f1a2b3c4d5e");
    expect(decodeCursor(cursor)).toEqual({ createdAt: "2026-09-28T18:38:19.123456+00:00", id: "0b8f5d8e-6f0c-4d5a-9a44-1f1a2b3c4d5e" });
    expect(decodeCursor(Buffer.from("2026-09-28T00:00:00Z|x,id.gt.0").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("created_at.gt.0|0b8f5d8e-6f0c-4d5a-9a44-1f1a2b3c4d5e").toString("base64url"))).toBeNull();
    expect(decodeCursor("not-base64-at-all!")).toBeNull();
  });

  it("lists only the caller's jobs, newest first, with executions and totals", async () => {
    const owner = principal("org-a");
    await seed(owner, "first", ["a"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const { group } = await seed(owner, "second", ["x", "y"]);
    await seed(principal("org-b"), "other", ["z"]);

    const result = await listExecutionGroups(owner, { limit: 20 });
    expect(result.data.map((item) => item.metadata.name)).toEqual(["second", "first"]);
    const [latest] = result.data;
    expect(latest.id).toBe(group.id);
    expect(latest.circuit_name).toBe("second");
    expect(latest.executions.map((item) => item.key)).toEqual(["x", "y"]);
    expect(latest.totals.quoted).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/OPENQASM|normalizedQasm2|route_decision/);
  });

  it("pages with has_more and next_cursor", async () => {
    const owner = principal("org-page");
    for (const name of ["one", "two", "three"]) {
      await seed(owner, name, ["k"]);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const first = await listExecutionGroups(owner, { limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.has_more).toBe(true);
    const second = await listExecutionGroups(owner, { limit: 2, cursor: first.next_cursor! });
    expect(second.data.map((item) => item.metadata.name)).toEqual(["one"]);
    expect(second.has_more).toBe(false);
    expect(second.next_cursor).toBeNull();
  });

  it("filters by status and circuit, and reflects live execution status", async () => {
    const owner = principal("org-filter");
    const { circuit, group } = await seed(owner, "filtered", ["only"]);
    await seed(owner, "unrelated", ["only"]);
    expect((await listExecutionGroups(owner, { limit: 20, circuit_id: circuit.id })).data.map((item) => item.id)).toEqual([group.id]);

    const executionId = String(group.executions[0].id);
    const job = demoJobs.get(executionId)!;
    if (job.status === "completed") job.status = "submitted";
    await cancelExecution(owner, executionId);
    const cancelled = await listExecutionGroups(owner, { limit: 20, status: ["cancelled"] });
    expect(cancelled.data.map((item) => item.id)).toEqual([group.id]);
    expect(cancelled.data[0].executions[0].status).toBe("cancelled");
  });

  it("lists circuits with run counts and without source", async () => {
    const owner = principal("org-circuits");
    const { circuit } = await seed(owner, "bell", ["a"]);
    const result = await listCircuits(owner, { limit: 20, include_released: true });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: circuit.id, name: "bell", job_count: 1 });
    expect(result.data[0].last_job_at).not.toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/OPENQASM|normalizedQasm2|"source"/);
  });

  it("hides v2 executions from the v1 standalone list", async () => {
    await seed(principal("demo"), "grouped", ["a"]);
    const request = (url: string) => new Request(url, { headers: { authorization: "Bearer qci_test_local_development" } });
    const all = await (await listV1Jobs(request("http://localhost/api/v1/jobs?view=summary"))).json();
    const standalone = await (await listV1Jobs(request("http://localhost/api/v1/jobs?view=summary&standalone=1"))).json();
    expect(all.data.length).toBe(1);
    expect(all.data[0].group_id).toBeTruthy();
    expect(standalone.data).toHaveLength(0);
  });

  it("serves the lists over HTTP and validates the query", async () => {
    await seed(principal("demo"), "http", ["a"]);
    const request = (url: string) => new Request(url, { headers: { authorization: "Bearer qci_test_local_development" } });

    const jobs = await listJobsRoute(request("http://localhost/api/v2/jobs?limit=5"));
    expect(jobs.status).toBe(200);
    const body = await jobs.json();
    expect(body).toMatchObject({ object: "list", has_more: false, next_cursor: null });
    expect(body.data).toHaveLength(1);

    const circuits = await listCircuitsRoute(request("http://localhost/api/v2/circuits"));
    expect((await circuits.json()).data).toHaveLength(1);

    expect((await listJobsRoute(request("http://localhost/api/v2/jobs?cursor=bogus"))).status).toBe(400);
    expect((await listJobsRoute(request("http://localhost/api/v2/jobs?status=paused"))).status).toBe(400);
    expect((await listJobsRoute(request("http://localhost/api/v2/jobs?limit=500"))).status).toBe(400);
    expect((await listCircuitsRoute(request("http://localhost/api/v2/circuits?include_released=maybe"))).status).toBe(400);
  });
});
