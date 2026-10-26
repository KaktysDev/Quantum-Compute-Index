import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeCircuit } from "@/lib/qrouter/analyze";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { summarizeAttemptUsage, type JobAttempt } from "@/lib/qrouter/dispatcher";
import { assertRequeueGroupBudget } from "@/lib/qrouter/credits";
import { nextAttemptCandidate } from "@/lib/qrouter/orchestration";
import { configuredNativePricing, providerPrice, totalPrice } from "@/lib/qrouter/pricing";
import { buildQuote, routeCircuit } from "@/lib/qrouter/route";
import type { Backend } from "@/lib/qrouter/types";

const analysis = analyzeCircuit('OPENQASM 2.0; include "qelib1.inc"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;', "openqasm2");
function backend(id: string, usdPerShot = .01): Backend {
  return { ...BACKENDS[0], id, provider: "test-provider", kind: "qpu", available: true,
    nativePricing: { kind: "per-shot", usdPerShot, usdPerTask: .3, source: "fixture seller rate",
      observedAt: "2026-01-01T00:00:00Z", validUntil: "9999-12-31T00:00:00Z", channel: "test-provider" } };
}
const hardware = { executionIntent: "hardware" as const };
afterEach(() => vi.unstubAllEnvs());

describe("native billing and total budget", () => {
  it("uses task + shots regardless of synthetic NQH and circuit gate counts", () => {
    const target = { ...backend("native"), pricePerNqh: 9_000_000 };
    const light = routeCircuit({ backends: [target], analysis, shots: 100, target: target.id, mode: "cost" });
    const heavy = routeCircuit({ backends: [target], analysis: { ...analysis, gates: 190, twoQubitGates: 80 }, shots: 100, target: target.id, mode: "cost" });
    expect(light.candidates[0].estimatedProviderCost).toBe(1.3);
    expect(heavy.candidates[0].estimatedProviderCost).toBe(1.3);
    expect(buildQuote(light, analysis, 100).rateSnapshot).not.toHaveProperty("qciSnapshotId");
  });
  it("rejects unknown, expired, channel-mismatched and malformed pricing", () => {
    for (const target of [
      { ...backend("unknown"), nativePricing: undefined },
      { ...backend("unknown"), nativePricing: { kind: "unknown" as const, reason: "requires runtime usage" } },
      { ...backend("expired"), nativePricing: { ...backend("x").nativePricing!, validUntil: "2020-01-01" } },
      { ...backend("channel"), nativePricing: { ...backend("x").nativePricing!, channel: "other-channel" } },
    ]) expect(providerPrice(target as Backend, 100).error).toBeTruthy();
    const unknown = { ...backend("unknown"), nativePricing: undefined };
    expect(() => routeCircuit({ backends: [unknown], analysis, shots: 100, target: "unknown", mode: "cost" })).toThrow(/Native provider pricing is unknown/);
  });
  it("requires explicit hardware intent for automatic routes", () => {
    const pool = [BACKENDS[0], backend("physical")];
    expect(routeCircuit({ backends: pool, analysis, shots: 100, target: "auto", mode: "quality" }).selected.kind).toBe("simulator");
    expect(routeCircuit({ backends: pool, analysis, shots: 100, target: "auto", mode: "quality", constraints: hardware }).selected.kind).toBe("qpu");
    expect(routeCircuit({ backends: pool, analysis, shots: 100, target: "physical", mode: "quality" }).executionIntent).toBe("hardware");
  });
  it("enforces software fees and the full retry reservation under maxCost", () => {
    const target = backend("physical");
    const input = { backends: [target], analysis, shots: 100, target: target.id, mode: "cost" as const };
    expect(() => routeCircuit({ ...input, constraints: { maxCost: 1.3 } })).toThrow(/total reservation/);
    expect(() => routeCircuit({ ...input, constraints: { maxCost: 3 }, failover: { enabled: true, max_attempts: 3 } })).toThrow(/total reservation/);
    const ceiling = totalPrice(analysis, 3.9);
    const route = routeCircuit({ ...input, constraints: { maxCost: ceiling }, failover: { enabled: true, max_attempts: 3 } });
    expect(buildQuote(route, analysis, 100).total).toBeCloseTo(ceiling, 6);
  });
  it("reranks using each target's compiled software cost and marks the frontier", () => {
    const a = backend("cheap-before-compile", .001);
    const b = backend("cheap-after-compile", .002);
    const input = { backends: [a, b], analysis, shots: 100, target: "auto", mode: "cost" as const, constraints: hardware };
    expect(routeCircuit(input).selected.id).toBe(a.id);
    const route = routeCircuit({ ...input, compiledAnalyses: { [a.id]: { ...analysis, gates: 100_000 }, [b.id]: analysis } });
    expect(route.selected.id).toBe(b.id);
    expect(route.candidates.find((c) => c.backend.id === b.id)?.paretoOptimal).toBe(true);
  });
  it("does not accept synthetic per-shot config for runtime or direct gate-based billing", () => {
    vi.stubEnv("QROUTER_NATIVE_RATES_JSON", JSON.stringify({ "ibm-brisbane": backend("x").nativePricing }));
    expect(configuredNativePricing(BACKENDS.find((b) => b.id === "ibm-brisbane")!)).toMatchObject({ kind: "unknown" });
  });
  it("retains group spending approval when parked jobs are repriced", () => {
    expect(() => assertRequeueGroupBudget([{ total: 2 }, { total: 4 }], { approved_max_total_cost: "5" })).toThrow(/approved total budget/);
    expect(() => assertRequeueGroupBudget([{ total: 2 }, { total: 3 }], { approved_max_total_cost: "5" })).not.toThrow();
    expect(() => assertRequeueGroupBudget([{ total: 0 }], { approved_max_total_cost: "invalid" })).toThrow();
  });
});

