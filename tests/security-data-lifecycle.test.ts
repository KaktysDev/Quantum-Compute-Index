import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { demoV2Circuits, demoV2Groups } from "@/lib/qrouter/v2-demo-store";
import { createCircuitResource, createExecutionGroup, getExecutionGroup, releaseCircuitResource } from "@/lib/qrouter/v2-service";

const bell = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

function sqlFile(name: string) {
  return readFileSync(fileURLToPath(new URL(`../supabase/${name}`, import.meta.url)), "utf8");
}

/**
 * Pulls one `create or replace function name(...) ... $$ body $$` out of a
 * migration so an assertion can be scoped to that function instead of matching
 * anywhere in a 700-line file.
 */
function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is missing from the migration`).toBeGreaterThan(-1);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$", bodyStart + 2);
  return sql.slice(bodyStart + 2, bodyEnd);
}

/** Every string anywhere in a nested structure, so nothing hides in a subkey. */
function allStrings(value: unknown, found: string[] = []): string[] {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, found));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => allStrings(item, found));
  return found;
}

describe("v2 circuit release purges every copy of the customer's circuit", () => {
  beforeEach(() => {
    demoV2Circuits.clear();
    demoV2Groups.clear();
    demoJobs.clear();
  });

  it("leaves no QASM and no result counts readable after release", async () => {
    const owner: Principal = { organizationId: "org-purge", userId: null, apiKeyId: "key", demo: true };
    const { circuit } = await createCircuitResource(owner, { circuit: bell, format: "openqasm2", name: undefined }, "purge-circuit");
    const { group } = await createExecutionGroup(owner, {
      circuit_id: circuit.id,
      metadata: {},
      executions: [{ key: "only", target: "qci-aer-gpu", shots: 32, routing_mode: "balanced", optimization_level: 2, failover: false, max_attempts: 1, timeout_seconds: 60, constraints: {} }],
    }, "purge-job", "request-purge");

    // Sanity: the circuit really is recoverable before the release.
    const before = allStrings(await getExecutionGroup(owner, group.id));
    expect(before.some((value) => value.includes("OPENQASM"))).toBe(true);

    await releaseCircuitResource(owner, circuit.id);

    const surfaces: Record<string, unknown> = {
      "circuit store": [...demoV2Circuits.values()],
      "group store": [...demoV2Groups.values()],
      "job store": [...demoJobs.values()],
      "GET /api/v2/jobs/{id}": await getExecutionGroup(owner, group.id),
    };
    for (const [surface, value] of Object.entries(surfaces)) {
      const leaked = allStrings(value).filter((item) => item.includes("OPENQASM") || item.includes("qreg q[2]"));
      expect(leaked, `${surface} still exposes circuit source after release`).toEqual([]);
    }

    for (const job of demoJobs.values()) {
      expect(job.result, "job result survived release").toBeNull();
      expect(job.source).toBe("");
    }
  });
});

// The remaining suites assert on the migration text. There is no Postgres
// available in CI, so these pin the SQL contract the TypeScript relies on: if
// someone drops a table from the purge, widens the dispatch guard, or restores
// the jobs INSERT policy, one of these fails.
describe("supabase/qrouter.sql keeps the security contract", () => {
  const qrouter = sqlFile("qrouter.sql");
  const schema = sqlFile("schema.sql");

  it("has no user-facing INSERT policy on public.jobs", () => {
    for (const [name, sql] of [["qrouter.sql", qrouter], ["schema.sql", schema]] as const) {
      const insertPolicies = sql.match(/create policy[^;]*on public\.jobs[^;]*for insert[^;]*/gi) ?? [];
      expect(insertPolicies, `${name} recreates an INSERT policy on public.jobs`).toEqual([]);
      expect(sql, `${name} does not drop the historical policy names`).toMatch(/drop policy if exists "job member create" on public\.jobs/);
      expect(sql, `${name} does not drop the historical policy names`).toMatch(/drop policy if exists "jobs: member create" on public\.jobs/);
      expect(sql, `${name} still grants write access on jobs`).toMatch(/revoke insert, update, delete on public\.jobs from anon, authenticated/);
    }
  });

  it("only dispatches jobs that carry a quote and a credit reservation", () => {
    const body = functionBody(qrouter, "claim_qrouter_jobs");
    expect(body).toMatch(/quote_id is not null/);
    expect(body).toMatch(/ledger_entries/);
    expect(body).toMatch(/entry\.type='reserve'/);
    // v2 reserves once per execution group, so the group form must be accepted
    // or every v2 execution would stall in `queued`.
    expect(body).toMatch(/group_id/);
  });

  it("purges circuit data from every table that can hold it", () => {
    const body = functionBody(qrouter, "purge_circuit_data");
    const required: Array<[string, RegExp]> = [
      ["circuits.source", /update public\.circuits[\s\S]*source=''/],
      ["circuits.analysis.normalizedQasm2", /analysis=\(coalesce\(analysis,'\{\}'::jsonb\) - 'normalizedQasm2' - 'transpilation' - 'encoding'\)/],
      ["released_at stamped before the purge", /released_at=coalesce\(released_at,now\(\)\)/],
      ["jobs.source / result / analysis", /update public\.jobs[\s\S]*source='',result=null,analysis=/],
      ["jobs.route_decision encoding payload", /route_decision #\- '\{encoding,selected_bundle,payload\}'/],
      ["job_attempts", /delete from public\.job_attempts/],
      ["job_events.payload", /update public\.job_events set payload=/],
      ["webhook_deliveries.payload", /update public\.webhook_deliveries[\s\S]*payload='\{\}'::jsonb/],
      ["job ids returned for artifact object deletion", /'job_ids',to_jsonb\(job_ids\)/],
    ];
    for (const [what, pattern] of required) {
      expect(body, `purge_circuit_data no longer clears ${what}`).toMatch(pattern);
    }
  });

  it("lets an auth.users row be deleted so erasure is possible", () => {
    expect(qrouter).toMatch(/created_by uuid references auth\.users\(id\) on delete set null/);
    expect(qrouter).toMatch(/alter table public\.organizations alter column created_by drop not null/);
    expect(schema).not.toMatch(/created_by uuid not null references auth\.users\(id\) on delete restrict/);
    expect(qrouter).toMatch(/create or replace function public\.erase_user_personal_data/);
  });

  it("cannot wedge credit unparking on one bad execution group", () => {
    const body = functionBody(qrouter, "requeue_awaiting_payment_execution_groups");
    // The quote aggregate and the pending-execution count must agree, or
    // cancelling one execution parks the whole organization permanently.
    const aggregateFilters = body.match(/job\.status in\('quoted','awaiting_payment'\)/g) ?? [];
    expect(aggregateFilters.length, "the quote aggregate is not status-filtered").toBeGreaterThanOrEqual(2);
    expect(body, "one failing group can still abort the batch").toMatch(/exception when others then/);
  });

  it("pins pg_temp on every security definer function", () => {
    for (const name of ["qrouter.sql", "schema.sql", "access.sql", "admin.sql", "chat.sql", "contact.sql"]) {
      const sql = sqlFile(name);
      const unhardened = sql.match(/security definer[\s\S]{0,80}?set search_path\s*=\s*public\s*(?:as|\n)/gi) ?? [];
      expect(unhardened, `${name} has a security definer function without pg_temp`).toEqual([]);
    }
  });

  it("keeps key_hash out of reach of ordinary org members", () => {
    expect(qrouter).toMatch(/revoke select on public\.api_keys from anon, authenticated/);
    const grant = qrouter.match(/grant select \(([^)]*)\)\s*\n?\s*on public\.api_keys to authenticated/);
    expect(grant, "api_keys column grant is missing").not.toBeNull();
    expect(grant![1]).not.toContain("key_hash");
  });

  it("commits no personal email addresses as seed data", () => {
    for (const name of ["access.sql", "schema.sql"]) {
      const active = sqlFile(name)
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
      expect(active, `${name} seeds a real address`).not.toMatch(/@gmail\.com/i);
    }
  });
});
