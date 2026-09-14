"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, MessageSquare, Send } from "lucide-react";
import { bitOrderLabel } from "@/lib/qrouter/encoding/public";
import { formatDuration } from "@/lib/qrouter/duration";
import { computeAnalytics } from "@/lib/qrouter/report/analytics";
import type { JobReportContext } from "@/lib/qrouter/report/types";
import { CountsChart } from "./CountsChart";

export type JobResultView = {
  counts?: Record<string, number>;
  probabilities?: Record<string, number>;
  shots?: number;
  metadata?: Record<string, unknown>;
};

export function JobResultsPanel({
  jobId,
  status,
  backendId,
  backendName,
  qubits,
  depth,
  shots,
  cost,
  durationMs,
  createdAt,
  completedAt,
  result,
  measurementMap,
  layoutMapped,
  transpile,
  error,
}: {
  jobId: string;
  status?: string;
  backendId?: string;
  backendName?: string;
  qubits?: number;
  depth?: number;
  shots?: number;
  cost?: number | null;
  durationMs?: number | null;
  createdAt?: string;
  completedAt?: string | null;
  result?: JobResultView | null;
  measurementMap?: Array<{ qubit: number; clbit: number }>;
  layoutMapped?: number | null;
  transpile?: { before?: { depth: number; gates: number }; after?: { depth: number; gates: number } } | null;
  error?: string;
}) {
  const analytics = useMemo(() => computeAnalytics({
    counts: result?.counts,
    probabilities: result?.probabilities,
    shots: result?.shots,
    requestedShots: shots,
    metadata: result?.metadata,
    measurementMap,
    layoutMapped,
  }), [layoutMapped, measurementMap, result, shots]);

  const [report, setReport] = useState<JobReportContext | null>(null);
  const [reportState, setReportState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [question, setQuestion] = useState("");
  const [askState, setAskState] = useState<"idle" | "loading" | "error">("idle");
  const [thread, setThread] = useState<Array<{ question: string; answer: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    setReportState("loading");
    fetch(`/api/v1/jobs/${jobId}/report`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load the report.");
        return data as JobReportContext;
      })
      .then((data) => {
        if (cancelled) return;
        setReport(data);
        setReportState("ready");
      })
      .catch(() => {
        if (!cancelled) setReportState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, result?.counts, result?.shots, status]);

  const pending = !analytics.available && !error && status !== "failed" && status !== "cancelled";
  const brief = report?.narrative?.text;
  const questionId = `jr-question-${jobId}`;
  const mapCount = analytics.measurementMap.length;
  const mapDense = mapCount > 16;
  const entropyBits = analytics.shannonEntropyBits ?? analytics.probabilityEntropyBits;
  const starters = analytics.available
    ? [
        entropyBits != null ? { label: "Entropy", question: "What does the stored entropy say about this histogram?" } : null,
        analytics.mostProbable ? { label: "Top bitstring", question: `How frequent is the stored bitstring |${analytics.mostProbable}⟩?` } : null,
        analytics.shotsObserved != null || analytics.shotsRequested != null || shots != null
          ? { label: "Shots", question: "How many shots were requested, and how many are stored in the result?" }
          : null,
      ].filter((item): item is { label: string; question: string } => item != null)
    : [];

  async function ask(raw: string) {
    const next = raw.trim();
    if (!next || askState === "loading") return;
    setAskState("loading");
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}/report/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not answer.");
      setThread((current) => [...current, { question: next, answer: String(data.answer ?? "") }]);
      setQuestion("");
      setAskState("idle");
    } catch {
      setAskState("error");
    }
  }

  function onAsk(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="jr">
      <div className="jr-hero">
        <Metric label="Status" value={status ? status.replaceAll("_", " ") : "—"} tone={status === "completed" ? "ok" : status === "failed" || status === "cancelled" ? "bad" : "warn"} />
        <Metric label="Backend" value={backendName || backendId || "—"} detail={backendId && backendName && backendId !== backendName ? backendId : undefined} />
        <Metric label="Qubits" value={qubits != null ? String(qubits) : "—"} />
        <Metric label="Depth" value={depth != null ? String(depth) : "—"} />
        <Metric label="Shots" value={(analytics.shotsObserved ?? shots)?.toLocaleString() ?? "—"} detail={analytics.shotsMatch === false ? "Observed total differs from requested" : undefined} />
        <Metric label="Cost" value={cost == null ? "—" : `$${cost.toFixed(4)}`} />
        <Metric label="Time" value={formatDuration(durationMs)} detail={completedAt ? new Date(completedAt).toLocaleString() : createdAt ? `Created ${new Date(createdAt).toLocaleString()}` : undefined} />
      </div>

      {error && !analytics.available ? (
        <div className="jr-empty bad" role="status">
          <b>This job did not return results</b>
          <p>{error}</p>
        </div>
      ) : pending ? (
        <div className="jr-empty pending" role="status">
          <Loader2 className="spin" size={16} />
          <b>Waiting for results</b>
          <p>Charts appear when this job stores measurement counts. The report PDF is available now as a pending paper.</p>
        </div>
      ) : !analytics.available ? (
        <div className="jr-empty" role="status">
          <b>No results stored</b>
          <p>{analytics.reason ?? "This job has no measurement results yet."}</p>
        </div>
      ) : (
        <>
          <section className="jr-section">
            <header>
              <h3>Distribution</h3>
              <p>Stored shot histogram{analytics.countsAreSynthetic ? " — counts derived from probabilities" : ""}.</p>
            </header>
            <CountsChart rows={analytics.histogram} />
          </section>

          <section className="jr-section">
            <header>
              <h3>Top bitstrings</h3>
              <p>{analytics.distinctStates.toLocaleString()} distinct states stored.</p>
            </header>
            <div className="jr-table-wrap">
              <table className="jr-table">
                <thead>
                  <tr>
                    <th>Bitstring</th>
                    <th>Count</th>
                    <th>Probability</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics.top.map((row) => (
                    <tr key={row.bitstring}>
                      <td><code>|{row.bitstring}⟩</code></td>
                      <td>{row.count == null ? "—" : row.count.toLocaleString()}</td>
                      <td>{row.probability == null ? "—" : `${(row.probability * 100).toFixed(2)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="jr-stats">
            <Stat label="Entropy" value={analytics.shannonEntropyBits != null ? `${analytics.shannonEntropyBits.toFixed(3)} bits` : analytics.probabilityEntropyBits != null ? `${analytics.probabilityEntropyBits.toFixed(3)} bits` : "—"} detail={analytics.shannonEntropyBits != null ? "Shannon entropy of the shot histogram" : analytics.probabilityEntropyBits != null ? "From stored probabilities only" : "Not computable from this result"} />
            <Stat label="Most frequent" value={analytics.mostProbable ? `|${analytics.mostProbable}⟩` : "—"} detail={analytics.maxProbability != null ? `${(analytics.maxProbability * 100).toFixed(2)}%` : undefined} />
            <Stat label="Shot integrity" value={analytics.shotsMatch == null ? "—" : analytics.shotsMatch ? "Matches request" : "Differs"} detail={analytics.shotsRequested != null && analytics.shotsObserved != null ? `${analytics.shotsObserved.toLocaleString()} of ${analytics.shotsRequested.toLocaleString()}` : undefined} />
            {analytics.fidelity != null && <Stat label="Fidelity" value={String(analytics.fidelity)} detail="From stored result metadata" />}
            {analytics.stderr != null && <Stat label="Stderr" value={String(analytics.stderr)} detail="From stored result metadata" />}
          </section>

          {analytics.expected && analytics.expected.length > 0 && (
            <section className="jr-section">
              <header>
                <h3>Compared with expected</h3>
                <p>Shown because this job stored an expected distribution.</p>
              </header>
              <CountsChart rows={analytics.expected} emptyLabel="No expected distribution is stored." />
            </section>
          )}

          {mapCount > 0 && (
            <section className="jr-section">
              <header>
                <h3>Measurement map</h3>
                <p>
                  {mapCount.toLocaleString()} stored pair{mapCount === 1 ? "" : "s"}
                  {analytics.bitOrder ? ` · ${bitOrderLabel(analytics.bitOrder)}` : ""}.
                </p>
              </header>
              <ol
                className={`jr-map${mapDense ? " dense" : ""}`}
                aria-label={`${mapCount} qubit to classical-bit pairs`}
              >
                {analytics.measurementMap.map((pair) => (
                  <li key={`${pair.qubit}-${pair.clbit}`}>
                    <code>q{pair.qubit}</code>
                    <span aria-hidden="true">→</span>
                    <code>c{pair.clbit}</code>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {transpile?.before && transpile.after && (
            <section className="jr-section">
              <header>
                <h3>Compilation</h3>
                <p>Before and after figures stored on this job.</p>
              </header>
              <div className="jr-stats">
                <Stat label="Depth" value={`${transpile.before.depth} → ${transpile.after.depth}`} />
                <Stat label="Gates" value={`${transpile.before.gates} → ${transpile.after.gates}`} />
                {analytics.layoutMapped != null && <Stat label="Layout" value={`${analytics.layoutMapped} mapped`} detail="Logical qubits placed on the chip" />}
              </div>
            </section>
          )}

          {analytics.notes.length > 0 && (
            <ul className="jr-notes">
              {analytics.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
        </>
      )}

      <section className="jr-section jr-brief">
        <header>
          <h3>QRouter brief</h3>
          <p>From this job’s stored results. Missing fields stay blank.</p>
        </header>
        {reportState === "loading" && <p className="muted"><Loader2 size={13} className="spin" /> Writing a brief from stored results…</p>}
        {reportState === "error" && <p className="muted">The brief could not be generated. Downloads still use whatever this job stored.</p>}
        {brief && <p className="jr-narrative">{brief}</p>}
      </section>

      <section className="jr-section jr-ask">
        <header>
          <h3><MessageSquare size={13} /> Ask about this report</h3>
          <p>{analytics.available ? "Answers use only what this job stored." : "This job has no measurement results yet."}</p>
        </header>
        {thread.map((item) => (
          <div key={`${item.question}:${item.answer.slice(0, 24)}`} className="jr-turn">
            <p><b>You</b> {item.question}</p>
            <p><b>QRouter</b> {item.answer}</p>
          </div>
        ))}
        {starters.length > 0 && (
          <div className="jr-chips" role="group" aria-label="Starter questions about stored results">
            {starters.map((item) => (
              <button
                key={item.label}
                type="button"
                className="jr-chip"
                disabled={askState === "loading"}
                aria-label={item.question}
                onClick={() => void ask(item.question)}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {analytics.available ? (
          <form onSubmit={onAsk} className="jr-ask-form">
            <label htmlFor={questionId}>Question</label>
            <div className="jr-ask-row">
              <input
                id={questionId}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={600}
                placeholder="Ask about entropy, the top bitstring, or shots…"
                aria-label="Question about this job report"
              />
              <button type="submit" className="console-primary" disabled={askState === "loading" || !question.trim()}>
                {askState === "loading" ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
                Ask
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">The ask form unlocks when this job stores measurement results.</p>
        )}
        {askState === "error" && <p className="muted">Could not answer from this report. Try again.</p>}
      </section>

      <div className="jr-downloads" role="group" aria-label="Download this job report and stored results">
        <a className="console-secondary" href={`/api/v1/jobs/${jobId}/report/pdf`} download={`job-${jobId}-report.pdf`}>
          <FileText size={14} />
          Report PDF
        </a>
        <a className="console-secondary" href={`/api/v1/jobs/${jobId}/result`} download={`job-${jobId}.json`}>
          <Download size={14} />
          JSON
        </a>
        <a className="console-secondary" href={`/api/v1/jobs/${jobId}/result.csv`} download={`job-${jobId}.csv`}>
          <FileSpreadsheet size={14} />
          CSV
        </a>
      </div>
    </div>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className={`jr-metric${tone ? ` ${tone}` : ""}`}>
      <small>{label}</small>
      <b>{value}</b>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="jr-stat">
      <small>{label}</small>
      <b>{value}</b>
      {detail ? <span>{detail}</span> : null}
    </div>
  );
}
