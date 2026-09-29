import Link from "next/link";
import ApiKeyManager from "@/components/ApiKeyManager";
import { CodeTabs, PageHeader, Panel } from "@/components/console/ui";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";

export const metadata = { title: "QRouter Console — API keys" };

const base = PUBLIC_CONFIG.apiBaseUrl;
const bell = String.raw`OPENQASM 2.0;\ninclude \"qelib1.inc\";\nqreg q[2];\ncreg c[2];\nh q[0];\ncx q[0],q[1];\nmeasure q -> c;`;

const EXAMPLES = [
  {
    id: "cli",
    label: "CLI",
    code: `# Node 18.17+. Paste your key when prompted, then describe the run.
npx qrouter.app`,
  },
  {
    id: "v2",
    label: "HTTP · v2",
    code: `# 1. Store the circuit once
curl ${base}/api/v2/circuits \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "Bell pair", "circuit": "${bell}"}'

# 2. Run it on one or more targets
curl ${base}/api/v2/jobs \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"circuit_id": "<id>", "executions": [
        {"key": "auto", "target": "auto", "shots": 1024},
        {"key": "sim", "target": "qci-aer-gpu", "shots": 1024}]}'

# 3. Poll the job, then fetch each execution's result
curl ${base}/api/v2/jobs/<job_id> -H "Authorization: Bearer $QROUTER_API_KEY"`,
  },
  {
    id: "v1",
    label: "HTTP · v1",
    code: `curl ${base}/api/v1/jobs \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"circuit": "${bell}", "shots": 1024, "routing_mode": "balanced"}'`,
  },
];

export default function ApiKeysPage() {
  return (
    <div className="console-page">
      <PageHeader title="API keys" description="Authenticate the CLI, SDKs and HTTP API. Test keys can only reach simulators." />

      <ApiKeyManager />

      <div className="api-layout">
        <Panel title="Quickstart" actions={<Link href="/docs#quickstart" className="btn btn-ghost btn-sm">Full guide</Link>}>
          <CodeTabs tabs={EXAMPLES} />
        </Panel>
        <Panel title="Reference">
          <dl className="kv">
            <dt>Base URL</dt>
            <dd><code>{base}</code></dd>
            <dt>Header</dt>
            <dd><code>Authorization: Bearer qci_live_…</code></dd>
            <dt>Scopes</dt>
            <dd><code>jobs:read</code>, <code>jobs:write</code></dd>
            <dt>Rate limit</dt>
            <dd>120 requests per minute per workspace</dd>
            <dt>Storage</dt>
            <dd>Keys are stored as SHA-256 hashes</dd>
          </dl>
          <p className="muted" style={{ marginTop: 16 }}>
            v2 stores circuits once and runs up to 25 executions per job. v1 stays available for single runs, repository deploys and webhooks.{" "}
            <Link href="/docs" className="link-btn">API reference</Link>
          </p>
        </Panel>
      </div>
    </div>
  );
}
