import { describe, expect, it } from "vitest";
import { EXECUTION_STATUS, GROUP_STATUS, isAdvanceable, isSettled, isTerminal, statusView } from "@/lib/qrouter/status";
import { V2_GROUP_STATUSES } from "@/lib/qrouter/v2";

const JOB_STATUSES = [
  "created", "analyzing", "quoted", "awaiting_payment", "funds_reserved", "queued", "dispatching",
  "submitted", "processing", "completed", "failed", "cancellation_requested", "cancelled",
];

describe("console status vocabulary", () => {
  it("labels every execution and group status", () => {
    expect(Object.keys(EXECUTION_STATUS).sort()).toEqual([...JOB_STATUSES].sort());
    expect(Object.keys(GROUP_STATUS).sort()).toEqual([...V2_GROUP_STATUSES].sort());
  });

  it("treats awaiting_payment as settled but still cancellable", () => {
    expect(isSettled("awaiting_payment")).toBe(true);
    expect(isTerminal("awaiting_payment")).toBe(false);
    expect(isAdvanceable("awaiting_payment")).toBe(false);
    expect(statusView("awaiting_payment")).toEqual({ label: "Needs credits", tone: "warning" });
  });

  it("matches the dispatcher's settled set", () => {
    const settled = JOB_STATUSES.filter(isSettled).sort();
    expect(settled).toEqual(["awaiting_payment", "cancelled", "completed", "failed"]);
    for (const status of ["queued", "funds_reserved", "dispatching", "submitted", "processing"]) {
      expect(isAdvanceable(status)).toBe(true);
    }
  });

  it("falls back to a readable label for unknown statuses", () => {
    expect(statusView("some_new_state")).toEqual({ label: "some new state", tone: "neutral" });
  });
});
