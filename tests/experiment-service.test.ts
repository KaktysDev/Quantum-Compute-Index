import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExperiment, experimentEvidence, getExperiment, listExperiments, quoteExperiment, runExperiment } from "@/lib/qrouter/experiment-service";
import { experimentSchema } from "@/lib/qrouter/experiments";
import { demoV2Circuits } from "@/lib/qrouter/v2-demo-store";
import type { Principal } from "@/lib/qrouter/auth";
import { V2ApiError } from "@/lib/qrouter/v2-http";

const mocks = vi.hoisted(() => ({ circuit: vi.fn(), group: vi.fn(), getGroup: vi.fn(), prepare: vi.fn(), routing: vi.fn() }));
vi.mock("@/lib/qrouter/v2-service", () => ({ getCircuitResource: mocks.circuit, createExecutionGroup: mocks.group, getExecutionGroup: mocks.getGroup }));
vi.mock("@/lib/qrouter/pipeline", () => ({ prepareExecution: mocks.prepare }));
vi.mock("@/lib/qrouter/routingContext", () => ({ loadRoutingContext: mocks.routing }));

const circuitId = "11111111-1111-4111-8111-111111111111";
const principal: Principal = { organizationId: "org-a", userId: null, apiKeyId: null, demo: true };
const outsider: Principal = { ...principal, organizationId: "org-b" };
const circuit = { id: circuitId, organization_id: "org-a", source_hash: "source-sha", analysis: { classicalBits: 2 }, format: "openqasm2", released_at: null };
function definition() {
  return experimentSchema.parse({ name: "Bell validation", objective: "Validate expected Bell outcomes.", circuit_id: circuitId,
    execution_intent: "simulate", targets: ["auto"], shots: 10000, max_total_cost: 1,
    reference: { kind: "distribution", probabilities: { "00": 0.5, "11": 0.5 }, provenance: "Analytic circuit distribution" },
    success_criterion: { metric: "total_variation_distance", max_distance: 0.1, confidence: 0.95 } });
}

beforeEach(() => {
  vi.clearAllMocks(); demoV2Circuits.clear();
  const state = globalThis as typeof globalThis & { __qrouterExperiments?: Map<string, unknown>; __qrouterExperimentRuns?: Map<string, unknown> };
  state.__qrouterExperiments?.clear(); state.__qrouterExperimentRuns?.clear();
  mocks.circuit.mockResolvedValue({ ...circuit });
  mocks.group.mockResolvedValue({ group: { id: "group-a", status: "completed", executions: [] }, outcome: "completed" });
  mocks.routing.mockResolvedValue({ backends: [], snapshot: { id: null, ts: "2026-01-01T00:00:00Z" } });
});

