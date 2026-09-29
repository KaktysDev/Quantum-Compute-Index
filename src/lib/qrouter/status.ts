// Single source of truth for how job, execution and group statuses read in the
// console. Pure constants so client components can import it.

import type { JobStatus } from "./types";
import type { V2GroupStatus } from "./v2";

export type StatusTone = "neutral" | "progress" | "success" | "warning" | "danger";
export type StatusView = { label: string; tone: StatusTone };

export const EXECUTION_STATUS: Record<JobStatus, StatusView> = {
  created: { label: "Created", tone: "progress" },
  analyzing: { label: "Analyzing", tone: "progress" },
  quoted: { label: "Quoted", tone: "progress" },
  awaiting_payment: { label: "Needs credits", tone: "warning" },
  funds_reserved: { label: "Reserved", tone: "progress" },
  queued: { label: "Queued", tone: "progress" },
  dispatching: { label: "Dispatching", tone: "progress" },
  submitted: { label: "Submitted", tone: "progress" },
  processing: { label: "Running", tone: "progress" },
  cancellation_requested: { label: "Cancelling", tone: "progress" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const GROUP_STATUS: Record<V2GroupStatus, StatusView> = {
  queued: { label: "Queued", tone: "progress" },
  running: { label: "Running", tone: "progress" },
  awaiting_payment: { label: "Needs credits", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function statusView(status: string): StatusView {
  return (
    (EXECUTION_STATUS as Record<string, StatusView>)[status] ??
    (GROUP_STATUS as Record<string, StatusView>)[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" }
  );
}

/** The job has stopped for good. Decides whether Cancel is offered. */
export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

/**
 * Nothing will change without outside action. Decides polling and live timers.
 * Matches `SETTLED` in the dispatcher: awaiting_payment waits on a top-up.
 */
export const SETTLED_STATUSES = [...TERMINAL_STATUSES, "awaiting_payment"] as const;

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function isSettled(status: string): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

/** Statuses the dispatcher can move forward via POST /jobs/:id/advance. */
export const ADVANCEABLE_STATUSES = ["funds_reserved", "queued", "dispatching", "submitted", "processing"] as const;

export function isAdvanceable(status: string): boolean {
  return (ADVANCEABLE_STATUSES as readonly string[]).includes(status);
}
