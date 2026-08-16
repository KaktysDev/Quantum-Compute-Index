import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Boxes,
  Braces,
  CircleDollarSign,
  Clock3,
  Code2,
  ExternalLink,
  FileJson,
  Fingerprint,
  KeyRound,
  Layers,
  Lock,
  Route,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Webhook,
} from "lucide-react";
import DocsCodeExamples from "@/components/DocsCodeExamples";
import DocsV2CodeExamples from "@/components/docs/DocsV2CodeExamples";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";
import "./docs.css";

export const metadata: Metadata = {
  title: "QRouter API Documentation",
  description: "Build with the QRouter v1 and v2 APIs for quantum workload evaluation, compilation, routing, execution, and result retrieval.",
};

const endpoints = [
  ["GET", "/api/v1/session", "Verify a key and read its workspace, credits, scopes, and runnable backends."],
  ["GET", "/api/v1/repositories/inspect", "Discover OpenQASM entrypoints in a connected GitHub repository."],
  ["POST", "/api/v1/projects", "Import a repository, production branch, entrypoint, and routing defaults."],
  ["POST", "/api/v1/repository-jobs", "Deploy a commit-pinned circuit from a connected repository."],
  ["GET", "/api/v1/backends", "List compute targets and current routing inputs."],
  ["POST", "/api/v1/transpile", "Analyze, route, compile, verify, and quote without execution."],
  ["POST", "/api/v1/jobs", "Compile, reserve credits, and submit a workload."],
  ["GET", "/api/v1/jobs/{id}", "Read normalized job state and route metadata."],
  ["GET", "/api/v1/jobs/{id}/result", "Retrieve normalized counts and probabilities."],
  ["GET", "/api/v1/jobs/{id}/transpiled", "Download the provider-targeted OpenQASM artifact."],
  ["POST", "/api/v1/jobs/{id}/advance", "Drive one of your own jobs forward when no fleet scheduler is deployed."],
  ["POST", "/api/v1/jobs/{id}/cancel", "Request cancellation and release reserved credits."],
  ["POST", "/api/v1/webhooks", "Register an HTTPS endpoint and issue a signing secret."],
  ["GET", "/api/v1/webhooks/deliveries", "Inspect delivery attempts, retries, and terminal failures."],
];

const v2Endpoints = [
  ["POST", "/api/v2/circuits", "Store an OpenQASM circuit as a reusable resource. Idempotency-Key required."],
  ["GET", "/api/v2/circuits/{id}", "Read circuit metadata, static analysis, and release state."],
  ["POST", "/api/v2/circuits/{id}/release", "Purge circuit source, results, attempt/event/webhook payloads, and encrypted artifacts."],
  ["DELETE", "/api/v2/circuits/{id}", "Same purge as release, then remove the circuit resource. Responds 204 with no body."],
  ["POST", "/api/v2/jobs", "Create an execution group of 1–25 executions. Idempotency-Key required."],
  ["GET", "/api/v2/jobs/{id}", "Read group status with every execution, quote, and route decision."],
  ["GET", "/api/v2/executions/{id}/result", "Retrieve one normalized result as application/json."],
  ["GET", "/api/v2/executions/{id}/transpiled", "Download one compiled OpenQASM artifact as text/plain."],
  ["POST", "/api/v2/executions/{id}/cancel", "Cancel a single execution without touching its siblings."],
  ["GET", "/api/v2/backends", "List targets with capability metadata and the current QCI snapshot."],
];

const v2Errors = [
  ["400", "invalid_request", "The body is not valid JSON, or it failed the request schema."],
  ["400", "invalid_idempotency_key", "Idempotency-Key is absent or outside 8–255 characters."],
  ["401", "authentication_error", "Missing, malformed, revoked, or expired API key."],
  ["403", "insufficient_scope", "The API key is missing a required scope, or a test key pinned a QPU."],
  ["404", "circuit_not_found", "No circuit with that id belongs to this workspace."],
  ["404", "job_not_found", "No execution group with that id belongs to this workspace."],
  ["404", "execution_not_found", "No v2 execution with that id belongs to this workspace."],
  ["409", "idempotency_conflict", "The key was already used with a different request body."],
  ["409", "circuit_released", "The circuit source was released and cannot start new jobs."],
  ["409", "circuit_active", "A job for this circuit is still queued, running, or awaiting payment."],
  ["409", "result_not_available", "The execution has no stored result, or it was released."],
  ["409", "transpiled_not_available", "No transpiled artifact is stored for this execution."],
  ["409", "not_cancellable", "The execution is already completed, failed, or cancelled."],
  ["409", "execution_changed", "The execution changed state while cancellation was requested."],
  ["422", "invalid_circuit", "OpenQASM parsing or validation failed."],
  ["429", "rate_limit_error", "The per-key minute budget is exhausted. Honour retry-after."],
  ["500", "internal_error", "Unhandled platform error. Quote request_id when reporting it."],
];

const executionFields = [
  ["key", "string · required", "—", "Trimmed, 1–64 characters. Must be unique inside the job; duplicates are rejected."],
  ["target", "string", "auto", "Backend id (1–120 characters) or auto to let the QCI Engine select one."],
  ["shots", "integer", "1024", "1 – 1,000,000 measurement repetitions."],
  ["routing_mode", "enum", "balanced", "balanced, cost, speed, or quality."],
  ["optimization_level", "integer", "2", "0 – 3 compiler optimization level."],
  ["failover", "boolean", "true", "Try another quoted compatible backend after a failure."],
  ["max_attempts", "integer", "3", "1 – 5 dispatch attempts for this execution."],
  ["timeout_seconds", "integer", "7200", "60 – 604,800 seconds before an overdue provider job is cancelled."],
  ["constraints", "object", "{}", "Hard filters applied before scoring. See the table below."],
];

const constraintFields = [
  ["maxCost", "number", "Greater than 0. Rejects any candidate quoted above this total."],
  ["maxQueueSeconds", "integer", "0 or greater. Rejects candidates with a longer expected queue."],
  ["minFidelity", "number", "Between 0 and 1 inclusive. Rejects lower-fidelity candidates."],
  ["kind", "enum", "qpu or simulator."],
  ["providers", "string[]", "Up to 25 provider ids. Only these providers stay eligible."],
  ["excludeProviders", "string[]", "Up to 25 provider ids to remove from the candidate set."],
];

const groupStatuses = [
  ["queued", "No", "The group row exists and its executions are being quoted and funded."],
  ["running", "No", "Credits are reserved and at least one execution has not reached a terminal state."],
  ["awaiting_payment", "No", "The workspace balance could not cover the combined quote. Nothing was submitted."],
  ["completed", "Yes", "Every execution is terminal and at least one completed."],
  ["failed", "Yes", "Every execution is terminal, at least one failed, and none completed."],
  ["cancelled", "Yes", "Every execution is terminal and all of them were cancelled."],
];

