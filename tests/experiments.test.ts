import { beforeEach, describe, expect, it, vi } from "vitest";
import { assessDistribution, experimentSchema } from "@/lib/qrouter/experiments";
import { createExecutionGroup } from "@/lib/qrouter/v2-service";
import { createExecutionGroupSchema } from "@/lib/qrouter/v2";
import { demoV2Circuits, demoV2Groups } from "@/lib/qrouter/v2-demo-store";
import { demoJobs } from "@/lib/qrouter/demo-store";
import type { Principal } from "@/lib/qrouter/auth";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), routing: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/qrouter/pipeline", () => ({ prepareExecution: mocks.prepare }));
vi.mock("@/lib/qrouter/routingContext", () => ({ loadRoutingContext: mocks.routing }));
vi.mock("@/lib/qrouter/execution", () => ({ submitToProvider: mocks.submit, cancelProviderJob: vi.fn() }));

const circuitId = "11111111-1111-4111-8111-111111111111";
const principal: Principal = { organizationId: "org-a", userId: null, apiKeyId: null, demo: true };
function definition() {
  return experimentSchema.parse({ name: "Bell validation", objective: "Validate expected Bell outcomes.", circuit_id: circuitId,
    execution_intent: "simulate", targets: ["qci-aer-gpu"], shots: 10000, max_total_cost: 1,
    reference: { kind: "distribution", probabilities: { "00": 0.5, "11": 0.5 }, provenance: "Analytic circuit distribution" },
    success_criterion: { metric: "total_variation_distance", max_distance: 0.1, confidence: 0.95 } });
}

describe("distribution assessment", () => {
  it("passes a well sampled matching distribution and fails a disjoint one", () => {
    const pass = assessDistribution(definition(), { counts: { "00": 5000, "11": 5000 }, shots: 10000 });
    expect(pass.status).toBe("pass"); expect(pass.distance).toBe(0); expect(pass.interval![1]).toBeLessThan(0.1);
    const fail = assessDistribution(definition(), { counts: { "01": 10000 }, shots: 10000 });
    expect(fail.status).toBe("fail"); expect(fail.distance).toBe(1);
  });

  it("keeps a small exact-looking sample inconclusive", () => {
    expect(assessDistribution(definition(), { counts: { "00": 50, "11": 50 }, shots: 100 }).status).toBe("inconclusive");
  });

  it("accounts for outcomes outside the reference support", () => {
    const result = assessDistribution(definition(), { counts: { "00": 4500, "11": 4500, "01": 1000 }, shots: 10000 });
    expect(result.distance).toBeCloseTo(0.1);
    expect(result.status).toBe("inconclusive");
  });

  it.each([
    { counts: { "00": 50, "11": 50 }, shots: 101 },
    { counts: { "00": -1, "11": 101 }, shots: 100 },
    { counts: { "00": 0.5, "11": 99.5 }, shots: 100 },
    { counts: { "0": 100 }, shots: 100 },
    { counts: {}, shots: 0 },
    { probabilities: { "00": 0.5, "11": 0.5 }, shots: 10000 },
    { counts: { "00": 5000, "11": 5000 }, shots: 10000, metadata: { synthetic: [{ field: "counts" }] } },
  ])("does not grant sampling confidence to invalid or synthetic evidence %#", (result) => {
    expect(assessDistribution(definition(), result).status).toBe("inconclusive");
  });

  it("supports a genuinely record-only experiment", () => {
    const d = definition();
    d.reference = { kind: "none", reason: "No known classical reference distribution." };
    d.success_criterion = { metric: "record_only" };
    expect(assessDistribution(d, null).status).toBe("record_only");
    expect(experimentSchema.safeParse({ ...d, success_criterion: definition().success_criterion }).success).toBe(false);
  });

  it("rejects inconsistent reference dimensions, non-normalized mass and duplicate targets", () => {
    const d = definition();
    expect(experimentSchema.safeParse({ ...d, reference: { kind: "distribution", provenance: "analytic", probabilities: { "0": 0.5, "11": 0.5 } } }).success).toBe(false);
    expect(experimentSchema.safeParse({ ...d, reference: { kind: "distribution", provenance: "analytic", probabilities: { "00": 0.4, "11": 0.4 } } }).success).toBe(false);
    expect(experimentSchema.safeParse({ ...d, targets: ["auto", "auto"] }).success).toBe(false);
  });
});

