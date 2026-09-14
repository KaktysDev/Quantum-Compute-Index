import { reportCacheKey } from "./cache";
import { buildReportContext } from "./context";
import { loadOwnedJob, loadOwnedResult, type OwnedJob } from "./load";
import { generateReportNarrative } from "./narrative";
import type { Principal } from "@/lib/qrouter/auth";
import type { JobReportContext } from "./types";

export async function assembleJobReport(input: {
  principal: Principal;
  jobId: string;
  signal?: AbortSignal;
  withNarrative?: boolean;
}): Promise<{ job: OwnedJob; context: JobReportContext; cacheKey: string } | null> {
  const job = await loadOwnedJob(input.principal, input.jobId);
  if (!job) return null;
  const result = await loadOwnedResult(input.principal, job);
  const context = buildReportContext({ job, result });
  const cacheKey = reportCacheKey(String(job.id), context.hash);
  if (input.withNarrative !== false) {
    context.narrative = await generateReportNarrative(context, cacheKey, input.signal);
  }
  return { job, context, cacheKey };
}
