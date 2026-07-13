import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  Cloud,
  Code2,
  Gauge,
  GitBranch,
  Network,
  Play,
  Sparkles,
} from "lucide-react";
import LandingFeatureWheel from "@/components/LandingFeatureWheel";
import LandingHeroStage from "@/components/LandingHeroStage";
import Logo from "@/components/Logo";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { getLatestSnapshot } from "@/lib/qci/store";
import "./landing.css";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const latest = await getLatestSnapshot();
  const connected = BACKENDS.filter((backend) => backend.available).length;

  return (
    <main className="qh-site">
      <section className="qh-hero">
        <LandingHeroStage />

        <div className="qh-terminal-shell">
          <div className="qh-terminal-bar"><span><i /><i /><i /> qrouter / first-task.py</span><em>QCI NETWORK ONLINE</em></div>
          <div className="qh-terminal-body">
            <div className="qh-terminal-code">
              <p><span>01</span><code>from <b>qrouter</b> import QRouter</code></p>
              <p><span>02</span><code>client = QRouter(api_key=<em>QCI_API_KEY</em>)</code></p>
              <p><span>03</span><code>job = client.jobs.create(</code></p>
              <p><span>04</span><code>&nbsp;&nbsp;circuit=open(<em>&quot;bell.qasm&quot;</em>).read(),</code></p>
              <p><span>05</span><code>&nbsp;&nbsp;routing=<em>&quot;balanced&quot;</em>, shots=1024</code></p>
              <p><span>06</span><code>)</code></p>
              <p><span>07</span><code>print(job.wait().counts)</code></p>
              <div className="qh-live-circuit">
                <span>INPUT / BELL CIRCUIT</span>
                <div><b>q0</b><i /><em>H</em><i /><em className="control">●</em><i /><em>M</em></div>
                <div><b>q1</b><i /><em className="blank" /><i /><em>⊕</em><i /><em>M</em></div>
              </div>
            </div>
            <aside className="qh-route-result">
              <p><span /> LIVE ROUTE DECISION</p>
              <div className="qh-live-steps"><span>ANALYZE</span><span>TRANSPILE</span><span>SCORE</span><span>EXECUTE</span></div>
              <div className="qh-live-candidates">
                <div><span><b>QCI Aer GPU</b><small>2s / 100.0%</small></span><i><em style={{ width: "96%" }} /></i><strong>0.96</strong></div>
                <div><span><b>IBM Brisbane</b><small>13m / 99.2%</small></span><i><em style={{ width: "73%" }} /></i><strong>0.73</strong></div>
                <div><span><b>IonQ Aria 1</b><small>20m / 99.6%</small></span><i><em style={{ width: "68%" }} /></i><strong>0.68</strong></div>
              </div>
              <div className="qh-route-choice"><span>SELECTED</span><b>qci-aer-gpu</b><strong>$0.0031</strong></div>
              <div className="qh-counts"><span><i style={{ width: "94%" }} />|00&gt; 507</span><span><i style={{ width: "96%" }} />|11&gt; 517</span></div>
              <div className="qh-execution-flow"><i /><i /><i /><i /><i /><i /><i /><i /></div>
            </aside>
          </div>
          <footer><span>QROUTER CONSOLE / LIVE PREVIEW</span><span>TRANSPILE <ArrowRight size={11} /> ROUTE <ArrowRight size={11} /> EXECUTE</span></footer>
        </div>

        <div className="qh-provider-cards">
          <article><span>CONNECTED TARGETS</span><strong>{BACKENDS.length}</strong><p>Every major architecture</p><Network size={22} /></article>
          <article><span>QCI PRICE / NQH</span><strong>${latest.vwap.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><p>{latest.changePct >= 0 ? "+" : ""}{latest.changePct.toFixed(2)}% live rate</p><Gauge size={22} /></article>
          <article><span>ROUTER STATUS</span><strong>{connected} LIVE</strong><p>Automatic failover ready</p><Cloud size={22} /></article>
        </div>
      </section>

      <section id="network" className="qh-features">
        <div className="qh-feature-label"><Logo size={22} /><span>FEATURE</span><b>PREVIEW</b></div>
        <LandingFeatureWheel price={latest.price} changePct={latest.changePct} />
        <div className="qh-mega-word">QROUTER</div>
      </section>

      <section className="qh-manifesto">
        <p><Sparkles size={14} /> THE QUANTUM EXECUTION LAYER</p>
        <h2>ONE API.<br />EVERY CORE.</h2>
        <div>
          <Link href="/dashboard" className="qh-action dark"><Play size={12} fill="currentColor" /> START ROUTING</Link>
          <a href="/openapi.json">READ THE API <ArrowRight size={12} /></a>
        </div>
      </section>

      <footer className="qh-footer">
        <Logo size={24} />
        <p>QUANTUM COMPUTE INDEX / CHICAGO</p>
        <div><a href="/openapi.json"><Code2 size={14} /> API</a><a href="https://github.com/ItCodinTime/QCI2"><GitBranch size={14} /> GITHUB</a><a href="#network"><ArrowDown size={14} /> TOP</a></div>
      </footer>
    </main>
  );
}
