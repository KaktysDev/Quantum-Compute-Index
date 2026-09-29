"use client";

// Deploy a project's OpenQASM entrypoint at a pinned ref, then track the jobs
// each deployment created.

import Link from "next/link";
<<<<<<< Updated upstream
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Clock3, FileCode2, GitBranch, Loader2, Play, RefreshCw, Route, Terminal } from "lucide-react";
=======
import { Loader2, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { EmptyState, InlineAlert, Panel, StatusBadge, Timestamp } from "@/components/console/ui";
import { apiErrorMessage, backendLabel } from "@/lib/client/activity";
import { useAdvance } from "@/lib/client/use-advance";
import { onVisibleInterval } from "@/lib/client/visible-interval";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { costView, formatUsd } from "@/lib/qrouter/cost";
>>>>>>> Stashed changes
import type { ProjectSettings, QRouterProject, RepositoryInspection } from "@/lib/qrouter/repositories";
import { isSettled } from "@/lib/qrouter/status";

interface Deployment {
  id: string;
  name: string | null;
  status: string;
  selected_backend_id: string;
  created_at: string;
  updated_at: string;
  quote?: { total?: number };
  quotes?: { total?: number } | Array<{ total?: number }>;
  analysis?: { transpilation?: { compiler?: string } };
  error?: { message?: string };
}

type Outcome = { tone: "success" | "warning"; jobId: string; text: string };

const DEFAULT_SETTINGS: ProjectSettings = { shots: 1024, target: "auto", routingMode: "balanced", optimizationLevel: 2, failover: true, maxAttempts: 3, timeoutSeconds: 7200 };

function quoteOf(deployment: Deployment) {
  const embedded = Array.isArray(deployment.quotes) ? deployment.quotes[0] : deployment.quotes;
  const total = Number(embedded?.total ?? deployment.quote?.total);
  return Number.isFinite(total) ? total : null;
}

export default function RepositoryDeployments({ requestedTarget }: { requestedTarget?: string }) {
  const [projects, setProjects] = useState<QRouterProject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [settings, setSettings] = useState<ProjectSettings>(DEFAULT_SETTINGS);
  const [ref, setRef] = useState("");
  const [circuitPath, setCircuitPath] = useState("");
  const [inspection, setInspection] = useState<RepositoryInspection | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const selected = projects.find((project) => project.id === selectedId) ?? null;

  const loadDeployments = useCallback(async (projectId: string) => {
    const response = await fetch(`/api/v1/repository-jobs?project_id=${encodeURIComponent(projectId)}`, { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (response.ok) setDeployments(data.data);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/v1/projects", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(apiErrorMessage(data, "Could not load projects."));
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
    setSettings({ ...DEFAULT_SETTINGS, ...selected.settings, target: requestedTarget || selected.settings.target });
    setRef(selected.production_branch);
    setCircuitPath(selected.circuit_path);
    setInspection(null);
    setOutcome(null);
    void loadDeployments(selected.id);
    (async () => {
      const query = new URLSearchParams({ repository: selected.repository, ref: selected.production_branch });
      const response = await fetch(`/api/v1/repositories/inspect?${query}`, { cache: "no-store" });
      if (response.ok) setInspection(await response.json() as RepositoryInspection);
    })();
  }, [loadDeployments, requestedTarget, selected]);

  const inFlight = deployments.some((deployment) => !isSettled(deployment.status));
  useEffect(() => {
<<<<<<< Updated upstream
    if (!selectedId) return;
    const timer = window.setInterval(() => loadDeployments(selectedId), 5000);
    return () => window.clearInterval(timer);
  }, [loadDeployments, selectedId]);
=======
    if (!selectedId || !inFlight) return;
    return onVisibleInterval(() => void loadDeployments(selectedId), 5000);
  }, [inFlight, loadDeployments, selectedId]);
  useAdvance(deployments, () => selectedId && void loadDeployments(selectedId));
>>>>>>> Stashed changes

  async function deploy(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const updateResponse = await fetch(`/api/v1/projects/${selected.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ production_branch: ref, circuit_path: circuitPath, settings }),
      });
      if (!updateResponse.ok) throw new Error(apiErrorMessage(await updateResponse.json().catch(() => null), "Could not update the project source."));
      const response = await fetch("/api/v1/repository-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project_id: selected.id, ref, circuit_path: circuitPath, settings, deployment_id: crypto.randomUUID() }),
      });
      const data = await response.json().catch(() => null);
      const parkedId = data?.error?.job_id;
      if (response.status === 402 && typeof parkedId === "string") {
        setOutcome({ tone: "warning", jobId: parkedId, text: "Deployment is waiting for credits and starts automatically once they are added." });
      } else if (!response.ok) {
        throw new Error(apiErrorMessage(data, "Repository deployment failed."));
      } else {
        const total = Number(data.quote?.total);
        setOutcome({
          tone: "success",
          jobId: data.id,
          text: `Deployed ${circuitPath} at ${ref} to ${backendLabel(data.selected_backend_id)}${Number.isFinite(total) ? `, ${formatUsd(total)} reserved` : ""}.`,
        });
      }
      await loadDeployments(selected.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Repository deployment failed.");
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => ({
    total: deployments.length,
    active: deployments.filter((deployment) => !isSettled(deployment.status)).length,
  }), [deployments]);

  if (loading) return <div className="empty"><Loader2 size={16} className="spin" /></div>;
  if (!projects.length) {
    return (
      <section className="panel">
        <EmptyState
          title="No repository projects"
          body="Import a GitHub repository and choose its OpenQASM entrypoint first."
          action={<Link href="/dashboard/repositories" className="btn btn-primary">Import a repository</Link>}
        />
      </section>
    );
  }

  const set = <K extends keyof ProjectSettings>(key: K, value: ProjectSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  return (
    <div className="stack">
      <div className="row-between">
        <label className="select-wrap" style={{ width: "min(420px, 100%)" }}>
          <select className="input" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Project">
            {projects.map((project) => <option key={project.id} value={project.id}>{project.repository}</option>)}
          </select>
        </label>
        <span className="dim">{counts.total} deployments{counts.active ? ` · ${counts.active} in progress` : ""}</span>
      </div>

      <Panel title="Deploy" description="Runs the entrypoint as a single job at the ref you choose.">
        <form className="stack" onSubmit={deploy}>
          <div className="form-grid two" style={{ padding: 0 }}>
            <label className="field">
              Branch or ref
              <input className="input mono" value={ref} onChange={(event) => setRef(event.target.value)} required />
            </label>
            <label className="field">
              Entrypoint
              {inspection?.files.length ? (
                <select className="input" value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)}>
                  {inspection.files.map((file) => <option key={file.sha} value={file.path}>{file.path}</option>)}
                </select>
              ) : (
                <input className="input mono" value={circuitPath} onChange={(event) => setCircuitPath(event.target.value)} required />
              )}
            </label>
          </div>
          <div className="form-grid four" style={{ padding: 0 }}>
            <label className="field">
              Target
              <select className="input" value={settings.target} onChange={(event) => set("target", event.target.value)}>
                <option value="auto">Automatic</option>
                {BACKENDS.map((backend) => <option key={backend.id} value={backend.id}>{backend.displayName}</option>)}
              </select>
            </label>
            <label className="field">
              Shots
              <input className="input" type="number" min={1} max={1_000_000} value={settings.shots} onChange={(event) => set("shots", Math.max(1, Number(event.target.value) || 1))} />
            </label>
            <label className="field">
              Routing mode
              <select className="input" value={settings.routingMode} onChange={(event) => set("routingMode", event.target.value as ProjectSettings["routingMode"])}>
                <option value="balanced">Balanced</option>
                <option value="cost">Cost</option>
                <option value="speed">Speed</option>
                <option value="quality">Quality</option>
              </select>
            </label>
            <label className="field">
              Optimization level
              <select className="input" value={settings.optimizationLevel} onChange={(event) => set("optimizationLevel", Number(event.target.value))}>
                {[0, 1, 2, 3].map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
            </label>
          </div>
          <details className="advanced">
            <summary>Failover and timeout</summary>
            <div className="form-grid three" style={{ padding: "12px 0 0" }}>
              <label className="check-row" style={{ alignSelf: "end", height: 32 }}>
                <input type="checkbox" checked={settings.failover} onChange={(event) => set("failover", event.target.checked)} />
                Provider failover
              </label>
              <label className="field">
                Max attempts
                <select className="input" value={settings.maxAttempts} disabled={!settings.failover} onChange={(event) => set("maxAttempts", Number(event.target.value))}>
                  {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <label className="field">
                Timeout (seconds)
                <input className="input" type="number" min={60} max={604800} value={settings.timeoutSeconds} onChange={(event) => set("timeoutSeconds", Number(event.target.value))} />
              </label>
            </div>
          </details>

          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          {outcome ? (
            <InlineAlert
              tone={outcome.tone}
              action={
                outcome.tone === "warning" ? (
                  <Link href="/dashboard/billing" className="btn btn-secondary btn-sm">Add credits</Link>
                ) : (
                  <Link href={`/dashboard/activity?job=${outcome.jobId}`} className="btn btn-secondary btn-sm">View job</Link>
                )
              }
            >
              {outcome.text}
            </InlineAlert>
          ) : null}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy || !circuitPath || !ref}>
              {busy ? <Loader2 size={14} className="spin" /> : <Play size={13} />} Deploy
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Deployments" flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th className="hide-sm">Backend</th>
                <th className="hide-sm">Compiler</th>
                <th className="num">Cost</th>
                <th className="hide-sm">Created</th>
              </tr>
            </thead>
            <tbody>
              {deployments.length === 0 ? (
                <tr><td colSpan={6} className="empty-row">No deployments for this project yet.</td></tr>
              ) : (
                deployments.map((deployment) => {
                  const cost = costView({ status: deployment.status, quoted: quoteOf(deployment), charged: null });
                  return (
                    <tr key={deployment.id}>
                      <td>
                        <Link href={`/dashboard/activity?job=${deployment.id}`} className="cell-main">
                          <b className="mono">{deployment.id.slice(0, 8)}</b>
                          <small>{deployment.name ?? selected?.circuit_path}</small>
                        </Link>
                      </td>
                      <td><StatusBadge status={deployment.status} /></td>
                      <td className="hide-sm">{backendLabel(deployment.selected_backend_id)}</td>
                      <td className="hide-sm muted">{deployment.analysis?.transpilation?.compiler ?? "—"}</td>
                      <td className="num">
                        <span className="cell-main">
                          <span>{cost.amount === null ? "—" : formatUsd(cost.amount)}</span>
                          <small>{cost.label === "Charged" ? "Quoted" : cost.label}</small>
                        </span>
                      </td>
                      <td className="hide-sm"><Timestamp value={deployment.created_at} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
