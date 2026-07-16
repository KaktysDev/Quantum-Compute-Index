"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { PUBLIC_JOBS_ENDPOINT } from "@/lib/publicConfig";

const EXAMPLES = {
  curl: `curl ${PUBLIC_JOBS_ENDPOINT} \\
  -H "Authorization: Bearer $QROUTER_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: bell-001" \\
  -d '{
    "circuit": "OPENQASM 2.0; include \\"qelib1.inc\\"; qreg q[2]; creg c[2]; h q[0]; cx q[0],q[1]; measure q -> c;",
    "shots": 1024,
    "target": "auto",
    "routing_mode": "balanced",
    "optimization_level": 2
  }'`,
  typescript: `import { QRouter } from "@qrouter/sdk";

const qrouter = new QRouter(process.env.QROUTER_API_KEY!);
const circuit = await readFile("bell.qasm", "utf8");

const job = await qrouter.jobs.create({
  circuit,
  shots: 1024,
  target: "auto",
  routing_mode: "balanced",
  optimization_level: 2,
});

const completed = await qrouter.jobs.wait(job.id);
console.log(await qrouter.jobs.result(completed.id));`,
  python: `from qrouter import QRouter
import os

with QRouter(os.environ["QROUTER_API_KEY"]) as qrouter:
    with open("bell.qasm") as source:
        job = qrouter.create_job(
            source.read(),
            shots=1024,
            target="auto",
            routing_mode="balanced",
            optimization_level=2,
        )

    completed = qrouter.wait(job["id"])
    print(qrouter.get_result(completed["id"]))`,
};

export default function DocsCodeExamples() {
  const [language, setLanguage] = useState<keyof typeof EXAMPLES>("curl");
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(EXAMPLES[language]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="docs-code-example">
      <div className="docs-code-toolbar">
        <div role="tablist" aria-label="Quickstart language">
          {(Object.keys(EXAMPLES) as Array<keyof typeof EXAMPLES>).map((item) => (
            <button role="tab" aria-selected={language === item} className={language === item ? "active" : ""} key={item} onClick={() => setLanguage(item)}>{item}</button>
          ))}
        </div>
        <button className="docs-copy" onClick={copy} aria-label="Copy code">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      </div>
      <pre><code>{EXAMPLES[language]}</code></pre>
    </div>
  );
}
