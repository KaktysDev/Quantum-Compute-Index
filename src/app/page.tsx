import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Braces, Check, Cpu, Gauge, Route, ShieldCheck, Timer } from "lucide-react";
import Logo from "@/components/Logo";
import LaunchConsole from "@/components/LaunchConsole";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const latest = await getLatestSnapshot();
  return (
    <main className="qr-landing">
      <section className="qr-hero">
        <Image src="/assets/qrouter-infrastructure.png" alt="Quantum processors linked through the QRouter infrastructure" fill priority sizes="100vw" className="qr-hero-image" />
        <div className="qr-hero-shade" />
        <header className="qr-public-nav">
          <Link href="/" aria-label="QRouter home"><Logo size={28} /></Link>
          <nav><a href="#network">Network</a><a href="#workflow">How it works</a><Link href="/pricing">QCI pricing</Link></nav>
          <Link href="/dashboard" className="qr-nav-console">Console <ArrowRight size={14} /></Link>
        </header>
        <div className="qr-hero-copy">
          <p className="qr-live"><span /> Quantum routing network online</p>
          <h1>QRouter</h1>
          <p className="qr-hero-lede">One API for the world&apos;s quantum computers.</p>
          <p className="qr-hero-body">Ship OpenQASM once. QCI transpiles, prices, and routes every workload to the right QPU or GPU simulator.</p>
          <LaunchConsole />
          <div className="qr-proof"><span><Check size={14} /> One API key</span><span><Check size={14} /> Live QCI pricing</span><span><Check size={14} /> Automatic routing</span></div>
        </div>
        <div className="qr-network-strip">
          <div><span>QCI / USD</span><strong>${latest.price.toFixed(2)}</strong><em className={latest.changePct >= 0 ? "positive" : "negative"}>{latest.changePct >= 0 ? "+" : ""}{latest.changePct.toFixed(2)}%</em></div>
          <div><span>Connected targets</span><strong>{BACKENDS.length}</strong><em>{BACKENDS.filter((backend) => backend.kind === "qpu").length} QPUs</em></div>
          <div><span>Universal IR</span><strong>OpenQASM</strong><em>2.0 + 3.0</em></div>
        </div>
      </section>

      <section id="workflow" className="qr-band qr-workflow">
        <div className="qr-section-intro"><p className="qr-eyebrow">The execution layer</p><h2>From circuit to result,<br />without provider glue.</h2></div>
        <div className="qr-flow-line">
          {[{ icon: Braces, n: "01", t: "Submit", d: "Send OpenQASM through one stable endpoint." }, { icon: Gauge, n: "02", t: "Analyze", d: "Measure depth, gates, qubits, and task complexity." }, { icon: Route, n: "03", t: "Route", d: "Balance price, queue, fidelity, and constraints." }, { icon: Cpu, n: "04", t: "Execute", d: "Run on the selected physical or simulated core." }].map((item) => <article key={item.n}><div><item.icon size={20} /><span>{item.n}</span></div><h3>{item.t}</h3><p>{item.d}</p></article>)}
        </div>
      </section>

      <section id="network" className="qr-band qr-network">
        <div className="qr-section-intro split"><div><p className="qr-eyebrow">Live backend catalog</p><h2>Every architecture.<br />One control plane.</h2></div><p>Pin a backend when you need control, or let QCI choose the best eligible target for every workload.</p></div>
        <div className="qr-backend-table">
          <div className="qr-table-head"><span>Backend</span><span>Architecture</span><span>Qubits</span><span>Queue</span><span>Fidelity</span><span>Status</span></div>
          {BACKENDS.slice(0, 6).map((backend) => <div className="qr-table-row" key={backend.id}><span><i className={`provider-dot ${backend.kind}`} /> <b>{backend.displayName}</b><small>{backend.provider}</small></span><span>{backend.kind === "simulator" ? "State vector" : backend.description.split(" ").slice(-2).join(" ")}</span><span>{backend.qubits}</span><span>{backend.queueSeconds < 60 ? `${backend.queueSeconds}s` : `${Math.ceil(backend.queueSeconds / 60)}m`}</span><span>{(backend.fidelity * 100).toFixed(1)}%</span><span className={backend.available ? "online" : "standby"}>{backend.available ? "Connected" : "Ready"}</span></div>)}
        </div>
      </section>

      <section className="qr-band qr-developer">
        <div className="qr-code-window"><div className="qr-code-bar"><span /><span /><span /><em>submit.py</em></div><pre><code>{`from qrouter import QRouter\n\nclient = QRouter(api_key="qci_live_...")\n\njob = client.jobs.create(\n    circuit=open("bell.qasm").read(),\n    routing="balanced",\n    max_cost=2.00,\n)\n\nprint(job.result())`}</code></pre></div>
        <div className="qr-developer-copy"><p className="qr-eyebrow">Built for production</p><h2>Quantum compute<br />that feels like an API.</h2><p>No provider SDK matrix. No manual queue watching. No separate billing accounts in your application.</p><ul><li><ShieldCheck size={18} /> Scoped, revocable API keys</li><li><Timer size={18} /> Async jobs and signed webhooks</li><li><Gauge size={18} /> Fixed quotes before execution</li></ul><Link href="/dashboard" className="qr-text-cta">Open the console <ArrowRight size={16} /></Link></div>
      </section>

      <section className="qr-final"><p className="qr-eyebrow">The quantum cloud starts here</p><h2>One key. Every core.</h2><LaunchConsole /></section>
      <footer className="qr-footer"><Logo /><p>QCI routing infrastructure · Chicago, IL</p><span>© 2026 QuantumForge</span></footer>
    </main>
  );
}
