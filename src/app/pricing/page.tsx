import type { Metadata } from "next";
import CompanyLogos from "@/components/CompanyLogos";
import PriceChart from "@/components/PriceChart";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { formatUsd } from "@/lib/qci/format";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — QuantumForge",
  description:
    "How the Quantum Compute Index is calculated, and the providers it's sourced from.",
};

const STEPS = [
  {
    n: "01",
    title: "We read the live rates",
    body: "Every provider's price to run quantum work — per shot or per minute — pulled straight from their cloud.",
  },
  {
    n: "02",
    title: "We score the hardware",
    body: "Each machine earns a quality factor from its qubit count, speed (CLOPS) and error rate. Better hardware counts for more.",
  },
  {
    n: "03",
    title: "We blend them",
    body: "A volume-weighted average price across every machine — weighted by that quality factor, so price and capability both matter.",
  },
  {
    n: "04",
    title: "We anchor it",
    body: "Set to 1,000 at launch, like the S&P 500, and refreshed every day at 9:30 AM ET so the number stays comparable over time.",
  },
];

export default async function PricingPage() {
  const [latest, series] = await Promise.all([getLatestSnapshot(), getSeries(120)]);

  return (
    <main className="qci-subpage relative mx-auto w-full max-w-7xl px-6 sm:px-10">
      <SiteHeader />
      <div className="hairline" />

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
          The Quantum Compute Index answers one question: how expensive and how useful is an hour of
          quantum compute, right now? Here&apos;s how we work it out — in plain terms.
        </p>
      </section>

      {/* steps */}
      <section className="grid gap-5 pb-6 md:grid-cols-2">
        {STEPS.map((s) => (
          <div key={s.n} className="glass glass-hover sheen rounded-2xl p-7">
            <p className="serif text-4xl leading-none text-white/30">{s.n}</p>
            <h3 className="mt-4 text-xl font-medium text-white">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{s.body}</p>
          </div>
        ))}
      </section>

      {/* simplified formula */}
      <section className="py-10">
        <div className="glass-panel rounded-2xl p-7 text-center sm:p-9">
          <p className="mono-label">The index, in one line</p>
          <p className="tabular mt-4 text-lg text-white sm:text-2xl">
            QCI&nbsp;=&nbsp;Σ(price&nbsp;×&nbsp;volume&nbsp;×&nbsp;quality)&nbsp;÷&nbsp;Σ(volume&nbsp;×&nbsp;quality)
          </p>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            A volume-weighted average price across all qualifying machines, scaled by each one&apos;s
            performance quality factor.
          </p>
        </div>
      </section>

      {/* chart */}
      <section className="py-8">
        <div className="glass-panel rounded-3xl p-6 sm:p-8">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="mono-label">$ / QC-hour</p>
              <p className="serif mt-2 text-4xl text-white sm:text-5xl">
                <span className="align-top text-xl text-[var(--muted)] sm:text-2xl">$</span>
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
        <h2 className="text-4xl font-medium tracking-tight text-white sm:text-5xl">Sourced from</h2>
        <p className="mt-3 max-w-xl text-[var(--muted)]">
          The index draws on the providers building the quantum cloud. One key per provider feeds the
          benchmark.
        </p>
        <div className="mt-10">
          <CompanyLogos />
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
