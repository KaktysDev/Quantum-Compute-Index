"use client";

// Side panel for one execution: summary, actions, then the routing, encoding,
// timeline and result tabs. Polls until the execution settles.

import Link from "next/link";
import { FileCode2, Loader2, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { EncodingDeepDive, overlayExecute } from "@/components/encoding/EncodingProcess";
import { InlineAlert, StatusBadge, Timestamp } from "@/components/console/ui";
import { apiErrorMessage, backendLabel, executionUrls } from "@/lib/client/activity";
import { useAdvance } from "@/lib/client/use-advance";
import { onVisibleInterval } from "@/lib/client/visible-interval";
import { costView, formatUsd } from "@/lib/qrouter/cost";
import { elapsedMs, formatDuration } from "@/lib/qrouter/duration";
import type { EncodingTrace } from "@/lib/qrouter/encoding/types";
import { isSettled, isTerminal } from "@/lib/qrouter/status";

type Detail = {
  id: string;
  name?: string | null;
  status: string;
  group_id?: string | null;
  circuit_id?: string | null;
  execution_key?: string | null;
  selected_backend_id: string;
  shots: number;
  routing_mode?: string;
  created_at: string;
  updated_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  charged?: number | null;
  quote?: { total?: number | string } | null;
  analysis?: {
    qubits?: number;
    depth?: number;
    released?: boolean;
    encoding?: EncodingTrace;
    transpilation?: { before: { depth: number; gates: number }; after: { depth: number; gates: number }; equivalent: boolean | null };
  };
  route_decision?: {
    explanation?: string[];
    encoding?: EncodingTrace;
    candidates?: Array<{
      backend: { id: string; displayName: string; kind: string; provider?: string };
      compatible: boolean;
      score: number;
      estimatedProviderCost?: number;
      rejectionReasons: string[];
    }>;
  };
  attempts?: Array<{ attempt: number; backend_id: string; status: string; error?: { message?: string } | null }>;
  events?: Array<{ type?: string; from_status?: string; to_status?: string; created_at?: string }>;
  result?: { counts?: Record<string, number>; probabilities?: Record<string, number>; shots?: number; metadata?: Record<string, unknown> } | null;
  error?: { message?: string } | null;
};

export function ExecutionDrawer({
  executionId,
  title,
  onClose,
  onChanged,
}: {
  executionId: string;
  title?: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/jobs/${executionId}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiErrorMessage(body, response.status === 404 ? "This execution no longer exists." : "Could not load this execution."));
      setDetail(body as Detail);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load this execution.");
    }
  }, [executionId]);

  useEffect(() => {
    setDetail(null);
    setActionError(null);
    void load();
  }, [load]);

  const settled = detail ? isSettled(detail.status) : false;
  useEffect(() => {
    if (!detail || settled) return;
    return onVisibleInterval(() => void load(), 3000);
  }, [detail, settled, load]);

  useAdvance(detail ? [detail] : [], () => void load());

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function cancel() {
    if (!detail) return;
    setCancelling(true);
    setActionError(null);
    try {
      const response = await fetch(executionUrls({ id: detail.id, group_id: detail.group_id ?? null }).cancel, { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiErrorMessage(body, "Cancellation failed."));
      await load();
      onChanged?.();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Cancellation failed.");
      await load();
    } finally {
      setCancelling(false);
    }
  }

  const quoted = detail?.quote?.total != null ? Number(detail.quote.total) : null;
  const cost = detail ? costView({ status: detail.status, quoted, charged: detail.charged }) : null;
  const urls = detail ? executionUrls({ id: detail.id, group_id: detail.group_id ?? null }) : null;
  const encoding = detail?.route_decision?.encoding ?? detail?.analysis?.encoding;
  const heading = detail?.execution_key ?? detail?.name ?? title ?? executionId.slice(0, 8);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Execution ${heading}`} ref={panelRef} tabIndex={-1}>
        <header className="drawer-head">
          <div>
            <p className="dim">{detail?.group_id ? "Execution" : "Job"}</p>
            <h2 className="truncate">{heading}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        <div className="drawer-body">
          {loadError && !detail ? <InlineAlert tone="danger">{loadError}</InlineAlert> : null}
          {!detail && !loadError ? (
            <div className="empty"><Loader2 size={16} className="spin" /></div>
          ) : null}

          {detail && cost && urls ? (
            <>
              <dl className="kv">
                <dt>Status</dt>
                <dd><StatusBadge status={detail.status} /></dd>
                <dt>Backend</dt>
                <dd>{backendLabel(detail.selected_backend_id)}</dd>
                <dt>Circuit</dt>
                <dd className="num">
                  {detail.analysis?.qubits != null ? `${detail.analysis.qubits} qubits` : "—"}
                  {detail.analysis?.transpilation?.after.depth != null || detail.analysis?.depth != null
                    ? ` · depth ${detail.analysis?.transpilation?.after.depth ?? detail.analysis?.depth}`
                    : ""}
                </dd>
                <dt>Shots</dt>
                <dd className="num">{detail.shots.toLocaleString()}</dd>
                <dt>Duration</dt>
                <dd className="num">{formatDuration(elapsedMs(detail))}</dd>
                <dt>{cost.label}</dt>
                <dd className="num">
                  {cost.amount === null ? "—" : formatUsd(cost.amount)}
                  {cost.secondary ? <span className="dim"> · {cost.secondary}</span> : null}
                </dd>
                <dt>Created</dt>
                <dd><Timestamp value={detail.created_at} /></dd>
                <dt>ID</dt>
                <dd className="mono dim">{detail.id}</dd>
              </dl>

              {detail.status === "awaiting_payment" ? (
                <InlineAlert
                  tone="warning"
                  title="Waiting for credits"
                  action={<Link href="/dashboard/billing" className="btn btn-secondary btn-sm">Add credits</Link>}
                >
                  This execution starts automatically once your balance covers the quote.
                </InlineAlert>
              ) : null}
              {detail.analysis?.released ? (
                <InlineAlert tone="info" title="Source released">
                  The circuit and compiled program were purged. Metrics and billing records are kept.
                </InlineAlert>
              ) : null}
              {detail.error?.message && detail.status !== "completed" ? (
                <InlineAlert tone="danger" title="Execution error">{detail.error.message}</InlineAlert>
              ) : null}
              {actionError ? <InlineAlert tone="danger">{actionError}</InlineAlert> : null}

              <div className="row" style={{ flexWrap: "wrap" }}>
                {!isTerminal(detail.status) ? (
                  <button type="button" className="btn btn-danger btn-sm" onClick={cancel} disabled={cancelling || detail.status === "cancellation_requested"}>
                    {cancelling ? <Loader2 size={13} className="spin" /> : <Square size={12} />}
                    {detail.status === "cancellation_requested" ? "Cancelling" : "Cancel"}
                  </button>
                ) : null}
                {!detail.analysis?.released ? (
                  <a className="btn btn-secondary btn-sm" href={urls.transpiled} target="_blank" rel="noreferrer">
                    <FileCode2 size={13} /> Compiled circuit
                  </a>
                ) : null}
                {detail.circuit_id ? (
                  <Link className="btn btn-ghost btn-sm" href={`/dashboard/circuits/${detail.circuit_id}`}>
                    Open circuit
                  </Link>
                ) : null}
              </div>

              <div className="drawer-inspector">
                <EncodingDeepDive
                  surface="tabs"
                  encoding={encoding}
                  stages={overlayExecute(encoding?.stages, detail.status)}
                  candidates={detail.route_decision?.candidates}
                  explanation={detail.route_decision?.explanation}
                  selectedId={detail.selected_backend_id}
                  transpilation={detail.analysis?.transpilation}
                  quoteTotal={detail.charged ?? quoted}
                  events={detail.events}
                  attempts={detail.attempts}
                  counts={detail.result?.counts}
                  error={detail.error?.message}
                  jobId={detail.id}
                  jobStatus={detail.status}
                />
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
