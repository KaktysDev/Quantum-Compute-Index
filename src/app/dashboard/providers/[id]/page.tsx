import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Clock3, Cpu, GitBranch, Gauge, Route } from "lucide-react";
import { getLatestSnapshot } from "@/lib/qci/store";
import { withQciSnapshot } from "@/lib/qrouter/catalog";

function price(shot: number, task: number, nqh?: number) {
  if (nqh != null) return `$${nqh.toFixed(2)} / QC-hour`;
  return `${task ? `$${task.toFixed(3)} task + ` : ""}$${shot.toFixed(6)} / shot`;
}

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, latest] = await Promise.all([params, getLatestSnapshot()]);
  const backend = withQciSnapshot(latest.components).find((item) => item.id === id);
  if (!backend) notFound();
  return <div className="console-page provider-detail-page">
    <Link className="provider-back" href="/dashboard/providers"><ArrowLeft size={13} /> All providers</Link>
    <header className="provider-detail-hero"><div className="provider-mark large">{backend.displayName.slice(0, 2).toUpperCase()}</div><div><p>{backend.provider} / {backend.kind}</p><h1>{backend.displayName}</h1><span>{backend.description}</span></div><div><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Connected" : "Credential required"}</span><Link href={`/dashboard/playground?target=${backend.id}`}>Deploy to target <ArrowRight size={13} /></Link></div></header>
    <nav className="provider-detail-tabs"><a href="#overview" className="active">Overview</a><a href="#pricing">Pricing</a><a href="#capabilities">Capabilities</a><a href="#routing">Routing</a></nav>
    <section className="provider-detail-stats" id="overview"><div><Clock3 size={14} /><span>Queue</span><b>{backend.queueSeconds}s</b></div><div><Cpu size={14} /><span>Capacity</span><b>{backend.qubits} qubits</b></div><div><Gauge size={14} /><span>Two-qubit fidelity</span><b>{(backend.fidelity * 100).toFixed(2)}%</b></div><div><Route size={14} /><span>Reliability</span><b>{(backend.reliability * 100).toFixed(1)}%</b></div></section>
    <div className="provider-detail-grid">
      <section className="provider-detail-section" id="pricing"><header><h2>Endpoint pricing</h2><span>QCI snapshot {new Date(latest.ts).toLocaleDateString()}</span></header><div className="provider-price-line"><span><b>{backend.displayName}</b><small>{backend.region ?? "Provider cloud"}</small></span><span><small>Billing rate</small><b>{price(backend.pricePerShot, backend.pricePerTask, backend.pricePerNqh)}</b></span><span><small>Est. 1K shots</small><b>${(backend.pricePerTask + backend.pricePerShot * 1024).toFixed(4)}</b></span><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Available" : "BYOK required"}</span></div></section>
      <section className="provider-detail-section" id="routing"><header><h2>Routing contract</h2><span>QRouter API v1</span></header><dl><div><dt>Target ID</dt><dd><code>{backend.id}</code></dd></div><div><dt>Provider</dt><dd>{backend.provider}</dd></div><div><dt>Connectivity</dt><dd>{backend.connectivity}</dd></div><div><dt>Fallbacks</dt><dd>Policy controlled</dd></div></dl></section>
    </div>
    <section className="provider-detail-section" id="capabilities"><header><h2>Capabilities</h2><span>{backend.nativeGates.length} native operations</span></header><div className="provider-capabilities"><div><h3>Execution</h3><p><Check size={13} /> OpenQASM 2 input</p><p><Check size={13} /> Supported OpenQASM 3 subset</p><p><Check size={13} /> Normalized counts and probabilities</p><p><Check size={13} /> Commit-pinned repository source</p></div><div><h3>Compilation</h3><p><Check size={13} /> Hardware-aware transpilation</p><p><Check size={13} /> {backend.connectivity} topology</p><p><Check size={13} /> Optimization levels 0–3</p><p><Check size={13} /> Before/after metrics</p></div><div><h3>Native gates</h3><div className="provider-gates">{backend.nativeGates.map((gate) => <code key={gate}>{gate}</code>)}</div></div></div></section>
    <section className="provider-detail-cta"><GitBranch size={17} /><div><b>Run this target from a repository</b><p>Connect GitHub, choose a QASM entrypoint, and set <code>target</code> to <code>{backend.id}</code>.</p></div><Link href="/dashboard/github">Connect repository <ArrowRight size={13} /></Link></section>
  </div>;
}
