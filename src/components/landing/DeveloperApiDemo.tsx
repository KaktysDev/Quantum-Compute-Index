"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Clipboard, Code2, KeyRound, Loader2, Play } from "lucide-react";

type Language = "curl" | "python" | "typescript";

const API_KEY = "qci_live_your_workspace_key";
const SNIPPETS: Record<Language, string> = {
  curl: `curl https://api.qrouter.dev/api/v1/jobs \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Idempotency-Key: bell-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "circuit": "OPENQASM 2.0; ...",
    "shots": 1024,
    "target": "auto",
    "routing_mode": "balanced"
  }'`,
  python: `from qiskit import QuantumCircuit, qasm2
import os, requests

circuit = QuantumCircuit(2, 2)
circuit.h(0); circuit.cx(0, 1); circuit.measure_all()

job = requests.post(
    "https://api.qrouter.dev/api/v1/jobs",
    headers={"Authorization": f"Bearer {os.environ['QROUTER_API_KEY']}"},
    json={"circuit": qasm2.dumps(circuit), "shots": 1024,
          "target": "auto", "routing_mode": "balanced"},
).json()`,
  typescript: `import { QRouter } from "@qrouter/sdk";

const qrouter = new QRouter(process.env.QROUTER_API_KEY!);
const job = await qrouter.jobs.create({
  circuit: openQasm,
  shots: 1024,
  target: "auto",
  routing_mode: "balanced",
});

const result = await qrouter.jobs.wait(job.id);`,
};

export default function DeveloperApiDemo() {
  const [language, setLanguage] = useState<Language>("curl");
  const [copied, setCopied] = useState<"key" | "code" | null>(null);
  const [runState, setRunState] = useState<"idle" | "routing" | "done">("idle");

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(value: string, target: "key" | "code") {
    await navigator.clipboard.writeText(value);
    setCopied(target);
  }

  function run() {
    setRunState("routing");
    window.setTimeout(() => setRunState("done"), 850);
  }

  return (
    <section id="developers" className="ql-developer-demo ql-shell">
      <header className="ql-developer-copy">
        <p className="ql-kicker">UNIFIED API</p>
        <h2>One key. One job contract. Every connected backend.</h2>
        <p>Submit Qiskit or OpenQASM once. QCI applies constraints, produces the quote, and returns a normalized job lifecycle regardless of provider.</p>
        <div className="ql-api-key">
          <span><KeyRound /> API KEY</span>
          <code>{API_KEY}</code>
          <button type="button" onClick={() => copy(API_KEY, "key")} title="Copy example API key" aria-label="Copy example API key">
            {copied === "key" ? <Check /> : <Clipboard />}
          </button>
        </div>
        <div className="ql-cta-row">
          <Link href="/signin" className="ql-btn primary">Request an API key</Link>
          <Link href="/docs" className="ql-btn ghost">API reference</Link>
        </div>
      </header>

      <div className="ql-code-demo">
        <div className="ql-code-tabs" role="tablist" aria-label="Code example language">
          {(["curl", "python", "typescript"] as Language[]).map((item) => (
            <button type="button" role="tab" aria-selected={language === item} className={language === item ? "active" : ""} key={item} onClick={() => setLanguage(item)}>
              {item === "curl" ? "cURL" : item === "python" ? "Python / Qiskit" : "TypeScript"}
            </button>
          ))}
          <button className="ql-copy-code" type="button" onClick={() => copy(SNIPPETS[language], "code")} title="Copy code" aria-label="Copy code">
            {copied === "code" ? <Check /> : <Clipboard />}
          </button>
        </div>
        <pre><code><span>{SNIPPETS[language]}</span></code></pre>
        <div className="ql-code-action">
          <span><Code2 /> POST /api/v1/jobs</span>
          <button type="button" onClick={run} disabled={runState === "routing"}>
            {runState === "routing" ? <Loader2 className="spin" /> : runState === "done" ? <Check /> : <Play />}
            {runState === "routing" ? "Routing" : runState === "done" ? "Routed" : "Run sample"}
          </button>
        </div>
        <div className={`ql-code-response ${runState === "done" ? "visible" : ""}`} aria-live="polite">
          <span>201 CREATED</span>
          <code>{`{ "id": "job_qr_7c91", "backend": "ibm-brisbane", "quote": "$0.658", "status": "submitted" }`}</code>
        </div>
      </div>
    </section>
  );
}
