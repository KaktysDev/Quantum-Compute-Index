import type { Metadata } from "next";
import CompanyLogos from "@/components/CompanyLogos";
import PriceChart from "@/components/PriceChart";
import SiteFooter from "@/components/SiteFooter";
import LandingNav from "@/components/landing/LandingNav";
import { formatUsd } from "@/lib/qci/format";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quantum Compute Index and Pricing — QRouter",
  description: "Methodology, data sources, update cadence, and limitations for the Quantum Compute Index.",
};

const STEPS = [
  {
    n: "01",
    title: "Rate inputs",
    body: "Configured provider adapters collect published or authenticated rate inputs. Sample benchmarks are shown when live snapshots are unavailable.",
  },
  {
    n: "02",
    title: "Scoring the hardware",
    body: "The model can apply a documented quality adjustment using supported capacity, throughput, and fidelity inputs.",
  },
  {
    n: "03",
    title: "Blending",
    body: "Qualifying inputs are normalized to a QC-hour and blended into an indicative index snapshot.",
  },
];

export default async function PricingPage() {
  const [latest, series] = await Promise.all([getLatestSnapshot(), getSeries(120)]);

  return (
    <>
      <LandingNav />
      <main className="qci-subpage relative mx-auto w-full max-w-7xl px-6 sm:px-10">
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
            QCI = Σ(price × volume × quality) ÷ Σ(volume × quality)
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            A modeled average across qualifying inputs, normalized to a QC-hour and adjusted by supported quality factors. This is not an audited transaction benchmark.
          </p>
          <div className="mx-auto mt-8 grid max-w-4xl gap-4 text-left sm:grid-cols-2">
            <div className="border-t border-white/10 pt-4"><p className="mono-label">What it represents</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">An indicative normalized cost of quantum compute across the current index basket.</p></div>
            <div className="border-t border-white/10 pt-4"><p className="mono-label">Data sources</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Configured provider adapters and documented seed benchmarks when authenticated data is unavailable.</p></div>
            <div className="border-t border-white/10 pt-4"><p className="mono-label">Update cadence</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Snapshots are scheduled daily. The interface labels whether the current value is live or sample data.</p></div>
            <div className="border-t border-white/10 pt-4"><p className="mono-label">Limitations</p><p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">Inputs may be estimated, carried forward, or normalized from different billing units. Values are not audited market transactions.</p></div>
          </div>
        </div>
      </section>

      {/* chart */}
      <section className="py-8">
        <div className="glass-panel rounded-3xl p-6 sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="mono-label">$ / QC-hour</p>
              <p className="tabular mt-2 text-4xl text-white sm:text-5xl">
                <span className="align-top text-xl text-[var(--accent)] sm:text-2xl">$</span>
                {formatUsd(latest.vwap)}
              </p>
            </div>
            <span className="mono-label rounded-full border border-white/15 bg-white/5 px-3 py-1">
              {latest.source === "sample" ? "sample data" : "live"}
            </span>
          </div>
          <div className="h-[320px] w-full sm:h-[400px]">
            <PriceChart data={series} pollMs={60000} />
          </div>
          <p className="mono-label mt-4 normal-case tracking-normal text-[var(--muted-dim)]">
            {latest.source === "sample"
              ? "Showing sample data. The chart switches to live values automatically once provider API keys are added in the dashboard."
              : ""}
          </p>
        </div>
      </section>

      {/* providers */}
      <section className="py-16">
        <h2 className="text-4xl font-medium tracking-tight text-white sm:text-5xl">{latest.source === "sample" ? "Sample basket" : "Provider inputs"}</h2>
        <p className="mt-3 max-w-xl text-[var(--muted)]">
          {latest.source === "sample" ? "The current display uses deterministic benchmark data until authenticated provider snapshots are available." : "The current snapshot uses configured provider data sources."}
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
