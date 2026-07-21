import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GitBranch,
  Route,
  ShieldCheck,
} from "lucide-react";
import HeroConsole from "@/components/landing/HeroConsole";
import HeroParticleText from "@/components/landing/HeroParticleText";
import LandingNav from "@/components/landing/LandingNav";
import Reveal from "@/components/landing/Reveal";
import AffiliationRail from "@/components/landing/AffiliationRail";
import DeveloperApiDemo from "@/components/landing/DeveloperApiDemo";
import RoutingSandbox from "@/components/landing/RoutingSandbox";
import LandingPriceIndex, { type IndexPoint } from "@/components/LandingPriceIndex";
import LogoMark from "@/components/LogoMark";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "QRouter — Intelligent Routing for Quantum Compute",
  description:
    "QRouter evaluates, compiles, prices, and intelligently routes quantum workloads across compatible backends through one API.",
  openGraph: {
    title: "QRouter — The Quantum Execution Layer",
    description:
      "One API for workload-specific quantum backend evaluation, routing, and execution.",
  },
};

const strengths = [
  ["Workload specific", "Every route begins with circuit requirements and explicit user constraints."],
  ["Predictable quotes", "Review estimated execution cost and routing inputs before provider submission."],
  ["Provider neutral", "Use one request and one result lifecycle across configured backends."],
  ["Traceable", "Preserve candidate scores, rejection reasons, and the selected route."],
] as const;

const productRows = [
  {
    id: "route",
    eyebrow: "01 / Route",
    title: "Select the right available backend",
    copy: "The QCI Engine removes incompatible targets, applies workload constraints, and ranks the remaining options across projected quality, queue, cost, and reliability.",
    action: "Explore routing",
    href: "/docs#routing",
    side: "left",
  },
  {
    id: "transpile",
    eyebrow: "02 / Transpile",
    title: "Compile for the selected architecture",
    copy: "Turn one OpenQASM circuit into a target-aware program without rebuilding your application around every provider SDK.",
    action: "Read the compiler docs",
    href: "/docs#transpilation",
    side: "right",
  },
  {
    id: "index",
    eyebrow: "03 / Price",
    title: "Understand the quote before execution",
    copy: "The Quantum Compute Index normalizes configured pricing inputs to a QC-hour. Every public view identifies whether its data is a provider snapshot or a deterministic sample.",
    action: "View methodology",
    href: "/pricing#methodology",
    side: "left",
  },
  {
    id: "deploy",
    eyebrow: "04 / Deploy",
    title: "Ship circuits, not provider integrations",
    copy: "Connect a repository, select an OpenQASM entrypoint, set routing defaults, and deploy from a branch, tag, or commit.",
    action: "Repository workflow",
    href: "/docs#repositories",
    side: "right",
  },
] as const;

