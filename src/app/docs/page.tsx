import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Braces,
  CircleDollarSign,
  Clock3,
  Code2,
  ExternalLink,
  FileJson,
  KeyRound,
  Route,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import DocsCodeExamples from "@/components/DocsCodeExamples";
import Logo from "@/components/Logo";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";
import "./docs.css";

export const metadata: Metadata = {
  title: "QRouter API Documentation",
  description: "Build with the QRouter API for quantum workload evaluation, compilation, routing, and execution.",
};

const endpoints = [
  ["GET", "/api/v1/repositories/inspect", "Discover OpenQASM entrypoints in a connected GitHub repository."],
  ["POST", "/api/v1/projects", "Import a repository, production branch, entrypoint, and routing defaults."],
  ["POST", "/api/v1/repository-jobs", "Deploy a commit-pinned circuit from a connected repository."],
  ["GET", "/api/v1/backends", "List compute targets and current routing inputs."],
  ["POST", "/api/v1/transpile", "Analyze, route, compile, verify, and quote without execution."],
  ["POST", "/api/v1/jobs", "Compile, reserve credits, and submit a workload."],
  ["GET", "/api/v1/jobs/{id}", "Read normalized job state and route metadata."],
  ["GET", "/api/v1/jobs/{id}/result", "Retrieve normalized counts and probabilities."],
  ["GET", "/api/v1/jobs/{id}/transpiled", "Download the provider-targeted OpenQASM artifact."],
  ["POST", "/api/v1/jobs/{id}/cancel", "Request cancellation and release reserved credits."],
  ["POST", "/api/v1/webhooks", "Register an HTTPS endpoint and issue a signing secret."],
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
            <p>Getting started</p>
            <a href="#quickstart">Quickstart</a>
            <a href="#authentication">Authentication</a>
          </div>
          <div>
            <p>Deploy</p>
            <a href="#repositories">Repositories</a>
            <a href="#jobs">Jobs</a>
            <a href="#endpoints">Endpoints</a>
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
            <a href="#errors">Errors</a>
            <a href="#production">Production</a>
          </div>
        </nav>
        <div className="docs-sidebar-foot">
          <Link href="/dashboard"><KeyRound size={13} /> Back to console</Link>
          <a href="/openapi.json">OpenAPI <ExternalLink size={12} /></a>
          <div><span>API version</span><b>v1</b><span>Base URL</span><code>{PUBLIC_CONFIG.apiBaseUrl.replace("https://", "")}</code></div>
        </div>
      </aside>

      <main className="docs-main">
        <section className="docs-intro" id="quickstart">
          <p className="docs-eyebrow"><span /> QRouter / API v1</p>
          <h1>One contract for quantum compute.</h1>
          <p>Submit OpenQASM once. The QCI Engine analyzes the workload, selects an eligible configured backend, transpiles against its native target, creates a quote, and normalizes the result.</p>
          <div className="docs-actions"><Link href="/dashboard/playground">Open deployments <ArrowRight size={14} /></Link><a href="/openapi.json">Download specification <FileJson size={14} /></a></div>
        </section>

        <section className="docs-section">
          <div className="docs-section-title"><Code2 size={17} /><div><h2>Run a Bell circuit</h2><p>The same API key and job lifecycle work across every enabled simulator and QPU.</p></div></div>
          <DocsCodeExamples />
        </section>

        <section className="docs-section" id="authentication">
          <div className="docs-section-title"><KeyRound size={17} /><div><h2>Authentication</h2><p>Send the workspace key as a bearer token on every API request.</p></div></div>
          <div className="docs-callout"><ShieldCheck size={16} /><p>Platform keys authenticate to QRouter. Provider credentials remain encrypted server-side and are never returned to client applications.</p></div>
          <pre className="docs-inline-code"><code>Authorization: Bearer qci_live_...</code></pre>
          <p className="docs-copy-text">Create, expire, and revoke keys in <Link href="/dashboard/api-keys">Console → API keys</Link>. Local development without Supabase accepts <code>qci_test_local_development</code>; production never does.</p>
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
            <div><code>constraints</code><b>object</b><p>Cost, queue, fidelity, compute type, and provider allow/deny filters.</p></div>
          </div>
          <p className="docs-copy-text">Include a stable <code>Idempotency-Key</code> header when creating a job. Repeating a request with the same key returns the original workspace job instead of spending twice.</p>
        </section>

        <section className="docs-section" id="endpoints">
          <div className="docs-section-title"><FileJson size={17} /><div><h2>Endpoint reference</h2><p>The core HTTP surface is versioned under <code>/api/v1</code>.</p></div></div>
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
          <div className="docs-lifecycle"><span>quoted</span><i /><span>funds_reserved</span><i /><span>submitted</span><i /><span>processing</span><i /><span>completed</span></div>
          <p className="docs-copy-text">Poll <code>GET /api/v1/jobs/{'{id}'}</code> until <code>completed</code>, <code>failed</code>, or <code>cancelled</code>. Results and transpiled OpenQASM use dedicated artifact endpoints so clients do not need provider-specific storage APIs.</p>
        </section>

        <section className="docs-section" id="webhooks">
          <div className="docs-section-title"><Webhook size={17} /><div><h2>Signed webhooks</h2><p>Receive asynchronous job transitions over HTTPS.</p></div></div>
          <pre className="docs-inline-code"><code>{`POST /api/v1/webhooks\n{ "url": "https://example.com/qrouter/events" }`}</code></pre>
          <p className="docs-copy-text">The endpoint returns its signing secret once. Store it outside source control and validate each delivery before processing its payload.</p>
        </section>

        <section className="docs-section" id="errors">
          <div className="docs-section-title"><BookOpen size={17} /><div><h2>Error contract</h2><p>Errors use stable machine-readable types and human-readable messages.</p></div></div>
          <div className="docs-error-table"><div><b>401</b><code>authentication_error</code><span>Missing, invalid, expired, or revoked key.</span></div><div><b>402</b><code>insufficient_credits</code><span>The quote is valid but the workspace cannot reserve it.</span></div><div><b>422</b><code>invalid_circuit</code><span>QASM parsing or validation failed.</span></div><div><b>422</b><code>routing_error</code><span>No target satisfies circuit and policy constraints.</span></div><div><b>500</b><code>server_error</code><span>Compiler, provider, or platform execution failed.</span></div></div>
        </section>

        <section className="docs-section" id="production">
          <div className="docs-section-title"><ShieldCheck size={17} /><div><h2>Production checklist</h2><p>Required before enabling paid physical backends.</p></div></div>
          <ol className="docs-checklist"><li>Apply <code>supabase/schema.sql</code> and <code>supabase/qrouter.sql</code>.</li><li>Configure Supabase, Stripe, artifact encryption, and provider credentials.</li><li>Create the GitHub App, set its callback URL, and configure <code>GITHUB_APP_ID</code>, <code>GITHUB_APP_SLUG</code>, and <code>GITHUB_APP_PRIVATE_KEY</code>.</li><li>Deploy the authenticated Qiskit compiler/worker and set <code>QROUTER_COMPILER_URL</code>.</li><li>Configure the internal job poller, refresh cron, and Stripe webhook.</li><li>Run credentialed smoke jobs against every enabled paid provider.</li><li>Run lint, typecheck, Node tests, Python worker tests, SDK builds, and the production web build.</li></ol>
        </section>

        <section className="docs-end"><p>Ready to deploy a repository circuit?</p><Link href="/dashboard/playground">Open deployments <ArrowRight size={14} /></Link></section>
      </main>
    </div>
  );
}