describe("cumulative retry authorization", () => {
  function decision() {
    const route = routeCircuit({ backends: [backend("a"), backend("b")], analysis, shots: 100, target: "auto", mode: "cost", constraints: hardware, failover: { enabled: true, max_attempts: 2 } });
    route.candidates = route.candidates.map((c) => ({ ...c, compiled: true, quoteBinding: "binding" }));
    return route;
  }
  it("stops after an ambiguous external submission and never treats unknown cost as zero", () => {
    const route = decision();
    const input = { decision: route, attemptedBackendIds: [route.selected.id], failoverEnabled: true, maxAttempts: 2 };
    expect(nextAttemptCandidate(input)).toBeNull();
    expect(nextAttemptCandidate({ ...input, usage: [{ backendId: route.selected.id, confirmed: false }] })).toBeNull();
    expect(nextAttemptCandidate({ ...input, usage: [{ backendId: route.selected.id, confirmed: true, cost: 0, ambiguous: true }] })).toBeNull();
    expect(nextAttemptCandidate({ ...input, usage: [{ backendId: route.selected.id, confirmed: true, cost: 0 }] })?.backend.id).toBe("b");
  });
  it("deducts cumulative known cost and refuses indicative or legacy quotes", () => {
    const route = decision();
    const input = { decision: route, attemptedBackendIds: [route.selected.id], failoverEnabled: true, maxAttempts: 2 };
    expect(nextAttemptCandidate({ ...input, usage: [{ backendId: route.selected.id, confirmed: true, cost: 2.5 }] })).toBeNull();
    route.candidates[1].quoteBinding = "indicative";
    expect(nextAttemptCandidate({ ...input, usage: [{ backendId: route.selected.id, confirmed: true, cost: 0 }] })).toBeNull();
    route.pricingVersion = undefined;
    expect(nextAttemptCandidate({ ...input, attemptedBackendIds: [] })).toBeNull();
  });
});


describe("usage reconciliation evidence", () => {
  it("sums all attempts and retains unknown actual costs", () => {
    const decision = routeCircuit({ backends: [backend("a"), backend("b")], analysis, shots: 100, target: "auto", mode: "cost", constraints: hardware });
    const attempts: JobAttempt[] = [
      { attempt: 1, backend_id: "a", provider_job_id: "p1", status: "failed", response: { billing: { status: "confirmed", estimated: 1.3, actual: 0.4 } } },
      { attempt: 2, backend_id: "b", provider_job_id: "p2", status: "completed", response: { billing: { status: "estimated", estimated: 1.3 } } },
    ];
    expect(summarizeAttemptUsage(attempts, decision)).toEqual({ estimated: 2.6, actual: null, confirmed: false });
    attempts[1].response = { billing: { status: "confirmed", estimated: 1.3, actual: 0 } };
    expect(summarizeAttemptUsage(attempts, decision)).toEqual({ estimated: 2.6, actual: 0.4, confirmed: true });
    attempts[1].response = { billing: { status: "confirmed", estimated: 1.3, actual: -5 } };
    expect(summarizeAttemptUsage(attempts, decision).actual).toBeNull();
  });
});
