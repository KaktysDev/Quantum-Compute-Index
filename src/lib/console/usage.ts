// Usage figures from the credit ledger (what was billed) and the jobs table
// (what ran). Quotes are never summed: a failed or cancelled job's quote was
// released, not spent.

import { chargedFromLedger } from "@/lib/qrouter/cost";
import { demoJobs, DEMO_BALANCE } from "@/lib/qrouter/demo-store";
import { isSettled } from "@/lib/qrouter/status";
import type { ConsoleWorkspace } from "./workspace";

export type UsageDay = { day: string; spend: number; runs: number };
export type UsageBackend = { id: string; runs: number; shots: number; spend: number };

export type UsageSummary = {
  spend: number;
  creditsAdded: number;
  available: number;
  reserved: number;
  runs: { total: number; completed: number; failed: number; active: number; needsCredits: number };
  shots: number;
  days: UsageDay[];
  backends: UsageBackend[];
};

type JobRow = { id: string; status: string; shots: number | null; selected_backend_id: string | null; created_at: string };
type LedgerRow = { type: string; amount: number | string; created_at: string; job_id: string | null };

const dayKey = (iso: string) => iso.slice(0, 10);

function summarize(jobs: JobRow[], ledger: LedgerRow[], available: number, reserved: number, days: number): UsageSummary {
  const buckets = new Map<string, UsageDay>();
  for (let index = days - 1; index >= 0; index -= 1) {
    const day = dayKey(new Date(Date.now() - index * 86_400_000).toISOString());
    buckets.set(day, { day, spend: 0, runs: 0 });
  }
  const backendOf = new Map(jobs.map((job) => [job.id, job.selected_backend_id ?? "unrouted"]));
  const backends = new Map<string, UsageBackend>();
  const backend = (id: string) => {
    const entry = backends.get(id) ?? { id, runs: 0, shots: 0, spend: 0 };
    backends.set(id, entry);
    return entry;
  };

  for (const job of jobs) {
    const bucket = buckets.get(dayKey(job.created_at));
    if (bucket) bucket.runs += 1;
    const entry = backend(job.selected_backend_id ?? "unrouted");
    entry.runs += 1;
    entry.shots += job.shots ?? 0;
  }

  let spend = 0;
  let creditsAdded = 0;
  const byJob = new Map<string, LedgerRow[]>();
  for (const row of ledger) {
    const amount = Number(row.amount) || 0;
    if (row.type === "purchase") creditsAdded += amount;
    if (row.type !== "charge" && row.type !== "refund") continue;
    // Charges are negative ledger amounts; refunds are positive and reduce spend.
    const billed = -amount;
    spend += billed;
    const bucket = buckets.get(dayKey(row.created_at));
    if (bucket) bucket.spend += billed;
    if (row.job_id) byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), row]);
  }
  for (const [jobId, rows] of byJob) {
    const id = backendOf.get(jobId);
    if (id) backend(id).spend += chargedFromLedger(rows) ?? 0;
  }

  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed" || job.status === "cancelled").length;
  const needsCredits = jobs.filter((job) => job.status === "awaiting_payment").length;
  const active = jobs.filter((job) => !isSettled(job.status)).length;

  return {
    spend: Math.max(0, spend),
    creditsAdded,
    available,
    reserved,
    runs: { total: jobs.length, completed, failed, active, needsCredits },
    shots: jobs.reduce((total, job) => total + (job.shots ?? 0), 0),
    days: [...buckets.values()],
    backends: [...backends.values()].sort((a, b) => b.spend - a.spend || b.runs - a.runs).slice(0, 10),
  };
}

export async function loadUsage(workspace: ConsoleWorkspace, days: number): Promise<UsageSummary | null> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  if (workspace.mode === "none") return null;
  if (workspace.mode === "demo") {
    const jobs = [...demoJobs.values()].filter((job) => job.organization_id === workspace.organizationId && job.created_at >= since);
    // Demo jobs have no ledger; a completed demo job is billed at its quote.
    const ledger: LedgerRow[] = jobs
      .filter((job) => job.status === "completed")
      .map((job) => ({ type: "charge", amount: -Number(job.quote?.total ?? 0), created_at: job.completed_at ?? job.created_at, job_id: job.id }));
    return summarize(jobs, ledger, DEMO_BALANCE, 0, days);
  }
  const { supabase, organizationId } = workspace;
  const [jobs, ledger, credits] = await Promise.all([
    supabase.from("jobs").select("id,status,shots,selected_backend_id,created_at").eq("organization_id", organizationId).gte("created_at", since).order("created_at", { ascending: false }).limit(5000),
    supabase.from("ledger_entries").select("type,amount,created_at,job_id").eq("organization_id", organizationId).gte("created_at", since).in("type", ["charge", "refund", "purchase"]).limit(10000),
    supabase.from("credit_accounts").select("available,reserved").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const jobRows = (jobs.data ?? []) as JobRow[];
  const ledgerRows = (ledger.data ?? []) as LedgerRow[];
  // Charges can land on jobs created before the window; fetch their backends too.
  const missing = [...new Set(ledgerRows.map((row) => row.job_id).filter((id): id is string => Boolean(id) && !jobRows.some((job) => job.id === id)))];
  const extra = missing.length
    ? ((await supabase.from("jobs").select("id,selected_backend_id").eq("organization_id", organizationId).in("id", missing.slice(0, 500))).data ?? [])
    : [];
  const summary = summarize(jobRows, ledgerRows, Number(credits.data?.available ?? 0), Number(credits.data?.reserved ?? 0), days);
  if (extra.length) {
    const backendOf = new Map(extra.map((row) => [row.id as string, (row.selected_backend_id as string | null) ?? "unrouted"]));
    const byJob = new Map<string, LedgerRow[]>();
    for (const row of ledgerRows) if (row.job_id && backendOf.has(row.job_id)) byJob.set(row.job_id, [...(byJob.get(row.job_id) ?? []), row]);
    for (const [jobId, rows] of byJob) {
      const id = backendOf.get(jobId)!;
      const entry = summary.backends.find((item) => item.id === id);
      if (entry) entry.spend += chargedFromLedger(rows) ?? 0;
      else summary.backends.push({ id, runs: 0, shots: 0, spend: chargedFromLedger(rows) ?? 0 });
    }
    summary.backends.sort((a, b) => b.spend - a.spend || b.runs - a.runs);
  }
  return summary;
}
