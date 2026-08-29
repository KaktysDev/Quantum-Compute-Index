"use client";

import { useState } from "react";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { overlayExecute } from "@/lib/qrouter/encoding/stages";
import type { EncodingStage, EncodingTrace } from "@/lib/qrouter/encoding/types";
import { getBackend } from "@/lib/qrouter/catalog";

export { overlayExecute };

export type JobEvent = {
  type?: string;
  from_status?: string;
  to_status?: string;
  created_at?: string;
  payload?: Record<string, unknown>;
};

export type JobAttempt = {
  attempt: number;
  backend_id: string;
  status: string;
  error?: { message?: string } | null;
  started_at?: string | null;
  finished_at?: string | null;
};

function backendLabel(id: string) {
  return getBackend(id)?.displayName ?? id;
}

function StageIcon({ status }: { status: EncodingStage["status"] }) {
  if (status === "done") return <Check size={11} />;
  if (status === "running") return <Loader2 size={11} className="spin" />;
  if (status === "failed") return <X size={11} />;
  return <span className="enc-stage-dot" />;
}

export function EncodingStageStrip({
  stages,
  compact = false,
}: {
  stages: EncodingStage[];
  compact?: boolean;
}) {
  return (
    <ol className={`enc-strip${compact ? " compact" : ""}`} aria-label="Encoding and routing process">
      {stages.map((stage, index) => (
        <li key={stage.id} className={`enc-stage ${stage.status}`} data-stage={stage.id}>
          <span className="enc-stage-mark"><StageIcon status={stage.status} /></span>
          <span>
            <b>{stage.label}</b>
            {!compact && stage.detail ? <small>{stage.detail}</small> : null}
          </span>
          {index < stages.length - 1 && <ChevronRight size={12} className="enc-stage-next" />}
        </li>
      ))}
    </ol>
  );
}

export type EncodingCandidate = {
  backend: { id: string; displayName: string; kind: string; provider?: string };
  compatible: boolean;
  score: number;
  estimatedProviderCost?: number;
  rejectionReasons: string[];
  quoteBinding?: string;
  compiled?: boolean;
};

