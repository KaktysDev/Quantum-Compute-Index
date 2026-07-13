"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, CheckCircle2, GitBranch, Loader2, Plug, Unplug } from "lucide-react";

type Repository = { full_name: string; html_url: string; default_branch: string; stargazers_count: number; updated_at: string; private: boolean };
const STORAGE_KEY = "qrouter.github.v1";

export default function GitHubManager() {
  const [value, setValue] = useState("KaktysDev/Quantum-Compute-Index");
  const [repository, setRepository] = useState<Repository | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setRepository(JSON.parse(saved) as Repository);
  }, []);

  async function connect() {
    const slug = value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(slug)) { setError("Enter a GitHub repository as owner/name."); return; }
    setBusy(true); setError(null);
    try {
      const response = await fetch(`https://api.github.com/repos/${slug}`, { headers: { accept: "application/vnd.github+json" } });
      if (!response.ok) throw new Error(response.status === 404 ? "Repository not found or not public." : "GitHub connection failed.");
      const data = await response.json() as Repository;
      setRepository(data); window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (value) { setError(value instanceof Error ? value.message : "GitHub connection failed."); }
    finally { setBusy(false); }
  }

  function disconnect() { setRepository(null); window.localStorage.removeItem(STORAGE_KEY); }

  return (
    <div className="github-layout">
      <section className="console-panel github-connect">
        <div className="panel-title"><GitBranch size={16} /><div><h2>Repository connection</h2><small>Source-triggered quantum jobs</small></div></div>
        <div className="github-form"><label><span>Repository</span><input value={value} onChange={(event) => setValue(event.target.value)} placeholder="owner/repository" /></label>{error && <p className="form-error">{error}</p>}<button className="console-primary" onClick={connect} disabled={busy}>{busy ? <Loader2 className="spin" size={14} /> : <Plug size={14} />} Connect repository</button></div>
      </section>

      <section className="console-panel github-state">
        <div className="panel-title"><GitBranch size={16} /><div><h2>Connected source</h2><small>GitHub public repository</small></div></div>
        {repository ? <div className="github-repo"><div className="github-repo-status"><CheckCircle2 size={16} /><span><b>{repository.full_name}</b><small>Connection healthy</small></span></div><dl><div><dt>Default branch</dt><dd>{repository.default_branch}</dd></div><div><dt>Visibility</dt><dd>{repository.private ? "Private" : "Public"}</dd></div><div><dt>Stars</dt><dd>{repository.stargazers_count.toLocaleString()}</dd></div><div><dt>Last activity</dt><dd>{new Date(repository.updated_at).toLocaleDateString()}</dd></div></dl><div className="github-actions"><a className="console-secondary" href={repository.html_url} target="_blank" rel="noreferrer">Open GitHub <ArrowUpRight size={13} /></a><button className="console-danger" onClick={disconnect}><Unplug size={13} /> Disconnect</button></div></div> : <div className="console-empty"><GitBranch /><p>No repository connected</p></div>}
      </section>
    </div>
  );
}
