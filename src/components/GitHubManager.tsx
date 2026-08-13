"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Repository import.
//
// Two paths in, ordered by how many of them actually work out of the box:
//
//   1. Paste a repository URL. This needs NO configuration — the inspect
//      endpoint reads public repositories through the anonymous GitHub API —
//      so it leads the page. It used to sit below a full-height "no repository
//      source connected" empty state, which made the whole tab look broken.
//   2. Pick from a list of your repositories. This needs a GitHub App
//      installation (or a local GITHUB_TOKEN), so it is presented as an
//      optional upgrade with a link to the setup guide, not as a failure.
//
// Anonymous GitHub reads are rate-limited per IP (60/hour), which on shared
// hosting is a real failure mode — `hint` below turns that into an explanation
// instead of a bare "GitHub rejected the request".
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileCode2,
  FolderGit2,
  GitBranch,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unplug,
} from "lucide-react";
import type { QRouterProject, RepositoryInspection } from "@/lib/qrouter/repositories";

const PLACEHOLDER_REPOSITORY = "Qiskit/qiskit";

interface GithubStatus {
  configured: boolean;
  connected: boolean;
  connection: { account_login: string; account_type: string } | null;
}

interface GithubRepo {
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  language: string | null;
  description: string | null;
}

/** Turns the raw API message into something a user can act on. */
function hint(message: string): string {
  if (/rate limit/i.test(message)) {
    return `${message} Anonymous GitHub reads are capped at 60 per hour — connect the GitHub App or set GITHUB_TOKEN to raise it.`;
  }
  if (/not found/i.test(message)) {
    return `${message} Check the owner/name spelling, and note that private repositories need a GitHub App connection.`;
  }
  return message;
}

