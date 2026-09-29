// Shared run-duration formatting for the console.
//
// Every surface that shows "how long did this take" — the Activity table, the
// Usage summary, the assistant's run card — needs the same rounding and the
// same wording, otherwise the same job appears to have taken two lengths.

import { isSettled } from "./status";

/** `1.4s` under a minute, then `2m 30s`, then `1h 12m`. `—` when unknown. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${whole % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Elapsed run time in milliseconds.
 *
 * `started_at` is set when the dispatcher picks the job up, so a job that is
 * still queued measures from creation — that is the number a user waiting on a
 * result actually cares about ("how long since I asked for this"), not the
 * provider's own execution window.
 */
export function elapsedMs(
  job: { status?: string; created_at: string; started_at?: string | null; completed_at?: string | null; updated_at?: string | null },
  now = Date.now(),
): number {
  const from = new Date(job.started_at ?? job.created_at).getTime();
  // A job parked on credits stopped moving when it was last updated.
  const stoppedAt = job.completed_at ?? (job.status && isSettled(job.status) ? job.updated_at : null);
  const to = stoppedAt ? new Date(stoppedAt).getTime() : now;
  const value = to - from;
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