export default async function LandingPage() {
  const [latest, series] = await Promise.all([getLatestSnapshot(), getSeries(365)]);
  const routable = BACKENDS.filter((backend) => backend.available).length;
  const qpuCount = BACKENDS.filter((backend) => backend.kind === "qpu").length;
  const routingCandidates = BACKENDS.filter((backend) => ["ibm-brisbane", "ionq-aria-1", "iqm-garnet"].includes(backend.id)).map((backend) => ({
    id: backend.id,
    name: backend.displayName,
    queue: backend.queueSeconds,
    fidelity: backend.fidelity,
    cost: backend.pricePerTask + backend.pricePerShot * 1024,
  }));
  const tickerItems = [
    ...BACKENDS.map((b) => ({
      name: b.displayName,
      detail: `${b.qubits}Q · ${b.kind.toUpperCase()}`,
    })),
    { name: "QCI", detail: `$${latest.vwap.toFixed(2)}/QC·H` },
  ];

  return (
    <main className="ql-site">
      <LandingNav />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <header className="ql-hero ql-shell">
        <p className="ql-eyebrow">
          <span className="ql-blink" aria-hidden="true" /> THE QUANTUM EXECUTION LAYER
        </p>

        <h1 className="ql-hero-title">The economic layer <HeroParticleText>for quantum</HeroParticleText></h1>

        <div className="ql-hero-grid">
          <div className="ql-hero-copy">
            <h2>One API that analyzes, prices, and routes circuits to the right available quantum hardware.</h2>
            <p>
              Hard constraints first. Eligible candidates ranked by projected quality,
              queue, cost, and reliability. Full decision trace on every job.
            </p>
            <div className="ql-cta-row">
              <Link href={PUBLIC_CONFIG.accessUrl} className="ql-btn primary">
                Join waitlist <ArrowRight />
              </Link>
              <Link href={PUBLIC_CONFIG.docsUrl} className="ql-btn ghost">
                Read the API
              </Link>
            </div>
            <dl className="ql-hero-stats">
              <div>
                <dt>Routable targets</dt>
                <dd>{routable}</dd>
              </div>
              <div>
                <dt>QPU architectures</dt>
                <dd>{qpuCount}</dd>
              </div>
              <div>
                <dt>Index / QC-hour</dt>
                <dd>
                  ${latest.vwap.toFixed(2)}
                  <small>{latest.source === "sample" ? "SAMPLE" : "SNAPSHOT"}</small>
                </dd>
              </div>
            </dl>
          </div>

          <Reveal variant="left" className="ql-hero-console">
            <HeroConsole />
          </Reveal>
        </div>
      </header>

      {/* ── Backend ticker ───────────────────────────────────────────────── */}
      <div className="ql-ticker" aria-hidden="true">
        <div className="ql-ticker-track">
          {[0, 1].map((copy) => (
            <div className="ql-ticker-group" key={copy}>
              {tickerItems.map((item) => (
                <span key={`${copy}-${item.name}`}>
                  <b>{item.name}</b> {item.detail}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <AffiliationRail />

      {/* ── Product qualities ────────────────────────────────────────────── */}
      <section id="product" className="ql-proof ql-shell" aria-label="Product qualities">
        <Reveal>
          <header className="ql-section-head">
            <p className="ql-kicker">{"// 01 — BUILT FOR QUANTUM WORKLOADS"}</p>
            <h2>
              Deterministic where it matters,<br />
              <span>quantum where it counts.</span>
            </h2>
          </header>
        </Reveal>
        <div className="ql-proof-grid">
          {strengths.map(([title, copy], index) => (
            <Reveal key={title} delay={index * 90}>
              <article className="ql-proof-card">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── QCI Engine ───────────────────────────────────────────────────── */}
      <section id="engine" className="ql-engine ql-shell">
        <Reveal>
          <header className="ql-section-head">
            <p className="ql-kicker">{"// 02 — QCI ENGINE"}</p>
            <h2>
              Choose by trade-off,<br />
              <span>not one metric.</span>
            </h2>
            <p className="ql-section-sub">
              QCI combines circuit compatibility, projected execution quality, queue
              time, cost, reliability, and user constraints into a workload-specific
              route decision.
            </p>
          </header>
        </Reveal>
        <div className="ql-engine-grid">
          <Reveal variant="right" className="ql-engine-copy">
            <p>
              The selected route should not simply be the fastest, cheapest, or
              highest-fidelity option. Hard constraints are applied first; eligible
              candidates are then ranked under the chosen policy.
            </p>
            <ul>
              <li><Check /> Compatibility filters before scoring</li>
              <li><Check /> Explicit cost &amp; queue ceilings</li>
              <li><Check /> Rejection reasons preserved per candidate</li>
            </ul>
            <Link href="/docs#routing" className="ql-inline-link">
              Read routing methodology <ArrowRight />
            </Link>
          </Reveal>
          <Reveal variant="left">
            <RoutingSandbox candidates={routingCandidates} />
          </Reveal>
        </div>
      </section>

      {/* ── Product rows ─────────────────────────────────────────────────── */}
      <section className="ql-products ql-shell" aria-label="Product surfaces">
        {productRows.map((row) => (
          <article
            className={`ql-product-row ${row.side === "right" ? "reverse" : ""}`}
            id={row.id}
            key={row.id}
          >
            <Reveal variant={row.side === "right" ? "left" : "right"} className="ql-product-copy">
              <p className="ql-kicker">{row.eyebrow}</p>
              <h2>{row.title}</h2>
              <span>{row.copy}</span>
              <Link href={row.href} className="ql-inline-link">
                {row.action} <ArrowUpRight />
              </Link>
            </Reveal>
            <Reveal variant={row.side === "right" ? "right" : "left"}>
              <ProductVisual
                id={row.id}
                price={latest.vwap}
                source={latest.source}
                series={series}
              />
            </Reveal>
          </article>
        ))}
      </section>

      {/* ── Start ────────────────────────────────────────────────────────── */}
      <DeveloperApiDemo />

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="ql-footer">
        <div className="ql-shell ql-footer-grid">
          <div className="ql-footer-brand">
            <LogoMark size={30} />
            <strong>QROUTER</strong>
            <p>The quantum execution layer.</p>
          </div>
          <nav aria-label="Product">
            <h3>Product</h3>
            <a href="#engine">QCI Engine</a>
            <a href="#route">Routing</a>
            <a href="#index">Quantum Compute Index</a>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <nav aria-label="Developers">
            <h3>Developers</h3>
            <Link href="/docs">Documentation</Link>
            <a href="/openapi.json">OpenAPI</a>
            <Link href="/docs#repositories">Repositories</Link>
            <Link href="/signin">Join the waitlist</Link>
          </nav>
          <nav aria-label="Company">
            <h3>Company</h3>
            <Link href="/history">History</Link>
            <Link href="/contact">Contact</Link>
            <span>Chicago, Illinois</span>
          </nav>
          <div className="ql-footer-bottom">
            <span>{PUBLIC_CONFIG.copyright}</span>
            <span>QCI values identify sample or provider-snapshot sources.</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ProductVisual({
  id,
  price,
  source,
  series,
}: {
  id: string;
  price: number;
  source: "live" | "sample";
  series: IndexPoint[];
}) {
  if (id === "route")
    return (
      <div className="ql-visual">
        <div className="ql-ui-window">
          <header><Route /> ROUTE DECISION <span>QCI / V1</span></header>
          <div className="ql-ui-rows">
            <div className="selected"><b>QCI Aer GPU</b><span>2 sec</span><span>100.0%</span><span>$0.0031</span><strong>SELECTED</strong></div>
            <div><b>Amazon SV1</b><span>8 sec</span><span>100.0%</span><span>$0.0845</span><strong>KEY REQUIRED</strong></div>
            <div className="rejected"><b>IBM Brisbane</b><span>780 sec</span><span>99.2%</span><span>$65.90</span><strong>KEY REQUIRED</strong></div>
          </div>
          <footer><Check /> BALANCED · 2 QUBITS · 1,024 SHOTS · MAX $2.00</footer>
        </div>
      </div>
    );
  if (id === "transpile")
    return (
      <div className="ql-visual">
        <div className="ql-code-compare">
          <pre><span>OPENQASM 2 · BELL.QASM</span><code>{`h q[0];\ncx q[0], q[1];\nmeasure q -> c;`}</code><small>DEPTH 4 · 2 GATES</small></pre>
          <i>→</i>
          <pre><span>QCI AER GPU · LOCAL</span><code>{`h q[0];\ncx q[0],q[1];\nmeasure q -> c;`}</code><small>OPT LEVEL 2 · ARTIFACT SAVED</small></pre>
        </div>
      </div>
    );
  if (id === "index") return <LandingPriceIndex vwap={price} source={source} series={series} />;
  return (
    <div className="ql-visual">
      <div className="ql-deploy-window">
        <header><GitBranch /> github.com/org/quantum-circuits <span>main@f1d8dfc</span></header>
        {["Inspect repository", "Detect examples/bell.qasm", "Load qrouter.json defaults", "Pin source commit", "Route to QCI Aer GPU", "Store compiled artifact", "Return normalized counts"].map((step, index) => (
          <div key={step}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <b>{step}</b>
            {index < 6 ? <ArrowRight /> : <Check />}
          </div>
        ))}
        <footer><ShieldCheck /> Commit-pinned source · normalized artifacts</footer>
      </div>
    </div>
  );
}
