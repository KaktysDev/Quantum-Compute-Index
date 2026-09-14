"use client";

import { memo, useMemo, useState, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import dynamic from "next/dynamic";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import type { JobResultView } from "@/components/results/JobResultsPanel";
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
import { formatPayloadBytes, type EncodingPreviewInput } from "@/lib/qrouter/encoding/preview";
import type { EncodingStage, EncodingTrace } from "@/lib/qrouter/encoding/types";
import { getBackend } from "@/lib/qrouter/catalog";
import { useEncodingPreview } from "@/components/encoding/useEncodingPreview";

const JobResultsPanel = dynamic(
  () => import("@/components/results/JobResultsPanel").then((mod) => mod.JobResultsPanel),
  {
    loading: () => (
      <div className="jr-empty pending" role="status">
        <Loader2 className="spin" size={16} />
        <b>Loading results</b>
        <p>Opening the stored report for this job.</p>
      </div>
    ),
    ssr: false,
  },
);

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

export function EncodingPreview({
  defaultOpen = false,
  children,
  quoteTotal,
  ...input
}: EncodingPreviewInput & {
  defaultOpen?: boolean;
  children?: ReactNode;
  quoteTotal?: number | null;
}) {
  const plan = useEncodingPreview(input);
  const binding = input.encoding?.selected_bundle?.quote_binding;
  const [open, setOpen] = useState(defaultOpen);
  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    setOpen(event.currentTarget.open);
  }

  return (
    <details className={`enc-preview${plan.error ? " failed" : ""}${plan.source === "pending" ? " pending" : ""}`} open={open} onToggle={onToggle}>
      <summary>
        <span className="enc-preview-kicker">Encoding plan</span>
        <span className="enc-preview-title">
          <b>{plan.encodingLabel}</b>
          {plan.backendName ? <em>{plan.backendName}</em> : null}
          {plan.formatLabel !== "—" && !plan.encodingLabel.includes(plan.formatLabel) ? <em>{plan.formatLabel}</em> : null}
        </span>
        <p className="enc-preview-headline">{plan.headline}</p>
        <ul className="enc-preview-chips">
          {plan.resources.map((item) => (
            <li key={item.key}><span>{item.label}</span><b>{item.value}</b></li>
          ))}
          {quoteTotal != null ? (
            <li><span>Quote</span><b>${quoteTotal.toFixed(4)}</b></li>
          ) : binding ? (
            <li><span>Quote</span><b>{quoteBindingLabel(binding)}</b></li>
          ) : null}
        </ul>
      </summary>
      <div className="enc-preview-body">
        <p className="enc-preview-why"><b>Why this encoding.</b> {plan.why}</p>
        <p className="enc-preview-transform"><b>What will happen.</b> {plan.transform}</p>
        <p className="enc-preview-next"><b>Next.</b> {plan.nextStep}</p>
        {plan.warnings.length > 0 && (
          <ul className="enc-preview-warnings">
            {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
        <div className="enc-preview-grid">
          <section>
            <h3>Parameters</h3>
            <dl>
              {plan.parameters.map((item) => (
                <div key={item.name}>
                  <dt>{item.name}</dt>
                  <dd>
                    <b>{item.value}</b>
                    <small>{item.effect}</small>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section>
            <h3>Mappings</h3>
            {plan.mappings.length ? (
              <dl>
                {plan.mappings.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd>{item.detail}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">Mappings appear after analyze — register layout, measurement pairs, and bit order.</p>
            )}
          </section>
        </div>
        {children}
      </div>
    </details>
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
  shots,
}: {
  encoding?: EncodingTrace;
  transpilation?: CompileMetrics;
  shots?: number;
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
      {change?.depth != null && change.gates != null ? (
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
        <div><dt>Shots</dt><dd>{shots != null ? shots.toLocaleString() : "—"}</dd></div>
        <div><dt>Payload</dt><dd>{bundle?.payload_bytes != null ? formatPayloadBytes(bundle.payload_bytes) : "—"}</dd></div>
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

function ResultPane({
  jobId,
  status,
  backendId,
  qubits,
  depth,
  shots,
  cost,
  durationMs,
  createdAt,
  completedAt,
  result,
  encoding,
  transpilation,
  error,
}: {
  jobId?: string;
  status?: string;
  backendId?: string;
  qubits?: number;
  depth?: number;
  shots?: number;
  cost?: number | null;
  durationMs?: number | null;
  createdAt?: string;
  completedAt?: string | null;
  result?: JobResultView | null;
  encoding?: EncodingTrace;
  transpilation?: CompileMetrics;
  error?: string;
}) {
  if (!jobId) {
    return (
      <div className={`jr-empty${error ? " bad" : ""}`} role="status">
        <b>{error ? "This job did not return results" : "Waiting for results"}</b>
        <p>{error ?? "Results appear after this job runs."}</p>
      </div>
    );
  }
  const bundle = encoding?.selected_bundle;
  const layout = bundle?.decode_map.layout;
  return (
    <div className="enc-pane">
      <JobResultsPanel
        jobId={jobId}
        status={status}
        backendId={backendId}
        backendName={backendId ? backendLabel(backendId) : undefined}
        qubits={qubits ?? encoding?.requirements.qubits}
        depth={depth ?? transpilation?.after.depth ?? bundle?.metrics.depth}
        shots={shots}
        cost={cost}
        durationMs={durationMs}
        createdAt={createdAt}
        completedAt={completedAt}
        result={result}
        measurementMap={bundle?.decode_map.measurement_map}
        layoutMapped={layout ? Object.keys(layout.logical_to_physical).length : null}
        transpile={transpilation}
        error={error}
      />
    </div>
  );
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
  result,
  error,
  jobId,
  jobStatus,
  transpilation,
  quoteTotal,
  surface = "full",
  defaultOpen,
  shots,
  format,
  targetId,
  routingMode,
  kind,
  qubits,
  phase,
  updating,
  durationMs,
  createdAt,
  completedAt,
}: {
  encoding?: EncodingTrace;
  stages: EncodingStage[];
  candidates?: EncodingCandidate[];
  explanation?: string[];
  selectedId?: string;
  events?: JobEvent[];
  attempts?: JobAttempt[];
  counts?: Record<string, number>;
  result?: JobResultView | null;
  error?: string;
  jobId?: string;
  jobStatus?: string;
  transpilation?: CompileMetrics;
  quoteTotal?: number | null;
  surface?: "full" | "tabs";
  defaultOpen?: boolean;
  shots?: number;
  format?: "openqasm2" | "openqasm3";
  targetId?: string;
  routingMode?: string;
  kind?: "qpu" | "simulator";
  qubits?: number;
  phase?: EncodingPreviewInput["phase"];
  updating?: boolean;
  durationMs?: number | null;
  createdAt?: string;
  completedAt?: string | null;
}) {
  const resolvedResult = result ?? (counts ? { counts } : null);
  const hasCounts = Boolean(resolvedResult?.counts && Object.keys(resolvedResult.counts).length);
  const [tab, setTab] = useState<TabId>(error && !hasCounts ? "result" : hasCounts || jobStatus === "completed" ? "result" : "route");
  const selectedName = selectedId ? backendLabel(selectedId) : undefined;
  const stories = useMemo(() => {
    const ctx = { encoding, transpilation, candidates, selectedName };
    return Object.fromEntries(stages.map((stage) => [stage.id, stageStory(stage.id, stage.detail, ctx)])) as Partial<Record<EncodingStage["id"], string>>;
  }, [candidates, encoding, selectedName, stages, transpilation]);
  const uid = jobId ?? "quote";
  const previewOpen = defaultOpen ?? surface === "full";
  const previewInput: EncodingPreviewInput = {
    encoding,
    selectedId,
    targetId,
    shots,
    format,
    routingMode,
    kind,
    qubits: qubits ?? encoding?.requirements.qubits,
    depth: transpilation?.after.depth ?? encoding?.selected_bundle?.metrics.depth,
    gates: transpilation?.after.gates,
    transpilation,
    candidates,
    explanation,
    error: error && jobStatus && ["failed", "cancelled"].includes(jobStatus) ? error : (phase === "failed" ? error : undefined),
    phase,
    updating,
    jobStatus,
  };

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
        <EncodingPreview {...previewInput} defaultOpen={previewOpen} quoteTotal={quoteTotal} />
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
        {tab === "encode" && <EncodePane encoding={encoding} transpilation={transpilation} shots={shots} />}
        {tab === "timeline" && <TimelinePane events={events} attempts={attempts} />}
        {tab === "result" && (
          <ResultPane
            jobId={jobId}
            status={jobStatus}
            backendId={selectedId}
            qubits={qubits}
            depth={transpilation?.after.depth ?? encoding?.selected_bundle?.metrics.depth}
            shots={shots}
            cost={quoteTotal}
            durationMs={durationMs}
            createdAt={createdAt}
            completedAt={completedAt}
            result={resolvedResult}
            encoding={encoding}
            transpilation={transpilation}
            error={error}
          />
        )}
      </div>
    </div>
  );
});
