"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, Clock, Download, FileCode2, Loader2, RotateCw, Square } from "lucide-react";

interface Job {
  id: string; name: string | null; status: string; selected_backend_id: string;
  shots: number; analysis?: { qubits: number; depth: number; complexity: string; transpilation?: { before: { depth: number; gates: number }; after: { depth: number; gates: number }; equivalent: boolean | null } };
  attempts?: Array<{ attempt: number; backend_id: string; status: string }>;
  result?: { counts?: Record<string, number> }; error?: { message?: string }; created_at: string;
}
const terminal = ["completed", "failed", "cancelled"];

export default function TasksTable() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/jobs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load tasks.");
      setJobs(data.data); setError(null);
    } catch (value) { setError(value instanceof Error ? value.message : "Could not load tasks."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const timer = setInterval(load, 5000); return () => clearInterval(timer); }, [load]);

  async function toggle(job: Job) {
    if (open === job.id) { setOpen(null); return; }
    setOpen(job.id);
    try {
      const response = await fetch(`/api/v1/jobs/${job.id}`, { cache: "no-store" });
      const detail = await response.json();
      if (response.ok) setJobs((current) => current.map((item) => item.id === job.id ? { ...item, ...detail } : item));
    } catch { /* polling will retry */ }
  }

  async function cancel(id: string) {
    const response = await fetch(`/api/v1/jobs/${id}/cancel`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setError(data.error?.message ?? "Cancellation failed."); return; }
    await load();
  }

  if (loading) return <div className="console-empty"><Loader2 className="spin"/><p>Loading tasks</p></div>;
  return <div className="console-panel tasks-panel">
    <div className="tasks-toolbar"><span>{jobs.length} tasks</span><button onClick={load}><RotateCw size={14}/>Refresh</button></div>
    {error && <div className="console-alert error"><AlertCircle size={16}/>{error}</div>}
    <div className="tasks-head"><span>Task</span><span>Backend</span><span>Created</span><span>Cost state</span><span>Status</span><span/></div>
    {jobs.length === 0 ? <div className="console-empty"><Clock/><p>No tasks yet</p><a href="/dashboard/playground">Deploy your first project</a></div> : jobs.map((job) => <div className="task-wrap" key={job.id}>
      <button className="task-row" onClick={() => toggle(job)}><span><b>{job.name || "Untitled task"}</b><small>{job.id.slice(0, 8)}</small></span><span><b>{job.selected_backend_id}</b><small>{job.analysis ? `${job.analysis.qubits}q · ${job.analysis.depth} depth` : "Analyzing"}</small></span><span>{new Date(job.created_at).toLocaleDateString()}<small>{new Date(job.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span><span>{job.status === "completed" ? "Settled" : terminal.includes(job.status) ? "Released" : "Reserved"}</span><span><i className={`status-dot ${job.status}`}/>{job.status.replaceAll("_", " ")}</span><ChevronDown size={15} className={open === job.id ? "rotate" : ""}/></button>
      {open === job.id && <div className="task-detail"><div><span>Task configuration</span><dl><div><dt>Shots</dt><dd>{job.shots.toLocaleString()}</dd></div><div><dt>Complexity</dt><dd>{job.analysis?.complexity ?? "—"}</dd></div><div><dt>Backend</dt><dd>{job.selected_backend_id}</dd></div><div><dt>Attempts</dt><dd>{job.attempts?.length ?? 0}</dd></div>{job.analysis?.transpilation && <><div><dt>Compiled depth</dt><dd>{job.analysis.transpilation.before.depth} → {job.analysis.transpilation.after.depth}</dd></div><div><dt>Compiled gates</dt><dd>{job.analysis.transpilation.before.gates} → {job.analysis.transpilation.after.gates}</dd></div></>}</dl>{!terminal.includes(job.status) && <button className="console-danger" onClick={() => cancel(job.id)}><Square size={13}/>Cancel task</button>}<a className="console-secondary artifact-link" href={`/api/v1/jobs/${job.id}/transpiled`}><FileCode2 size={14}/>Compiled QASM</a></div><div><span>Result</span>{job.result?.counts ? <div className="mini-counts">{Object.entries(job.result.counts).map(([state, count]) => <div key={state}><code>|{state}⟩</code><b>{count}</b></div>)}<a href={`/api/v1/jobs/${job.id}/result`}><Download size={14}/>Download JSON</a></div> : <p className="muted">{job.error?.message ?? "Result will unlock when execution completes."}</p>}</div></div>}
    </div>)}
  </div>;
}
