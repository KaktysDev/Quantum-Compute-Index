"use client";

import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import { overlayExecute } from "@/lib/qrouter/encoding/stages";
import {
  bitOrderLabel,
  compileChange,
  gateCount,
  quoteBindingLabel,
  stageStory,
  verificationLabel,
  whyRouted,
  workloadLabel,
} from "@/lib/qrouter/encoding/public";
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

export type EncodingCandidate = {
  backend: { id: string; displayName: string; kind: string; provider?: string };
  compatible: boolean;
  score: number;
  estimatedProviderCost?: number;
  rejectionReasons: string[];
  quoteBinding?: string;
  compiled?: boolean;
};

export type CompileMetrics = {
  before: { depth: number; gates: number };
  after: { depth: number; gates: number };
};

const TABS = ["route", "encode", "timeline", "result"] as const;
type TabId = (typeof TABS)[number];

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
  stories,
  encoding,
  transpilation,
  candidates,
  selectedId,
}: {
  stages: EncodingStage[];
  compact?: boolean;
  stories?: Partial<Record<EncodingStage["id"], string>>;
  encoding?: EncodingTrace;
  transpilation?: CompileMetrics;
  candidates?: EncodingCandidate[];
  selectedId?: string;
}) {
  const selectedName = selectedId ? backendLabel(selectedId) : undefined;
  const derived = stories ?? Object.fromEntries(
    stages.map((stage) => [stage.id, stageStory(stage.id, stage.detail, { encoding, transpilation, candidates, selectedName })]),
  ) as Partial<Record<EncodingStage["id"], string>>;
  return (
    <ol className={`enc-strip${compact ? " compact" : ""}`} aria-label="Analyze, transpile, score, route, then execute">
      {stages.map((stage, index) => {
        const detail = derived[stage.id] || stage.detail;
        return (
          <li key={stage.id} className={`enc-stage ${stage.status}`} data-stage={stage.id}>
            <span className="enc-stage-mark"><StageIcon status={stage.status} /></span>
            <span>
              <b>{stage.label}</b>
              {detail ? <small title={detail}>{detail}</small> : null}
            </span>
            {index < stages.length - 1 && <ChevronRight size={12} className="enc-stage-next" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

export function EncodingOverview({
  encoding,
  candidates,
  explanation,
  selectedId,
  transpilation,
  quoteTotal,
  error,
  emptyHint,
  density = "full",
}: {
  encoding?: EncodingTrace;
  candidates?: EncodingCandidate[];
  explanation?: string[];
  selectedId?: string;
  transpilation?: CompileMetrics;
  quoteTotal?: number | null;
  error?: string;
  emptyHint?: string;
  density?: "full" | "process";
}) {
  const selectedName = selectedId ? backendLabel(selectedId) : undefined;
  const change = compileChange(
    transpilation?.before,
    transpilation?.after ?? (encoding?.selected_bundle
      ? { depth: encoding.selected_bundle.metrics.depth, gates: gateCount(encoding.selected_bundle.metrics) ?? encoding.selected_bundle.metrics.two_qubit_ops }
      : null),
  );
  const why = whyRouted({ selectedId, selectedName, candidates, explanation });
  const binding = encoding?.selected_bundle?.quote_binding;
  const failed = Boolean(error);

  if (!selectedId && !encoding && !error) {
    return (
      <div className="enc-overview pending">
        <p>{emptyHint ?? "Encoding and routing have not run on this job yet."}</p>
      </div>
    );
  }

  return (
    <div className={`enc-overview${failed ? " failed" : ""}${density === "process" ? " process" : ""}`}>
      <p className="enc-overview-story">
        {failed ? error : why}
      </p>
      {density === "process" ? (
        change ? <p className="enc-overview-change">{change.text}</p> : null
      ) : (
      <dl>
        <div>
          <dt>Backend</dt>
          <dd>
            {selectedId && <span className="enc-route-chip">Route</span>}
            <b>{selectedName ?? "—"}</b>
          </dd>
        </div>
        <div>
          <dt>Circuit after encode</dt>
          <dd><b>{change?.text ?? (encoding ? `${encoding.requirements.qubits} qubits · ${encoding.requirements.instructions.length} ops` : "—")}</b></dd>
        </div>
        <div>
          <dt>Quote</dt>
          <dd>
            <b>{quoteTotal == null ? (binding ? quoteBindingLabel(binding) : "—") : `$${quoteTotal.toFixed(4)}`}</b>
            {binding && quoteTotal != null ? <small>{quoteBindingLabel(binding)}</small> : null}
          </dd>
        </div>
        <div>
          <dt>Why</dt>
          <dd><b>{why}</b></dd>
        </div>
      </dl>
      )}
    </div>
  );
}

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
  const selectedName = selectedId ? backendLabel(selectedId) : undefined;
  const ranked = useMemo(() => {
    if (!candidates?.length) return [];
    return [...candidates].sort((a, b) => Number(b.compatible) - Number(a.compatible) || b.score - a.score);
  }, [candidates]);

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
            <strong>{quoteBindingLabel(encoding.selected_bundle.quote_binding)}</strong>
          )}
        </div>
      )}
      <p className="enc-why">{whyRouted({ selectedId, selectedName, candidates, explanation })}</p>
      {ranked.length ? (
        <div className="enc-candidates">
          {ranked.map((candidate) => {
            const selected = candidate.backend.id === selectedId;
            return (
              <div
                key={candidate.backend.id}
                className={`${candidate.compatible ? "" : "rejected"}${selected ? " selected" : ""}`.trim()}
              >
                <span>
                  <b>{candidate.backend.displayName}{selected ? " · selected" : ""}</b>
                  <small>
                    {candidate.backend.kind}
                    {candidate.quoteBinding ? ` · ${quoteBindingLabel(candidate.quoteBinding).toLowerCase()}` : ""}
                    {candidate.compiled ? " · compiled" : ""}
                  </small>
                </span>
                <b>{candidate.compatible ? Math.round(candidate.score * 100) : "not a fit"}</b>
                {!candidate.compatible && candidate.rejectionReasons.length > 0 && (
                  <p>{candidate.rejectionReasons.join(" · ")}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Candidate scores appear after the router runs. Open this task again once quoting finishes.</p>
      )}
    </div>
  );
}

function EncodePane({
  encoding,
  transpilation,
}: {
  encoding?: EncodingTrace;
  transpilation?: CompileMetrics;
}) {
  if (!encoding) {
    return <p className="muted">This job does not have an encoding trace yet — older runs stored only the route. Route and result tabs still work.</p>;
  }
  const bundle = encoding.selected_bundle;
  const change = compileChange(
    transpilation?.before,
    transpilation?.after ?? (bundle
      ? { depth: bundle.metrics.depth, gates: gateCount(bundle.metrics) ?? bundle.metrics.two_qubit_ops }
      : null),
  );
  const layout = bundle?.decode_map.layout;
  const mapped = layout ? Object.keys(layout.logical_to_physical).length : 0;

  return (
    <div className="enc-pane">
      {change?.depth && change.gates ? (
        <div className="enc-metrics" aria-label="Circuit change after transpile">
          <div>
            <small>Depth</small>
            <b>{change.depth.from} → {change.depth.to}</b>
          </div>
          <div>
            <small>Gates</small>
            <b>{change.gates.from} → {change.gates.to}</b>
          </div>
          <div>
            <small>Two-qubit</small>
            <b>{bundle ? bundle.metrics.two_qubit_ops : "—"}</b>
          </div>
          <div>
            <small>Qubits</small>
            <b>{bundle?.metrics.qubits ?? encoding.requirements.qubits}</b>
          </div>
        </div>
      ) : null}
      <dl>
        <div><dt>Workload</dt><dd>{workloadLabel(encoding.workload_kind)}</dd></div>
        <div><dt>Qubits / bits</dt><dd>{encoding.requirements.qubits} / {encoding.requirements.clbits}</dd></div>
        <div>
          <dt>Operations</dt>
          <dd>{encoding.requirements.instructions.slice(0, 8).join(", ") || "—"}{encoding.requirements.instructions.length > 8 ? "…" : ""}</dd>
        </div>
        <div><dt>Control flow</dt><dd>{encoding.requirements.control_flow.join(", ") || "none"}</dd></div>
        {bundle && (
          <>
            <div><dt>Verification</dt><dd>{verificationLabel(bundle.verification)}</dd></div>
            <div><dt>Bit order</dt><dd>{bitOrderLabel(bundle.bit_order)}</dd></div>
            <div>
              <dt>Layout</dt>
              <dd>{layout ? `Mapped ${mapped} logical qubits onto the chip` : "No extra SWAP routing — identity / all-to-all"}</dd>
            </div>
            <div>
              <dt>Measurements</dt>
              <dd>{bundle.decode_map.measurement_map.length ? `${bundle.decode_map.measurement_map.length} qubit → bit pairs` : "—"}</dd>
            </div>
          </>
        )}
      </dl>
      {encoding.compiled.length > 1 && (
        <div className="enc-compiled">
          {encoding.compiled.map((item) => (
            <div key={item.bundle_id}>
              <span>{backendLabel(item.backend_id)}</span>
              <small>{quoteBindingLabel(item.quote_binding)} · {verificationLabel(item.verification)}</small>
            </div>
          ))}
        </div>
      )}
      <details className="enc-tech">
        <summary>Technical identifiers</summary>
        <dl>
          <div><dt>Envelope</dt><dd><code>{encoding.envelope_id.slice(0, 16)}</code></dd></div>
          <div><dt>Frontend</dt><dd>{encoding.frontend.name} {encoding.frontend.version}</dd></div>
          {bundle && (
            <>
              <div><dt>Bundle</dt><dd><code>{bundle.id.slice(0, 16)}</code> · {bundle.media_type}</dd></div>
              <div><dt>Quote binding</dt><dd>{bundle.quote_binding}</dd></div>
            </>
          )}
        </dl>
      </details>
    </div>
  );
}

function TimelinePane({ events, attempts }: { events?: JobEvent[]; attempts?: JobAttempt[] }) {
  if (!events?.length && !attempts?.length) {
    return <p className="muted">No dispatch events yet. They appear here as the job is submitted, waits in queue, and finishes.</p>;
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

const RESULT_CAP = 24;

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
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const shown = entries.slice(0, RESULT_CAP);
    const max = Math.max(...shown.map(([, count]) => count), 1);
    return (
      <div className="enc-pane">
        <div className="mini-counts">
          {shown.map(([state, count]) => (
            <div key={state}>
              <code>|{state}⟩</code>
              <i style={{ width: `${Math.max(4, (count / max) * 100)}%` }} />
              <b>{count}</b>
            </div>
          ))}
        </div>
        {entries.length > RESULT_CAP && (
          <p className="muted">Showing the top {RESULT_CAP} of {entries.length} states.</p>
        )}
        {jobId && <a className="artifact-link" href={`/api/v1/jobs/${jobId}/result`}>Download JSON</a>}
      </div>
    );
  }
  return <p className="muted">{error ?? "Result unlocks when execution finishes."}</p>;
}

export const EncodingDeepDive = memo(function EncodingDeepDive({
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
  jobStatus,
  transpilation,
  quoteTotal,
  surface = "full",
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
  jobStatus?: string;
  transpilation?: CompileMetrics;
  quoteTotal?: number | null;
  surface?: "full" | "tabs";
}) {
  const [tab, setTab] = useState<TabId>(error && !counts ? "result" : "route");
  const selectedName = selectedId ? backendLabel(selectedId) : undefined;
  const stories = useMemo(() => {
    const ctx = { encoding, transpilation, candidates, selectedName };
    return Object.fromEntries(stages.map((stage) => [stage.id, stageStory(stage.id, stage.detail, ctx)])) as Partial<Record<EncodingStage["id"], string>>;
  }, [candidates, encoding, selectedName, stages, transpilation]);
  const uid = jobId ?? "quote";

  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.indexOf(tab);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setTab(TABS[(index + 1) % TABS.length]);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setTab(TABS[(index + TABS.length - 1) % TABS.length]);
    }
  }

  return (
    <div className="enc-deep">
      {surface === "full" && (
        <EncodingOverview
          encoding={encoding}
          candidates={candidates}
          explanation={explanation}
          selectedId={selectedId}
          transpilation={transpilation}
          quoteTotal={quoteTotal}
          error={error && jobStatus && ["failed", "cancelled"].includes(jobStatus) ? error : undefined}
          emptyHint={jobStatus && ["analyzing", "quoted", "queued"].includes(jobStatus) ? "Analyze → transpile → score → route is still running." : undefined}
        />
      )}
      {surface === "full" && <EncodingStageStrip stages={stages} stories={stories} />}
      <div className="enc-tabs" role="tablist" aria-label="Encoding and routing details" onKeyDown={onTabKey}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`enc-tab-${uid}-${id}`}
            aria-selected={tab === id}
            aria-controls={`enc-panel-${uid}-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`enc-panel-${uid}-${tab}`} aria-labelledby={`enc-tab-${uid}-${tab}`}>
        {tab === "route" && <RoutePane encoding={encoding} candidates={candidates} explanation={explanation} selectedId={selectedId} />}
        {tab === "encode" && <EncodePane encoding={encoding} transpilation={transpilation} />}
        {tab === "timeline" && <TimelinePane events={events} attempts={attempts} />}
        {tab === "result" && <ResultPane counts={counts} error={error} jobId={jobId} />}
      </div>
    </div>
  );
});
