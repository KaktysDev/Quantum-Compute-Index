"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, FileCode2, GitBranch, Loader2, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import type { QRouterProject, RepositoryInspection } from "@/lib/qrouter/repositories";

const DEFAULT_REPOSITORY = "KaktysDev/Quantum-Compute-Index";

interface GithubStatus {
  configured: boolean;
  connected: boolean;
  connection: { account_login: string; account_type: string } | null;
}

export default function GitHubManager() {
  const [projects, setProjects] = useState<QRouterProject[]>([]);
  const [repository, setRepository] = useState(DEFAULT_REPOSITORY);
  const [ref, setRef] = useState("");
  const [circuitPath, setCircuitPath] = useState("");
  const [inspection, setInspection] = useState<RepositoryInspection | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [busy, setBusy] = useState<"load" | "inspect" | "import" | null>("load");
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setBusy("load");
    try {
      const response = await fetch("/api/v1/projects", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load projects.");
      setProjects(data.data);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not load projects.");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadGithub = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/integrations/github", { cache: "no-store" });
      if (response.ok) setGithub(await response.json() as GithubStatus);
    } catch {
      setGithub(null);
    }
  }, []);

  useEffect(() => { loadProjects(); loadGithub(); }, [loadGithub, loadProjects]);

  async function disconnectGithub() {
    const response = await fetch("/api/v1/integrations/github", { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error?.message ?? "Could not disconnect GitHub.");
      return;
    }
    await loadGithub();
  }

  async function inspect() {
    setBusy("inspect"); setError(null); setInspection(null);
    try {
      const query = new URLSearchParams({ repository, ...(ref.trim() ? { ref: ref.trim() } : {}) });
      const response = await fetch(`/api/v1/repositories/inspect?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Repository inspection failed.");
      const next = data as RepositoryInspection;
      setInspection(next);
      setRepository(next.repository.fullName);
      setRef(ref.trim() || next.repository.defaultBranch);
      const configured = typeof next.config?.circuit === "string" ? next.config.circuit : "";
      setCircuitPath(next.files.some((file) => file.path === configured) ? configured : next.files[0]?.path ?? "");
      if (!next.files.length) setError("No .qasm circuit files were found in this ref.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Repository inspection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function importProject() {
    if (!inspection || !circuitPath) return;
    setBusy("import"); setError(null);
    try {
      const config = inspection.config ?? {};
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repository: inspection.repository.fullName,
          production_branch: ref,
          circuit_path: circuitPath,
          settings: {
            shots: typeof config.shots === "number" ? config.shots : 1024,
            target: typeof config.target === "string" ? config.target : "auto",
            routingMode: ["balanced", "cost", "speed", "quality"].includes(String(config.routing_mode)) ? config.routing_mode : "balanced",
            optimizationLevel: typeof config.optimization_level === "number" ? config.optimization_level : 2,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Project import failed.");
      setInspection(null); setCircuitPath("");
      await loadProjects();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Project import failed.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/v1/projects/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error?.message ?? "Could not remove project.");
      return;
    }
    setProjects((current) => current.filter((project) => project.id !== id));
  }

  return (
    <div className="repo-import-layout">
      <section className="github-connection-bar">
        <div><GitBranch size={15} /><span><b>GitHub source</b><small>{github?.connection ? `${github.connection.account_login} · ${github.connection.account_type}` : github?.connected ? "Server credential connected" : "Public repositories only"}</small></span></div>
        {github?.connection ? <button onClick={disconnectGithub}><Unplug size={13} /> Disconnect</button> : github?.configured ? <a href="/api/integrations/github/connect"><GitBranch size={13} /> Install GitHub App</a> : <span>APP NOT CONFIGURED</span>}
      </section>
      <section className="console-panel repo-import-panel">
        <div className="panel-title"><Plus size={16} /><div><h2>Import Git repository</h2><small>GitHub source → QRouter project</small></div></div>
        <div className="repo-import-form">
          <label><span>Repository</span><div className="terminal-input"><b>github.com/</b><input value={repository} onChange={(event) => setRepository(event.target.value)} /></div></label>
          <label><span>Production branch</span><div className="terminal-input"><GitBranch size={13} /><input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="default branch" /></div></label>
          <button className="console-secondary" onClick={inspect} disabled={Boolean(busy)}>{busy === "inspect" ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Inspect repository</button>
          {inspection && <div className="repo-inspection">
            <div><Check size={14} /><span><b>{inspection.repository.fullName}</b><small>{inspection.repository.private ? "Private via server credential" : "Public repository"} · {inspection.files.length} circuits</small></span></div>
            <label><span>Entrypoint circuit</span><select value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)}>{inspection.files.map((file) => <option key={file.sha} value={file.path}>{file.path}</option>)}</select></label>
            {inspection.config && <p><FileCode2 size={12} /> qrouter.json detected and defaults loaded</p>}
            <button className="console-primary" onClick={importProject} disabled={Boolean(busy) || !circuitPath}>{busy === "import" ? <Loader2 className="spin" size={14} /> : <Plus size={14} />} Import project</button>
          </div>}
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>

      <section className="console-panel repo-projects-panel">
        <div className="panel-title"><GitBranch size={16} /><div><h2>Workspace projects</h2><small>Connected deployment sources</small></div><span>{projects.length} total</span></div>
        <div className="repo-project-head"><span>Project</span><span>Entrypoint</span><span>Production</span><span>Last deploy</span><span /></div>
        {busy === "load" ? <div className="console-empty"><Loader2 className="spin" /></div> : projects.length === 0 ? <div className="console-empty"><GitBranch /><p>No repositories imported</p><small>Inspect a repository to create the first project.</small></div> : projects.map((project) => (
          <div className="repo-project-row" key={project.id}>
            <span><b>{project.name}</b><small>{project.repository}</small></span>
            <span><FileCode2 size={12} />{project.circuit_path}</span>
            <span><GitBranch size={12} />{project.production_branch}</span>
            <span>{project.last_deployed_at ? new Date(project.last_deployed_at).toLocaleString() : "Never"}</span>
            <span><a href={project.repository_url} target="_blank" rel="noreferrer" title="Open repository"><ArrowUpRight size={13} /></a><button onClick={() => remove(project.id)} title="Remove project"><Trash2 size={13} /></button></span>
          </div>
        ))}
      </section>
    </div>
  );
}
