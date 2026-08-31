"use client";

// Activity — every job this workspace has submitted.
//
// The table now carries a live Duration column. Jobs that are still moving tick
// once a second against `started_at` (or creation, while still queued); jobs
// that have stopped show their final wall-clock time. That is the "how long has
// this been processing" signal the console previously only implied through a
// status word.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Clock, FileCode2, Loader2, RotateCw, Square } from "lucide-react";
import { EncodingDeepDive, overlayExecute } from "@/components/encoding/EncodingProcess";
import type { EncodingTrace } from "@/lib/qrouter/encoding/types";
import { slimJobForClient } from "@/lib/qrouter/encoding/public";
import { getBackend } from "@/lib/qrouter/catalog";
import { elapsedMs, formatDuration, isTerminal, statusTone } from "@/lib/qrouter/duration";

/** Backend ids are stable storage keys; show the human name where one exists. */
const backendLabel = (id: string) => getBackend(id)?.displayName ?? id;

interface Job {
  id: string;
  name: string | null;
  status: string;
  selected_backend_id: string;
  shots: number;
  analysis?: {
    qubits: number;
    depth: number;
    complexity: string;
    encoding?: EncodingTrace;
    transpilation?: { before: { depth: number; gates: number }; after: { depth: number; gates: number }; equivalent: boolean | null; verificationStatus?: string };
  };
  route_decision?: {
    selected?: { id: string; displayName: string };
    explanation?: string[];
    encoding?: EncodingTrace;
    candidates?: Array<{
      backend: { id: string; displayName: string; kind: string; provider?: string };
      compatible: boolean;
      score: number;
      estimatedProviderCost?: number;
      rejectionReasons: string[];
      quoteBinding?: string;
      compiled?: boolean;
    }>;
  };
  attempts?: Array<{ attempt: number; backend_id: string; status: string; error?: { message?: string } | null; started_at?: string | null; finished_at?: string | null }>;
  events?: Array<{ type?: string; from_status?: string; to_status?: string; created_at?: string; payload?: Record<string, unknown> }>;
  result?: { counts?: Record<string, number> };
  error?: { message?: string };
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  // The list endpoint embeds the quote as `quotes` (PostgREST join); the demo
  // engine and the single-job endpoint return it inline as `quote`.
  quotes?: Array<{ total: number | string }> | { total: number | string } | null;
  quote?: { total?: number | string } | null;
}

function quoteTotal(job: Job): number | null {
  const embedded = Array.isArray(job.quotes) ? job.quotes[0] : job.quotes;
  const raw = embedded?.total ?? job.quote?.total;
  if (raw === undefined || raw === null) return null;
  const total = Number(raw);
  return Number.isFinite(total) ? total : null;
}

function asJob(value: unknown): Job {
  return slimJobForClient((value ?? {}) as Record<string, unknown>) as unknown as Job;
}

function mergeOpenJob(previous: Job | undefined, incoming: Job): Job {
  if (!previous) return incoming;
  return {
    ...previous,
    ...incoming,
    analysis: incoming.analysis ?? previous.analysis,
    route_decision: incoming.route_decision ?? previous.route_decision,
    events: incoming.events ?? previous.events,
    attempts: incoming.attempts ?? previous.attempts,
    result: incoming.result ?? previous.result,
    error: incoming.error ?? previous.error,
    quote: incoming.quote ?? previous.quote,
    quotes: incoming.quotes ?? previous.quotes,
  };
}

