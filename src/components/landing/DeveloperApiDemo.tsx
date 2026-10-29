"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Clipboard, Code2 } from "lucide-react";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";

type Language = "curl" | "python" | "typescript";
const CIRCUIT = 'OPENQASM 2.0; include "qelib1.inc"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;';
const SNIPPETS: Record<Language, string> = {
  curl: `curl ${PUBLIC_CONFIG.apiBaseUrl}/api/v1/transpile \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({ circuit: CIRCUIT, shots: 1024, target: "qci-aer-gpu", constraints: { kind: "simulator", maxCost: 1 } }, null, 2)}'`,
  python: `import os, requests\n\npreview = requests.post(\n    "${PUBLIC_CONFIG.apiBaseUrl}/api/v1/transpile",\n    headers={"Authorization": f"Bearer {os.environ['QROUTER_API_KEY']}"},\n    json={\n        "circuit": ${JSON.stringify(CIRCUIT)},\n        "shots": 1024, "target": "qci-aer-gpu",\n        "constraints": {"kind": "simulator", "maxCost": 1},\n    },\n)\npreview.raise_for_status()\nprint(preview.json())`,
  typescript: `const response = await fetch(\n  "${PUBLIC_CONFIG.apiBaseUrl}/api/v1/transpile",\n  {\n    method: "POST",\n    headers: {\n      Authorization: \`Bearer \${process.env.QROUTER_API_KEY}\`,\n      "Content-Type": "application/json",\n    },\n    body: JSON.stringify({\n      circuit: openQasm, shots: 1024,\n      target: "qci-aer-gpu",\n      constraints: { kind: "simulator", maxCost: 1 },\n    }),\n  },\n);\nif (!response.ok) throw new Error(await response.text());\nconst preview = await response.json();`,
};

export default function DeveloperApiDemo() {
  const [language, setLanguage] = useState<Language>("curl");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 1500); return () => window.clearTimeout(timer); }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(SNIPPETS[language]); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return (
    <section id="developers" className="ql-developer-demo ql-shell">
      <header className="ql-developer-copy">
        <p className="ql-kicker">EXECUTION API</p>
        <h2>Keep your circuits.<br />Make the execution reviewable.</h2>
        <p>Use the experiment workspace for the campaign, or integrate the underlying execution API with your own tools. Start with a compile-and-quote preview that submits no provider job.</p>
        <div className="ql-cta-row"><Link href="/dashboard/experiments" className="ql-btn primary">Open experiments</Link></div>
      </header>
      <div className="ql-code-demo">
        <div className="ql-code-tabs" role="tablist" aria-label="Code example language">
          {(["curl", "python", "typescript"] as Language[]).map((item) => <button type="button" role="tab" aria-selected={language === item} className={language === item ? "active" : ""} key={item} onClick={() => { setLanguage(item); setCopied(false); setCopyError(false); }}>{item === "curl" ? "cURL" : item === "python" ? "Python" : "TypeScript"}</button>)}
          <button className="ql-copy-code" type="button" onClick={copy} title="Copy example" aria-label="Copy example">{copied ? <Check /> : <Clipboard />}</button>
        </div>
        <pre><code><span>{SNIPPETS[language]}</span></code></pre>
        <div className="ql-code-action"><span><Code2 /> POST /api/v1/transpile</span><span aria-live="polite">{copyError ? "Select the code to copy it" : copied ? "Copied" : "Preview only · no execution"}</span></div>
      </div>
    </section>
  );
}
