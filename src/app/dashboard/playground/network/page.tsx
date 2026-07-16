import Link from "next/link";
import { Clock3, Cpu, KeyRound, Network } from "lucide-react";
import { BACKENDS } from "@/lib/qrouter/catalog";

function rate(shot: number, task: number, nqh?: number) {
  if (nqh != null) return `$${nqh.toFixed(2)}/QC-hour`;
  if (task > 0) return `$${task.toFixed(3)} + $${shot.toFixed(6)}/shot`;
  return `$${shot.toFixed(6)}/shot`;
}

export default function NetworkPage() {
  const online = BACKENDS.filter((backend) => backend.available).length;
  return <div className="console-page system-page">
    <div className="console-page-heading compact"><div><p className="qr-eyebrow"><span /> Playground / network</p><h1>Compute network</h1><p>Provider availability, topology, queue, fidelity, and current routing rates.</p></div><Link className="console-primary" href="/dashboard/settings"><KeyRound size={14} /> Provider credentials</Link></div>
    <section className="network-command-status"><div><Network size={14} /><span>Targets</span><b>{BACKENDS.length}</b></div><div><Cpu size={14} /><span>Connected</span><b>{online}</b></div><div><Clock3 size={14} /><span>Median queue</span><b>{Math.round(BACKENDS.reduce((sum, item) => sum + item.queueSeconds, 0) / BACKENDS.length)}s</b></div><div><span>Catalog</span><b>QROUTER/V1</b></div></section>
    <section className="console-panel full-network-panel"><div className="panel-title"><Cpu size={16} /><div><h2>Provider targets</h2><small>Router catalog and financial inputs</small></div><span>{BACKENDS.length} RECORDS</span></div><div className="full-network-head"><span>Target</span><span>Provider</span><span>Type</span><span>Capacity</span><span>Queue</span><span>Fidelity</span><span>Rate</span><span>State</span></div>{BACKENDS.map((backend) => <div className="full-network-row" key={backend.id}><span><b>{backend.displayName}</b><small>{backend.id}</small></span><span>{backend.provider}</span><span>{backend.kind}</span><span>{backend.qubits} qubits</span><span>{backend.queueSeconds < 60 ? `${backend.queueSeconds}s` : `${Math.ceil(backend.queueSeconds / 60)}m`}</span><span>{(backend.fidelity * 100).toFixed(2)}%</span><span>{rate(backend.pricePerShot, backend.pricePerTask, backend.pricePerNqh)}</span><span className={backend.available ? "terminal-ok" : "terminal-muted"}><i />{backend.available ? "connected" : "credential required"}</span></div>)}</section>
  </div>;
}
