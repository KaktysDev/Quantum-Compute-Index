"use client";

// Repository access is intentionally one flow:
//   connect GitHub once → search or paste a repository → scan → import.
//
// Connected repositories and pasted URLs share the same input. That keeps the
// mental model small and also mirrors Deploy, where a connected repository can
// be referenced by name instead of requiring its URL every time.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
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
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import MagnetField from "@/components/routing/MagnetField";
import { fetchJsonWithRetry } from "@/lib/client/fetch-json";
import type { QRouterProject, RepositoryInspection } from "@/lib/qrouter/repositories";

const PLACEHOLDER_REPOSITORY = "Search repositories or paste a GitHub URL";

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

interface ApiErrorPayload {
  error?: { message?: string };
}

function apiErrorMessage(data: unknown, fallback: string): string {
  const payload = data as ApiErrorPayload | null;
  return payload?.error?.message ?? fallback;
}

function hint(message: string): string {
  if (/load failed|failed to fetch|fetch failed|network(?: request)? failed/i.test(message)) {
    return "QRouter could not reach the repository import service. Please try again.";
  }
  if (/rate limit/i.test(message)) {
    return `${message} Connect GitHub to use your installation's higher API limit.`;
  }
  if (/not found/i.test(message)) {
    return `${message} Check the name, or connect GitHub before scanning a private repository.`;
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
  const [showAllRepos, setShowAllRepos] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"repos" | "inspect" | "import" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/v1/projects", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Could not load projects.");
    setProjects(data.data);
  }, []);

  const loadGithub = useCallback(async () => {
    const response = await fetch("/api/v1/integrations/github", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load the GitHub connection.");
    setGithub((await response.json()) as GithubStatus);
  }, []);

  const loadRepos = useCallback(async (showBusy = false) => {
    if (showBusy) setBusy("repos");
    try {
      const response = await fetch("/api/v1/repositories", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Could not load repositories.");
      setRepos(data.data as GithubRepo[]);
      setRepoSource(data.source as "app" | "token" | "none");
    } finally {
      if (showBusy) setBusy(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([loadProjects(), loadGithub(), loadRepos()])
      .catch((value) => {
        if (active) setError(value instanceof Error ? hint(value.message) : "Could not load repositories.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "github") {
      setNotice("GitHub connected. Your selected repositories are ready to use in QRouter.");
    }
    if (params.get("error") === "github_app_not_configured") {
      setError("The GitHub App still needs to be configured on this QRouter deployment.");
    } else if (params.get("error") === "github_connection_failed") {
      setError("GitHub could not be connected. Try again or review the GitHub App setup.");
    }

    return () => {
      active = false;
    };
  }, [loadGithub, loadProjects, loadRepos]);

  const connected = Boolean(github?.connected || repoSource === "token" || (repoSource === "app" && repos.length > 0));
  const query = repository.trim().toLowerCase();
  const filteredRepos = useMemo(() => {
    if (!query || /^https?:\/\//.test(query)) return repos;
    return repos.filter((repo) =>
      `${repo.fullName} ${repo.description ?? ""} ${repo.language ?? ""}`.toLowerCase().includes(query),
    );
  }, [query, repos]);
  const visibleRepos = showAllRepos ? filteredRepos : filteredRepos.slice(0, 6);

  async function disconnectGithub() {
    setBusy("disconnect");
    setError(null);
    try {
      const response = await fetch("/api/v1/integrations/github", { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message ?? "Could not disconnect GitHub.");
      }
      setRepos([]);
      setRepoSource("none");
      setRepository("");
      setInspection(null);
      await Promise.all([loadGithub(), loadRepos()]);
      setNotice("GitHub disconnected. Imported project settings remain in your workspace.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not disconnect GitHub.");
    } finally {
      setBusy(null);
    }
  }

  function resolveRepositoryInput(value: string): { repository: string; ref?: string } {
    const input = value.trim();
    if (!input) throw new Error("Choose a repository or paste its GitHub URL.");
    if (/^https?:\/\//i.test(input) || input.includes("/")) return { repository: input };

    const exactName = repos.filter((repo) => repo.name.toLowerCase() === input.toLowerCase());
    if (exactName.length === 1) {
      return { repository: exactName[0].fullName, ref: exactName[0].defaultBranch };
    }
    if (filteredRepos.length === 1) {
      return { repository: filteredRepos[0].fullName, ref: filteredRepos[0].defaultBranch };
    }
    if (exactName.length > 1) throw new Error("More than one connected repository has that name. Choose the owner/name below.");
    throw new Error("Choose a matching repository below, or enter it as owner/name.");
  }

  function selectRepo(repo: GithubRepo) {
    setRepository(repo.fullName);
    setRef(repo.defaultBranch);
    void inspect(repo.fullName, repo.defaultBranch);
  }

  async function inspect(overrideRepo?: string, overrideRef?: string) {
    let target: { repository: string; ref?: string };
    try {
      target = overrideRepo
        ? { repository: overrideRepo, ref: overrideRef }
        : resolveRepositoryInput(repository);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Choose a repository.");
      return;
    }

    const targetRef = (overrideRef ?? target.ref ?? ref).trim();
    setBusy("inspect");
    setError(null);
    setNotice(null);
    setInspection(null);
    try {
      const params = new URLSearchParams({
        repository: target.repository,
        ...(targetRef ? { ref: targetRef } : {}),
      });
      const response = await fetch(`/api/v1/repositories/inspect?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message ?? "Repository scan failed.");
      const next = data as RepositoryInspection;
      setInspection(next);
      setRepository(next.repository.fullName);
      setRef(targetRef || next.repository.defaultBranch);
      const configured = typeof next.config?.circuit === "string" ? next.config.circuit : "";
      setCircuitPath(next.files.some((file) => file.path === configured) ? configured : next.files[0]?.path ?? "");
      if (!next.files.length) {
        setError(`No .qasm quantum tasks were found in ${next.repository.fullName}.`);
      }
    } catch (value) {
      setError(value instanceof Error ? hint(value.message) : "Repository scan failed.");
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
      const { response, data } = await fetchJsonWithRetry<QRouterProject | ApiErrorPayload>("/api/v1/projects", {
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
            failover: typeof config.failover === "boolean" ? config.failover : true,
            maxAttempts: typeof config.max_attempts === "number" ? config.max_attempts : 3,
            timeoutSeconds: typeof config.timeout_seconds === "number" ? config.timeout_seconds : 7200,
          },
        }),
      });
      if (!response.ok) throw new Error(apiErrorMessage(data, "Project import failed."));
      const project = data as QRouterProject;
      setNotice(`${inspection.repository.fullName} is ready. You can now reference it by name in Deploy.`);
      setInspection(null);
      setCircuitPath("");
      setProjects((current) => [
        project,
        ...current.filter((item) => item.id !== project.id && item.repository !== project.repository),
      ]);
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

  const accountLabel = github?.connection
    ? `${github.connection.account_login} · ${github.connection.account_type}`
    : repoSource === "token"
      ? "Local GitHub account"
      : "GitHub";

  return (
    <section className="repo-stage">
      <MagnetField />
      <div className="repo-stage-content">
        <header className="repo-lede">
          <span className="repo-kicker"><GitBranch size={13} /> GitHub integration</span>
          <h2>Connect once. Route from any repository.</h2>
          <p>
            Give QRouter access to the repositories you choose. Private source stays private, and in Deploy
            you can refer to a connected repository by name instead of pasting its URL.
          </p>
        </header>

        <section className={`repo-connect-card ${connected ? "connected" : ""}`}>
          <div className="repo-connect-icon">{connected ? <Check size={20} /> : <GitBranch size={20} />}</div>
          <div className="repo-connect-copy">
            <b>{connected ? accountLabel : "Connect your GitHub account"}</b>
            <span>
              {connected
                ? `${repos.length} repos available · private repository access enabled`
                : "Choose exactly which repositories QRouter can read. You can revoke access at any time."}
            </span>
          </div>
          {connected ? (
            <button className="repo-disconnect" onClick={disconnectGithub} disabled={busy === "disconnect"}>
              {busy === "disconnect" ? <Loader2 className="spin" size={14} /> : <Unplug size={14} />}
              Disconnect
            </button>
          ) : (
            <a className="console-primary repo-connect-button" href="/api/integrations/github/connect">
              <GitBranch size={15} /> Connect GitHub
            </a>
          )}
        </section>

        {!connected && github && !github.configured && (
          <p className="repo-setup-note">
            <ShieldCheck size={13} /> This deployment still needs GitHub App credentials. <Link href="/docs#github">Open setup guide</Link>
          </p>
        )}

        {(error || notice) && (
          <div className={`repo-feedback ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>
            {error ?? notice}
          </div>
        )}

        <section className="console-panel repo-picker-panel">
          <div className="panel-title">
            <Search size={16} />
            <div>
              <h2>Find a quantum task</h2>
              <small>{connected ? "Search your GitHub repos or paste any URL" : "Public GitHub URLs work without a connection"}</small>
            </div>
            {connected && (
              <button className="terminal-icon-button" onClick={() => loadRepos(true)} disabled={busy === "repos"} title="Refresh repositories">
                {busy === "repos" ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}
              </button>
            )}
          </div>

          <div className="repo-picker-body">
            <div className="repo-command">
              <Search size={17} />
              <input
                value={repository}
                placeholder={PLACEHOLDER_REPOSITORY}
                aria-label="Repository name or GitHub URL"
                spellCheck={false}
                onChange={(event) => {
                  setRepository(event.target.value);
                  setInspection(null);
                  setShowAllRepos(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void inspect();
                  }
                }}
              />
              <button onClick={() => inspect()} disabled={Boolean(busy) || !repository.trim()}>
                {busy === "inspect" ? <Loader2 className="spin" size={14} /> : <ArrowRight size={14} />}
                Scan repository
              </button>
            </div>

            {connected && repos.length > 0 && !/^https?:\/\//i.test(repository.trim()) && !inspection && (
              <div className="repo-results">
                <div className="repo-results-label">
                  <span>{query ? `${filteredRepos.length} matches` : "Recently updated"}</span>
                  <small>Click a repository to scan it</small>
                </div>
                {visibleRepos.length === 0 ? (
                  <div className="repo-no-results">No connected repositories match “{repository}”.</div>
                ) : (
                  <div className="repo-result-grid">
                    {visibleRepos.map((repo) => (
                      <button key={repo.fullName} onClick={() => selectRepo(repo)} disabled={Boolean(busy)}>
                        <span className="repo-result-mark">{repo.name.slice(0, 2).toUpperCase()}</span>
                        <span>
                          <b>{repo.fullName}{repo.private && <Lock size={10} />}</b>
                          <small>{repo.description || `${repo.language ?? "Repository"} · ${repo.defaultBranch}`}</small>
                        </span>
                        <ArrowRight size={13} />
                      </button>
                    ))}
                  </div>
                )}
                {filteredRepos.length > 6 && (
                  <button className="repo-show-more" onClick={() => setShowAllRepos((current) => !current)}>
                    {showAllRepos ? "Show fewer" : `Show all ${filteredRepos.length}`} <ChevronDown size={12} />
                  </button>
                )}
              </div>
            )}

            <details className="repo-options">
              <summary>Branch or ref <ChevronDown size={12} /></summary>
              <label>
                <span>Optional — leave empty to use the default branch</span>
                <div className="terminal-input">
                  <GitBranch size={13} />
                  <input value={ref} placeholder="default branch" spellCheck={false} onChange={(event) => setRef(event.target.value)} />
                </div>
              </label>
            </details>

            {inspection && (
              <div className="repo-inspection-card">
                <div className="repo-inspection-head">
                  <span><Check size={15} /></span>
                  <div>
                    <b>{inspection.repository.fullName}</b>
                    <small>
                      {inspection.repository.private ? "Private repository" : "Public repository"} · {inspection.files.length} quantum task{inspection.files.length === 1 ? "" : "s"} found
                    </small>
                  </div>
                  <a href={inspection.repository.htmlUrl} target="_blank" rel="noreferrer" title="Open on GitHub"><ArrowUpRight size={14} /></a>
                </div>
                {inspection.files.length > 0 && (
                  <>
                    <label>
                      <span>Quantum task</span>
                      <select value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)}>
                        {inspection.files.map((file) => <option key={file.sha} value={file.path}>{file.path}</option>)}
                      </select>
                    </label>
                    {inspection.config && <p><FileCode2 size={12} /> qrouter.json defaults detected</p>}
                    <button className="console-primary" onClick={importProject} disabled={Boolean(busy) || !circuitPath}>
                      {busy === "import" ? <Loader2 className="spin" size={14} /> : <Plus size={14} />}
                      Add to QRouter
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="console-panel repo-projects-panel repo-ready-panel">
          <div className="panel-title">
            <FolderGit2 size={16} />
            <div><h2>Ready in QRouter</h2><small>Imported repository tasks</small></div>
            <span>{projects.length}</span>
          </div>
          {loading ? (
            <div className="console-empty"><Loader2 className="spin" /></div>
          ) : projects.length === 0 ? (
            <div className="repo-ready-empty">
              <GitBranch size={18} />
              <div><b>No repository tasks yet</b><span>Scan a repository above and choose a .qasm entrypoint.</span></div>
            </div>
          ) : (
            <div className="repo-ready-list">
              {projects.map((project) => (
                <div className="repo-ready-row" key={project.id}>
                  <span className="repo-result-mark">{project.name.slice(0, 2).toUpperCase()}</span>
                  <span className="repo-ready-name"><b>{project.repository}</b><small>{project.circuit_path}</small></span>
                  <span className="repo-ready-branch"><GitBranch size={12} /> {project.production_branch}</span>
                  <span className="repo-ready-actions">
                    <Link href="/dashboard/github/deploy">Deploy <ArrowRight size={12} /></Link>
                    <a href={project.repository_url} target="_blank" rel="noreferrer" title="Open repository"><ArrowUpRight size={13} /></a>
                    <button onClick={() => remove(project.id)} title="Remove project"><Trash2 size={13} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
