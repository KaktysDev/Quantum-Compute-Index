import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { BackendUnavailableError } from "@/lib/qrouter/availability";
import { apiError } from "@/lib/qrouter/http";
import { routeCircuit } from "@/lib/qrouter/route";
import type { CircuitAnalysis } from "@/lib/qrouter/types";

const BELL = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;
`;

const analysis: CircuitAnalysis = analyzeCircuit(BELL, "openqasm2");
const route = (target: string) => routeCircuit({ analysis, shots: 1024, target, mode: "balanced" });

describe("unavailable backend routing", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.IBM_QUANTUM_TOKEN;
    delete process.env.IONQ_API_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.BRAKET_OUTPUT_BUCKET;
  });
  afterEach(() => { process.env = { ...saved }; });

  it("explains an unconfigured provider rather than failing opaquely", () => {
    try {
      route("ibm-brisbane");
      expect.unreachable("expected the pinned QPU to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(BackendUnavailableError);
      const unavailable = error as BackendUnavailableError;
      expect(unavailable.reason.code).toBe("credentials_missing");
      expect(unavailable.reason.message).toContain("not configured");
    }
  });

  it("distinguishes a capability gap from a missing credential", () => {
    try {
      route("xanadu-borealis");
      expect.unreachable("expected the photonic backend to be rejected");
    } catch (error) {
      expect((error as BackendUnavailableError).reason.code).toBe("capability_mismatch");
    }
  });

  it("offers runnable alternatives with legible differences", () => {
    try {
      route("ibm-brisbane");
      expect.unreachable("expected the pinned QPU to be rejected");
    } catch (error) {
      const { alternatives } = error as BackendUnavailableError;
      expect(alternatives.length).toBeGreaterThan(0);
      // Every alternative must actually be runnable and not the rejected one.
      expect(alternatives.some((item) => item.backend_id === "ibm-brisbane")).toBe(false);
      const simulator = alternatives.find((item) => item.backend_id === "qci-aer-gpu");
      expect(simulator).toBeDefined();
      expect(simulator!.retry_with.target).toBe("qci-aer-gpu");
      expect(simulator!.differences.join(" ")).toContain("simulator rather than physical quantum hardware");
      // Differences must be self-describing prose, never empty filler.
      expect(simulator!.differences.every((line) => line.trim().length > 0)).toBe(true);
    }
  });

  it("responds 409 with the reason, a resolution, and retargeting options", async () => {
    try {
      route("ibm-brisbane");
      expect.unreachable("expected the pinned QPU to be rejected");
    } catch (error) {
      const response = apiError(error);
      expect(response.status).toBe(409);
      const body = await response.json() as {
        error: {
          type: string;
          requested: { reason_code: string; resolution: string };
          alternatives: Array<{ retry_with: { target: string } }>;
          retry_with_auto?: { target: string };
        };
      };
      expect(body.error.type).toBe("backend_unavailable");
      expect(body.error.requested.reason_code).toBe("credentials_missing");
      expect(body.error.requested.resolution).toContain("IBM_QUANTUM_TOKEN");
      expect(body.error.alternatives[0].retry_with.target).toBeTruthy();
      expect(body.error.retry_with_auto).toEqual({ target: "auto" });
    }
  });

  it("still routes normally when the target is runnable", () => {
    const decision = route("qci-aer-gpu");
    expect(decision.selected.id).toBe("qci-aer-gpu");
  });

  it("keeps the aggregate error when auto-routing finds nothing runnable", () => {
    expect(() => routeCircuit({
      analysis, shots: 1024, target: "auto", mode: "balanced",
      constraints: { maxCost: 0 },
    })).toThrow(/No backend can run this workload/);
  });
});

describe("catalog and database seed stay in sync", () => {
  // jobs.selected_backend_id is a foreign key into public.backends, so any
  // routable backend missing from the seed makes its job INSERT fail with a
  // foreign-key violation, surfacing as an opaque 500.
  it("seeds every routable backend into public.backends", async () => {
    const { readFileSync } = await import("fs");
    const { BACKENDS } = await import("@/lib/qrouter/catalog");
    const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
    const seedBlock = schema.slice(schema.indexOf("insert into public.backends"));
    const missing = BACKENDS.filter((backend) => !seedBlock.includes(`('${backend.id}',`));
    expect(missing.map((backend) => backend.id)).toEqual([]);
  });
});

describe("health reporting for the always-local simulator", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  // qci-aer-gpu runs in-process when no worker is configured. If the health
  // probe called that unreachable, two cron runs would open the circuit breaker
  // and mark the only working backend offline.
  it("reports qci-aer-gpu reachable when no remote worker is configured", async () => {
    delete process.env.QROUTER_COMPILER_URL;
    delete process.env.VULTR_SIMULATOR_URL;
    delete process.env.QROUTER_COMPILER_TOKEN;
    delete process.env.VULTR_SIMULATOR_TOKEN;
    const { checkProviderConnections } = await import("@/lib/qrouter/providerHealth");
    const compiler = (await checkProviderConnections()).find((p) => p.backendIds.includes("qci-aer-gpu"));
    expect(compiler?.reachable).toBe(true);
    expect(compiler?.configured).toBe(true);
    expect(compiler?.detail).toContain("in-process");
  });

  it("keeps qci-aer-gpu routable under an open circuit breaker elsewhere", async () => {
    const { applyProviderHealth } = await import("@/lib/qrouter/providerHealth");
    const { BACKENDS } = await import("@/lib/qrouter/catalog");
    const applied = applyProviderHealth(BACKENDS, [{
      backend_id: "qci-aer-gpu", configured: true, reachable: true,
      consecutive_failures: 0, detail: "in-process", checked_at: new Date().toISOString(),
    }]);
    const simulator = applied.find((b) => b.id === "qci-aer-gpu");
    expect(simulator?.status).not.toBe("offline");
    expect(simulator?.available).toBe(true);
  });
});

describe("assistant failures name the responsible subsystem", () => {
  it("attributes an upstream provider 500 instead of echoing it bare", async () => {
    const { AIInferenceError, describeAssistantFailure } = await import("@/lib/ai/inference");
    const message = describeAssistantFailure(
      new AIInferenceError("Internal server error.", "vultr", 500, undefined, "nvidia/Retired-Model"),
    );
    expect(message).toContain("vultr");
    expect(message).toContain("HTTP 500");
    // A retired model ID is the likeliest cause of a bare upstream 500.
    expect(message).toContain("nvidia/Retired-Model");
    expect(message).toContain("retired without notice");
    expect(message).toContain("QRouter itself is unaffected");
    // The bare upstream string must never stand alone — that is what made this
    // look identical to a QRouter fault.
    expect(message).not.toBe("Internal server error.");
  });

  it("gives a configuration instruction when a provider has no key", async () => {
    const { AIInferenceError, describeAssistantFailure } = await import("@/lib/ai/inference");
    const message = describeAssistantFailure(
      new AIInferenceError("vultr inference is not configured.", "vultr", undefined, "not_configured"),
    );
    expect(message).toContain("AI_PROVIDER_ORDER");
  });

  it("passes non-inference errors through unchanged", async () => {
    const { describeAssistantFailure } = await import("@/lib/ai/inference");
    expect(describeAssistantFailure(new Error("boom"))).toBe("boom");
  });
});

describe("opaque 500s carry a machine-identifiable cause", () => {
  // Three separate faults in this codebase have surfaced as an identical bare
  // "Internal server error.", each costing a round-trip to server logs. The
  // class name and Postgres code are schema-level and safe to return.
  it("returns the Postgres code and error class on an unhandled fault", async () => {
    const pgError = Object.assign(new Error("relation \"public.widgets\" does not exist"), {
      code: "42P01",
      name: "PostgrestError",
      details: "secret customer row contents",
      hint: "also sensitive",
    });
    const body = await apiError(pgError).json() as {
      error: { code?: string; kind?: string; request_id?: string; details?: string; hint?: string };
    };
    expect(body.error.code).toBe("42P01");
    expect(body.error.kind).toBe("PostgrestError");
    expect(body.error.request_id).toBeTruthy();
    // Row-quoting fields must never be echoed to the caller.
    expect(JSON.stringify(body)).not.toContain("secret customer row");
    expect(JSON.stringify(body)).not.toContain("also sensitive");
  });

  it("omits the fields entirely for a plain Error", async () => {
    const body = await apiError(new Error("boom")).json() as { error: Record<string, unknown> };
    expect(body.error.code).toBeUndefined();
    expect(body.error.kind).toBeUndefined();
    expect(body.error.message).toBe("Internal server error.");
  });
});

describe("SQL functions do not shadow the columns they write", () => {
  // consume_rate_limit declared locals named `window_start`/`window_seconds`,
  // colliding with the rate_limit_windows columns. Postgres then raised 42702
  // on the ON CONFLICT target, and because the caller fails closed, every
  // authenticated request became an opaque 500.
  it("keeps PL/pgSQL locals distinct from conflict-target column names", async () => {
    const { readFileSync } = await import("fs");
    const sql = readFileSync(new URL("../supabase/qrouter.sql", import.meta.url), "utf8");

    const offenders: string[] = [];
    for (const fn of sql.split(/create or replace function /i).slice(1)) {
      const name = fn.slice(0, fn.indexOf("(")).trim();
      const declared = [...fn.matchAll(/declare\s+([^]*?)\bbegin\b/gi)]
        .flatMap((m) => [...m[1].matchAll(/([a-z_][a-z0-9_]*)\s+[a-z]/gi)].map((d) => d[1].toLowerCase()));
      for (const target of fn.matchAll(/on conflict\s*\(([^)]*)\)/gi)) {
        for (const column of target[1].split(",").map((c) => c.trim().toLowerCase())) {
          if (declared.includes(column)) offenders.push(`${name}: "${column}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