export default function DocsPage() {
  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <div className="docs-brand-row">
          <Link href="/" aria-label="QRouter home"><Logo size={26} /></Link>
          <span className="docs-badge">Docs</span>
        </div>
        <nav className="docs-toc" aria-label="Documentation">
          <div>
            <p>Start here</p>
            <a href="#quickstart">Run your first job</a>
            <a href="#cli-more">More CLI commands</a>
          </div>
          <div>
            <p>Build with the API</p>
            <a href="#http">Call it over HTTP</a>
            <a href="#authentication">Authentication</a>
            <a href="#key-security">Key security</a>
            <a href="#versions">Choosing v1 or v2</a>
          </div>
          <div>
            <p>Deploy</p>
            <a href="#github">Connecting GitHub</a>
            <a href="#repositories">Repositories</a>
            <a href="#jobs">Jobs</a>
            <a href="#endpoints">v1 endpoints</a>
          </div>
          <div>
            <p>Pipeline</p>
            <a href="#transpilation">Transpilation</a>
            <a href="#routing">Routing</a>
            <a href="#pricing">Pricing</a>
            <a href="#lifecycle">Lifecycle</a>
          </div>
          <div>
            <p>Operate</p>
            <a href="#webhooks">Webhooks</a>
            <a href="#errors">v1 errors</a>
          </div>
          <div>
            <p>API v2</p>
            <a href="#v2">Resource model</a>
            <a href="#v2-quickstart">v2 quickstart</a>
            <a href="#v2-endpoints">v2 endpoints</a>
            <a href="#v2-request">Request schema</a>
            <a href="#idempotency">Idempotency</a>
            <a href="#v2-lifecycle">Execution lifecycle</a>
            <a href="#v2-retention">Release and deletion</a>
            <a href="#v2-errors">v2 errors</a>
          </div>
          <div>
            <p>Go live</p>
            <a href="#production">Production checklist</a>
          </div>
        </nav>
        <div className="docs-sidebar-foot">
          <Link href="/dashboard/api-keys"><KeyRound size={13} /> Get an API key</Link>
          <Link href="/dashboard"><ArrowRight size={13} /> Back to console</Link>
          <a href="/openapi.json">OpenAPI <ExternalLink size={12} /></a>
          {/* The docs are reachable straight from a search result, so this is
              the only appearance control a reader arriving here has. */}
          <ThemeToggle />
          <div className="docs-sidebar-legal"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div>
          <div><span>API versions</span><b>v1 · v2</b><span>Base URL</span><code>{PUBLIC_CONFIG.apiBaseUrl.replace("https://", "")}</code></div>
        </div>
      </aside>

      <main className="docs-main">
        <section className="docs-intro">
          <p className="docs-eyebrow"><span /> QRouter documentation</p>
          <h1>Run a quantum job in three steps.</h1>
          <p>QRouter routes a circuit to the cheapest, fastest or most accurate machine that can actually run it, across every provider you have enabled. The quickest way in is the terminal — one command, one key, then plain English. The HTTP API is underneath it when you need to automate.</p>
          <div className="docs-actions">
            <a href="#quickstart">Start with the terminal <ArrowRight size={14} /></a>
            <a href="#http">Or call the API <Code2 size={14} /></a>
          </div>
        </section>

        {/* ── The three steps ──────────────────────────────────────────────
            First on the page and deliberately short. Everything that used to
            live here — the config-file path, the advance endpoint, the
            non-conversational subcommands — is true and none of it is needed to
            get a first job running, so it moved down to `#cli-more`. */}
        <section className="docs-section" id="quickstart">
          <div className="docs-section-title"><Terminal size={17} /><div><h2>Run your first job</h2><p>No SDK, no install, no scaffolding. About a minute end to end.</p></div></div>

          <ol className="docs-steps">
            <li>
              <div className="docs-step-body">
                <h3>Open your terminal and run QRouter</h3>
                <p>Node 18.17 or newer is the only requirement. Nothing is installed — <code>npx</code> fetches and runs it.</p>
                <div className="docs-terminal">
                  <div className="docs-terminal-bar"><i /><i /><i /><span>terminal</span></div>
                  <pre><code><i>{"$ "}</i><b>npx qrouter.app</b></code></pre>
                </div>
              </div>
            </li>

            <li>
              <div className="docs-step-body">
                <h3>Get your API key</h3>
                <p>Open <b>API keys</b> in the console and create one. It is shown once, so copy it before closing the dialog.</p>
                <Link className="docs-step-link" href="/dashboard/api-keys">
                  <KeyRound size={14} /> Create an API key
                </Link>
              </div>
            </li>

            <li>
              <div className="docs-step-body">
                <h3>Paste the key, then just ask</h3>
                <p>QRouter asks for the key on first run and remembers it. After that, describe the run in plain English — including the GitHub repository to take the circuit from — and it finds the circuit, picks the machine, and shows you the price before anything is charged.</p>
                <div className="docs-terminal">
                  <div className="docs-terminal-bar"><i /><i /><i /><span>terminal</span></div>
                  {/* Kept under ~56 columns so it never needs a horizontal
                      scrollbar at the narrowest column this page renders at. */}
                  <pre><code>
{`❯ Paste your QRouter API key: `}<b>{`••••••••••••`}</b>{`
`}<em>{`✓ local workspace · $25.00 credit · 12 backends`}</em>{`

❯ `}<b>{`Run this IBM quantum task on the cheapest
  IonQ model from github repo:
  acme-labs/bell-state-demo`}</b>{`

`}<i>{`Found circuits/bell.qasm — 2 qubits, depth 3
Routing under "cheapest" … IonQ Aria-1
Quote  $2.14 · 1024 shots · ~4 min queue`}</i>{`

❯ type `}<b>run</b>{` to execute, or ask for something else`}
                  </code></pre>
                </div>
              </div>
            </li>
          </ol>

          <div className="docs-callout"><ShieldCheck size={16} /><p>Nothing runs and nothing is charged until you type <b>run</b>. The price on the confirmation line is QRouter&apos;s own quote for the backend it selected — never the assistant&apos;s estimate of one. Finished runs land in your Downloads folder as JSON with a readable <code>.txt</code> companion.</p></div>
        </section>

        <section className="docs-section" id="cli-more">
          <div className="docs-section-title"><Terminal size={17} /><div><h2>More CLI commands</h2><p>For scripts and CI, where a conversation is the wrong shape.</p></div></div>
          <div className="docs-endpoints">
            <div><b>run</b><code>qrouter run ./bell.qasm --shots 1024 --yes</code><span>Submit a circuit file or repository URL with no prompts.</span></div>
            <div><b>status</b><code>qrouter status &lt;job-id&gt; --wait</code><span>Check a job, or block until it reaches a terminal state.</span></div>
            <div><b>backends</b><code>qrouter backends --json</code><span>List every target this key can reach, machine-readable.</span></div>
            <div><b>login</b><code>qrouter login</code><span>Store or replace the saved API key.</span></div>
          </div>
          <p className="docs-copy-text">The key is stored at <code>~/.config/qrouter/config.json</code> with <code>0600</code> permissions. Setting <code>QROUTER_API_KEY</code> overrides the stored value and is never written to disk — that is the form to use in CI. Prefer a permanent install to <code>npx</code>? <code>curl -fsSL https://qrouter.app/install | sh</code>.</p>
          <p className="docs-copy-text">While it waits, the client calls <code>POST /api/v1/jobs/&#123;id&#125;/advance</code> for its own job, so a run finishes even on a deployment with no execution scheduler configured. The endpoint is scoped to the caller&apos;s workspace and refuses any job without a quote and a matching credit reservation.</p>
        </section>

        <section className="docs-section" id="http">
          <div className="docs-section-title"><Code2 size={17} /><div><h2>Call it over HTTP</h2><p>The same key, the same router. One request submits a circuit; poll it, then read the result.</p></div></div>
          <p className="docs-copy-text">Send the key you created in step 2 as a bearer token against <code>{PUBLIC_CONFIG.apiBaseUrl}</code>. Only <code>circuit</code> is required — every routing input has a default, and <code>&quot;target&quot;: &quot;auto&quot;</code> lets the router choose the machine exactly as the CLI does.</p>
          <DocsCodeExamples />
          <p className="docs-copy-text">To store a circuit once and run it on several backends in one call, use the <a href="#v2-quickstart">v2 quickstart</a> instead.</p>
        </section>

        <section className="docs-section" id="authentication">
          <div className="docs-section-title"><KeyRound size={17} /><div><h2>Authentication</h2><p>One unified workspace key authenticates every request to both <code>/api/v1</code> and <code>/api/v2</code>.</p></div></div>
          <div className="docs-callout"><ShieldCheck size={16} /><p>Platform keys authenticate to QRouter. Provider credentials remain encrypted server-side and are never returned to client applications.</p></div>
          <pre className="docs-inline-code"><code>Authorization: Bearer qci_live_xxxxxxxxxxxx</code></pre>
          <p className="docs-copy-text">Every key is issued as <code>qci_&#123;environment&#125;_&#123;secret&#125;</code>, where the secret is 24 random bytes in base64url. Send it as a bearer token on every request; a token that does not begin with <code>qci_</code> is rejected before any lookup. There is no separate v2 credential and no per-version scope — the key resolves to a workspace, and every circuit, job, and execution is filtered by that workspace.</p>
          <p className="docs-copy-text">QRouter stores only a SHA-256 hash of the key plus its first 17 characters, which is the prefix shown in the console. The full value is returned exactly once, in the response that creates it.</p>

          <h3 className="docs-subhead">Environments</h3>
          <div className="docs-schema">
            <div><code>qci_live_…</code><b>live · default</b><p>The environment applied when a key is created without an explicit choice. May route to simulators and QPUs.</p></div>
            <div><code>qci_test_…</code><b>test · opt-in</b><p>Selected in the create-key form. Restricted to simulators — useful for CI and staging.</p></div>
          </div>
          <div className="docs-callout" data-tone="warn"><ShieldAlert size={16} /><p>A <code>qci_test_</code> key shares the same workspace and credit balance as a live key, but it can only run on simulators: pinning a QPU returns <code>403</code>, and <code>&quot;target&quot;: &quot;auto&quot;</code> stays on simulators. Key scopes such as <code>jobs:read</code> and <code>jobs:write</code> are enforced for API-key principals; console sessions remain full-privilege.</p></div>

          <h3 className="docs-subhead">Creating, rotating, and revoking</h3>
          <p className="docs-copy-text">Create and revoke keys in <Link href="/dashboard/api-keys">Console → API keys</Link>. Keys can only be minted from a signed-in console session: calling the key endpoint with an API key returns <code>403</code>, so a leaked key can never mint another one. Revoking takes effect immediately and the next request with that key fails <code>401</code>. A key that carries an expiry stops authenticating at that timestamp with the same status. There is no in-place rotation — create the replacement, deploy it, confirm the <b>Last used</b> column has gone quiet on the old key, then revoke it.</p>

          <h3 className="docs-subhead">Rate limits</h3>
          <p className="docs-copy-text">Each key consumes one unit per request from a budget of <code>QROUTER_RATE_LIMIT_PER_MINUTE</code> requests, default <code>120</code>, counted inside the current calendar minute. Exceeding it returns <code>429</code> with a <code>retry-after</code> header holding the whole seconds left in that minute, never less than one. Back off for that long rather than retrying immediately; a retry inside the same window consumes budget again.</p>
          <pre className="docs-inline-code"><code>{`HTTP/1.1 429 Too Many Requests\nretry-after: 23\ncontent-type: application/problem+json`}</code></pre>
          <p className="docs-copy-text">The <code>429</code> body follows the error contract of the version you called, carrying the code <code>rate_limit_error</code> in <a href="#v2-errors">the v2 problem document</a> under <code>/api/v2</code> and in <a href="#errors">the v1 envelope</a> under <code>/api/v1</code>.</p>

          <h3 className="docs-subhead">Local development</h3>
          <p className="docs-copy-text">A deployment with no Supabase configuration that is not running in production accepts the fixed key <code>qci_test_local_development</code> and resolves it to an in-memory demo workspace whose circuits and jobs are lost on restart. Production deployments reject it exactly like any other unknown key, so it can never be used against live data.</p>
        </section>

        <section className="docs-section" id="key-security">
          <div className="docs-section-title"><Lock size={17} /><div><h2>Key security</h2><p>A key is a bearer credential for the whole workspace: it spends credits and reads results.</p></div></div>
          <ol className="docs-checklist">
            <li>Call QRouter from server-side code only. A key shipped in a browser bundle, mobile binary, or published notebook is compromised the moment it ships.</li>
            <li>Read the key from an environment variable or secret manager, for example <code>$QROUTER_API_KEY</code>. Never commit it, and keep it out of build logs, crash reports, and error payloads.</li>
            <li>Issue one key per deployment and per environment so a single revocation never takes down every service at once.</li>
            <li>Prefer <code>qci_test_</code> keys for CI and staging — they cannot pin QPUs. Issue a live key only when a run must hit real hardware.</li>
            <li>Rotate on any suspicion of exposure: create a replacement, deploy it, then revoke the old key.</li>
            <li>Log the <code>x-request-id</code> of a failed call rather than the key or the request headers when you need support.</li>
            <li>Provider credentials for IBM, AWS Braket, Vultr, and every other configured backend stay encrypted server-side. No endpoint returns them, and your key never grants direct access to a provider account.</li>
          </ol>
        </section>

        <section className="docs-section" id="versions">
          <div className="docs-section-title"><Layers size={17} /><div><h2>Choosing v1 or v2</h2><p>Both versions are live, share one base URL, and accept the same key. v2 is additive: nothing in v1 was deprecated or removed.</p></div></div>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Capability</th><th scope="col">/api/v1</th><th scope="col">/api/v2</th></tr></thead>
              <tbody>
                <tr><th scope="row">Circuit source</th><td>Inlined in every job request.</td><td>Uploaded once as a <code>circuit</code> resource and referenced by id.</td></tr>
                <tr><th scope="row">Executions per request</th><td>One.</td><td>1 – 25, each with its own target, shots, and constraints.</td></tr>
                <tr><th scope="row">Success envelope</th><td>The resource at the top level.</td><td><code>&#123; &quot;object&quot;, &quot;data&quot; &#125;</code>, or the raw artifact for result and transpiled.</td></tr>
                <tr><th scope="row">Error envelope</th><td><code>&#123; &quot;error&quot;: &#123; &quot;type&quot;, &quot;message&quot; &#125; &#125;</code></td><td><code>application/problem+json</code> with a stable <code>code</code>.</td></tr>
                <tr><th scope="row">Idempotency-Key</th><td>Optional on job creation.</td><td>Required on circuit and job creation, 8–255 characters.</td></tr>
                <tr><th scope="row">Cancellation</th><td>Per job.</td><td>Per execution, leaving siblings running.</td></tr>
                <tr><th scope="row">Data retention control</th><td>Job records persist.</td><td>Explicit <code>release</code> and <code>delete</code> on the circuit.</td></tr>
                <tr><th scope="row">Repository deploys and webhooks</th><td>Supported, alongside the transpile-only preview.</td><td>Not part of the v2 surface — keep using v1.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="docs-copy-text">Both surfaces share one base URL, <code>{PUBLIC_CONFIG.apiBaseUrl}</code>, and the version is carried in the path. Analysis, transpilation, routing policy, quoting, and credit settlement are the same engine underneath, so <a href="#routing">routing modes</a> and <a href="#pricing">pricing</a> behave identically in both.</p>
          <div className="docs-callout"><Boxes size={16} /><p>Reach for v2 when you want to compare backends for one circuit, re-run stored work without re-uploading it, cancel or fetch artifacts per execution, or purge circuit source on a schedule. Stay on v1 for repository-sourced deployments, signed webhooks, and the transpile-only preview.</p></div>
        </section>

        <section className="docs-section" id="github">
          <div className="docs-section-title"><Route size={17} /><div><h2>Connecting GitHub</h2><p>Public repositories need no setup at all. A connection is only required to list your own repositories and to read private ones.</p></div></div>
          <p className="docs-copy-text"><b>Public repositories work immediately.</b> In <Link href="/dashboard/github">Console → Repositories</Link>, paste any GitHub URL (<code>https://github.com/owner/name</code> or just <code>owner/name</code>), click <b>Inspect repository</b>, pick the <code>.qasm</code> entrypoint, and import. QRouter reads the repository through the anonymous GitHub API, which is rate-limited to <b>60 requests per hour per IP</b> — if inspection starts failing with a rate-limit error, that is the cause, and either option below removes the cap.</p>
          <h3 className="docs-subhead">Option A — GitHub App (production, per-organization)</h3>
          <p className="docs-copy-text">This is the path that supports private repositories and scopes access to each workspace separately. Register an App at <a href="https://github.com/settings/apps/new" target="_blank" rel="noreferrer">github.com/settings/apps/new <ExternalLink size={11} /></a> with:</p>
          <div className="docs-schema">
            <div><code>Repository permissions</code><b>Contents: Read-only, Metadata: Read-only</b><p>Enough to list repositories, walk the git tree, and read <code>.qasm</code> and <code>qrouter.json</code> blobs.</p></div>
            <div><code>Callback URL</code><b>https://your-domain/api/integrations/github/callback</b><p>Where GitHub returns after an installation.</p></div>
            <div><code>Request user authorization (OAuth) during installation</code><b>enabled</b><p>Required — the callback verifies that the person completing the install actually owns it.</p></div>
            <div><code>Webhook</code><b>optional</b><p>Not needed for import or deploy.</p></div>
          </div>
          <p className="docs-copy-text">Then set these environment variables and redeploy. <code>GITHUB_APP_PRIVATE_KEY</code> is the downloaded <code>.pem</code>; keep it on one line with literal <code>\n</code> escapes, which the server converts back to newlines.</p>
          <pre className="docs-inline-code"><code>{`GITHUB_APP_ID=123456
GITHUB_APP_SLUG=your-app-slug          # the URL name, github.com/apps/<slug>
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n...\\n-----END RSA PRIVATE KEY-----"
GITHUB_APP_CLIENT_ID=Iv1.xxxxxxxxxxxx
GITHUB_APP_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OAUTH_STATE_SECRET=$(openssl rand -base64 32)`}</code></pre>
          <p className="docs-copy-text">All three of <code>GITHUB_APP_ID</code>, <code>GITHUB_APP_SLUG</code> and <code>GITHUB_APP_PRIVATE_KEY</code> must be present or the console reports the App as not configured and hides the <b>Connect GitHub</b> button. Once they are set, click <b>Connect GitHub</b> in Repositories, install the App on the accounts and repositories you want QRouter to see, and your repositories appear in the picker.</p>
          <h3 className="docs-subhead">Option B — personal token (local development only)</h3>
          <p className="docs-copy-text">For running the console on your own machine, a classic or fine-grained personal access token with <code>repo</code> read access is enough:</p>
          <pre className="docs-inline-code"><code>{`# .env.local\nGITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx`}</code></pre>
          <p className="docs-copy-text">This token is process-wide, so it deliberately does <b>not</b> serve tenants in production — a request from any workspace would otherwise read the server account&apos;s private repositories. In a production deployment, tenants without an App connection fall back to public, unauthenticated access.</p>
          <div className="docs-callout"><ShieldCheck size={16} /><p>Private repositories are only ever read through an installation token scoped to that workspace&apos;s own connection. There is no configuration in which one workspace can read another&apos;s private source.</p></div>
        </section>

        <section className="docs-section" id="repositories">
          <div className="docs-section-title"><Route size={17} /><div><h2>Repository deployments</h2><p>Production workloads are sourced from connected GitHub repositories, not typed into the console.</p></div></div>
          <pre className="docs-inline-code"><code>{`# qrouter.json\n{\n  "circuit": "circuits/bell.qasm",\n  "shots": 1024,\n  "target": "auto",\n  "routing_mode": "balanced",\n  "optimization_level": 2\n}`}</code></pre>
          <p className="docs-copy-text">Install the QRouter GitHub App for the workspace, import a repository, and select its production branch and <code>.qasm</code> entrypoint. Each deployment fetches the source server-side and records the exact blob SHA before routing. CI can call <code>POST /api/v1/repository-jobs</code> with a stable <code>deployment_id</code> to make retries idempotent.</p>
        </section>

        <section className="docs-section" id="jobs">
          <div className="docs-section-title"><Braces size={17} /><div><h2>Job request</h2><p>Only <code>circuit</code> is required. Every routing input has a deterministic default.</p></div></div>
          <div className="docs-schema">
            <div><code>circuit</code><b>string · required</b><p>OpenQASM 2 or supported OpenQASM 3 source, up to 256 KB.</p></div>
            <div><code>shots</code><b>integer · 1–1,000,000</b><p>Measurement repetitions. Default: <code>1024</code>.</p></div>
            <div><code>target</code><b>backend id | auto</b><p>Pin a target or let the QCI Engine select one. Default: <code>auto</code>.</p></div>
            <div><code>routing_mode</code><b>enum</b><p><code>balanced</code>, <code>cost</code>, <code>speed</code>, or <code>quality</code>.</p></div>
            <div><code>optimization_level</code><b>integer · 0–3</b><p>Compiler optimization level. Default: <code>2</code>.</p></div>
            <div><code>failover</code><b>boolean</b><p>Try another quoted compatible backend after failure. Default: <code>true</code>.</p></div>
            <div><code>timeout_seconds</code><b>integer · 60–604,800</b><p>Cancel an overdue provider job before failover. Default: <code>7200</code>.</p></div>
            <div><code>constraints</code><b>object</b><p>Cost, queue, fidelity, compute type, and provider allow/deny filters.</p></div>
          </div>
          <p className="docs-copy-text">Include a stable <code>Idempotency-Key</code> header when creating a job. Repeating a request with the same key returns the original workspace job instead of spending twice. In v1 the header is optional and a job that ended <code>failed</code> or <code>cancelled</code> releases its key so the same deployment can be retried; <a href="#idempotency">v2 enforces a stricter contract</a>.</p>
        </section>

        <section className="docs-section" id="endpoints">
          <div className="docs-section-title"><FileJson size={17} /><div><h2>v1 endpoint reference</h2><p>The original HTTP surface, versioned under <code>/api/v1</code>.</p></div></div>
          <div className="docs-endpoints">
            {endpoints.map(([method, path, description]) => <div key={`${method}-${path}`}><b>{method}</b><code>{path}</code><span>{description}</span></div>)}
          </div>
        </section>

        <section className="docs-section" id="transpilation">
          <div className="docs-section-title"><Code2 size={17} /><div><h2>Hardware-aware transpilation</h2><p>Compilation is part of execution, not an optional preview step.</p></div></div>
          <div className="docs-flow">
            <div><span>01</span><b>Parse</b><p>Validate QASM and derive width, depth, gate counts, and complexity.</p></div>
            <div><span>02</span><b>Target</b><p>Resolve native gates, connectivity, provider backend, and current calibration.</p></div>
            <div><span>03</span><b>Compile</b><p>Map and optimize against the selected target with a reproducible seed.</p></div>
            <div><span>04</span><b>Verify</b><p>Record before/after metrics, layout, and equivalence status.</p></div>
          </div>
          <div className="docs-callout"><Braces size={16} /><p><code>POST /api/v1/transpile</code> performs the full route and compile pipeline without provider submission. Physical QPU compilation fails closed when the hardware-aware compiler service is unavailable.</p></div>
        </section>

        <section className="docs-section" id="routing">
          <div className="docs-section-title"><Route size={17} /><div><h2>Routing policy</h2><p>QRouter removes incompatible targets, then scores the remaining candidates.</p></div></div>
          <div className="docs-policy-grid">
            <div><b>Balanced</b><p>35% cost · 25% queue · 25% fidelity · 15% reliability</p></div>
            <div><b>Cost</b><p>70% cost with queue, fidelity, and reliability as tie-breakers.</p></div>
            <div><b>Speed</b><p>65% queue priority for latency-sensitive workloads.</p></div>
            <div><b>Quality</b><p>65% fidelity plus 15% historical reliability.</p></div>
          </div>
          <p className="docs-copy-text">Constraints are hard filters. A target is rejected when it exceeds <code>maxCost</code> or <code>maxQueueSeconds</code>, falls below <code>minFidelity</code>, lacks circuit width, or is not connected.</p>
        </section>

        <section className="docs-section" id="pricing">
          <div className="docs-section-title"><CircleDollarSign size={17} /><div><h2>Pricing and settlement</h2><p>Quotes use the compiled circuit and a versioned QCI rate snapshot.</p></div></div>
          <div className="docs-formula"><span>Total</span><b>=</b><code>provider cost</code><b>+</b><code>transpiler fee</code><b>+</b><code>platform fee</code></div>
          <p className="docs-copy-text">A quote expires after 15 minutes. QRouter reserves the quoted total before submission, records the provider-rate inputs in <code>rateSnapshot</code>, records settlement after completion, and releases reserved credits after cancellation or failure.</p>
          <div className="docs-callout"><CircleDollarSign size={16} /><p><b>Unit compatibility:</b> public copy uses <b>QC-hour</b>. Legacy response fields named <code>pricePerNqh</code> and <code>estimatedNqh</code> represent that same normalized QC-hour unit and remain in v1 for API compatibility.</p></div>
        </section>

        <section className="docs-section" id="lifecycle">
          <div className="docs-section-title"><Clock3 size={17} /><div><h2>Lifecycle and artifacts</h2><p>Every provider maps into one observable state machine.</p></div></div>
          <div className="docs-lifecycle"><span>quoted</span><i /><span>queued</span><i /><span>dispatching</span><i /><span>submitted</span><i /><span>processing</span><i /><span>completed</span></div>
          <p className="docs-copy-text">Poll <code>GET /api/v1/jobs/{'{id}'}</code> until <code>completed</code>, <code>failed</code>, or <code>cancelled</code>. The response includes the attempt and event history. Results and transpiled OpenQASM use dedicated artifact endpoints so clients do not need provider-specific storage APIs.</p>
        </section>

        <section className="docs-section" id="webhooks">
          <div className="docs-section-title"><Webhook size={17} /><div><h2>Signed webhooks</h2><p>Receive asynchronous job transitions over HTTPS.</p></div></div>
          <pre className="docs-inline-code"><code>{`POST /api/v1/webhooks\n{ "url": "https://example.com/qrouter/events" }`}</code></pre>
          <p className="docs-copy-text">The endpoint returns its signing secret once. Store it outside source control and validate each delivery before processing its payload. Failed deliveries retry with exponential backoff and are visible through <code>GET /api/v1/webhooks/deliveries</code>.</p>
        </section>

        <section className="docs-section" id="errors">
          <div className="docs-section-title"><BookOpen size={17} /><div><h2>v1 error contract</h2><p>Errors under <code>/api/v1</code> use stable machine-readable types and human-readable messages.</p></div></div>
          <pre className="docs-inline-code"><code>{`{ "error": { "type": "invalid_circuit", "message": "..." } }`}</code></pre>
          <div className="docs-error-table"><div><b>401</b><code>authentication_error</code><span>Missing, invalid, expired, or revoked key.</span></div><div><b>402</b><code>insufficient_credits</code><span>The quote is valid but the workspace cannot reserve it.</span></div><div><b>422</b><code>invalid_circuit</code><span>QASM parsing or validation failed.</span></div><div><b>422</b><code>routing_error</code><span>No target satisfies circuit and policy constraints.</span></div><div><b>429</b><code>rate_limit_error</code><span>Per-key minute budget exhausted. Honour the retry-after header.</span></div><div><b>500</b><code>server_error</code><span>Compiler, provider, or platform execution failed.</span></div></div>
          <p className="docs-copy-text"><code>/api/v2</code> uses a different, richer envelope — see <a href="#v2-errors">the v2 error contract</a>.</p>
        </section>

        <section className="docs-section" id="v2">
          <div className="docs-section-title"><Boxes size={17} /><div><h2>The v2 resource model</h2><p>A circuit is uploaded once and becomes a reusable resource. A job fans it out across independent executions.</p></div></div>
          <div className="docs-flow">
            <div><span>01</span><b>Circuit</b><p>OpenQASM stored once with its hash and static analysis. Reusable by any number of jobs.</p></div>
            <div><span>02</span><b>Job</b><p>An execution group referencing one circuit, carrying metadata and 1–25 execution targets.</p></div>
            <div><span>03</span><b>Execution</b><p>One circuit run with its own target, shots, routing mode, constraints, quote, and status.</p></div>
            <div><span>04</span><b>Artifacts</b><p>Result JSON and compiled OpenQASM fetched per execution once it completes.</p></div>
          </div>
          <p className="docs-copy-text">In v1 a job is a single-shot envelope: the source, the routing inputs, and the run all arrive together, and comparing two backends means sending the same QASM twice as two unrelated jobs. v2 separates the circuit from the work. Uploading returns a <code>circuit_id</code> you can reference for as long as you keep it, and one <code>POST /api/v2/jobs</code> can quote and dispatch up to 25 executions of that circuit at once.</p>
          <p className="docs-copy-text">Executions inside a job are independent — each one selects its own backend, holds its own quote, and reaches a terminal state on its own — but they are funded together. QRouter reserves the sum of every execution quote in a single transaction, so a comparison can never start half-way because the balance moved mid-request.</p>
          <div className="docs-callout"><Boxes size={16} /><p>Each execution carries a caller-chosen <code>key</code>, unique inside the job. Results come back keyed by it, so you can match an execution to the variant it represents without tracking generated ids.</p></div>
        </section>

        <section className="docs-section" id="v2-quickstart">
          <div className="docs-section-title"><Terminal size={17} /><div><h2>v2 quickstart</h2><p>Create a circuit, fan it out, poll the job, and read each result.</p></div></div>
          <DocsV2CodeExamples />
          <p className="docs-copy-text">Install <code>@qrouter/sdk</code> for TypeScript or <code>qrouter</code> for Python. The v2 clients are exported as <code>QRouterV2</code> alongside the v1 <code>QRouter</code> client, so both surfaces can share one key in the same process. Both constructors take the key first and default to <code>{PUBLIC_CONFIG.apiBaseUrl}</code>.</p>
          <div className="docs-callout"><Fingerprint size={16} /><p>When you omit the idempotency key argument, both SDKs generate a fresh UUID per call, which means an automatic retry after a network timeout creates a second job. Pass a key derived from your own workload identity whenever a retry must not spend twice.</p></div>
        </section>

        <section className="docs-section" id="v2-endpoints">
          <div className="docs-section-title"><FileJson size={17} /><div><h2>v2 endpoint reference</h2><p>Ten operations under <code>/api/v2</code>, all authenticated with the same workspace key.</p></div></div>
          <div className="docs-endpoints">
            {v2Endpoints.map(([method, path, description]) => <div key={`${method}-${path}`}><b>{method}</b><code>{path}</code><span>{description}</span></div>)}
          </div>
          <p className="docs-copy-text">JSON responses are wrapped as <code>&#123; &quot;object&quot;: &quot;circuit&quot; | &quot;job&quot; | &quot;execution&quot; | &quot;list&quot;, &quot;data&quot;: … &#125;</code>. The two artifact endpoints are the exception: they return the stored artifact directly, as <code>application/json</code> for results and <code>text/plain; charset=utf-8</code> for transpiled OpenQASM, both with <code>cache-control: no-store</code>. Deleting a circuit answers <code>204</code> with an empty body.</p>
          <p className="docs-copy-text">Every v2 response carries an <code>x-request-id</code> header. Send your own <code>x-request-id</code> to have it echoed back — the first 128 characters are kept — otherwise QRouter generates one and reuses it as the <code>request_id</code> in any error document.</p>

          <h3 className="docs-subhead">Backends and capabilities</h3>
          <p className="docs-copy-text"><code>GET /api/v2/backends</code> returns the routing catalog under <code>data</code>, each entry extended with a <code>capabilities</code> object declaring its accepted input formats, that execution is asynchronous, and that results are reported as counts, probabilities, and shots. The response also carries a <code>qci</code> block with the snapshot timestamp, source, index level, and current price per QC-hour.</p>
        </section>

        <section className="docs-section" id="v2-request">
          <div className="docs-section-title"><Braces size={17} /><div><h2>v2 request and response schema</h2><p>Both creation endpoints reject unknown fields, so a typo fails loudly instead of being ignored.</p></div></div>
          <p className="docs-copy-text">A body that misses a required field, breaks a bound, or carries an unrecognised key is rejected with <code>400 invalid_request</code>. The problem document reports which endpoint rejected it rather than which field failed, so validate against the bounds below before sending.</p>

          <h3 className="docs-subhead"><code>POST /api/v2/circuits</code></h3>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                <tr><th scope="row">circuit</th><td>string · required</td><td>—</td><td>1 – 256,000 characters of OpenQASM source. Parsed and analyzed synchronously.</td></tr>
                <tr><th scope="row">format</th><td>enum</td><td><code>openqasm2</code></td><td><code>openqasm2</code> or <code>openqasm3</code>.</td></tr>
                <tr><th scope="row">name</th><td>string</td><td><code>null</code></td><td>Trimmed, 1 – 120 characters. May be sent as <code>null</code> to leave it unset.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="docs-copy-text">A stored circuit responds with <code>id</code>, <code>organization_id</code>, <code>name</code>, <code>format</code>, <code>source_hash</code> (SHA-256 of the exact source you sent), the static <code>analysis</code>, <code>created_at</code>, <code>expires_at</code>, and <code>released_at</code>. New circuits return <code>201</code>; invalid OpenQASM returns <code>422 invalid_circuit</code>.</p>

          <h3 className="docs-subhead"><code>POST /api/v2/jobs</code></h3>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                <tr><th scope="row">circuit_id</th><td>string · required</td><td>—</td><td>UUID of a circuit in this workspace that has not been released.</td></tr>
                <tr><th scope="row">executions</th><td>array · required</td><td>—</td><td>1 – 25 execution targets. Keys must be unique within the array.</td></tr>
                <tr><th scope="row">metadata</th><td>object</td><td><code>&#123;&#125;</code></td><td>Up to 50 string entries. Keys up to 64 characters, values up to 500.</td></tr>
              </tbody>
            </table>
          </div>

          <h3 className="docs-subhead">Execution target</h3>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                {executionFields.map(([field, type, fallback, notes]) => (
                  <tr key={field}><th scope="row">{field}</th><td>{type}</td><td>{fallback === "—" ? "—" : <code>{fallback}</code>}</td><td>{notes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="docs-subhead">Constraints</h3>
          <p className="docs-copy-text">Every field is optional, and the object itself defaults to <code>&#123;&#125;</code>. Constraints are hard filters applied before scoring, exactly as described under <a href="#routing">routing policy</a>.</p>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Bounds and behaviour</th></tr></thead>
              <tbody>
                {constraintFields.map(([field, type, notes]) => <tr key={field}><th scope="row">{field}</th><td>{type}</td><td>{notes}</td></tr>)}
              </tbody>
            </table>
          </div>

          <h3 className="docs-subhead">Job and execution responses</h3>
          <p className="docs-copy-text">A job responds with <code>id</code>, <code>circuit_id</code>, <code>organization_id</code>, <code>status</code>, <code>metadata</code>, <code>created_at</code>, <code>updated_at</code>, <code>completed_at</code>, <code>error</code>, and the ordered <code>executions</code> array. Each execution carries <code>id</code>, your <code>key</code>, <code>status</code>, <code>target</code>, <code>selected_backend_id</code>, <code>shots</code>, <code>routing_mode</code>, <code>analysis</code>, <code>route_decision</code>, <code>error</code>, <code>result_available</code>, its timestamps, and a <code>quote</code> once one exists.</p>
          <pre className="docs-inline-code"><code>{`{\n  "object": "job",\n  "data": {\n    "id": "…",\n    "circuit_id": "…",\n    "status": "running",\n    "metadata": { "experiment": "bell-baseline" },\n    "executions": [\n      { "id": "…", "key": "recommended", "status": "queued", "target": "auto",\n        "selected_backend_id": "aws-sv1", "shots": 1024, "result_available": false }\n    ]\n  }\n}`}</code></pre>
          <p className="docs-copy-text"><code>result_available</code> is simply whether that execution has reached <code>completed</code>; use it to decide when to call the result endpoint.</p>
        </section>

        <section className="docs-section" id="idempotency">
          <div className="docs-section-title"><Fingerprint size={17} /><div><h2>Idempotency</h2><p>Both v2 creation endpoints require a key, and both compare the payload behind it.</p></div></div>
          <pre className="docs-inline-code"><code>Idempotency-Key: bell-compare-2026-08-06</code></pre>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Endpoint</th><th scope="col">Idempotency-Key</th><th scope="col">Replay response</th></tr></thead>
              <tbody>
                <tr><th scope="row">POST /api/v2/circuits</th><td>Required</td><td><code>200</code> with the stored circuit instead of <code>201</code>.</td></tr>
                <tr><th scope="row">POST /api/v2/jobs</th><td>Required</td><td><code>200</code> with the existing job instead of <code>202</code>.</td></tr>
                <tr><th scope="row">All other v2 routes</th><td>Ignored</td><td>Reads, cancellation, release, and deletion never inspect the header.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="docs-copy-text">The key is trimmed and must be between 8 and 255 characters. Anything shorter, longer, or absent is rejected with <code>400 invalid_idempotency_key</code> before the request is processed. Keys are scoped to your workspace and, separately, to each resource type — the same string can address one circuit and one job without colliding.</p>
          <p className="docs-copy-text">QRouter fingerprints each creation request with a SHA-256 hash of the validated body after defaults have been applied, which means omitting a field and sending its documented default are treated as the same request. Replaying an identical request returns the original resource with <code>200</code> and the header <code>idempotent-replayed: true</code>, and never charges twice.</p>
          <div className="docs-callout" data-tone="warn"><ShieldAlert size={16} /><p>Reusing a key with a different body returns <code>409 idempotency_conflict</code> and creates nothing. Unlike v1, a v2 key is never released — a job that ends <code>failed</code> keeps its key, so retrying the same work needs a new one.</p></div>
        </section>

        <section className="docs-section" id="v2-lifecycle">
          <div className="docs-section-title"><Clock3 size={17} /><div><h2>Execution lifecycle</h2><p>A job rolls up the state of its executions. Poll the job, then fetch artifacts per execution.</p></div></div>
          <div className="docs-lifecycle"><span>queued</span><i /><span>running</span><i /><span>completed · failed · cancelled</span></div>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Job status</th><th scope="col">Terminal</th><th scope="col">Meaning</th></tr></thead>
              <tbody>
                {groupStatuses.map(([status, terminal, meaning]) => <tr key={status}><th scope="row">{status}</th><td>{terminal}</td><td>{meaning}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="docs-copy-text">Creation quotes every execution, then reserves their combined total in one transaction. When the balance covers it, the executions become <code>queued</code>, the job becomes <code>running</code>, and the API answers <code>202</code>. When it does not, every execution and the job itself are parked as <code>awaiting_payment</code>, nothing is submitted, and the API answers <code>402</code>. Parked jobs are repriced and released automatically once credits arrive.</p>

          <h3 className="docs-subhead">Per-execution status</h3>
          <p className="docs-copy-text">Executions move through the platform job states: <code>quoted</code>, <code>awaiting_payment</code>, <code>funds_reserved</code>, <code>queued</code>, <code>dispatching</code>, <code>submitted</code>, <code>processing</code>, and then <code>completed</code>, <code>failed</code>, or <code>cancelled</code>. A cancellation of an already-submitted execution first reports <code>cancellation_requested</code> while the provider job is being stopped.</p>
          <p className="docs-copy-text">The job status is derived from its executions: it stays <code>running</code> while any execution is still live, reports <code>completed</code> when at least one execution completed, <code>failed</code> when none completed and at least one failed, and <code>cancelled</code> when every execution was cancelled. A job that failed outright also carries an <code>error</code> object.</p>

          <h3 className="docs-subhead">Polling and artifacts</h3>
          <p className="docs-copy-text">Poll <code>GET /api/v2/jobs/{'{id}'}</code> — the SDK helpers default to two-second intervals — until the job status is <code>completed</code>, <code>failed</code>, or <code>cancelled</code>. An execution&rsquo;s result is available as soon as that execution reaches <code>completed</code>, so a long comparison can start reading fast backends while slower ones are still running; wait on the individual execution instead of the whole job when that matters.</p>
          <p className="docs-copy-text">A job parked as <code>awaiting_payment</code> is not terminal, but it will not advance on its own — stop polling and add credits rather than waiting it out. Requesting an artifact before it exists returns <code>409</code>, either <code>result_not_available</code> or <code>transpiled_not_available</code>. Cancelling an execution that already reached a terminal state returns <code>409 not_cancellable</code>, and cancellation answers <code>202</code> because the provider stop is asynchronous.</p>
        </section>

        <section className="docs-section" id="v2-retention">
          <div className="docs-section-title"><Trash2 size={17} /><div><h2>Release and deletion</h2><p>Two explicit ways to stop storing quantum source and results.</p></div></div>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Operation</th><th scope="col">What it purges</th><th scope="col">What survives</th></tr></thead>
              <tbody>
                <tr><th scope="row">POST /circuits/&#123;id&#125;/release</th><td>Circuit source and analysis payload, every related job&rsquo;s source/result/analysis, <code>job_attempts</code> rows, <code>job_events.payload</code>, <code>webhook_deliveries.payload</code> for those jobs, and the encrypted result and transpiled artifacts. <code>released_at</code> is stamped first.</td><td>The circuit record with <code>released_at</code> set, plus job, execution, quote, and webhook delivery history (without circuit content).</td></tr>
                <tr><th scope="row">DELETE /circuits/&#123;id&#125;</th><td>The same content scrub as release, then the circuit resource itself.</td><td>Nothing you can address by circuit id — reading it afterwards returns <code>404 circuit_not_found</code>.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="docs-copy-text">Both operations require that every job for the circuit is already terminal. While any job is <code>queued</code>, <code>running</code>, or <code>awaiting_payment</code> they return <code>409 circuit_active</code>; cancel or wait for those executions first. Release is idempotent — a circuit that is already released keeps its original <code>released_at</code>.</p>
          <p className="docs-copy-text">After release the circuit can no longer start new jobs: referencing it from <code>POST /api/v2/jobs</code> returns <code>409 circuit_released</code>, and its artifact endpoints return <code>409</code>. Reading the circuit itself still works, so <code>released_at</code> remains observable.</p>
          <div className="docs-callout"><Trash2 size={16} /><p>Prefer release when a circuit has already run and you still need its job, quote, and ledger history for accounting. Reserve deletion for circuits you no longer need to account for at all.</p></div>
        </section>

        <section className="docs-section" id="v2-errors">
          <div className="docs-section-title"><ShieldAlert size={17} /><div><h2>v2 error contract</h2><p>Every failure under <code>/api/v2</code> is an RFC-style problem document.</p></div></div>
          <pre className="docs-inline-code"><code>{`content-type: application/problem+json\nx-request-id: 6f1d2c9a-…\n\n{\n  "type": "https://api.qrouter.dev/problems/idempotency_conflict",\n  "title": "Idempotency Conflict",\n  "status": 409,\n  "detail": "Idempotency key was already used for a different job.",\n  "instance": "/api/v2/jobs",\n  "code": "idempotency_conflict",\n  "request_id": "6f1d2c9a-…"\n}`}</code></pre>
          <p className="docs-copy-text">Branch on <code>code</code>: it is the stable identifier, <code>type</code> is that code as a URL, and <code>title</code> is the same code in title case. <code>instance</code> is the path you called and <code>detail</code> is a human-readable sentence that may change. Log <code>request_id</code>, which always matches the <code>x-request-id</code> response header, and quote it when contacting support.</p>
          <div className="docs-table-wrap">
            <table className="docs-table">
              <thead><tr><th scope="col">Status</th><th scope="col">Code</th><th scope="col">Cause</th></tr></thead>
              <tbody>
                {v2Errors.map(([status, code, cause]) => <tr key={code}><th scope="row">{status}</th><td><code>{code}</code></td><td>{cause}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="docs-callout"><CircleDollarSign size={16} /><p>Insufficient credit is the one exception. <code>POST /api/v2/jobs</code> answers <code>402</code> with the ordinary job envelope plus an <code>error</code> object of <code>&#123; &quot;code&quot;: &quot;insufficient_credits&quot; &#125;</code>, not a problem document, because the job was created and parked rather than rejected. Add credits and it resumes on its own.</p></div>
        </section>

        <section className="docs-section" id="production">
          <div className="docs-section-title"><ShieldCheck size={17} /><div><h2>Production checklist</h2><p>Required before enabling paid physical backends.</p></div></div>
          <ol className="docs-checklist"><li>Apply the Supabase schema and QRouter migrations.</li><li>Configure Supabase, Stripe, artifact encryption, and provider credentials.</li><li>Create the GitHub App, set its callback URL, and configure the matching app credentials from <code>.env.local.example</code>.</li><li>Deploy the authenticated Qiskit compiler/worker and point the app at its URL.</li><li>Configure authenticated external schedulers for job polling, provider health checks, the daily index refresh, and the Stripe webhook.</li><li>Run credentialed smoke jobs against every enabled paid provider.</li><li>Run lint, typecheck, Node tests, Python worker tests, SDK builds, and the production web build.</li></ol>
        </section>

        <section className="docs-end"><p>Ready to deploy a repository circuit?</p><Link href="/dashboard/github/deploy">Open deployments <ArrowRight size={14} /></Link></section>
      </main>
    </div>
  );
}