describe("immutable experiment service", () => {
  it("replays the same create key and rejects changed definitions", async () => {
    const first = await createExperiment(principal, definition(), "experiment-key");
    const again = await createExperiment(principal, definition(), "experiment-key");
    expect(again.replayed).toBe(true); expect(again.experiment.id).toBe(first.experiment.id);
    await expect(createExperiment(principal, { ...definition(), shots: 5000 }, "experiment-key")).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect(first.experiment.definition_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("canonically hashes equivalent references regardless of object key order", async () => {
    const first = await createExperiment(principal, definition(), "canonical-key");
    const reordered = definition();
    reordered.reference = { kind: "distribution", probabilities: { "11": 0.5, "00": 0.5 }, provenance: "Analytic circuit distribution" };
    const replay = await createExperiment(principal, reordered, "canonical-key");
    const independentlyCreated = await createExperiment(principal, reordered, "separate-key");
    expect(replay.replayed).toBe(true);
    expect(replay.experiment.id).toBe(first.experiment.id);
    expect(independentlyCreated.experiment.definition_hash).toBe(first.experiment.definition_hash);
  });

  it("coalesces concurrent experiment creation at the demo uniqueness boundary", async () => {
    const [left, right] = await Promise.all([
      createExperiment(principal, definition(), "concurrent-create"),
      createExperiment(principal, definition(), "concurrent-create"),
    ]);
    expect(left.experiment.id).toBe(right.experiment.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
  });

  it("isolates reads, previous versions and evidence by organization", async () => {
    const { experiment } = await createExperiment(principal, definition(), "experiment-key");
    expect(await listExperiments(outsider)).toEqual([]);
    await expect(getExperiment(outsider, experiment.id)).rejects.toMatchObject({ status: 404 });
    await expect(experimentEvidence(outsider, experiment.id)).rejects.toMatchObject({ status: 404 });
    await expect(createExperiment(outsider, { ...definition(), previous_version_id: experiment.id }, "new-version-key")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses released sources and references with a different memory width", async () => {
    mocks.circuit.mockResolvedValueOnce({ ...circuit, released_at: "2026-10-26T00:00:00Z" });
    await expect(createExperiment(principal, definition(), "released-key")).rejects.toMatchObject({ code: "circuit_released" });
    mocks.circuit.mockResolvedValueOnce({ ...circuit, analysis: { classicalBits: 1 } });
    await expect(createExperiment(principal, definition(), "width-key")).rejects.toMatchObject({ code: "reference_width_mismatch" });
  });

  it("requires the current hash and exact complete budget before creating a group", async () => {
    const { experiment } = await createExperiment(principal, definition(), "experiment-key");
    await expect(runExperiment(principal, experiment.id, { approved_definition_hash: "0".repeat(64), approved_max_total_cost: 1 }, "run-key", "request-id")).rejects.toMatchObject({ code: "approval_mismatch" });
    await expect(runExperiment(principal, experiment.id, { approved_definition_hash: experiment.definition_hash, approved_max_total_cost: 2 }, "run-key", "request-id")).rejects.toMatchObject({ code: "approval_mismatch" });
    expect(mocks.group).not.toHaveBeenCalled();
  });

  it("reuses a stable nested execution key on run replay and binds intent and ceiling", async () => {
    const { experiment } = await createExperiment(principal, definition(), "experiment-key");
    const approval = { approved_definition_hash: experiment.definition_hash, approved_max_total_cost: 1 };
    const first = await runExperiment(principal, experiment.id, approval, "run-key", "request-id");
    const second = await runExperiment(principal, experiment.id, approval, "run-key", "request-id-2");
    expect(second.replayed).toBe(true); expect(second.run.id).toBe(first.run.id);
    expect(mocks.group.mock.calls[0][2]).toBe(mocks.group.mock.calls[1][2]);
    expect(mocks.group.mock.calls[0][1]).toMatchObject({ max_total_cost: 1, executions: [{ failover: false, max_attempts: 1, constraints: { executionIntent: "simulate" } }] });
  });

  it("blocks quotes and runs after source release", async () => {
    const { experiment } = await createExperiment(principal, definition(), "experiment-key");
    mocks.circuit.mockResolvedValue({ ...circuit, released_at: "2026-10-26T00:00:00Z" });
    await expect(quoteExperiment(principal, experiment.id)).rejects.toMatchObject({ code: "circuit_released" });
    await expect(runExperiment(principal, experiment.id, { approved_definition_hash: experiment.definition_hash, approved_max_total_cost: 1 }, "run-key", "request-id")).rejects.toMatchObject({ code: "circuit_released" });
    expect(mocks.group).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("records a rejected pre-submission budget as not submitted instead of preparing forever", async () => {
    const { experiment } = await createExperiment(principal, definition(), "budget-definition");
    const failure = new V2ApiError(422, "campaign_budget_exceeded", "The quote exceeds the approved campaign ceiling.");
    mocks.group.mockRejectedValueOnce(failure);
    await expect(runExperiment(principal, experiment.id,
      { approved_definition_hash: experiment.definition_hash, approved_max_total_cost: 1 }, "budget-run-key", "request-id")).rejects.toBe(failure);
    const evidence = await experimentEvidence(principal, experiment.id);
    expect(evidence.runs).toHaveLength(1);
    expect(evidence.runs[0]).toMatchObject({ status: "not_submitted", group_id: null, executions: [], error: { message: failure.message } });
    expect(mocks.getGroup).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous failure private and recovers through the same run idempotency key", async () => {
    const { experiment } = await createExperiment(principal, definition(), "recover-definition");
    const approval = { approved_definition_hash: experiment.definition_hash, approved_max_total_cost: 1 };
    mocks.group.mockRejectedValueOnce(new Error("private provider/database failure detail"));
    await expect(runExperiment(principal, experiment.id, approval, "recover-run-key", "first-request")).rejects.toThrow("private provider/database");
    const interrupted = await experimentEvidence(principal, experiment.id);
    expect(interrupted.runs[0]).toMatchObject({ status: "preparation_unknown", group_id: null, executions: [] });
    expect(JSON.stringify(interrupted)).not.toContain("private provider/database");
    mocks.getGroup.mockResolvedValue({ id: "group-a", status: "completed", executions: [] });
    const recovered = await runExperiment(principal, experiment.id, approval, "recover-run-key", "recovery-request");
    expect(recovered.replayed).toBe(true);
    expect(recovered.run.id).toBe(interrupted.runs[0].id);
    expect(mocks.group.mock.calls[0][2]).toBe(mocks.group.mock.calls[1][2]);
    const complete = await experimentEvidence(principal, experiment.id);
    expect(complete.runs).toHaveLength(1);
    expect(complete.runs[0]).toMatchObject({ status: "completed", group_id: "group-a" });
  });

  it("redacts released reference data from reads, lists and idempotent replays", async () => {
    const { experiment } = await createExperiment(principal, definition(), "experiment-key");
    const releasedAt = "2026-10-26T00:00:00Z";
    demoV2Circuits.set(circuitId, { ...circuit, format: "openqasm2", name: null, source: "", created_at: releasedAt, released_at: releasedAt, expires_at: null, idempotency_key: "circuit-key", request_hash: "hash" });
    mocks.circuit.mockResolvedValue({ ...circuit, released_at: releasedAt });
    expect((await getExperiment(principal, experiment.id)).definition.reference.kind).toBe("none");
    expect((await listExperiments(principal))[0].definition.reference.kind).toBe("none");
    const replay = await createExperiment(principal, definition(), "experiment-key");
    expect(replay.experiment.definition.reference.kind).toBe("none");
    expect(replay.experiment.definition_hash).toBe(experiment.definition_hash);
    demoV2Circuits.delete(circuitId);
    expect(await listExperiments(principal)).toEqual([]);
  });
});
