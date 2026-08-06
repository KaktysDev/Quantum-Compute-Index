// Coverage for the two endpoints the terminal client depends on:
//   GET  /api/v1/session          — is this key usable, and for what?
//   POST /api/v1/jobs/{id}/advance — drive MY job when no scheduler exists
//
// advanceJob() is the sensitive one: it can put a job on a provider and settle
// credits, so every guard (ownership, funding, exclusivity) is asserted here
// against a stubbed PostgREST client rather than trusted by inspection.

import { describe, expect, it, vi } from "vitest";
import { GET as getSession } from "@/app/api/v1/session/route";
import { POST as advanceRoute } from "@/app/api/v1/jobs/[id]/advance/route";
import { POST as createJob } from "@/app/api/v1/jobs/route";
import { advanceJob } from "@/lib/qrouter/dispatcher";

const bell = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

const DEMO_KEY = "qci_test_local_development";

function authed(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: { authorization: `Bearer ${DEMO_KEY}`, "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

// ── GET /api/v1/session ─────────────────────────────────────────────────────

describe("GET /api/v1/session", () => {
  it("falls through to the demo tenant only because demo mode is on here", async () => {
    // Documenting the boundary: with QROUTER_DEMO_MODE=true and no Supabase
    // service config, resolvePrincipal() hands out the shared demo principal.
    // Production has Supabase configured, so the same request is a 401 there.
    const response = await getSession(new Request("http://localhost/api/v1/session"));
    expect(response.status).toBe(200);
    expect((await response.json()).principal.demo).toBe(true);
  });

  it("rejects a key that is not a QRouter key", async () => {
    const response = await getSession(
      new Request("http://localhost/api/v1/session", { headers: { authorization: "Bearer sk-nope" } }),
    );
    expect(response.status).toBe(401);
  });

  it("reports identity, credits, billing and runnable backends", async () => {
    const response = await getSession(authed("http://localhost/api/v1/session"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.authenticated).toBe(true);
    expect(body.principal).toMatchObject({ kind: "api_key", environment: "test" });
    expect(body.principal.scopes).toContain("jobs:write");
    expect(body.organization.id).toBe("demo");
    expect(typeof body.credits.available).toBe("number");
    expect(body.billing).toHaveProperty("setup_complete");
    expect(body.assistant).toHaveProperty("configured");
    expect(Array.isArray(body.backends.ready)).toBe(true);
  });

  it("advertises only what a test key may actually target", async () => {
    // A test key is simulator-only, so a QPU must not appear as "ready" — that
    // is the difference between an honest first screen and a 403 later.
    const body = await (await getSession(authed("http://localhost/api/v1/session"))).json();
    for (const backend of body.backends.ready) expect(backend.kind).toBe("simulator");
    expect(body.backends.reachable).toBeGreaterThanOrEqual(body.backends.ready.length);
  });
});

// ── POST /api/v1/jobs/{id}/advance ──────────────────────────────────────────

describe("POST /api/v1/jobs/{id}/advance", () => {
  it("404s for a job that does not exist in the caller's workspace", async () => {
    const response = await advanceRoute(
      authed("http://localhost/api/v1/jobs/missing/advance", { method: "POST" }),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
    );
    expect(response.status).toBe(404);
  });

  it("reports an already-settled job as settled", async () => {
    const created = await createJob(
      authed("http://localhost/api/v1/jobs", {
        method: "POST",
        body: JSON.stringify({ circuit: bell, shots: 32, target: "qci-aer-gpu" }),
      }),
    );
    const job = await created.json();
    expect(job.status).toBe("completed");

    const response = await advanceRoute(
      authed(`http://localhost/api/v1/jobs/${job.id}/advance`, { method: "POST" }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: job.id, action: "settled", status: "completed" });
  });

  it("rejects a malformed key before touching any job", async () => {
    const response = await advanceRoute(
      new Request("http://localhost/api/v1/jobs/x/advance", {
        method: "POST",
        headers: { authorization: "Bearer sk-nope" },
      }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(response.status).toBe(401);
  });
});

// ── advanceJob() guards ─────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/**
 * A stub of the PostgREST builder surface advanceJob() uses. Filters are
 * recorded rather than applied, and each table returns a scripted result, so a
 * test can assert both the decision and the query that produced it.
 */
function stubAdmin(script: {
  job?: Row | null;
  reservations?: Row[];
  claim?: Row | null;
  after?: Row | null;
  rpc?: (name: string, args: Row) => unknown;
}) {
  const calls: Array<{ table: string; op: string; filters: Array<[string, unknown]>; payload?: Row }> = [];
  let jobReads = 0;

  const builder = (table: string, op: string, payload?: Row) => {
    const record = { table, op, filters: [] as Array<[string, unknown]>, payload };
    calls.push(record);
    const chain: Record<string, unknown> = {};
    const passthrough = (name: string) => (...args: unknown[]) => {
      record.filters.push([name, args]);
      return chain;
    };
    for (const name of ["eq", "lte", "or", "limit", "order", "select", "neq", "is"]) {
      chain[name] = passthrough(name);
    }
    const settle = () => {
      if (table === "ledger_entries") return { data: script.reservations ?? [], error: null };
      if (table === "jobs" && op === "update") return { data: script.claim ?? null, error: null };
      if (table === "jobs" && op === "select") {
        jobReads += 1;
        // The first read is the ownership/status load; later reads are the
        // post-dispatch refresh.
        return { data: jobReads === 1 ? script.job ?? null : script.after ?? script.job ?? null, error: null };
      }
      return { data: null, error: null };
    };
    chain.maybeSingle = () => Promise.resolve(settle());
    chain.single = () => Promise.resolve(settle());
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(settle()).then(resolve);
    return chain;
  };

  const admin = {
    from(table: string) {
      return {
        select: (...args: unknown[]) => {
          const chain = builder(table, "select");
          (chain as Record<string, unknown>).__cols = args;
          return chain;
        },
        update: (payload: Row) => builder(table, "update", payload),
        insert: (payload: Row) => builder(table, "insert", payload),
      };
    },
    rpc: vi.fn(async (name: string, args: Row) => ({ data: script.rpc?.(name, args) ?? false, error: null })),
  };
  return { admin: admin as never, calls };
}

const fundedQueuedJob = {
  id: "job-1",
  organization_id: "org-1",
  status: "queued",
  quote_id: "quote-1",
  group_id: null,
  provider_job_id: null,
  route_decision: { selected: { id: "qci-aer-gpu" }, candidates: [] },
  analysis: {},
  shots: 100,
  source: bell,
  input_format: "openqasm2",
  selected_backend_id: "qci-aer-gpu",
  failover_enabled: true,
  max_attempts: 3,
  execution_timeout_seconds: 7200,
  execution_deadline_at: null,
  timeout_failover_pending: false,
};

describe("advanceJob guards", () => {
  it("returns null when the job is not in the caller's organization", async () => {
    const { admin, calls } = stubAdmin({ job: null });
    expect(await advanceJob(admin, "job-1", "org-1")).toBeNull();
    // Ownership is enforced in the query itself, not after the fact.
    expect(calls[0].filters).toContainEqual(["eq", ["organization_id", "org-1"]]);
  });

  it("does nothing for a terminal job", async () => {
    const { admin } = stubAdmin({ job: { ...fundedQueuedJob, status: "completed" } });
    expect(await advanceJob(admin, "job-1", "org-1")).toEqual({ action: "settled", status: "completed" });
  });

  it("refuses a job with no quote attached", async () => {
    const { admin } = stubAdmin({ job: { ...fundedQueuedJob, quote_id: null } });
    const outcome = await advanceJob(admin, "job-1", "org-1");
    expect(outcome).toMatchObject({ action: "not_claimable" });
    expect(outcome?.detail).toMatch(/no quote/i);
  });

  it("refuses a job with no credit reservation, so nothing runs unbilled", async () => {
    const { admin } = stubAdmin({ job: fundedQueuedJob, reservations: [] });
    const outcome = await advanceJob(admin, "job-1", "org-1");
    expect(outcome).toMatchObject({ action: "not_claimable" });
    expect(outcome?.detail).toMatch(/reservation/i);
  });

  it("yields to whoever already holds the claim instead of double-dispatching", async () => {
    const { admin, calls } = stubAdmin({
      job: fundedQueuedJob,
      reservations: [{ id: 1 }],
      claim: null, // the conditional UPDATE matched nothing: someone else won
    });
    expect(await advanceJob(admin, "job-1", "org-1")).toMatchObject({ action: "waiting", status: "queued" });

    const claim = calls.find((call) => call.table === "jobs" && call.op === "update");
    expect(claim?.payload).toMatchObject({ status: "dispatching" });
    // The claim is only valid against a still-queued row that is due.
    expect(claim?.filters).toContainEqual(["eq", ["status", "queued"]]);
    expect(claim?.filters.some(([name]) => name === "lte")).toBe(true);
  });

  it("dispatches once it wins the claim", async () => {
    const { admin } = stubAdmin({
      job: fundedQueuedJob,
      reservations: [{ id: 1 }],
      claim: { ...fundedQueuedJob, status: "dispatching" },
      after: { status: "failed" }, // no candidates remain → dispatch fails it
      rpc: () => true,
    });
    const outcome = await advanceJob(admin, "job-1", "org-1");
    expect(outcome).toMatchObject({ action: "dispatched", status: "failed" });
  });

  it("polls a submitted job instead of dispatching it again", async () => {
    const submitted = { ...fundedQueuedJob, status: "submitted", provider_job_id: "provider-1" };
    const { admin, calls } = stubAdmin({
      job: submitted,
      reservations: [{ id: 1 }],
      claim: null, // lease held elsewhere
    });
    expect(await advanceJob(admin, "job-1", "org-1")).toMatchObject({ action: "waiting", status: "submitted" });
    const lease = calls.find((call) => call.table === "jobs" && call.op === "update");
    // A poll only takes the lease; it must never rewrite the job's status.
    expect(lease?.payload).not.toHaveProperty("status");
  });

  it("waits on states the submit path still owns", async () => {
    const { admin } = stubAdmin({ job: { ...fundedQueuedJob, status: "quoted" }, reservations: [{ id: 1 }] });
    expect(await advanceJob(admin, "job-1", "org-1")).toMatchObject({ action: "waiting", status: "quoted" });
  });
});
