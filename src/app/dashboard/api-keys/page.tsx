import Link from "next/link";
import { ArrowRight, KeyRound, LockKeyhole, Terminal } from "lucide-react";
import ApiKeyManager from "@/components/ApiKeyManager";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";

export const metadata = { title: "QRouter Console — API keys" };

// The endpoint reference used to live at /dashboard/playground/api, one tab
// away from the keys it authenticates with. It belongs here: you mint a key and
// immediately need the base URL, the header shape, and the limits.
//
// What it did NOT belong above is the curl block. A reader landing on this tab
// has just created a key and wants to know what to DO with it, and the first
// answer we gave them was a nine-line request body with an escaped OpenQASM
// string in it. The terminal client answers the same question in one line, so
// that goes first and curl stays as the second option.
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

      {/* The same three steps as the docs, deliberately word-for-word. Someone
          who reads one and then the other should not have to work out whether
          they are looking at two different procedures. */}
      <section className="console-panel api-steps-panel">
        <div className="panel-title">
          <Terminal size={16} />
          <div>
            <h2>Use your key</h2>
            <small>From nothing to a running job, in three steps</small>
          </div>
          <Link href="/docs#quickstart">
            Full guide <ArrowRight size={12} />
          </Link>
        </div>

        <ol className="api-steps">
          <li>
            <div>
              <h3>Run QRouter in your terminal</h3>
              <p>Needs Node 18.17 or newer. Nothing gets installed.</p>
              <pre>
                <code>
                  <i>{"$ "}</i>
                  <b>npx qrouter.app</b>
                </code>
              </pre>
            </div>
          </li>
          <li>
            <div>
              <h3>Copy a key from the table above</h3>
              <p>
                Create one if you have none. The full value is shown once, when it is created — after
                that only its prefix is stored.
              </p>
            </div>
          </li>
          <li>
            <div>
              <h3>Paste it when asked, then describe the run</h3>
              <p>
                QRouter remembers the key after the first run. From then on it is plain English —
                name the repository and what you want, and it finds the circuit, picks the machine,
                and quotes it before anything is charged.
              </p>
              <pre>
                <code>
                  {`❯ Paste your QRouter API key: `}
                  <b>{"••••••••••••"}</b>
                  {`

❯ `}
                  <b>{`Run this IBM quantum task on the cheapest
  IonQ model from github repo:
  acme-labs/bell-state-demo`}</b>
                  {`

`}
                  <i>{`Found circuits/bell.qasm — 2 qubits, depth 3
Routing under "cheapest" … IonQ Aria-1
Quote  $2.14 · 1024 shots · ~4 min queue`}</i>
                  {`

❯ type `}
                  <b>run</b>
                  {` to execute`}
                </code>
              </pre>
            </div>
          </li>
        </ol>
      </section>

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
              <h2>Or call it over HTTP</h2>
              <small>Same key, same router</small>
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
