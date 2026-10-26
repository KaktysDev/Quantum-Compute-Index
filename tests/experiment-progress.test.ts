import { describe, expect, it, vi } from "vitest";
import { progressExperiment } from "@/lib/client/experiment-progress";

describe("campaign progression without a fleet scheduler", () => {
  it("advances active funded executions and reloads evidence afterward", async () => {
    const queued = { runs: [{ executions: [{ id: "job-a", status: "queued" }, { id: "job-b", status: "processing" }] }] };
    const completed = { runs: [{ executions: [{ id: "job-a", status: "completed" }, { id: "job-b", status: "completed" }] }] };
    const load = vi.fn().mockResolvedValueOnce(queued).mockResolvedValueOnce(completed);
    const advance = vi.fn().mockResolvedValue({ action: "dispatched" });
    expect(await progressExperiment("experiment-a", load, advance)).toBe(completed);
    expect(advance.mock.calls.map(([id]) => id)).toEqual(["job-a", "job-b"]);
    expect(load.mock.calls).toEqual([["experiment-a"], ["experiment-a"]]);
  });

  it("leaves terminal, quoted and unfunded executions untouched", async () => {
    const record = { runs: [{ executions: ["completed", "failed", "cancelled", "quoted", "awaiting_payment"].map((status) => ({ id: status, status })) }] };
    const load = vi.fn().mockResolvedValue(record);
    const advance = vi.fn();
    expect(await progressExperiment("experiment-a", load, advance)).toBe(record);
    expect(advance).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("deduplicates shared execution ids and bounds one tick to five writes", async () => {
    const executions = Array.from({ length: 8 }, (_, index) => ({ id: `job-${index}`, status: "submitted" }));
    const record = { runs: [{ executions }, { executions }] };
    const advance = vi.fn().mockResolvedValue({ action: "polled" });
    await progressExperiment("experiment-a", vi.fn().mockResolvedValue(record), advance);
    expect(advance.mock.calls.map(([id]) => id)).toEqual(executions.slice(0, 5).map((execution) => execution.id));
  });

  it("propagates funding or authorization errors without reporting fresh success", async () => {
    const record = { runs: [{ executions: [{ id: "job-a", status: "queued" }, { id: "job-b", status: "submitted" }] }] };
    const load = vi.fn().mockResolvedValue(record);
    const failure = new Error("Write scope is required");
    const advance = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ action: "polled" });
    await expect(progressExperiment("experiment-a", load, advance)).rejects.toBe(failure);
    expect(advance).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
