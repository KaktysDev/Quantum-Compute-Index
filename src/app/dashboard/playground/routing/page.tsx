import Link from "next/link";
import { ArrowRight, Braces, Check, Cpu, Gauge, GitBranch, Play, Route, ServerCog, X } from "lucide-react";
import { BACKENDS } from "@/lib/qrouter/catalog";

const policies = [
  ["balanced", "35 cost / 25 queue / 25 fidelity / 15 reliability"],
  ["cost", "70 cost / 15 queue / 10 fidelity / 5 reliability"],
  ["speed", "15 cost / 65 queue / 10 fidelity / 10 reliability"],
  ["quality", "10 cost / 10 queue / 65 fidelity / 15 reliability"],
];

export default function RoutingPage() {
  return <div className="console-page system-page">
    <div className="console-page-heading compact"><div><p className="qr-eyebrow"><span /> Playground / routing</p><h1>Routing fabric</h1><p>How repository workloads become eligible, ranked provider candidates.</p></div><Link className="console-primary" href="/dashboard/playground"><Play size={14} /> Deploy project</Link></div>
    <section className="console-panel routing-detail-panel">
      <div className="panel-title"><Route size={16} /><div><h2>Execution path</h2><small>Commit source to provider target</small></div><span>QROUTER/V1</span></div>
      <div className="routing-command-flow">
        <div><GitBranch size={17} /><span><b>Repository</b><small>commit + .qasm path</small></span></div><i />
        <div><Braces size={17} /><span><b>Analyze</b><small>width + depth + gates</small></span></div><i />
        <div><Route size={17} /><span><b>Route</b><small>constraints + QCI score</small></span></div><i />
        <div><ServerCog size={17} /><span><b>Transpile</b><small>native gates + topology</small></span></div><i />
        <div><Cpu size={17} /><span><b>Execute</b><small>normalized lifecycle</small></span></div>
      </div>
      <div className="routing-phase-log"><div><span>01</span><b>Parse source</b><code>OPENQASM 2 / 3</code></div><div><span>02</span><b>Filter targets</b><code>width · kind · provider · spend</code></div><div><span>03</span><b>Score candidates</b><code>cost · queue · fidelity · reliability</code></div><div><span>04</span><b>Compile + reprice</b><code>target topology · QCI snapshot</code></div></div>
    </section>
    <div className="routing-system-grid">
      <section className="console-panel"><div className="panel-title"><Gauge size={16} /><div><h2>Routing policies</h2><small>Weighted candidate score</small></div></div><div className="policy-terminal-table">{policies.map(([name, weights]) => <div key={name}><code>{name}</code><span>{weights}</span></div>)}</div></section>
      <section className="console-panel"><div className="panel-title"><Check size={16} /><div><h2>Hard constraints</h2><small>Applied before ranking</small></div></div><div className="constraint-list"><div><Check size={12} /><span>Qubit capacity and input compatibility</span></div><div><Check size={12} /><span>Maximum cost and queue duration</span></div><div><Check size={12} /><span>Minimum two-qubit fidelity</span></div><div><Check size={12} /><span>Provider allow and deny lists</span></div><div><X size={12} /><span>Unavailable credentials or offline target</span></div></div></section>
    </div>
    <section className="console-panel candidate-panel"><div className="panel-title"><Cpu size={16} /><div><h2>Current candidate inputs</h2><small>Live router catalog</small></div><Link href="/dashboard/playground/network">Full network <ArrowRight size={12} /></Link></div><div className="candidate-head"><span>Target</span><span>Kind</span><span>Queue</span><span>Fidelity</span><span>Reliability</span><span>State</span></div>{BACKENDS.slice(0, 6).map((backend) => <div className="candidate-row" key={backend.id}><span><b>{backend.displayName}</b><small>{backend.id}</small></span><span>{backend.kind}</span><span>{backend.queueSeconds}s</span><span>{(backend.fidelity * 100).toFixed(2)}%</span><span>{(backend.reliability * 100).toFixed(2)}%</span><span className={backend.available ? "terminal-ok" : "terminal-muted"}>{backend.available ? "eligible" : "credential required"}</span></div>)}</section>
  </div>;
}
