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
    <div className="console-page-heading overview-heading"><div><p className="qr-eyebrow"><span /> QCI / USD-NQH</p><h1>Quantum Compute Index</h1><p>Normalized quantum compute pricing across the provider market.</p></div><Link href="/dashboard/playground" className="console-primary"><Play size={14} fill="currentColor" /> New deployment</Link></div>
    <section className="console-status-strip" aria-label="Network status"><div><span><Network size={15} /> Provider network</span><strong>{providers}</strong><small>integrations</small></div><div><span><Cpu size={15} /> Compute targets</span><strong>{BACKENDS.length}</strong><small>{qpus} physical QPUs</small></div><div><span><Zap size={15} /> Connected now</span><strong>{connected}</strong><small>ready to receive</small></div><div><span><ShieldCheck size={15} /> Router status</span><strong className="status-word"><i /> Operational</strong><small>all systems normal</small></div></section>
    <QciMarketPanel latest={latest} indexSeries={indexSeries} providerSeries={providerSeries} />
    <nav className="qci-console-links" aria-label="Playground system views"><Link href="/dashboard/playground/routing"><Route size={15} /><span><b>Routing fabric</b><small>Policy, constraints, and candidate scoring</small></span><ArrowRight size={13} /></Link><Link href="/dashboard/playground/api"><Terminal size={15} /><span><b>API endpoint</b><small>Authentication and request contracts</small></span><ArrowRight size={13} /></Link><Link href="/dashboard/playground/network"><Cpu size={15} /><span><b>Compute network</b><small>Providers, queues, fidelity, and rates</small></span><ArrowRight size={13} /></Link></nav>
  </div>;
}
