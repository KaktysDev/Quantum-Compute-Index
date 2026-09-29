// Activity data: v2 jobs (execution groups) and standalone v1 jobs merged into
// one newest-first list. A v1 job reads as a job with a single execution.

import { getBackend } from "@/lib/qrouter/catalog";
import { isSettled } from "@/lib/qrouter/status";
import type { JobListItem } from "@/lib/qrouter/v2";

export type ExecutionRow = {
  id: string;
  key: string | null;
  status: string;
  backend: string | null;
  shots: number;
  created_at: string;
  updated_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  quoted: number | null;
  charged: number | null;
  /** null for v1 jobs, which use the v1 execution URLs. */
  group_id: string | null;
};

export type ActivityItem = {
  id: string;
  name: string;
  status: string;
  circuit_id: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  quoted: number | null;
  charged: number | null;
  executions: ExecutionRow[];
  /** Submitted through /api/v1 (assistant, repository deploys, v1 API). */
  legacy: boolean;
};

export type ActivityFilter = {
  id: "all" | "active" | "credits" | "completed" | "failed";
  label: string;
  v2Status?: string;
  match: (status: string) => boolean;
};

export const ACTIVITY_FILTERS: ActivityFilter[] = [
  { id: "all", label: "All", match: () => true },
  { id: "active", label: "In progress", v2Status: "queued,running", match: (status) => !isSettled(status) },
  { id: "credits", label: "Needs credits", v2Status: "awaiting_payment", match: (status) => status === "awaiting_payment" },
  { id: "completed", label: "Completed", v2Status: "completed", match: (status) => status === "completed" },
  { id: "failed", label: "Failed", v2Status: "failed,cancelled", match: (status) => status === "failed" || status === "cancelled" },
];

export const backendLabel = (id: string | null | undefined) => (id ? getBackend(id)?.displayName ?? id : "—");

const num = (value: unknown) => {
  const parsed = Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
};

export function fromV2(job: JobListItem): ActivityItem {
  return {
    id: job.id,
    name: job.metadata?.name || job.circuit_name || `Job ${job.id.slice(0, 8)}`,
    status: job.status,
    circuit_id: job.circuit_id,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at,
    quoted: job.totals.quoted,
    charged: job.totals.charged,
    legacy: false,
    executions: job.executions.map((execution) => ({
      id: execution.id,
      key: execution.key,
      status: execution.status,
      backend: execution.selected_backend_id,
      shots: execution.shots,
      created_at: execution.created_at,
      updated_at: execution.updated_at,
      started_at: execution.started_at,
      completed_at: execution.completed_at,
      quoted: execution.quote?.total ?? null,
      charged: execution.charged,
      group_id: job.id,
    })),
  };
}

type V1Row = {
  id: string;
  name?: string | null;
  status: string;
  selected_backend_id?: string | null;
  shots?: number;
  created_at: string;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  quotes?: Array<{ total: unknown }> | { total: unknown } | null;
  quote?: { total?: unknown } | null;
  charged?: number | null;
};

export function fromV1(job: V1Row): ActivityItem {
  const embedded = Array.isArray(job.quotes) ? job.quotes[0] : job.quotes;
  const quoted = num(embedded?.total ?? job.quote?.total);
  const charged = typeof job.charged === "number" ? job.charged : null;
  return {
    id: job.id,
    name: job.name || `Job ${job.id.slice(0, 8)}`,
    status: job.status,
    circuit_id: null,
    created_at: job.created_at,
    updated_at: job.updated_at ?? null,
    completed_at: job.completed_at ?? null,
    quoted,
    charged,
    legacy: true,
    executions: [{
      id: job.id,
      key: null,
      status: job.status,
      backend: job.selected_backend_id ?? null,
      shots: job.shots ?? 0,
      created_at: job.created_at,
      updated_at: job.updated_at ?? null,
      started_at: job.started_at ?? null,
      completed_at: job.completed_at ?? null,
      quoted,
      charged,
      group_id: null,
    }],
  };
}

export function mergeActivity(...lists: ActivityItem[][]): ActivityItem[] {
  const byId = new Map<string, ActivityItem>();
  for (const list of lists) for (const item of list) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Where to fetch an execution's artifacts. v1 routes also accept v2 execution ids. */
export function executionUrls(execution: { id: string; group_id: string | null }) {
  const v2 = Boolean(execution.group_id);
  return {
    detail: `/api/v1/jobs/${execution.id}`,
    cancel: v2 ? `/api/v2/executions/${execution.id}/cancel` : `/api/v1/jobs/${execution.id}/cancel`,
    transpiled: v2 ? `/api/v2/executions/${execution.id}/transpiled` : `/api/v1/jobs/${execution.id}/transpiled`,
    result: v2 ? `/api/v2/executions/${execution.id}/result` : `/api/v1/jobs/${execution.id}/result`,
  };
}

/** Error text from either the v1 `{error:{message}}` or v2 problem+json shape. */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as { detail?: unknown; error?: { message?: unknown } };
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.error?.message === "string") return record.error.message;
  }
  return fallback;
}

export async function loadActivityPage({
  limit,
  filter,
  v2Cursor,
  v1Before,
  circuitId,
  includeV1 = true,
}: {
  limit: number;
  filter?: ActivityFilter;
  /** undefined = first page, string = next page, null = exhausted. */
  v2Cursor?: string | null;
  /** Same convention as v2Cursor. */
  v1Before?: string | null;
  circuitId?: string;
  includeV1?: boolean;
}) {
  const v2Params = new URLSearchParams({ limit: String(limit) });
  if (filter?.v2Status) v2Params.set("status", filter.v2Status);
  if (v2Cursor) v2Params.set("cursor", v2Cursor);
  if (circuitId) v2Params.set("circuit_id", circuitId);
  const v1Params = new URLSearchParams({ view: "summary", standalone: "1", limit: String(limit) });
  if (v1Before) v1Params.set("before", v1Before);

  const [v2Response, v1Response] = await Promise.all([
    v2Cursor === null ? null : fetch(`/api/v2/jobs?${v2Params}`, { cache: "no-store" }),
    includeV1 && v1Before !== null ? fetch(`/api/v1/jobs?${v1Params}`, { cache: "no-store" }) : null,
  ]);
  const v2Body = v2Response ? await v2Response.json().catch(() => null) : null;
  const v1Body = v1Response ? await v1Response.json().catch(() => null) : null;
  if (v2Response && !v2Response.ok) throw new Error(apiErrorMessage(v2Body, "Could not load jobs."));
  if (v1Response && !v1Response.ok) throw new Error(apiErrorMessage(v1Body, "Could not load jobs."));

  const v2Items = ((v2Body?.data ?? []) as JobListItem[]).map(fromV2);
  const v1Rows = ((v1Body?.data ?? []) as V1Row[]);
  const v1Items = v1Rows.map(fromV1).filter((item) => !filter || filter.match(item.status));
  return {
    items: mergeActivity(v2Items, v1Items),
    v2NextCursor: v2Response && v2Body?.has_more ? String(v2Body.next_cursor) : null,
    v1NextBefore: v1Response ? (v1Rows.length >= limit ? v1Rows[v1Rows.length - 1].created_at : null) : null,
  };
}
