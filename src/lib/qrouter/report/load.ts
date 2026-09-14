/**
 * Load an org-owned job and its slim public result for the report pipeline.
 */

import { loadArtifact } from "@/lib/qrouter/artifacts";
import type { Principal } from "@/lib/qrouter/auth";
import { demoJobs } from "@/lib/qrouter/demo-store";
import { slimJobForOwner, slimResult } from "@/lib/qrouter/encoding/public";
import { createAdminClient } from "@/lib/supabase/admin";

export const RESULT_JSON_MAX_BYTES = 1_500_000;

export type OwnedJob = Record<string, unknown> & { id: string; organization_id?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export async function loadOwnedJob(principal: Principal, id: string): Promise<OwnedJob | null> {
  if (principal.demo) {
    const job = demoJobs.get(id);
    if (!job || job.organization_id !== principal.organizationId) return null;
    return slimJobForOwner(job as unknown as Record<string, unknown>) as OwnedJob;
  }
  const admin = createAdminClient();
  const { data: job, error } = await admin.from("jobs").select("*").eq("id", id).eq("organization_id", principal.organizationId).maybeSingle();
  if (error) throw error;
  if (!job) return null;
  const { data: quote } = await admin.from("quotes").select("total").eq("job_id", id).maybeSingle();
  return slimJobForOwner({ ...job, quote } as Record<string, unknown>) as OwnedJob;
}

export function parseResultJson(raw: string): Record<string, unknown> | null {
  if (Buffer.byteLength(raw, "utf8") > RESULT_JSON_MAX_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asRecord(slimResult(parsed));
  } catch {
    return null;
  }
}

export async function loadOwnedResult(principal: Principal, job: OwnedJob): Promise<Record<string, unknown> | null> {
  const inline = asRecord(job.result);
  if (inline && (inline.counts || inline.probabilities || inline.shots != null)) {
    return asRecord(slimResult(inline));
  }
  if (principal.demo) return inline ? asRecord(slimResult(inline)) : null;
  const raw = await loadArtifact(String(job.id), "result");
  if (!raw) return inline ? asRecord(slimResult(inline)) : null;
  return parseResultJson(raw) ?? (inline ? asRecord(slimResult(inline)) : null);
}

export function notFound() {
  return { error: { type: "not_found", message: "Job not found." } };
}