export default function GitHubManager() {
  const [projects, setProjects] = useState<QRouterProject[]>([]);
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("");
  const [circuitPath, setCircuitPath] = useState("");
  const [inspection, setInspection] = useState<RepositoryInspection | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repoSource, setRepoSource] = useState<"app" | "token" | "none">("none");
  const [repoQuery, setRepoQuery] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [busy, setBusy] = useState<"load" | "repos" | "inspect" | "import" | null>("load");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    setBusy("load");
    try {
      const response = await fetch("/api/v1/projects", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load projects.");
      setProjects(data.data);
    } catch (value) {
      setError(value instanceof Error ? hint(value.message) : "Could not load projects.");
    } finally {
      setBusy(null);
    }
  }, []);

  const loadGithub = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/integrations/github", { cache: "no-store" });
      if (response.ok) setGithub((await response.json()) as GithubStatus);
    } catch {
      setGithub(null);
    }
  }, []);

  const loadRepos = useCallback(async () => {
    setBusy("repos");
    try {
      const response = await fetch("/api/v1/repositories", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load repositories.");
      setRepos(data.data as GithubRepo[]);
      setRepoSource(data.source as "app" | "token" | "none");
      // Only auto-expand the picker when it has something to show.
      if ((data.data as GithubRepo[]).length > 0) setBrowserOpen(true);
    } catch (value) {
      setError(value instanceof Error ? hint(value.message) : "Could not load repositories.");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadGithub();
    loadRepos();
  }, [loadGithub, loadProjects, loadRepos]);

  const filteredRepos = useMemo(() => {
    const term = repoQuery.trim().toLowerCase();
    if (!term) return repos;
    return repos.filter((repo) =>
      `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""}`.toLowerCase().includes(term),
    );
  }, [repos, repoQuery]);

  async function disconnectGithub() {
    const response = await fetch("/api/v1/integrations/github", { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error?.message ?? "Could not disconnect GitHub.");
      return;
    }
    setRepos([]);
    setBrowserOpen(false);
    await Promise.all([loadGithub(), loadRepos()]);
  }

  function selectRepo(repo: GithubRepo) {
    setRepository(repo.fullName);
    setRef(repo.defaultBranch);
    inspect(repo.fullName, repo.defaultBranch);
  }

  async function inspect(overrideRepo?: string, overrideRef?: string) {
    const targetRepo = (overrideRepo ?? repository).trim();
    const targetRef = (overrideRef ?? ref).trim();
    if (!targetRepo) {
      setError("Enter a repository as owner/name, or paste its GitHub URL.");
      return;
    }
    setBusy("inspect");
    setError(null);
    setNotice(null);
    setInspection(null);
    try {
      const query = new URLSearchParams({ repository: targetRepo, ...(targetRef ? { ref: targetRef } : {}) });
      const response = await fetch(`/api/v1/repositories/inspect?${query}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Repository inspection failed.");
      const next = data as RepositoryInspection;
      setInspection(next);
      setRepository(next.repository.fullName);
      setRef(targetRef || next.repository.defaultBranch);
      const configured = typeof next.config?.circuit === "string" ? next.config.circuit : "";
      setCircuitPath(next.files.some((file) => file.path === configured) ? configured : next.files[0]?.path ?? "");
      if (!next.files.length) {
        setError(`No .qasm circuit files were found in ${next.repository.fullName}@${targetRef || next.repository.defaultBranch}.`);
      }
    } catch (value) {
      setError(value instanceof Error ? hint(value.message) : "Repository inspection failed.");
    } finally {
      setBusy(null);
    }
  }

  async function importProject() {
    if (!inspection || !circuitPath) return;
    setBusy("import");
    setError(null);
    try {
      const config = inspection.config ?? {};
      const response = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repository: inspection.repository.fullName,
          production_branch: ref || inspection.repository.defaultBranch,
          circuit_path: circuitPath,
          settings: {
            shots: typeof config.shots === "number" ? config.shots : 1024,
            target: typeof config.target === "string" ? config.target : "auto",
            routingMode: ["balanced", "cost", "speed", "quality"].includes(String(config.routing_mode))
              ? config.routing_mode
              : "balanced",
            optimizationLevel: typeof config.optimization_level === "number" ? config.optimization_level : 2,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Project import failed.");
      setNotice(`${inspection.repository.fullName} imported. Open Deployments to run it.`);
      setInspection(null);
      setCircuitPath("");
      await loadProjects();
    } catch (value) {
      setError(value instanceof Error ? hint(value.message) : "Project import failed.");
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

  const sourceLabel = github?.connection
    ? `${github.connection.account_login} · ${github.connection.account_type}`
    : repoSource === "token"
      ? "Server token · lists this account's repositories"
      : "Public repositories · no connection required";

  return (
    <div className="repo-import-layout">
      {/* ── Source status ─────────────────────────────────────────────────── */}
      <section className="github-connection-bar">
        <div>
          <GitBranch size={15} />
          <span>
            <b>GitHub source</b>
            <small>{sourceLabel}</small>
          </span>
        </div>
        {github?.connection ? (
          <button onClick={disconnectGithub}>
            <Unplug size={13} /> Disconnect
          </button>
        ) : github?.configured ? (
          <a href="/api/integrations/github/connect">
            <GitBranch size={13} /> Connect GitHub
          </a>
        ) : (
          <Link href="/docs#github">Set up private repo access</Link>
        )}
      </section>

      {/* ── 1. Paste a repository — always available ──────────────────────── */}
      <section className="console-panel repo-import-panel">
        <div className="panel-title">
          <Plus size={16} />
          <div>
            <h2>Import a repository</h2>
            <small>Paste any public GitHub URL — no connection needed</small>
          </div>
        </div>
        <div className="repo-import-form">
          <label>
            <span>Repository</span>
            <div className="terminal-input">
              <b>github.com/</b>
              <input
                value={repository}
                placeholder={PLACEHOLDER_REPOSITORY}
                spellCheck={false}
                onChange={(event) => setRepository(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    inspect();
                  }
                }}
              />
            </div>
          </label>
          <label>
            <span>Production branch</span>
            <div className="terminal-input">
              <GitBranch size={13} />
              <input
                value={ref}
                placeholder="default branch"
                spellCheck={false}
                onChange={(event) => setRef(event.target.value)}
              />
            </div>
          </label>
          <button className="console-secondary" onClick={() => inspect()} disabled={Boolean(busy)}>
            {busy === "inspect" ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />} Inspect repository
          </button>

          {inspection && (
            <div className="repo-inspection">
              <div>
                <Check size={14} />
                <span>
                  <b>{inspection.repository.fullName}</b>
                  <small>
                    {inspection.repository.private ? "Private via connection" : "Public repository"} ·{" "}
                    {inspection.files.length} circuit{inspection.files.length === 1 ? "" : "s"}
                  </small>
                </span>
              </div>
              <label>
                <span>Entrypoint circuit</span>
                <select value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)}>
                  {inspection.files.map((file) => (
                    <option key={file.sha} value={file.path}>
                      {file.path}
                    </option>
                  ))}
                </select>
              </label>
              {inspection.config && (
                <p>
                  <FileCode2 size={12} /> qrouter.json detected and defaults loaded
                </p>
              )}
              <button className="console-primary" onClick={importProject} disabled={Boolean(busy) || !circuitPath}>
                {busy === "import" ? <Loader2 className="spin" size={14} /> : <Plus size={14} />} Import project
              </button>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-message">{notice}</p>}
        </div>
      </section>

      {/* ── 2. Browse your repositories — needs a connection ──────────────── */}
      <section className="console-panel repo-browser-panel">
        <div className="panel-title">
          <FolderGit2 size={16} />
          <div>
            <h2>Your repositories</h2>
            <small>
              {repoSource === "app"
                ? `${repos.length} from the GitHub App installation`
                : repoSource === "token"
                  ? `${repos.length} from the server token`
                  : "Connect GitHub to browse and import private repositories"}
            </small>
          </div>
          {repoSource === "none" ? null : (
            <>
              <button
                className="terminal-icon-button"
                onClick={loadRepos}
                disabled={busy === "repos"}
                title="Refresh repositories"
              >
                {busy === "repos" ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
              </button>
              <button
                className="terminal-icon-button"
                onClick={() => setBrowserOpen((open) => !open)}
                aria-expanded={browserOpen}
                title={browserOpen ? "Collapse" : "Expand"}
              >
                <ChevronDown size={13} style={browserOpen ? { transform: "rotate(180deg)" } : undefined} />
              </button>
            </>
          )}
        </div>
        {repoSource === "none" ? (
          /* The panel subtitle above already states what a connection buys;
             repeating it here in two lines only delayed the one link that
             actually does something. */
          <div className="repo-source-hint">
            <Link className="console-secondary" href="/docs#github">
              How to connect GitHub <ArrowUpRight size={13} />
            </Link>
          </div>
        ) : browserOpen ? (
          <>
            <label className="repo-search">
              <Search size={13} />
              <input
                value={repoQuery}
                onChange={(event) => setRepoQuery(event.target.value)}
                placeholder="Search repositories..."
              />
            </label>
            <div className="repo-browser-list">
              {busy === "repos" ? (
                <div className="console-empty">
                  <Loader2 className="spin" />
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="console-empty">
                  <Search />
                  <p>No repositories match</p>
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <button
                    className="repo-browser-row"
                    key={repo.fullName}
                    onClick={() => selectRepo(repo)}
                    disabled={Boolean(busy)}
                  >
                    <span className="repo-mark">{repo.name.slice(0, 2).toUpperCase()}</span>
                    <span className="repo-browser-meta">
                      <b>
                        {repo.fullName}
                        {repo.private && <Lock size={10} />}
                      </b>
                      <small>{repo.description || `${repo.language ?? "—"} · ${repo.defaultBranch}`}</small>
                    </span>
                    {repository === repo.fullName ? <Check size={14} /> : <Plus size={14} />}
                  </button>
                ))
              )}
            </div>
          </>
        ) : null}
      </section>

      {/* ── 3. Imported projects ──────────────────────────────────────────── */}
      <section className="console-panel repo-projects-panel">
        <div className="panel-title">
          <GitBranch size={16} />
          <div>
            <h2>Workspace projects</h2>
            <small>Connected deployment sources</small>
          </div>
          <span>{projects.length} total</span>
        </div>
        <div className="repo-project-head">
          <span>Project</span>
          <span>Entrypoint</span>
          <span>Production</span>
          <span>Last deploy</span>
          <span />
        </div>
        {busy === "load" ? (
          <div className="console-empty">
            <Loader2 className="spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="console-empty">
            <GitBranch />
            <p>No repositories imported</p>
            <small>Inspect a repository above to create the first project.</small>
          </div>
        ) : (
          projects.map((project) => (
            <div className="repo-project-row" key={project.id}>
              <span>
                <b>{project.name}</b>
                <small>{project.repository}</small>
              </span>
              <span>
                <FileCode2 size={12} />
                {project.circuit_path}
              </span>
              <span>
                <GitBranch size={12} />
                {project.production_branch}
              </span>
              <span>{project.last_deployed_at ? new Date(project.last_deployed_at).toLocaleString() : "Never"}</span>
              <span>
                <a href={project.repository_url} target="_blank" rel="noreferrer" title="Open repository">
                  <ArrowUpRight size={13} />
                </a>
                <button onClick={() => remove(project.id)} title="Remove project">
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
