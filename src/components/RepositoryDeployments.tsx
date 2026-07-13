"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, FileCode2, GitBranch, Loader2, Play, RefreshCw, Route, Terminal } from "lucide-react";
import type { ProjectSettings, QRouterProject, RepositoryInspection } from "@/lib/qrouter/repositories";

interface Deployment {
  id: string;
  name: string | null;
  status: string;
  selected_backend_id: string;
  created_at: string;
  updated_at: string;
  quote?: { total?: number };
  quotes?: { total?: number } | Array<{ total?: number }>;
  analysis?: { transpilation?: { compiler?: string; before?: { depth: number }; after?: { depth: number } } };
  error?: { message?: string };
}

const TERMINAL_IDLE = [
  { kind: "prompt", text: "$ qrouter deploy --source git" },
  { kind: "muted", text: "waiting for a project deployment" },
];

export default function RepositoryDeployments({ requestedTarget }: { requestedTarget?: string }) {
  const [projects, setProjects] = useState<QRouterProject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>({ shots: 1024, target: "auto", routingMode: "balanced", optimizationLevel: 2 });
  const [ref, setRef] = useState("");
  const [circuitPath, setCircuitPath] = useState("");
  const [inspection, setInspection] = useState<RepositoryInspection | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState(TERMINAL_IDLE);
  const [error, setError] = useState<string | null>(null);
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  const loadDeployments = useCallback(async (projectId: string) => {
    const response = await fetch(`/api/v1/repository-jobs?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const data = await response.json();
    if (response.ok) setDeployments(data.data);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/v1/projects", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message ?? "Could not load projects.");
        setProjects(data.data);
        setSelectedId(data.data[0]?.id ?? "");
      } catch (value) {
        setError(value instanceof Error ? value.message : "Could not load projects.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selected) return;
    setSettings({ ...selected.settings, target: requestedTarget || selected.settings.target });
    setRef(selected.production_branch);
    setCircuitPath(selected.circuit_path);
    setInspection(null);
    setLogs(TERMINAL_IDLE);
    loadDeployments(selected.id);
    (async () => {
      const query = new URLSearchParams({ repository: selected.repository, ref: selected.production_branch });
      const response = await fetch(`/api/v1/repositories/inspect?${query}`, { cache: "no-store" });
      if (response.ok) setInspection(await response.json() as RepositoryInspection);
    })();
  }, [loadDeployments, requestedTarget, selected]);

  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setInterval(() => loadDeployments(selectedId), 5000);
    return () => window.clearInterval(timer);
  }, [loadDeployments, selectedId]);

  async function deploy() {
    if (!selected) return;
    setBusy(true); setError(null);
    setLogs([
      { kind: "prompt", text: `$ qrouter deploy ${selected.repository} --ref ${ref}` },
      { kind: "path", text: `source  ${circuitPath}` },
      { kind: "muted", text: "fetching commit-pinned source..." },
    ]);
    try {
      const updateResponse = await fetch(`/api/v1/projects/${selected.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ production_branch: ref, circuit_path: circuitPath, settings }),
      });
      if (!updateResponse.ok) {
        const update = await updateResponse.json();
        throw new Error(update.error?.message ?? "Could not update the project source.");
      }
      setLogs((current) => [...current, { kind: "keyword", text: "parse   OpenQASM validated" }, { kind: "keyword", text: "route   scoring eligible compute targets" }]);
      const response = await fetch("/api/v1/repository-jobs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: selected.id, ref, circuit_path: circuitPath, settings, deployment_id: crypto.randomUUID() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Repository deployment failed.");
      setLogs((current) => [
        ...current,
        { kind: "keyword", text: `compile ${data.analysis?.transpilation?.compiler ?? "target"} → ${data.selected_backend_id}` },
        { kind: "value", text: `quote   $${Number(data.quote?.total ?? 0).toFixed(6)} reserved` },
        { kind: "success", text: `${data.status.padEnd(8)} job ${data.id}` },
      ]);
      await loadDeployments(selected.id);
    } catch (value) {
      const message = value instanceof Error ? value.message : "Repository deployment failed.";
      setError(message);
      setLogs((current) => [...current, { kind: "error", text: `error   ${message}` }]);
    } finally {
      setBusy(false);
    }
  }

  const summary = useMemo(() => ({
    total: deployments.length,
    active: deployments.filter((deployment) => !["completed", "failed", "cancelled"].includes(deployment.status)).length,
    completed: deployments.filter((deployment) => deployment.status === "completed").length,
  }), [deployments]);

  if (loading) return <div className="console-empty deployment-loading"><Loader2 className="spin" /><p>Loading projects</p></div>;
  if (!projects.length) return <section className="console-panel repo-empty-state"><GitBranch size={22} /><p>No repository projects</p><span>Import a GitHub repository and select its OpenQASM entrypoint before sending work to QRouter.</span><Link href="/dashboard/github" className="console-primary"><GitBranch size={14} /> Import repository</Link></section>;

  return (
    <div className="deployments-workspace">
      <div className="project-switcher">
        <span>Project</span>
        <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.repository}</option>)}</select>
        <Link href="/dashboard/github">Manage repositories <ArrowRight size={12} /></Link>
      </div>

      <section className="deployment-summary" aria-label="Deployment summary">
        <div><span>Deployments</span><b>{summary.total}</b></div><div><span>In flight</span><b>{summary.active}</b></div><div><span>Completed</span><b>{summary.completed}</b></div><div><span>Production ref</span><b>{ref}</b></div>
      </section>

      <div className="deployment-grid">
        <section className="console-panel deployment-config">
          <div className="panel-title"><GitBranch size={16} /><div><h2>Production source</h2><small>Repository configuration</small></div></div>
          <div className="deployment-fields">
            <label><span>Branch or ref</span><div className="terminal-input"><GitBranch size={13} /><input value={ref} onChange={(event) => setRef(event.target.value)} /></div></label>
            <label><span>Circuit entrypoint</span>{inspection?.files.length ? <select value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)}>{inspection.files.map((file) => <option key={file.sha} value={file.path}>{file.path}</option>)}</select> : <div className="terminal-input"><FileCode2 size={13} /><input value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)} /></div>}</label>
            <div className="deployment-field-grid">
              <label><span>Shots</span><input type="number" min={1} max={1_000_000} value={settings.shots} onChange={(event) => setSettings({ ...settings, shots: Number(event.target.value) })} /></label>
              <label><span>Routing</span><select value={settings.routingMode} onChange={(event) => setSettings({ ...settings, routingMode: event.target.value as ProjectSettings["routingMode"] })}><option value="balanced">balanced</option><option value="cost">cost</option><option value="speed">speed</option><option value="quality">quality</option></select></label>
              <label><span>Target</span><select value={settings.target} onChange={(event) => setSettings({ ...settings, target: event.target.value })}><option value="auto">auto</option><option value="qci-aer-gpu">QCI Aer GPU</option><option value="ibm-brisbane">IBM Brisbane</option><option value="ionq-aria-1">IonQ Aria 1</option><option value="iqm-garnet">IQM Garnet</option></select></label>
              <label><span>Optimization</span><select value={settings.optimizationLevel} onChange={(event) => setSettings({ ...settings, optimizationLevel: Number(event.target.value) })}><option value={0}>0</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></select></label>
            </div>
            <button className="console-primary deploy-command" onClick={deploy} disabled={busy || !circuitPath}>{busy ? <Loader2 className="spin" size={14} /> : <Play size={14} fill="currentColor" />} Deploy from repository</button>
            {error && <p className="form-error">{error}</p>}
          </div>
        </section>

        <section className="console-panel deployment-terminal">
          <div className="panel-title"><Terminal size={16} /><div><h2>Build output</h2><small>QRouter pipeline</small></div><span>{busy ? "RUNNING" : "READY"}</span></div>
          <div className="terminal-screen">{logs.map((line, index) => <div className={line.kind} key={`${line.text}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><code>{line.text}</code></div>)}</div>
          <div className="terminal-footer"><span><Route size={12} /> Route → transpile → price → execute</span><span>{selected?.repository}</span></div>
        </section>
      </div>

      <section className="console-panel deployment-list">
        <div className="panel-title"><Clock3 size={16} /><div><h2>Deployments</h2><small>Repository-triggered quantum jobs</small></div><button className="terminal-icon-button" onClick={() => selected && loadDeployments(selected.id)} title="Refresh"><RefreshCw size={13} /></button></div>
        <div className="deployment-head"><span>Deployment</span><span>Source</span><span>Target</span><span>Compiler</span><span>Status</span><span>Created</span></div>
        {!deployments.length ? <div className="console-empty"><Clock3 /><p>No deployments for this project</p></div> : deployments.map((deployment) => {
          const quote = Array.isArray(deployment.quotes) ? deployment.quotes[0] : deployment.quotes;
          return <Link href={`/dashboard/tasks?job=${deployment.id}`} className="deployment-row" key={deployment.id}>
            <span><b>{deployment.id.slice(0, 8)}</b><small>{quote?.total != null ? `$${Number(quote.total).toFixed(6)}` : deployment.name}</small></span>
            <span><FileCode2 size={12} />{selected?.circuit_path}</span>
            <span>{deployment.selected_backend_id}</span>
            <span>{deployment.analysis?.transpilation?.compiler ?? "pending"}</span>
            <span className={`deployment-status ${deployment.status}`}><i />{deployment.status}</span>
            <span>{new Date(deployment.created_at).toLocaleString()}</span>
          </Link>;
        })}
      </section>
    </div>
  );
}
