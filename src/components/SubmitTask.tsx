"use client";

import { useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, ChevronRight, Cpu, FileCode2, Loader2, Play, Route, Upload } from "lucide-react";
import type { Backend, RoutingMode } from "@/lib/qrouter/types";

const BELL = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

type JobResponse = { id: string; status: string; selected_backend_id: string; analysis: { qubits: number; depth: number; gates: number; twoQubitGates: number; complexity: string }; quote: { providerCost: number; transpilerFee: number; platformFee: number; total: number }; result?: { counts?: Record<string, number>; executionMs?: number }; error?: { message?: string } };

export default function SubmitTask({ backends }: { backends: Backend[] }) {
  const [source, setSource] = useState(BELL);
  const [format, setFormat] = useState<"openqasm2" | "openqasm3">("openqasm2");
  const [target, setTarget] = useState("auto");
  const [mode, setMode] = useState<RoutingMode>("balanced");
  const [shots, setShots] = useState(1024);
  const [maxCost, setMaxCost] = useState("2.00");
  const [kind, setKind] = useState<"any" | "qpu" | "simulator">("any");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run() {
    setBusy(true); setError(null); setJob(null);
    try {
      const response = await fetch("/api/v1/jobs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ name: "Console task", circuit: source, format, shots, target, routing_mode: mode, constraints: { maxCost: Number(maxCost) || undefined, kind: kind === "any" ? undefined : kind } }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Task submission failed.");
      setJob(data);
    } catch (value) { setError(value instanceof Error ? value.message : "Task submission failed."); }
    finally { setBusy(false); }
  }

  async function loadFile(file?: File) {
    if (!file) return;
    if (file.size > 256_000) { setError("Circuit files must be smaller than 256 KB."); return; }
    const text = await file.text(); setSource(text); setFormat(/OPENQASM\s+3/i.test(text) ? "openqasm3" : "openqasm2");
  }

  return (
    <div className="submit-layout">
      <section className="submit-builder">
        <div className="console-panel source-panel">
          <div className="panel-title"><FileCode2 size={16} /><h2>Circuit source</h2><div className="console-segments compact"><button className={format === "openqasm2" ? "active" : ""} onClick={() => setFormat("openqasm2")}>QASM 2</button><button className={format === "openqasm3" ? "active" : ""} onClick={() => setFormat("openqasm3")}>QASM 3</button></div></div>
          <div className="editor-wrap"><div className="line-numbers">{source.split("\n").map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} aria-label="OpenQASM circuit source" /></div>
          <div className="source-actions"><input ref={fileRef} type="file" accept=".qasm,.txt" hidden onChange={(event) => loadFile(event.target.files?.[0])} /><button onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload .qasm</button><span>{new Blob([source]).size.toLocaleString()} bytes</span></div>
        </div>

        <div className="console-panel routing-panel">
          <div className="panel-title"><Route size={16} /><h2>Routing policy</h2></div>
          <div className="console-segments">{(["balanced", "cost", "speed", "quality"] as RoutingMode[]).map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>)}</div>
          <div className="form-grid three"><label><span>Shots</span><input type="number" min={1} max={1000000} value={shots} onChange={(event) => setShots(Number(event.target.value))} /></label><label><span>Maximum cost</span><div className="input-prefix"><i>$</i><input value={maxCost} onChange={(event) => setMaxCost(event.target.value)} inputMode="decimal" /></div></label><label><span>Compute type</span><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="any">Any core</option><option value="simulator">Simulator</option><option value="qpu">Physical QPU</option></select></label></div>
        </div>

        <div className="console-panel backend-panel">
          <div className="panel-title"><Cpu size={16} /><h2>Target matrix</h2><span>{target === "auto" ? "QCI decides" : "Pinned"}</span></div>
          <button className={`backend-option auto ${target === "auto" ? "selected" : ""}`} onClick={() => setTarget("auto")}><span className="auto-mark"><Route size={17} /></span><span><b>Automatic routing</b><small>QCI selects the best compatible target when the task runs.</small></span><span className="backend-badges"><em>Recommended</em></span>{target === "auto" ? <Check size={17} /> : <ChevronRight size={17} />}</button>
          <div className="backend-options">{backends.map((backend) => <button key={backend.id} className={`backend-option ${target === backend.id ? "selected" : ""}`} onClick={() => setTarget(backend.id)} disabled={!backend.available && backend.id !== "qci-aer-gpu"}><span className={`auto-mark ${backend.kind}`}><Cpu size={16} /></span><span><b>{backend.displayName}</b><small>{backend.provider} · {backend.qubits} qubits · {backend.queueSeconds < 60 ? `${backend.queueSeconds}s` : `${Math.ceil(backend.queueSeconds / 60)}m`} queue</small></span><span className="backend-badges"><em>{backend.kind}</em><small>{backend.available ? "Connected" : "Needs provider key"}</small></span>{target === backend.id ? <Check size={17} /> : <ChevronRight size={17} />}</button>)}</div>
        </div>
      </section>

      <aside className="submit-review">
        <div className="console-panel review-panel"><p className="qr-eyebrow">Execution review</p><h2>Ready to transpile</h2><dl><div><dt>Input</dt><dd>{format === "openqasm2" ? "OpenQASM 2.0" : "OpenQASM 3.0"}</dd></div><div><dt>Policy</dt><dd className="capitalize">{mode}</dd></div><div><dt>Target</dt><dd>{target === "auto" ? "Automatic" : backends.find((backend) => backend.id === target)?.displayName}</dd></div><div><dt>Shots</dt><dd>{shots.toLocaleString()}</dd></div><div><dt>Spend limit</dt><dd>${Number(maxCost || 0).toFixed(2)}</dd></div></dl>{error && <div className="console-alert error"><AlertCircle size={16} />{error}</div>}<button className="console-primary full" onClick={run} disabled={busy || !source.trim()}>{busy ? <><Loader2 className="spin" size={16} /> Routing task</> : <><Play size={15} /> Run task</>}</button><small className="review-note">The exact quote is reserved before provider submission. Unused credits are released automatically.</small></div>
        {job && <div className="console-panel result-panel"><div className="result-status"><span><Check size={15} /></span><div><small>Task {job.status}</small><b>{job.id.slice(0, 8)}</b></div></div><dl><div><dt>Backend</dt><dd>{job.selected_backend_id}</dd></div><div><dt>Complexity</dt><dd className="capitalize">{job.analysis.complexity}</dd></div><div><dt>Circuit</dt><dd>{job.analysis.qubits}q · depth {job.analysis.depth}</dd></div><div><dt>QCI quote</dt><dd className="orange">${job.quote.total.toFixed(4)}</dd></div></dl>{job.result?.counts && <div className="counts"><span>Measurement counts</span>{Object.entries(job.result.counts).sort((a,b) => b[1]-a[1]).map(([state,count]) => <div key={state}><code>|{state}⟩</code><i style={{ width: `${Math.max(4, count / shots * 100)}%` }} /><b>{count}</b></div>)}</div>}<a href={`/dashboard/tasks?job=${job.id}`} className="console-secondary full">View task details <ArrowRight size={14} /></a></div>}
      </aside>
    </div>
  );
}
