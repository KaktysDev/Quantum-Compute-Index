import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, GitBranch, Route, ShieldCheck } from "lucide-react";
import LandingHeroStage from "@/components/LandingHeroStage";
import LandingPriceIndex, { type IndexPoint } from "@/components/LandingPriceIndex";
import { PUBLIC_CONFIG, PUBLIC_FEATURE_STATUS } from "@/lib/publicConfig";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";
import "./landing.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QRouter — Intelligent Routing for Quantum Compute",
  description: "QRouter evaluates, compiles, prices, and intelligently routes quantum workloads across compatible backends through one API.",
  openGraph: {
    title: "QRouter — The Quantum Execution Layer",
    description: "One API for workload-specific quantum backend evaluation, routing, and execution.",
  },
};

const strengths = [
  ["Workload specific", "Every route begins with circuit requirements and explicit user constraints."],
  ["Predictable quotes", "Review estimated execution cost and routing inputs before provider submission."],
  ["Provider neutral", "Use one request and one result lifecycle across configured backends."],
  ["Traceable", "Preserve candidate scores, rejection reasons, and the selected route."],
] as const;

const productRows = [
  { id: "route", eyebrow: "01 / Route", title: "Select the right available backend", copy: "The QCI Engine removes incompatible targets, applies workload constraints, and ranks the remaining options across projected quality, queue, cost, and reliability.", action: "Explore routing", href: "/docs#routing", side: "left" },
  { id: "transpile", eyebrow: "02 / Transpile", title: "Compile for the selected architecture", copy: "Turn one OpenQASM circuit into a target-aware program without rebuilding your application around every provider SDK.", action: "Read the compiler docs", href: "/docs#transpilation", side: "right" },
  { id: "price", eyebrow: "03 / Price", title: "Understand the quote before execution", copy: "The Quantum Compute Index normalizes configured pricing inputs to a QC-hour. Every public view identifies whether its data is a provider snapshot or a deterministic sample.", action: "View methodology", href: "/pricing#methodology", side: "left" },
  { id: "deploy", eyebrow: "04 / Deploy", title: "Ship circuits, not provider integrations", copy: "Connect a repository, select an OpenQASM entrypoint, set routing defaults, and deploy from a branch, tag, or commit.", action: "Repository workflow", href: "/docs#repositories", side: "right" },
] as const;

