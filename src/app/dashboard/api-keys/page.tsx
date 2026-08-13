import Link from "next/link";
import { ArrowRight, KeyRound, LockKeyhole, Terminal } from "lucide-react";
import ApiKeyManager from "@/components/ApiKeyManager";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";

export const metadata = { title: "QRouter Console — API keys" };

// The endpoint reference used to live at /dashboard/playground/api, one tab
// away from the keys it authenticates with. It belongs here: you mint a key and
// immediately need the base URL, the header shape, and the limits.
const command = `curl ${PUBLIC_CONFIG.apiBaseUrl}/api/v1/jobs \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "circuit": "OPENQASM 2.0; include \\"qelib1.inc\\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;",
    "format": "openqasm2",
    "shots": 1024,
    "routing_mode": "balanced"
  }'`;

export default function ApiKeysPage() {
  return (
    <div className="console-page">
      <div className="console-page-heading compact">
        <div>
          <h1>API keys</h1>
        </div>
      </div>

      <ApiKeyManager />

      <section className="api-command-bar">
        <span>Base URL</span>
        <code>{PUBLIC_CONFIG.apiBaseUrl}</code>
        <b>PRIVATE BETA</b>
      </section>

      <div className="api-system-grid">
        <section className="console-panel api-terminal-panel">
          <div className="panel-title">
            <Terminal size={16} />
            <div>
              <h2>Submit a job</h2>
              <small>Bearer authenticated request</small>
            </div>
            <span>cURL</span>
          </div>
          <pre>
            <code>{command}</code>
          </pre>
          <div className="terminal-footer">
            <span>
              <LockKeyhole size={12} /> Server-side provider credentials
            </span>
            <span>application/json</span>
          </div>
        </section>

        <section className="console-panel auth-contract">
          <div className="panel-title">
            <KeyRound size={16} />
            <div>
              <h2>Authentication</h2>
              <small>Workspace scoped</small>
            </div>
          </div>
          <div>
            <p>Authorization header</p>
            <code>Bearer qci_live_...</code>
          </div>
          <dl>
            <div>
              <dt>Key storage</dt>
              <dd>SHA-256 hash</dd>
            </div>
            <div>
              <dt>Provider secrets</dt>
              <dd>Server only</dd>
            </div>
            <div>
              <dt>Rate limit</dt>
              <dd>120 / minute</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>live or test</dd>
            </div>
          </dl>
          <Link className="console-secondary" href="/docs">
            Full API reference <ArrowRight size={13} />
          </Link>
        </section>
      </div>
    </div>
  );
}
