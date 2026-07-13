import Link from "next/link";
import { ArrowRight, Braces, FileJson, KeyRound, LockKeyhole, Terminal } from "lucide-react";

const command = `curl https://api.qrouter.dev/api/v1/repository-jobs \\
  -H "Authorization: Bearer $QCI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_id": "proj_...",
    "ref": "main"
  }'`;

export default function ApiPage() {
  return <div className="console-page system-page">
    <div className="console-page-heading compact"><div><p className="qr-eyebrow"><span /> Playground / API</p><h1>API endpoint</h1><p>Use the same repository and job contracts from CI, services, or the console.</p></div><Link className="console-primary" href="/dashboard/api-keys"><KeyRound size={14} /> Manage keys</Link></div>
    <section className="api-command-bar"><span>Production</span><code>https://api.qrouter.dev</code><b><i /> OPERATIONAL</b></section>
    <div className="api-system-grid">
      <section className="console-panel api-terminal-panel"><div className="panel-title"><Terminal size={16} /><div><h2>Repository deployment</h2><small>Bearer authenticated request</small></div><span>cURL</span></div><pre><code>{command}</code></pre><div className="terminal-footer"><span><LockKeyhole size={12} /> Server-side provider credentials</span><span>application/json</span></div></section>
      <section className="console-panel auth-contract"><div className="panel-title"><KeyRound size={16} /><div><h2>Authentication</h2><small>Workspace scoped</small></div></div><div><p>Authorization header</p><code>Bearer qci_live_...</code></div><dl><div><dt>Key storage</dt><dd>SHA-256 hash</dd></div><div><dt>Provider secrets</dt><dd>Server only</dd></div><div><dt>Rate limit</dt><dd>120 / minute</dd></div><div><dt>Environment</dt><dd>live or test</dd></div></dl></section>
    </div>
    <section className="console-panel endpoint-reference"><div className="panel-title"><Braces size={16} /><div><h2>Core endpoints</h2><small>API v1</small></div><a href="/openapi.json">OpenAPI <FileJson size={12} /></a></div>{[["GET","/api/v1/projects","List connected repository projects"],["POST","/api/v1/projects","Import and configure a repository"],["POST","/api/v1/repository-jobs","Deploy a commit-pinned repository circuit"],["GET","/api/v1/jobs","List normalized quantum jobs"],["GET","/api/v1/jobs/{id}","Read execution and provider state"],["GET","/api/v1/jobs/{id}/result","Retrieve normalized results"],["GET","/api/v1/jobs/{id}/transpiled","Download compiled OpenQASM"],["POST","/api/v1/jobs/{id}/cancel","Cancel and release reserved credits"]].map(([method,path,copy]) => <div key={`${method}:${path}`}><b>{method}</b><code>{path}</code><span>{copy}</span><ArrowRight size={12} /></div>)}</section>
  </div>;
}