function RoutePane({
  encoding,
  candidates,
  explanation,
  selectedId,
}: {
  encoding?: EncodingTrace;
  candidates?: EncodingCandidate[];
  explanation?: string[];
  selectedId?: string;
}) {
  return (
    <div className="enc-pane">
      {selectedId && (
        <div className="enc-selected">
          <span className="enc-route-chip">Route</span>
          <div>
            <small>Selected</small>
            <b>{backendLabel(selectedId)}</b>
          </div>
          {encoding?.selected_bundle && (
            <strong>{encoding.selected_bundle.quote_binding}</strong>
          )}
        </div>
      )}
      {explanation?.length ? (
        <ul className="enc-explain">
          {explanation.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}
      {candidates?.length ? (
        <div className="enc-candidates">
          {candidates.map((candidate) => (
            <div key={candidate.backend.id} className={candidate.compatible ? "" : "rejected"}>
              <span>
                <b>{candidate.backend.displayName}</b>
                <small>
                  {candidate.backend.kind}
                  {candidate.quoteBinding ? ` · ${candidate.quoteBinding}` : ""}
                  {candidate.compiled ? " · compiled" : ""}
                </small>
              </span>
              <b>{candidate.compatible ? Math.round(candidate.score * 100) : "skip"}</b>
              {!candidate.compatible && candidate.rejectionReasons.length > 0 && (
                <p>{candidate.rejectionReasons.join(" · ")}</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">Candidate scores appear after the router runs.</p>
      )}
    </div>
  );
}

function EncodePane({ encoding }: { encoding?: EncodingTrace }) {
  if (!encoding) return <p className="muted">Encoding envelope is not on this job yet.</p>;
  const bundle = encoding.selected_bundle;
  return (
    <div className="enc-pane">
      <dl>
        <div><dt>Envelope</dt><dd><code>{encoding.envelope_id.slice(0, 16)}</code></dd></div>
        <div><dt>Workload</dt><dd>{encoding.workload_kind}</dd></div>
        <div><dt>Frontend</dt><dd>{encoding.frontend.name} {encoding.frontend.version}</dd></div>
        <div><dt>Qubits / clbits</dt><dd>{encoding.requirements.qubits} / {encoding.requirements.clbits}</dd></div>
        <div><dt>Ops</dt><dd>{encoding.requirements.instructions.slice(0, 12).join(", ") || "—"}</dd></div>
        <div><dt>Control flow</dt><dd>{encoding.requirements.control_flow.join(", ") || "none"}</dd></div>
        {bundle && (
          <>
            <div><dt>Bundle</dt><dd><code>{bundle.id.slice(0, 16)}</code> · {bundle.media_type}</dd></div>
            <div><dt>Bit order</dt><dd>{bundle.bit_order} → q0_right</dd></div>
            <div><dt>Verification</dt><dd>{bundle.verification}</dd></div>
            <div>
              <dt>Compiled metrics</dt>
              <dd>{bundle.metrics.qubits}q · depth {bundle.metrics.depth} · {bundle.metrics.two_qubit_ops} two-qubit</dd>
            </div>
            <div>
              <dt>Layout</dt>
              <dd>{bundle.decode_map.layout ? `${Object.keys(bundle.decode_map.layout.logical_to_physical).length} logical → physical` : "identity / all-to-all"}</dd>
            </div>
            <div>
              <dt>Measurement map</dt>
              <dd>{bundle.decode_map.measurement_map.length ? `${bundle.decode_map.measurement_map.length} pairs` : "—"}</dd>
            </div>
          </>
        )}
      </dl>
      {encoding.compiled.length > 1 && (
        <div className="enc-compiled">
          {encoding.compiled.map((item) => (
            <div key={item.bundle_id}>
              <span>{backendLabel(item.backend_id)}</span>
              <small>{item.quote_binding} · {item.verification}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelinePane({ events, attempts }: { events?: JobEvent[]; attempts?: JobAttempt[] }) {
  if (!events?.length && !attempts?.length) {
    return <p className="muted">Timeline fills from job_events and job_attempts as the dispatcher runs.</p>;
  }
  return (
    <div className="enc-pane">
      {attempts?.length ? (
        <div className="enc-attempts">
          {attempts.map((attempt) => (
            <div key={attempt.attempt}>
              <b>Attempt {attempt.attempt}</b>
              <span>{backendLabel(attempt.backend_id)} · {attempt.status.replaceAll("_", " ")}</span>
              {attempt.error?.message && <p>{attempt.error.message}</p>}
            </div>
          ))}
        </div>
      ) : null}
      {events?.length ? (
        <ol className="enc-events">
          {events.map((event, index) => (
            <li key={`${event.type}-${index}`}>
              <b>{(event.type ?? "event").replace(/^job\./, "").replaceAll("_", " ")}</b>
              <small>
                {[event.from_status, event.to_status].filter(Boolean).join(" → ")}
                {event.created_at ? ` · ${new Date(event.created_at).toLocaleTimeString()}` : ""}
              </small>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ResultPane({
  counts,
  error,
  jobId,
}: {
  counts?: Record<string, number>;
  error?: string;
  jobId?: string;
}) {
  if (counts && Object.keys(counts).length) {
    const max = Math.max(...Object.values(counts), 1);
    return (
      <div className="enc-pane">
        <div className="mini-counts">
          {Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([state, count]) => (
              <div key={state}>
                <code>|{state}⟩</code>
                <i style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
                <b>{count}</b>
              </div>
            ))}
        </div>
        {jobId && <a className="artifact-link" href={`/api/v1/jobs/${jobId}/result`}>Download JSON</a>}
      </div>
    );
  }
  return <p className="muted">{error ?? "Result will unlock when execution completes."}</p>;
}

export function EncodingDeepDive({
  encoding,
  stages,
  candidates,
  explanation,
  selectedId,
  events,
  attempts,
  counts,
  error,
  jobId,
}: {
  encoding?: EncodingTrace;
  stages: EncodingStage[];
  candidates?: EncodingCandidate[];
  explanation?: string[];
  selectedId?: string;
  events?: JobEvent[];
  attempts?: JobAttempt[];
  counts?: Record<string, number>;
  error?: string;
  jobId?: string;
}) {
  const [tab, setTab] = useState<"route" | "encode" | "timeline" | "result">("route");
  return (
    <div className="enc-deep">
      <EncodingStageStrip stages={stages} />
      <div className="enc-tabs" role="tablist">
        {(["route", "encode", "timeline", "result"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      {tab === "route" && <RoutePane encoding={encoding} candidates={candidates} explanation={explanation} selectedId={selectedId} />}
      {tab === "encode" && <EncodePane encoding={encoding} />}
      {tab === "timeline" && <TimelinePane events={events} attempts={attempts} />}
      {tab === "result" && <ResultPane counts={counts} error={error} jobId={jobId} />}
    </div>
  );
}