export default async function LandingPage() {
  const [latest, series] = await Promise.all([getLatestSnapshot(), getSeries(365)]);
  const routable = BACKENDS.filter((backend) => backend.available).length;

  return (
    <main className="pl-site">
      <LandingHeroStage />

      <section className="pl-proof pl-shell" aria-label="Product qualities">
        <header><p>Built for quantum workloads</p><span>{routable} routable target{routable === 1 ? "" : "s"} in this deployment</span></header>
        <div>{strengths.map(([title, copy]) => <article key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section id="engine" className="pl-engine pl-shell">
        <header className="pl-section-head">
          <div><p>QCI Engine</p><h2>A routing API purpose-built for quantum workloads</h2></div>
          <p>QCI combines circuit compatibility, projected execution quality, queue time, cost, reliability, and user constraints into a workload-specific route decision.</p>
        </header>
        <div className="pl-engine-grid">
          <div className="pl-engine-copy">
            <p className="pl-mini-label">Illustrative decision space</p>
            <h3>Choose by trade-off,<br />not one metric.</h3>
            <p>The selected route should not simply be the fastest, cheapest, or highest-fidelity option. Hard constraints are applied first; eligible candidates are then ranked under the chosen policy.</p>
            <Link href="/docs#routing">Read routing methodology <ArrowRight /></Link>
          </div>
          <div className="pl-plot" aria-label="Illustrative routing decision plot; not provider performance data">
            <div className="pl-plot-tabs"><span className="active">Balanced</span><span>Cost</span><span>Speed</span><span>Quality</span></div>
            <div className="pl-plot-area">
              <span className="pl-axis-y">PROJECTED QUALITY</span><span className="pl-axis-x">ESTIMATED COST →</span>
              <i className="pl-dot alpha"><b>QPU ALPHA</b><small>SELECTED · 0.84</small></i>
              <i className="pl-dot beta"><b>QPU BETA</b><small>ELIGIBLE · 0.79</small></i>
              <i className="pl-dot gamma"><b>QPU GAMMA</b><small>REJECTED · COST</small></i>
            </div>
            <footer><span>SAMPLE BACKENDS</span><span>NO PROVIDER PERFORMANCE CLAIMS</span></footer>
          </div>
        </div>
      </section>

      <section id="products" className="pl-products pl-shell">
        {productRows.map((row) => (
          <article className={`pl-product-row ${row.side === "right" ? "reverse" : ""}`} id={row.id} key={row.id}>
            <div className="pl-product-copy"><p>{row.eyebrow}</p><h2>{row.title}</h2><span>{row.copy}</span><Link href={row.href}>{row.action} <ArrowUpRight /></Link></div>
            <ProductVisual id={row.id} price={latest.vwap} source={latest.source} series={series} />
          </article>
        ))}
      </section>

      <section className="pl-start pl-shell">
        <div className="pl-start-main">
          <p>Start building</p><h2>Route your first circuit</h2><span>Request access to QRouter, create an API key, and submit OpenQASM through one versioned endpoint.</span>
          <div><Link href={PUBLIC_CONFIG.accessUrl} className="pl-button primary">Request access</Link><Link href={PUBLIC_CONFIG.docsUrl} className="pl-button">Read the API</Link></div>
          <pre><code><b>POST</b> api.qrouter.dev/api/v1/jobs</code></pre>
        </div>
        <aside>
          <p>Product status</p>
          <div><span>QCI Engine</span><b>{PUBLIC_FEATURE_STATUS.routingEngine}</b></div>
          <div><span>Repository deploy</span><b>{PUBLIC_FEATURE_STATUS.repositoryDeploy}</b></div>
          <div><span>Provider failover</span><b>{PUBLIC_FEATURE_STATUS.providerFailover}</b></div>
          <div><span>Index source</span><b>{latest.source === "sample" ? "SAMPLE DATA" : "PROVIDER SNAPSHOT"}</b></div>
        </aside>
      </section>

      <footer className="pl-footer">
        <div className="pl-shell pl-footer-grid">
          <div className="pl-footer-brand"><span>Q</span><strong>QRouter</strong><p>The quantum execution layer.</p></div>
          <nav><h3>Product</h3><a href="#engine">QCI Engine</a><a href="#route">Routing</a><a href="#price">Quantum Compute Index</a><Link href="/pricing">Pricing</Link></nav>
          <nav><h3>Developers</h3><Link href="/docs">Documentation</Link><a href="/openapi.json">OpenAPI</a><Link href="/docs#repositories">Repositories</Link><Link href="/contact">Request access</Link></nav>
          <nav><h3>Company</h3><Link href="/history">History</Link><Link href="/contact">Contact</Link><span>Chicago, Illinois</span></nav>
          <div className="pl-footer-bottom"><span>{PUBLIC_CONFIG.copyright}</span><span>QCI values identify sample or provider-snapshot sources.</span></div>
        </div>
      </footer>
    </main>
  );
}

function ProductVisual({ id, price, source, series }: { id: string; price: number; source: "live" | "sample"; series: IndexPoint[] }) {
  if (id === "route") return <div className="pl-product-visual"><div className="pl-ui-window"><header><Route /> ROUTE DECISION <span>SAMPLE</span></header><div className="pl-ui-rows"><div className="selected"><b>QPU Alpha</b><span>18m</span><span>99.0%</span><span>$0.74</span><strong>0.84</strong></div><div><b>QPU Beta</b><span>29m</span><span>98.6%</span><span>$0.62</span><strong>0.79</strong></div><div className="rejected"><b>QPU Gamma</b><span>7m</span><span>99.4%</span><span>$1.18</span><strong>REJECT</strong></div></div><footer><Check /> BALANCED POLICY · QPU ONLY · MAX $1.00</footer></div></div>;
  if (id === "transpile") return <div className="pl-product-visual"><div className="pl-code-compare"><pre><span>OPENQASM INPUT</span><code>{`h q[0];\ncx q[0], q[1];\nmeasure q -> c;`}</code></pre><i>→</i><pre><span>TARGET-AWARE OUTPUT</span><code>{`rz(pi/2) q[0];\nsx q[0];\necr q[0], q[1];`}</code></pre></div></div>;
  if (id === "price") return <LandingPriceIndex vwap={price} source={source} series={series} />;
  return <div className="pl-product-visual"><div className="pl-deploy-window"><header><GitBranch /> github.com/organization/quantum-circuits <span>main</span></header>{["Connect repository","Discover circuit","Set routing policy","Compile","Route","Execute","Receive result"].map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><b>{step}</b>{index < 6 ? <ArrowRight /> : <Check />}</div>)}<footer><ShieldCheck /> Signed webhook delivery supported</footer></div></div>;
}
