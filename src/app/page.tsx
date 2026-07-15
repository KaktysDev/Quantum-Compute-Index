import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, GitBranch } from "lucide-react";
import LandingFeatureWheel from "@/components/LandingFeatureWheel";
import LandingHeroStage from "@/components/LandingHeroStage";
import { ApiWorkbench, RoutingProcess } from "@/components/LandingProductSections";
import { getLatestSnapshot } from "@/lib/qci/store";
import "./landing.css";

export const dynamic = "force-dynamic";

const providers = [
  ["QCI Aer GPU", "STATE-VECTOR SIMULATOR", "LIVE", "QROUTER NATIVE"],
  ["IBM Quantum", "SUPERCONDUCTING", "PRIVATE BETA", "PROVIDER ADAPTER"],
  ["AWS BRAKET", "MULTI-ARCHITECTURE", "PRIVATE BETA", "PROVIDER ADAPTER"],
  ["IonQ", "TRAPPED ION", "PLANNED", "ROADMAP"],
] as const;

export default async function LandingPage() {
  const latest = await getLatestSnapshot();
  return <main className="qr-site">
    <LandingHeroStage />

    <section className="qr-status-strip" aria-label="Network status"><span>ROUTER STATUS <b>ONLINE</b></span><span>CONNECTED TARGETS <b>—</b></span><span>FAILOVER <b>ARMED</b></span><span>API <b>OPERATIONAL</b></span><span>REGION <b>US-CENTRAL</b></span></section>

    <section id="routing" className="qr-section qr-process">
      <header className="qr-section-head"><p className="qr-kicker">01 / ROUTING PROCESS</p><h2>ONE CIRCUIT.<br />ONE DECISION.<br />EVERY VARIABLE.</h2><p>QRouter preserves the evidence behind every route, from circuit constraints to the normalized result.</p></header>
      <RoutingProcess />
    </section>

    <section className="qr-section qr-fragmentation">
      <header className="qr-section-head compact"><p className="qr-kicker">02 / INTEGRATION MODEL</p><h2>REMOVE THE<br />PROVIDER SURFACE.</h2></header>
      <div className="qr-compare"><div><header><span>DIRECT INTEGRATION</span><b>FRAGMENTED</b></header>{["4 provider SDKs","4 credential systems","4 billing models","4 job schemas","provider-specific transpilation","manual backend selection","manual fallback logic"].map((item, index) => <p key={item}><span>{String(index + 1).padStart(2, "0")}</span>{item}</p>)}</div><div className="ordered"><header><span>QROUTER</span><b>ONE CONTROL PLANE</b></header>{["1 API","1 job object","1 routing policy","1 result schema","automatic backend evaluation","automatic failover","normalized settlement"].map((item) => <p key={item}><Check size={13} />{item}</p>)}</div></div>
    </section>

    <section id="benchmarks" className="qr-section qr-benchmark">
      <div><p className="qr-kicker">03 / PRIVATE BENCHMARK PROGRAM</p><h2>ROUTING SHOULD<br />BE MEASURABLE.</h2><p>We are validating routing performance across heterogeneous quantum architectures. Public performance claims will appear only after the methodology and data are ready for review.</p><Link href="/contact">REQUEST TECHNICAL BRIEF <ArrowRight size={14} /></Link></div>
      <div className="qr-benchmark-plot" aria-label="Benchmark program placeholder; no performance data is shown"><header><span>QROUTER ROUTING</span><b>VALIDATION IN PROGRESS</b></header><div><i /><i /><i /><i /><i /><i /><span>PUBLIC DATA PENDING</span></div><footer><span>TEST WINDOW / —</span><span>CIRCUITS / —</span><span>BACKENDS / —</span></footer></div>
    </section>

    <section className="qr-section qr-api">
      <header className="qr-section-head"><p className="qr-kicker">04 / ONE REQUEST CONTRACT</p><h2>SUBMIT ONCE.<br />GET ONE RESULT.</h2><p>Create a job, choose a routing policy, wait for execution, and read a provider-neutral response.</p></header>
      <ApiWorkbench />
    </section>

    <section id="network" className="qr-section qr-capabilities">
      <header className="qr-section-head compact"><p className="qr-kicker">05 / CONTROL SURFACE</p><h2>THE EXECUTION LAYER.</h2></header>
      <LandingFeatureWheel price={latest.price} changePct={latest.changePct} />
    </section>

    <section className="qr-section qr-provider-network">
      <header className="qr-section-head"><p className="qr-kicker">06 / PROVIDER NETWORK</p><h2>HETEROGENEOUS<br />BY DESIGN.</h2><p>Integration status reflects the current QRouter product roadmap, not general provider availability.</p></header>
      <div className="qr-provider-table"><header><span>TARGET</span><span>ARCHITECTURE</span><span>AVAILABILITY</span><span>INTEGRATION</span></header>{providers.map(([target, architecture, status, integration]) => <div key={target}><strong>{target}</strong><span>{architecture}</span><span className={status === "LIVE" ? "live" : ""}><i />{status}</span><span>{integration}</span></div>)}</div>
    </section>

    <section className="qr-section qr-credibility"><p className="qr-kicker">07 / BUILT FOR THE WORK</p><h2>BUILT AT THE INTERSECTION OF<br />QUANTUM RESEARCH AND<br />INFRASTRUCTURE.</h2><div><p>QRouter is building the routing, execution, and settlement layer required to treat quantum compute as programmable infrastructure.</p><span>QCI NETWORK / CHICAGO</span></div></section>

    <section className="qr-final"><div className="qr-final-topology" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div><p className="qr-kicker">QROUTER / V1</p><h2>ROUTE YOUR<br />FIRST CIRCUIT.</h2><code><span>POST</span> /api/v1/jobs</code><div><Link href="/dashboard">OPEN CONSOLE <ArrowUpRight size={15} /></Link><Link href="/docs">READ THE DOCUMENTATION <ArrowRight size={14} /></Link></div></section>

    <footer className="qr-footer"><div><strong>QROUTER</strong><span>THE QUANTUM EXECUTION LAYER</span></div><nav>{[["PRODUCT","#routing"],["CONSOLE","/dashboard"],["API","/docs"],["PRICING","/pricing"],["STATUS","#network"],["ABOUT","#routing"],["CONTACT","/contact"]].map(([label, href]) => <Link href={href} key={label}>{label}</Link>)}<a href="https://github.com/ItCodinTime/QCI2">GITHUB <GitBranch size={11} /></a></nav><div><span>QCI NETWORK / CHICAGO</span><span>© 2026 QROUTER</span><span>SYSTEM STATUS: <b>OPERATIONAL</b></span></div></footer>
  </main>;
}
