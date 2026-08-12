import type { Metadata } from "next";
import CompanyLogos from "@/components/CompanyLogos";
import QciChart from "@/components/QciChart";
import SiteFooter from "@/components/SiteFooter";
import LandingNav from "@/components/landing/LandingNav";
import { getPublicQci } from "@/lib/qci/v2/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quantum Compute Index and Pricing — QRouter",
  description: "Methodology, data sources, update cadence, and limitations for the Quantum Compute Index.",
};

// These describe QCI 2.0 — the index this page now publishes. They used to
// describe v1: "sample benchmarks", a quality-weighted blend, and a synthetic
// "QC-hour". All three were retired with the engine. Full write-up:
// docs/QCI-METHODOLOGY.md.
const STEPS = [
  {
    n: "01",
    title: "Observe the rate",
    body: "Published hourly reservation rates, read from the sellers' own live rate cards. A machine with no published hourly rate does not enter the headline index — per-shot prices are never converted, because that conversion needs an assumption.",
  },
  {
    n: "02",
    title: "Deflate by capability",
    body: "Each rate is divided by what the hardware can actually do, from the two numbers every vendor publishes: qubit count and median two-qubit error. Price is deflated by quality, not weighted by it, so a machine getting better reads as a price fall.",
  },
  {
    n: "03",
    title: "Chain-link the move",
    body: "Only machines observed on both days are compared, and the index moves on their shared move. Adding or dropping a provider changes the basket without moving the level — a composition change is not a price change.",
  },
];

export default async function PricingPage() {
  // Same source as the landing page and the console. This page used to read
  // v1, which published a different figure under the same words.
  const qci = await getPublicQci(365);
  const money = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <>
      <LandingNav />
      <main className="qci-subpage qci-light relative mx-auto w-full max-w-7xl px-6 sm:px-10">
      {/* hero */}
      <section className="qci-subpage-hero py-16 sm:py-20">
        <p className="mono-label flex items-center gap-2 text-white/70">
          <span className="inline-block h-1.5 w-1.5 bg-white" />
          Pricing
        </p>
        <h1 className="qci-subpage-title mt-5 max-w-4xl text-white">
          How the index is priced
        </h1>
        <p className="qci-subpage-lede mt-6 max-w-xl">
          The Quantum Compute Index is an indicative view of normalized quantum-compute pricing across its configured data basket.
        </p>
      </section>

      {/* steps — a left-to-right flow: rates → score → blend */}
      <section className="pb-6">
        <div className="grid items-stretch gap-4 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.n} className="relative glass glass-hover sheen rounded-2xl p-7">
              <p className="tabular text-3xl leading-none text-emerald-300/70">{s.n}</p>
              <h3 className="mt-4 text-xl font-medium text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute right-[-1.15rem] top-1/2 z-10 hidden -translate-y-1/2 text-lg text-[var(--muted)] md:block"
                >
                  →
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* simplified formula */}
      <section className="py-10" id="methodology">
        <div className="glass-panel rounded-2xl p-7 text-center sm:p-9">
          <p className="mono-label">The index, in one line</p>
          <p className="tabular mx-auto mt-4 max-w-full text-lg leading-relaxed text-white sm:text-2xl">
            ln(I<sub>t</sub> / I<sub>t−1</sub>) = Σ w̄<sub>d</sub> · ln(π<sub>d,t</sub> / π
            <sub>d,t−1</sub>)
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            A matched-sample Törnqvist chain index over quality-deflated hourly rates. The sum runs
            only over machines observed on both days. This is not an audited transaction benchmark.
          </p>
          <div className="mx-auto mt-8 grid max-w-4xl gap-4 text-left sm:grid-cols-2">
            <div className="border-t border-white/10 pt-4"><p className="mono-label">What it represents</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">What an hour of quantum computing costs across every machine on the market with a published hourly rate — one QPU-hour being one hour of exclusive access to one processor.</p></div>
            <div className="border-t border-white/10 pt-4"><p className="mono-label">Data sources</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">The sellers&rsquo; own published rate cards and the operators&rsquo; own calibration data. Every figure carries the tier it came from; nothing is ever simulated to fill a gap.</p></div>
            <div className="border-t border-white/10 pt-4"><p className="mono-label">Update cadence</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">One point per day. A day with thin coverage is published as provisional and marked as such on the chart rather than quietly smoothed.</p></div>
            <div className="border-t border-white/10 pt-4"><p className="mono-label">Limitations</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Per-shot pricing is deliberately not converted into an hourly rate, so machines sold only per shot are outside the headline. Published list rates are not negotiated prices.</p></div>
          </div>
        </div>
      </section>

      {/* chart — the same component, on the same series, as the console tab */}
      <section className="py-8">
        <div className="glass-panel rounded-3xl p-6 sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="mono-label">$ / QPU-hour</p>
              <p className="tabular mt-2 text-4xl text-white sm:text-5xl">
                <span className="align-top text-xl text-[var(--accent)] sm:text-2xl">$</span>
                {qci.hasData ? money(qci.usdPerQpuHour) : "—"}
              </p>
            </div>
            <span className="mono-label rounded-full border border-white/15 bg-white/5 px-3 py-1">
              {qci.hasData ? "published" : "awaiting data"}
            </span>
          </div>
          {qci.hasData && qci.series.length > 0 ? (
            <div className="pricing-chart w-full">
              {/* prefix/decimals rather than a `format` callback: this is a
                  Server Component, and a function cannot be handed to a Client
                  Component across that boundary. */}
              <QciChart
                points={qci.series}
                height={320}
                prefix="$"
                ariaLabel="Quantum Compute Index history"
              />
            </div>
          ) : (
            <p className="mono-label normal-case tracking-normal text-[var(--muted-dim)]">
              {qci.emptyReason ??
                "No index point has been published yet. Nothing is drawn until one is — this page never shows a modelled or sample line."}
            </p>
          )}
          <p className="mono-label mt-6 normal-case tracking-normal text-[var(--muted-dim)]">
            {qci.hasData
              ? `Measured across ${qci.machines} machines from ${qci.providers} providers. One point per day, drawn only from what was measured.`
              : ""}
          </p>
        </div>
      </section>

      {/* providers */}
      <section className="py-16">
        <h2 className="text-4xl font-medium tracking-tight text-white sm:text-5xl">Provider inputs</h2>
        <p className="mt-3 max-w-xl text-[var(--muted)]">
          Priced from the sellers&rsquo; own published rate cards and the operators&rsquo; own
          calibration data. Nothing is charted that was not measured.
        </p>
        <div className="mt-10">
          <CompanyLogos />
        </div>
      </section>

      <SiteFooter />
      </main>
    </>
  );
}
