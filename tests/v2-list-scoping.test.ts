import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every PostgREST call so the test can assert org scoping. The list
// functions run on the service-role client, which bypasses RLS.
type Call = { table: string; ops: Array<[string, unknown[]]> };
const calls: Call[] = [];
const fixtures: Record<string, unknown[]> = {};

function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "is", "or", "order", "limit"]) {
    chain[op] = (...args: unknown[]) => {
      call.ops.push([op, args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve({ data: fixtures[table] ?? [], error: null });
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));

import { listCircuits, listExecutionGroups } from "@/lib/qrouter/v2-service";

const ORG = "11111111-1111-4111-8111-111111111111";
const principal = { organizationId: ORG, userId: null, apiKeyId: "key", demo: false, scopes: ["jobs:read"] };
const GROUP = "22222222-2222-4222-8222-222222222222";
const JOB = "33333333-3333-4333-8333-333333333333";
const CIRCUIT = "44444444-4444-4444-8444-444444444444";

function scopedToOrg(call: Call) {
  return call.ops.some(([op, args]) => op === "eq" && args[0] === "organization_id" && args[1] === ORG);
}

describe("v2 list queries on the service-role client", () => {
  beforeEach(() => {
    calls.length = 0;
    for (const key of Object.keys(fixtures)) delete fixtures[key];
  });

  it("scopes every job-list query to the caller's organization", async () => {
    fixtures.execution_groups = [{ id: GROUP, circuit_id: CIRCUIT, status: "completed", metadata: {}, error: null, created_at: "2026-09-28T10:00:00+00:00", updated_at: "2026-09-28T10:01:00+00:00", completed_at: "2026-09-28T10:01:00+00:00", circuits: { name: "bell" } }];
    fixtures.jobs = [{ id: JOB, group_id: GROUP, execution_key: "a", status: "completed", target: "auto", selected_backend_id: "qci-aer-gpu", shots: 100, routing_mode: "balanced", created_at: "2026-09-28T10:00:00+00:00" }];
    fixtures.quotes = [{ job_id: JOB, total: "0.50" }];
    fixtures.ledger_entries = [{ job_id: JOB, type: "charge", amount: "-0.40" }];

    const result = await listExecutionGroups(principal, { limit: 10, cursor: undefined });
    expect(calls.map((call) => call.table).sort()).toEqual(["execution_groups", "jobs", "ledger_entries", "quotes"]);
    for (const call of calls) expect(scopedToOrg(call), `${call.table} is not org-scoped`).toBe(true);
    expect(result.data[0]).toMatchObject({ circuit_name: "bell", totals: { quoted: 0.5, charged: 0.4 } });
    expect(result.data[0].executions[0]).toMatchObject({ key: "a", charged: 0.4, quote: { total: 0.5 } });
  });

  it("puts only validated cursor values into the keyset filter", async () => {
    const cursor = Buffer.from(`2026-09-28T10:00:00+00:00|${GROUP}`).toString("base64url");
    await listExecutionGroups(principal, { limit: 10, cursor });
    const filter = calls[0].ops.find(([op]) => op === "or");
    expect(filter?.[1][0]).toBe(`created_at.lt.2026-09-28T10:00:00+00:00,and(created_at.eq.2026-09-28T10:00:00+00:00,id.lt.${GROUP})`);
  });

  it("scopes circuit-list queries and never selects source", async () => {
    fixtures.circuits = [{ id: CIRCUIT, organization_id: ORG, name: "bell", input_format: "openqasm2", source_hash: "h", analysis: { qubits: 2, normalizedQasm2: "OPENQASM 2.0;" }, created_at: "2026-09-28T10:00:00+00:00", expires_at: null, released_at: null }];
    fixtures.execution_groups = [{ circuit_id: CIRCUIT, created_at: "2026-09-28T11:00:00+00:00" }];
    const result = await listCircuits(principal, { limit: 10, include_released: true });
    for (const call of calls) expect(scopedToOrg(call), `${call.table} is not org-scoped`).toBe(true);
    const select = calls[0].ops.find(([op]) => op === "select")?.[1][0] as string;
    expect(select.split(",")).not.toContain("source");
    expect(result.data[0].analysis).toEqual({ qubits: 2 });
    expect(result.data[0]).toMatchObject({ job_count: 1, last_job_at: "2026-09-28T11:00:00+00:00" });
  });
});
