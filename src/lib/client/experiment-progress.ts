type ProgressRecord = { runs: Array<{ executions: Array<{ id: string; status: string }> }> };
const ACTIVE = new Set(["queued", "funds_reserved", "dispatching", "submitted", "processing", "cancellation_requested"]);

/** Owner-scoped advancement uses the existing server-side funding and lease
 * guards. GET evidence stays read-only; an open campaign can progress even on
 * deployments without a fleet scheduler. Bound each tick to five executions.
 */
export async function progressExperiment<T extends ProgressRecord>(
  id: string,
  load: (id: string) => Promise<T>,
  advance: (jobId: string) => Promise<unknown>,
): Promise<T> {
  const record = await load(id);
  const ids = [...new Set(record.runs.flatMap((run) => run.executions).filter((execution) => ACTIVE.has(execution.status)).map((execution) => execution.id))].slice(0, 5);
  if (!ids.length) return record;
  const outcomes = await Promise.allSettled(ids.map((jobId) => advance(jobId)));
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return load(id);
}
