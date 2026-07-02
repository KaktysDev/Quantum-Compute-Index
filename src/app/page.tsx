import Link from "next/link";
import Logo from "@/components/Logo";
import SiteFooter from "@/components/SiteFooter";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

const WORKFLOWS = [
  {
    number: "01",
    eyebrow: "Normalize",
    title: "One market language",
    body: "Provider rates are converted into a consistent unit before they enter the index.",
    metric: "8 provider feeds unified",
    visual: (
      <div className="qci-mini-list">
        {["Per shot", "Per task", "Per minute", "Reserved"].map((item) => (
          <div key={item}><span>›</span>{item}</div>
        ))}
      </div>
    ),
  },
  {
    number: "02",
    eyebrow: "Adjust",
    title: "Quality-aware pricing",
    body: "Capability, throughput, and fidelity determine how each system contributes.",
    metric: "Performance weighted daily",
    visual: (
      <div className="qci-mini-table">
        <span>QPU</span><span>RATE</span><span>WEIGHT</span>
        <b>A-01</b><b>$1.62</b><i>32%</i>
        <b>B-08</b><b>$2.14</b><i>41%</i>
        <b>C-04</b><b>$0.98</b><i>27%</i>
      </div>
    ),
  },
  {
    number: "03",
    eyebrow: "Benchmark",
    title: "A durable index level",
    body: "A repeatable methodology creates a comparable time series across market cycles.",
    metric: "120-day market history",
    visual: (
      <div className="qci-mini-flow">
        <span>Rates</span><b>→</b><span>Quality</span><b>→</b><span>QCI</span>
      </div>
    ),
  },
  {
    number: "04",
    eyebrow: "Decide",
    title: "Built for real decisions",
    body: "Give finance, procurement, and infrastructure teams one defensible reference point.",
    metric: "One source of market truth",
    visual: (
      <div className="qci-mini-files">
        <span><i className="bg-emerald-400" />Board report <b>↓</b></span>
        <span><i className="bg-white/50" />Pricing brief <b>↓</b></span>
        <span><i className="bg-emerald-700" />Market data <b>↓</b></span>
      </div>
    ),
  },
];

const METRICS = [
  {
    value: "8+",
    label: "Quantum cloud providers tracked across the market",
    before: "Fragmented rates",
    after: "one normalized index",
    tag: "Coverage",
  },
  {
    value: "24h",
    label: "Refresh cadence for a current view of compute pricing",
    before: "Manual research",
    after: "daily market signal",
    tag: "Freshness",
  },
  {
    value: "1",
    label: "Comparable benchmark for infrastructure decisions",
    before: "Many price models",
    after: "one reference point",
    tag: "Clarity",
  },
];

export default async function LandingPage() {
  const latest = await getLatestSnapshot();
  const asOf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(latest.ts));

  return (
    <main className="qci-landing">
      <section className="qci-hero">
        <header className="qci-hero-nav">
          <Link href="/" className="qci-brand-pill" aria-label="QuantumForge home"><Logo /></Link>
          <div className="qci-nav-actions">
            <Link href="/pricing" className="qci-simple-link">Methodology</Link>
            <Link href="/dashboard" className="qci-simple-link">Sign in</Link>
            <Link href="/contact" className="qci-pill qci-pill-light">Request access</Link>
          </div>
        </header>

        <div className="qci-hero-content">
          <p className="qci-kicker"><span>✦</span> The market standard for quantum compute</p>
          <h1>The financial layer for<br />quantum computing.</h1>
          <div className="qci-hero-lower">
            <div className="qci-hero-copy">
              <p>A performance-adjusted benchmark for comparing the true cost of quantum compute across providers and architectures.</p>
              <div>
                <Link href="/contact" className="qci-pill qci-pill-light">Request access</Link>
                <Link href="/pricing" className="qci-text-link">Explore the index <span>→</span></Link>
              </div>
            </div>
            <div className="qci-index-line">
              <span><i /> QCI · {latest.source === "sample" ? "SAMPLE" : "LIVE"}</span>
              <strong>${latest.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <em>{latest.changePct >= 0 ? "+" : ""}{latest.changePct.toFixed(2)}%</em>
            </div>
          </div>
        </div>
        <p className="qci-asof">Updated {asOf} · 9:30 AM ET</p>
      </section>

      <section id="workflows" className="qci-workflows">
        <div className="qci-section-heading">
          <p>How the index works</p>
          <h2>The market decisions<br />teams can make faster.</h2>
        </div>
        <div className="qci-workflow-grid">
          {WORKFLOWS.map((item) => (
            <article key={item.number} className="qci-workflow-card">
              <div className="qci-card-visual">{item.visual}</div>
              <div className="qci-card-copy">
                <div className="qci-metric-pill"><span>◷</span>{item.metric}</div>
                <span className="qci-card-number">{item.number} · {item.eyebrow}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="qci-outcomes">
        <div className="qci-section-heading qci-section-heading-split">
          <div><p>Built for comparison</p><h2>From scattered pricing<br />to a market view.</h2></div>
          <span>QCI gives teams a consistent basis for evaluating providers, tracking cost, and planning quantum infrastructure.</span>
        </div>
        <div className="qci-metric-grid">
          {METRICS.map((metric) => (
            <article key={metric.tag} className="qci-outcome-card">
              <div className="qci-outcome-top">
                <strong>{metric.value}</strong>
                <p>{metric.label}</p>
              </div>
              <div className="qci-outcome-bottom">
                <div className="qci-comparison-heading">
                  <span>Measured impact</span>
                  <em>{metric.tag}</em>
                </div>
                <div className="qci-comparison">
                  <div className="qci-comparison-before">
                    <span>Before</span>
                    <p>{metric.before}</p>
                  </div>
                  <b aria-hidden="true">→</b>
                  <div className="qci-comparison-after">
                    <span>With QCI</span>
                    <p>{metric.after}</p>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="qci-closing">
        <p>Private access · 2026</p>
        <h2>One index for the<br />quantum compute market.</h2>
        <Link href="/contact" className="qci-pill qci-pill-light">Request access <span>→</span></Link>
      </section>

      <div className="qci-footer-wrap"><SiteFooter /></div>
    </main>
  );
}