describe("whole campaign budget boundary", () => {
  beforeEach(() => {
    demoV2Circuits.clear(); demoV2Groups.clear(); demoJobs.clear(); vi.clearAllMocks();
    demoV2Circuits.set(circuitId, { id: circuitId, organization_id: principal.organizationId, name: null, format: "openqasm2", source_hash: "hash", analysis: {}, source: "test source", created_at: "2026-01-01T00:00:00Z", released_at: null, expires_at: null, idempotency_key: "circuit-key", request_hash: "hash" });
    mocks.routing.mockResolvedValue({ backends: [], snapshot: { id: null, ts: "2026-01-01T00:00:00Z" } });
    mocks.prepare.mockResolvedValue({ quote: { total: 0.6 } });
  });

  it("rejects aggregate overspend before storing or submitting any execution", async () => {
    const input = createExecutionGroupSchema.parse({ circuit_id: circuitId, max_total_cost: 1, executions: [
      { key: "a", target: "auto", shots: 100 }, { key: "b", target: "auto", shots: 100 },
    ] });
    await expect(createExecutionGroup(principal, input, "budget-key", "request-id")).rejects.toMatchObject({ status: 422, code: "campaign_budget_exceeded" });
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(demoJobs.size).toBe(0); expect(demoV2Groups.size).toBe(0);
  });

  it("coalesces concurrent same-key demo groups before compiling or submitting", async () => {
    mocks.prepare.mockImplementation(async () => {
      await Promise.resolve();
      return { quote: { total: 0.1 }, transpilation: { qasm: "quoted source" },
        decision: { selected: { id: "qci-aer-gpu" }, candidates: [], mode: "balanced" },
        executionAnalysis: {}, bundles: [{ backend_id: "other-backend", media_type: "text/qasm2", payload: "wrong source" }, { backend_id: "qci-aer-gpu", media_type: "text/qasm2", payload: "quoted source" }] };
    });
    mocks.submit.mockResolvedValue({ providerJobId: "local-job", status: "completed", result: { counts: { "0": 100 }, shots: 100 } });
    const input = createExecutionGroupSchema.parse({ circuit_id: circuitId, max_total_cost: 1, executions: [{ key: "a", target: "auto", shots: 100 }] });
    const [left, right] = await Promise.all([
      createExecutionGroup(principal, input, "concurrent-group", "request-a"),
      createExecutionGroup(principal, input, "concurrent-group", "request-b"),
    ]);
    expect(left.group.id).toBe(right.group.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect(mocks.prepare).toHaveBeenCalledTimes(1); expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit.mock.calls[0][4]).toMatchObject({ backend_id: "qci-aer-gpu", payload: "quoted source" });
    expect(demoV2Groups.size).toBe(1);
  });

  it("rejects changed concurrent input and clears a failed in-flight attempt for retry", async () => {
    mocks.prepare.mockRejectedValue(new Error("compiler temporarily unavailable"));
    const input = createExecutionGroupSchema.parse({ circuit_id: circuitId, max_total_cost: 1, executions: [{ key: "a", target: "auto", shots: 100 }] });
    const first = createExecutionGroup(principal, input, "conflicting-group", "request-a");
    await expect(createExecutionGroup(principal, { ...input, max_total_cost: 2 }, "conflicting-group", "request-b")).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(first).rejects.toThrow(/temporarily unavailable/);
    await expect(createExecutionGroup(principal, input, "conflicting-group", "request-c")).rejects.toThrow(/temporarily unavailable/);
    expect(mocks.prepare).toHaveBeenCalledTimes(2); expect(mocks.submit).not.toHaveBeenCalled();
  });
});
