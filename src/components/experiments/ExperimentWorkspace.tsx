"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDownToLine, CheckCircle2, ClipboardCheck, FileCode2, FlaskConical, Loader2, Play, Plus, RefreshCw } from "lucide-react";
import { progressExperiment } from "@/lib/client/experiment-progress";
import type { ExperimentResource } from "@/lib/qrouter/experiments";

const BELL = `OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`;
const initial = { name: "Bell-state reference check", objective: "Check whether the measured Bell-state distribution agrees with the specified ideal reference.", source: BELL,
  intent: "simulate", targets: "qci-aer-gpu", shots: "1024", budget: "1.00", reference: '{"00":0.5,"11":0.5}', provenance: "Analytical ideal Bell-state distribution", threshold: "0.10", confidence: "95", referenceKind: "distribution", noReferenceReason: "" };
type Form = typeof initial;
type Assessment = { status: string; reason: string; distance: number | null; interval: [number, number] | null; shots: number | null; confidence: number | null };
type EvidenceExecution = { id: string; key: string; status: string; selected_backend_id: string; assessment: Assessment; charged_usd: number | null; cost_status: string; result_hash: string | null };
type Evidence = { schema_version: string; experiment: ExperimentResource; runs: { id: string; group_id: string | null; created_at: string; status: string; error?: { message: string } | null; executions: EvidenceExecution[] }[]; limitations: string[] };
type Preview = { total: number; max_total_cost: number; within_budget: boolean; definition_hash: string; executions: { target: string; selected_backend_id: string; quote: { providerCost: number; transpilerFee: number; platformFee: number; total: number }; verification: string }[]; note: string };

async function api<T>(url: string, body?: unknown, key?: string): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail ?? result.error?.message ?? (response.status === 402 ? "Credits are required. The campaign is parked awaiting payment." : "The request could not be completed."));
  return result.data as T;
}

