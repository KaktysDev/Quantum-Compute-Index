"use client";

import { useState } from "react";

const stages = [
  { id: "01", name: "ANALYZE", summary: "Inspect circuit requirements and policy constraints.", rows: [["QUBITS", "2"], ["DEPTH", "4"], ["GATE SET", "H, CX, MEASURE"], ["SHOTS", "1,024"], ["OBJECTIVE", "BALANCED"], ["COST CEILING", "$0.75"]] },
  { id: "02", name: "TRANSPILE", summary: "Map one circuit to each candidate hardware topology.", rows: [["IBM NATIVE", "RZ / SX / ECR"], ["IONQ NATIVE", "GPI / GPI2 / MS"], ["SIMULATOR", "OPENQASM 3"], ["DEPTH RANGE", "4–11"], ["VALIDATION", "PASSED"], ["ARTIFACTS", "3"]] },
  { id: "03", name: "SCORE", summary: "Compare compatibility, reliability, queue, and sampled cost.", rows: [["QCI AER GPU", "0.96"], ["IBM BRISBANE", "0.73"], ["IONQ ARIA 1", "0.68"], ["COMPATIBLE", "3 / 3"], ["POLICY", "BALANCED"], ["SNAPSHOT", "SAMPLE"]] },
  { id: "04", name: "ROUTE", summary: "Select the best eligible target and preserve the reasoning.", rows: [["SELECTED", "QCI AER GPU"], ["POSITIVE", "QUEUE / COST"], ["TRADEOFF", "SIMULATED"], ["FAILOVER", "IBM BRISBANE"], ["QUOTE", "$0.0031"], ["STATE", "LOCKED"]] },
  { id: "05", name: "EXECUTE", summary: "Normalize provider state and return one result contract.", rows: [["STATUS", "COMPLETED"], ["SHOTS", "1,024"], ["00", "507"], ["11", "517"], ["SCHEMA", "QROUTER/V1"], ["SETTLEMENT", "$0.0031"]] },
];

const snippets = {
  Python: `from qrouter import QRouter\n\nclient = QRouter(api_key=os.environ["QROUTER_API_KEY"])\njob = client.jobs.create(\n    circuit=open("bell.qasm").read(),\n    routing={"policy": "balanced", "failover": True},\n    shots=1024,\n)\nresult = job.wait()\nprint(result.counts)`,
  TypeScript: `const client = new QRouter({ apiKey: process.env.QROUTER_API_KEY });\n\nconst job = await client.jobs.create({\n  circuit: await readFile("bell.qasm", "utf8"),\n  routing: { policy: "balanced", failover: true },\n  shots: 1024,\n});\nconst result = await job.wait();\nconsole.log(result.counts);`,
  cURL: `curl -X POST https://api.qrouter.dev/api/v1/jobs \\\n  -H "Authorization: Bearer $QROUTER_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"circuit":"OPENQASM 3;…","routing":{"policy":"balanced","failover":false},"shots":1024}'`,
};

export function RoutingProcess() {
  const [active, setActive] = useState(0);
  const stage = stages[active];
  return <div className="qr-process-grid">
    <div className="qr-process-index" role="tablist" aria-label="Routing process stages">{stages.map((item, index) => <button key={item.id} role="tab" aria-selected={active === index} className={active === index ? "active" : ""} onClick={() => setActive(index)}><span>{item.id}</span><strong>{item.name}</strong><small>{item.summary}</small></button>)}</div>
    <div className="qr-process-view" role="tabpanel"><header><span>STAGE {stage.id}</span><b>{stage.name}</b><em>SAMPLE JOB</em></header><div className="qr-process-map"><i /><i /><i /><i /><i /><b /><span /></div><dl>{stage.rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><footer><span>QROUTER / DECISION TRACE</span><code>job_sample_92ac7f</code></footer></div>
  </div>;
}

export function ApiWorkbench() {
  const [language, setLanguage] = useState<keyof typeof snippets>("Python");
  return <div className="qr-api-workbench">
    <div className="qr-code-pane"><div className="qr-code-tabs" role="tablist" aria-label="API language">{Object.keys(snippets).map((item) => <button key={item} role="tab" aria-selected={language === item} className={language === item ? "active" : ""} onClick={() => setLanguage(item as keyof typeof snippets)}>{item}</button>)}</div><pre><code>{snippets[language]}</code></pre></div>
    <div className="qr-response-pane"><header><span>NORMALIZED RESPONSE</span><b>200 OK</b></header><pre><code>{`{\n  "id": "job_sample_92ac7f",\n  "status": "completed",\n  "backend": "qci-aer-gpu",\n  "routing": {\n    "policy": "balanced",\n    "score": 0.96,\n    "failover_ready": false\n  },\n  "result": {\n    "shots": 1024,\n    "counts": { "00": 507, "11": 517 }\n  }\n}`}</code></pre></div>
    <footer><span>TRANSPILE <b>✓</b></span><span>ROUTE <b>✓</b></span><span>FAILOVER IN DEVELOPMENT</span><span>NORMALIZED RESULT <b>✓</b></span></footer>
  </div>;
}
