import Link from "next/link";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { formatChangePct, formatUsd } from "@/lib/qci/format";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

const METRICS = [
  {
    value: "6",
    label: "Quantum cloud providers tracked",
    before: "Fragmented rates",
    after: "one normalized index",
    tag: "Coverage",
  },
  {
    value: "24h",
    label: "Refresh cadence for live compute pricing",
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
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(latest.ts));

  return (
    <>
      <SiteHeader />
      <main className="qci-landing">
      <section className="qci-hero">
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
              <span><i /> $/QC-HR · {latest.source === "sample" ? "SAMPLE" : "LIVE"}</span>
              <strong>${formatUsd(latest.vwap)}</strong>
              <em>{formatChangePct(latest.changePct)}</em>
            </div>
          </div>
        </div>
        <p className="qci-asof">Updated {asOf} ET</p>
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
    </>
  );
}
