import Link from "next/link";
import { ArrowRight, Cpu, Network, Play, Route, ShieldCheck, Terminal, Zap } from "lucide-react";
import QciMarketPanel from "@/components/QciMarketPanel";
import { getLatestSnapshot, getProviderSeries, getSeries } from "@/lib/qci/store";
import { BACKENDS } from "@/lib/qrouter/catalog";

export default async function QciPage() {
  const [latest, indexSeries, providerSeries] = await Promise.all([
    getLatestSnapshot(), getSeries(365), getProviderSeries(365),
  ]);
  const providers = new Set(BACKENDS.map((backend) => backend.provider)).size;
  const connected = BACKENDS.filter((backend) => backend.available).length;
  const qpus = BACKENDS.filter((backend) => backend.kind === "qpu").length;
  return <div className="console-page overview-page">
    <div className="console-page-heading overview-heading"><div><p className="qr-eyebrow"><span /> QCI / USD/QC-HOUR</p><h1>Quantum Compute Index</h1><p>Normalized quantum compute pricing across the provider market.</p></div><Link href="/dashboard/playground" className="console-primary"><Play size={14} fill="currentColor" /> New deployment</Link></div>
    <section className="console-status-strip" aria-label="Network status"><div><span><Network size={15} /> Provider catalog</span><strong>{providers}</strong><small>configured adapters</small></div><div><span><Cpu size={15} /> Catalog targets</span><strong>{BACKENDS.length}</strong><small>{qpus} physical QPU records</small></div><div><span><Zap size={15} /> Routable now</span><strong>{connected}</strong><small>configured targets</small></div><div><span><ShieldCheck size={15} /> Routing engine</span><strong>Private beta</strong><small>availability varies by credentials</small></div></section>
    <QciMarketPanel latest={latest} indexSeries={indexSeries} providerSeries={providerSeries} />
    <nav className="qci-console-links" aria-label="Playground system views"><Link href="/dashboard/playground/routing"><Route size={15} /><span><b>Routing fabric</b><small>Policy, constraints, and candidate scoring</small></span><ArrowRight size={13} /></Link><Link href="/dashboard/playground/api"><Terminal size={15} /><span><b>API endpoint</b><small>Authentication and request contracts</small></span><ArrowRight size={13} /></Link><Link href="/dashboard/playground/network"><Cpu size={15} /><span><b>Compute network</b><small>Providers, queues, fidelity, and rates</small></span><ArrowRight size={13} /></Link></nav>
  </div>;
}