export default function ExperimentWorkspace() {
  const [form, setForm] = useState<Form>(initial);
  const [experiments, setExperiments] = useState<ExperimentResource[]>([]);
  const [selected, setSelected] = useState<ExperimentResource | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dirty, setDirty] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeId = useRef<string | null>(null);
  const pollInFlight = useRef(false);
  const runKey = useRef<string | null>(null);
  const saveKeys = useRef<{ fingerprint: string; circuit: string; experiment: string } | null>(null);
  const load = useCallback(async () => { setExperiments(await api<ExperimentResource[]>("/api/v2/experiments")); }, []);
  useEffect(() => { load().catch((value) => setError(value.message)); }, [load]);
  const refresh = useCallback(async (id: string, advance = false) => {
    const read = (experimentId: string) => api<Evidence>(`/api/v2/experiments/${experimentId}`);
    const record = advance ? await progressExperiment(id, read, async (jobId) => {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/advance`, { method: "POST" });
      if (!response.ok) { const failure = await response.json(); throw new Error(failure.error?.message ?? "Cannot advance the approved execution."); }
    }) : await read(id);
    if (activeId.current === id) setEvidence(record);
    return record;
  }, []);
  useEffect(() => {
    if (!selected || !evidence?.runs.some((run) => ["running", "queued", "preparing"].includes(run.status))) return;
    const timer = setInterval(async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try { await refresh(selected.id, true); } catch (value) { if (activeId.current === selected.id) setError(value instanceof Error ? value.message : "Cannot refresh campaign."); }
      finally { pollInFlight.current = false; }
    }, 5000);
    return () => clearInterval(timer);
  }, [selected, evidence, refresh]);

  function change<K extends keyof Form>(key: K, value: Form[K]) { setForm((previous) => ({ ...previous, [key]: value })); setDirty(true); setPreview(null); setNotice(null); }
  function reset() { activeId.current = null; setForm(initial); setSelected(null); setEvidence(null); setPreview(null); setDirty(true); setError(null); setNotice(null); runKey.current = null; }
  async function choose(experiment: ExperimentResource) {
    const d = experiment.definition;
    activeId.current = experiment.id;
    setSelected(experiment); setDirty(false); setPreview(null); setError(null); setNotice(null); runKey.current = null;
    setForm({ name: d.name, objective: d.objective, source: "", intent: d.execution_intent, targets: d.targets.join(", "), shots: String(d.shots), budget: String(d.max_total_cost),
      reference: d.reference.kind === "distribution" ? JSON.stringify(d.reference.probabilities, null, 2) : "{}", provenance: d.reference.kind === "distribution" ? d.reference.provenance : "",
      threshold: d.success_criterion.metric === "total_variation_distance" ? String(d.success_criterion.max_distance) : "0.1", confidence: d.success_criterion.metric === "total_variation_distance" ? String(d.success_criterion.confidence * 100) : "95", referenceKind: d.reference.kind, noReferenceReason: d.reference.kind === "none" ? d.reference.reason : "" });
    setBusy("Loading evidence");
    try { await refresh(experiment.id); } catch (value) { setError(value instanceof Error ? value.message : "Cannot load experiment."); } finally { setBusy(null); }
  }
  async function save() {
    setBusy("Saving definition"); setError(null); setNotice(null);
    try {
      const fingerprint = JSON.stringify({ form, previous: selected?.id });
      if (saveKeys.current?.fingerprint !== fingerprint) saveKeys.current = { fingerprint, circuit: crypto.randomUUID(), experiment: crypto.randomUUID() };
      let circuitId = selected?.definition.circuit_id;
      if (form.source.trim()) {
        const circuit = await api<{ id: string }>("/api/v2/circuits", { name: form.name, circuit: form.source, format: /OPENQASM\s+3/i.test(form.source) ? "openqasm3" : "openqasm2" }, saveKeys.current.circuit);
        circuitId = circuit.id;
      }
      if (!circuitId) throw new Error("Supply an OpenQASM circuit.");
      const definition = { name: form.name, objective: form.objective, circuit_id: circuitId, ...(selected ? { previous_version_id: selected.id } : {}), execution_intent: form.intent,
        targets: form.targets.split(",").map((target) => target.trim()).filter(Boolean), shots: Number(form.shots), max_total_cost: Number(form.budget),
        reference: form.referenceKind === "distribution" ? { kind: "distribution", probabilities: JSON.parse(form.reference), provenance: form.provenance } : { kind: "none", reason: form.noReferenceReason },
        success_criterion: form.referenceKind === "distribution" ? { metric: "total_variation_distance", max_distance: Number(form.threshold), confidence: Number(form.confidence) / 100 } : { metric: "record_only" } };
      const experiment = await api<ExperimentResource>("/api/v2/experiments", definition, saveKeys.current.experiment);
      activeId.current = experiment.id;
      setSelected(experiment); setDirty(false); setPreview(null); runKey.current = null;
      await Promise.all([load(), refresh(experiment.id)]);
      setNotice("Definition saved. Preview costs before approving execution.");
    } catch (value) { setError(value instanceof Error ? value.message : "Definition could not be saved."); } finally { setBusy(null); }
  }
  async function quote() {
    if (!selected) return;
    setBusy("Compiling and estimating"); setError(null); setNotice(null);
    try { setPreview(await api<Preview>(`/api/v2/experiments/${selected.id}/quote`, {})); } catch (value) { setError(value instanceof Error ? value.message : "Quote unavailable."); } finally { setBusy(null); }
  }
  async function run() {
    if (!selected || !preview?.within_budget || dirty) return;
    setBusy("Approving campaign"); setError(null); setNotice(null);
    runKey.current ??= crypto.randomUUID();
    try {
      await api(`/api/v2/experiments/${selected.id}/run`, { approved_definition_hash: selected.definition_hash, approved_max_total_cost: selected.definition.max_total_cost }, runKey.current);
      runKey.current = null;
      await refresh(selected.id, true);
      setPreview(null);
      setNotice("Campaign accepted. Evidence appears as executions complete. Preview a fresh quote before approving another run.");
    } catch (value) { setError(value instanceof Error ? value.message : "Run could not be submitted."); await refresh(selected.id).catch(() => undefined); } finally { setBusy(null); }
  }
  function download() {
    if (!evidence) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `qrouter-experiment-${evidence.experiment.id}.json`; link.click(); URL.revokeObjectURL(url);
  }
  const released = Boolean(evidence?.experiment.released_at);
  return <main className="experiment-workspace">
    <header className="experiment-header"><div><p className="qr-eyebrow">PRIVATE EXPERIMENT CAMPAIGNS</p><h1>Make every run answer a question.</h1><p>Define the evidence you need, approve a complete budget, and keep a reproducible record.</p></div><button className="console-secondary" onClick={reset} disabled={!!busy}><Plus size={16} /> New experiment</button></header>
    {error && <div role="alert" className="console-alert error"><AlertCircle size={17} />{error}</div>}
    {notice && <div role="status" className="console-alert"><CheckCircle2 size={17} />{notice}</div>}
    <div className="experiment-layout"><aside className="experiment-list console-panel"><div className="panel-title"><FlaskConical size={17} /><h2>Definitions</h2><span>{experiments.length}</span></div>
      {!experiments.length && <p className="experiment-muted">Start with the Bell example, or bring your own circuit. Nothing executes when you save.</p>}
      {experiments.map((experiment) => <button key={experiment.id} className={`experiment-list-item ${selected?.id === experiment.id ? "active" : ""}`} onClick={() => choose(experiment)} disabled={!!busy}><b>{experiment.definition.name}</b><span>v{experiment.version} · {experiment.definition.execution_intent} · ${experiment.definition.max_total_cost.toFixed(2)} ceiling</span></button>)}
      <p className="experiment-muted">Definitions are immutable. Save an edit as a new version to preserve earlier approvals and evidence.</p></aside>
      <fieldset className="experiment-builder" disabled={!!busy}>
        <div className="console-panel"><div className="panel-title"><ClipboardCheck size={17} /><h2>1. Question and acceptance</h2></div><div className="experiment-fields">
          <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} maxLength={120} /></label>
          <label>What should this experiment establish?<textarea value={form.objective} onChange={(e) => change("objective", e.target.value)} rows={3} /></label>
          <div className="experiment-grid"><label>Execution intent<select value={form.intent} onChange={(e) => { change("intent", e.target.value); change("targets", e.target.value === "simulate" ? "qci-aer-gpu" : "auto"); }}><option value="simulate">Ideal circuit simulation</option><option value="hardware">Physical hardware evidence</option></select></label><label>Reference<select value={form.referenceKind} onChange={(e) => change("referenceKind", e.target.value)}><option value="distribution">Specified probability distribution</option><option value="none">Record results without a pass/fail claim</option></select></label></div>
          {form.referenceKind === "distribution" ? <><label>Reference distribution · classical bits, highest bit on the left<textarea className="experiment-code" value={form.reference} onChange={(e) => change("reference", e.target.value)} rows={3} spellCheck={false} /></label><label>Reference provenance<input value={form.provenance} onChange={(e) => change("provenance", e.target.value)} /></label><label>Maximum total variation distance<input type="number" min={0} max={1} step="0.01" value={form.threshold} onChange={(e) => change("threshold", e.target.value)} /></label><label>Confidence level · percent<input type="number" min={80} max={99.9} step="0.1" value={form.confidence} onChange={(e) => change("confidence", e.target.value)} /></label><p className="experiment-muted">Acceptance uses a conservative {form.confidence}% confidence interval. A small sample can be inconclusive. The author is responsible for the reference.</p></> : <label>Why is a reference unavailable?<textarea value={form.noReferenceReason} onChange={(e) => change("noReferenceReason", e.target.value)} rows={2} /></label>}
        </div></div>
        <div className="console-panel"><div className="panel-title"><FileCode2 size={17} /><h2>2. Circuit and execution scope</h2></div><div className="experiment-fields"><label>OpenQASM source{selected && !form.source && <small>Saved circuit retained. Paste source only to replace it in a new version.</small>}<textarea className="experiment-code" aria-label="Experiment OpenQASM source" value={form.source} onChange={(e) => change("source", e.target.value)} rows={9} spellCheck={false} /></label>
          <label>Backend IDs · comma-separated<input value={form.targets} onChange={(e) => change("targets", e.target.value)} /><small>Use <code>qci-aer-gpu</code> for QCI Aer CPU; <code>auto</code> selects within your execution intent. Hardware requires a configured connection and current native rates.</small></label>
          <div className="experiment-grid"><label>Shots per target<input type="number" min={100} max={1000000} value={form.shots} onChange={(e) => change("shots", e.target.value)} /></label><label>Total campaign ceiling · USD<input type="number" min={0.01} step="0.01" value={form.budget} onChange={(e) => change("budget", e.target.value)} /></label></div><p className="experiment-muted">The ceiling includes quoted provider costs and software fees across all targets. Campaigns use one attempt per target, with automatic failover disabled.</p>
          <button className="console-secondary" disabled={!!busy || !dirty || released} onClick={save}><ClipboardCheck size={16} />{selected ? "Save as new version" : "Save definition"}</button>
        </div></div>
        {selected && <div className="console-panel experiment-approval"><div className="panel-title"><Play size={17} /><h2>3. Review and approve</h2><span>v{selected.version}</span></div><p className="experiment-muted">Definition <code>{selected.definition_hash.slice(0, 16)}</code> · source <code>{selected.source_hash.slice(0, 16)}</code></p>
          {dirty && <p className="console-alert">Save your changes before previewing or running this version.</p>}{released && <p className="console-alert">Circuit data was released. This definition cannot run again.</p>}
          <button className="console-secondary" disabled={!!busy || dirty || released} onClick={quote}>Preview compilation and costs</button>
          {preview && <><div className="experiment-quote-list">{preview.executions.map((execution, index) => <div key={`${execution.target}-${index}`}><span><b>{execution.selected_backend_id}</b><small>{execution.verification === "unsupported" ? "Circuit equivalence has not been verified" : `Verification: ${execution.verification}`} · Provider ${execution.quote.providerCost.toFixed(6)} + software ${(execution.quote.transpilerFee + execution.quote.platformFee).toFixed(6)}</small></span><strong>${execution.quote.total.toFixed(6)}</strong></div>)}</div><p>Estimated reservation <b>${preview.total.toFixed(6)}</b> · approved ceiling <b>${preview.max_total_cost.toFixed(2)}</b></p><p className="experiment-muted">{preview.note}</p>{!preview.within_budget && <p className="console-alert error">Quote exceeds this campaign’s ceiling. Save a new version with a different scope or budget.</p>}<button className="console-primary" disabled={!!busy || dirty || !preview.within_budget || released} onClick={run}><Play size={15} /> Approve and run · up to ${preview.max_total_cost.toFixed(2)}</button></>}
        </div>}
        {busy && <div role="status" className="experiment-busy"><Loader2 className="spin" size={18} />{busy}…</div>}
      </fieldset>
    </div>
    {evidence && <section className="console-panel experiment-evidence"><div className="panel-title"><FlaskConical size={17} /><h2>Evidence record</h2><div className="experiment-actions"><button className="console-secondary" onClick={() => refresh(evidence.experiment.id).catch((value) => setError(value.message))}><RefreshCw size={14} /> Refresh</button><button className="console-secondary" onClick={download}><ArrowDownToLine size={14} /> Export JSON</button></div></div>
      {!evidence.runs.length && <p className="experiment-muted">No runs yet. Previewing and saving do not submit a job.</p>}
      {evidence.runs.map((run) => <article className="experiment-run" key={run.id}><div className="experiment-run-title"><b>{new Date(run.created_at).toLocaleString()}</b><span>{run.status.replaceAll("_", " ")}</span></div>{run.error && <p className="console-alert error">{run.error.message}</p>}{run.status === "preparation_unknown" && <p className="experiment-muted">Preparation was interrupted before its group could be linked. Retry with the original idempotency key to recover its status.</p>}<div className="experiment-table-wrap"><table><thead><tr><th>Execution</th><th>Acceptance</th><th>Distance / interval</th><th>Customer charge</th></tr></thead><tbody>{run.executions.map((execution) => <tr key={execution.id}><td><a href={`/dashboard/tasks?job=${execution.id}`}>{execution.selected_backend_id}</a><small>{execution.status}</small></td><td><span className={`experiment-verdict ${execution.assessment.status}`}>{execution.assessment.status.replace("_", " ")}</span><small>{execution.assessment.reason}</small></td><td>{execution.assessment.distance == null ? "—" : execution.assessment.distance.toFixed(4)}<small>{execution.assessment.interval ? `[${execution.assessment.interval.map((n) => n.toFixed(4)).join(", ")}] at ${((execution.assessment.confidence ?? 0.95) * 100).toFixed(1)}%` : "No confidence interval"}</small></td><td>{execution.charged_usd == null ? "Unknown / unbilled" : `$${execution.charged_usd.toFixed(6)}`}<small>{execution.cost_status.replaceAll("_", " ")}</small></td></tr>)}</tbody></table></div></article>)}
      <div className="experiment-limitations">{evidence.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}</div>
    </section>}
  </main>;
}