const TaskRow = memo(function TaskRow({
  job,
  now,
  open,
  onToggle,
}: {
  job: Job;
  now: number;
  open: boolean;
  onToggle: (job: Job) => void;
}) {
  const running = !isTerminal(job.status);
  const duration = elapsedMs(job, now);
  const total = quoteTotal(job);
  return (
    <button className="task-row" onClick={() => onToggle(job)} aria-expanded={open}>
      <span>
        <b>{job.name || "Untitled task"}</b>
        <small>{job.id.slice(0, 8)}</small>
      </span>
      <span>
        <b>{backendLabel(job.selected_backend_id)}</b>
        <small>{job.analysis ? `${job.analysis.qubits}q · ${job.analysis.depth} depth` : "Analyzing"}</small>
      </span>
      <span>
        {new Date(job.created_at).toLocaleDateString()}
        <small>{new Date(job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
      </span>
      <span className={`task-duration ${statusTone(job.status)}`}>
        {running && <i className="task-pulse" aria-hidden="true" />}
        <b>{formatDuration(duration)}</b>
        <small>{running ? "elapsed" : job.completed_at ? "total" : "—"}</small>
      </span>
      <span>
        <b>{total === null ? "—" : `$${total.toFixed(4)}`}</b>
        <small>{job.status === "completed" ? "settled" : running ? "reserved" : "released"}</small>
      </span>
      <span>
        <i className={`status-dot ${job.status}`} />
        {job.status.replaceAll("_", " ")}
      </span>
      <ChevronDown size={15} className={open ? "rotate" : ""} />
    </button>
  );
});

const TaskInspector = memo(function TaskInspector({
  job,
  running,
  onCancel,
}: {
  job: Job;
  running: boolean;
  onCancel: (id: string) => void;
}) {
  const encoding = job.route_decision?.encoding ?? job.analysis?.encoding;
  return (
    <div className="task-detail task-encoding">
      <EncodingDeepDive
        encoding={encoding}
        stages={overlayExecute(encoding?.stages, job.status)}
        candidates={job.route_decision?.candidates}
        explanation={job.route_decision?.explanation}
        selectedId={job.selected_backend_id}
        transpilation={job.analysis?.transpilation}
        quoteTotal={quoteTotal(job)}
        events={job.events}
        attempts={job.attempts}
        counts={job.result?.counts}
        error={job.error?.message}
        jobId={job.id}
        jobStatus={job.status}
      />
      <div className="task-encoding-actions">
        {running && (
          <button className="console-danger" onClick={() => onCancel(job.id)}>
            <Square size={13} />
            Cancel task
          </button>
        )}
        <a className="console-secondary artifact-link" href={`/api/v1/jobs/${job.id}/transpiled`}>
          <FileCode2 size={14} />
          Compiled QASM
        </a>
      </div>
    </div>
  );
});

export default function TasksTable() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // `?job=` must open once. Polling every 5s must not re-toggle the inspector.
  const openedFromQuery = useRef<string | null>(null);
  const openRef = useRef<string | null>(null);
  const detailedRef = useRef<Set<string>>(new Set());
  // Drives the live duration column. Held in state so the whole table advances
  // on one timer rather than one per row.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/jobs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load tasks.");
      const incoming = (Array.isArray(data.data) ? data.data as unknown[] : []).map(asJob);
      const openId = openRef.current;
      setJobs((current) => incoming.map((job) => (
        job.id === openId ? mergeOpenJob(current.find((item) => item.id === job.id), job) : job
      )));
      setError(null);
      if (!openId) return;
      const listed = incoming.find((item) => item.id === openId);
      if (listed && isTerminal(listed.status) && detailedRef.current.has(openId)) return;
      const detail = await fetch(`/api/v1/jobs/${openId}`, { cache: "no-store" }).then((item) => item.json()).catch(() => null);
      if (detail?.id) {
        const slim = asJob(detail);
        detailedRef.current.add(openId);
        setJobs((current) => current.map((item) => (item.id === openId ? mergeOpenJob(item, slim) : item)));
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  // Only tick while something is actually in flight. Duration lives on TaskRow
  // so the inspector does not re-render every second.
  const anyRunning = jobs.some((job) => !isTerminal(job.status));
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  const openJob = useCallback(async (job: Job) => {
    openRef.current = job.id;
    setOpen(job.id);
    try {
      const response = await fetch(`/api/v1/jobs/${job.id}`, { cache: "no-store" });
      const detail = await response.json();
      if (response.ok) {
        const slim = asJob(detail);
        detailedRef.current.add(job.id);
        setJobs((current) => current.map((item) => (item.id === job.id ? mergeOpenJob(item, slim) : item)));
      }
    } catch {
      /* polling will retry */
    }
  }, []);

  const toggle = useCallback((job: Job) => {
    if (openRef.current === job.id) {
      openRef.current = null;
      setOpen(null);
      return;
    }
    void openJob(job);
  }, [openJob]);

  useEffect(() => {
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId || openedFromQuery.current === jobId) return;
    const job = jobs.find((item) => item.id === jobId);
    if (!job) return;
    openedFromQuery.current = jobId;
    void openJob(job);
  }, [jobs, openJob]);

  const cancelJob = useCallback(async (id: string) => {
    const response = await fetch(`/api/v1/jobs/${id}/cancel`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message ?? "Cancellation failed.");
      return;
    }
    detailedRef.current.delete(id);
    await load();
  }, [load]);

  if (loading)
    return (
      <div className="console-empty">
        <Loader2 className="spin" />
        <p>Loading tasks</p>
      </div>
    );

  return (
    <div className="console-panel tasks-panel">
      <div className="tasks-toolbar">
        <span>{jobs.length} tasks</span>
        <button onClick={load}>
          <RotateCw size={14} />
          Refresh
        </button>
      </div>
      {error && (
        <div className="console-alert error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      <div className="tasks-head">
        <span>Task</span>
        <span>Backend</span>
        <span>Created</span>
        <span>Duration</span>
        <span>Cost</span>
        <span>Status</span>
        <span />
      </div>
      {jobs.length === 0 ? (
        <div className="console-empty">
          <Clock />
          <p>No tasks yet</p>
          <a href="/dashboard/deploy">Deploy your first job</a>
        </div>
      ) : (
        jobs.map((job) => (
          <div className="task-wrap" key={job.id}>
            <TaskRow job={job} now={now} open={open === job.id} onToggle={toggle} />
            {open === job.id && (
              <TaskInspector job={job} running={!isTerminal(job.status)} onCancel={cancelJob} />
            )}
          </div>
        ))
      )}
    </div>
  );
}
