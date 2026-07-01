import Link from "next/link";
import AnimatedTitle from "@/components/AnimatedTitle";
import BarsGraphic from "@/components/BarsGraphic";
import PriceDisplay from "@/components/PriceDisplay";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

const FEATURES = [
  {
    title: "Comparable by design",
    body: "One normalized price across providers, architectures, and billing models.",
  },
  {
    title: "Performance adjusted",
    body: "Weighted by throughput, fidelity, and usable quantum volume.",
  },
  {
    title: "Provider sourced",
    body: "Direct market inputs with a transparent, repeatable methodology.",
  },
];

export default async function LandingPage() {
  const latest = await getLatestSnapshot();

  const asOf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(latest.ts))
    .toUpperCase();

  return (
    <main className="relative mx-auto w-full max-w-7xl px-6 sm:px-10">
      <SiteHeader />
      <div className="hairline" />

      <section className="grid min-h-[76vh] items-center gap-14 py-16 lg:grid-cols-[1.2fr_0.8fr] lg:py-24">
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <p className="mono-label text-white/65">QCI benchmark · Daily at 9:30 AM ET</p>
          </div>

          <AnimatedTitle />

          <div className="flex flex-col gap-7">
            <p className="max-w-xl text-lg leading-relaxed text-[var(--muted)] sm:text-xl">
              A performance-adjusted benchmark for the cost of quantum computing—built for teams
              making infrastructure, investment, and procurement decisions.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/contact" className="btn btn-solid">
                Request access
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 text-sm font-medium text-white/75 transition-colors hover:text-white"
              >
                View methodology <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>

        <div className="flex justify-center lg:justify-end">
          <div className="glass-panel w-full max-w-md rounded-[1.4rem] p-7 sm:p-9">
            <div className="mb-6 flex items-center justify-between">
              <span className="mono-label">Market overview</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                {latest.source === "sample" ? "Sample" : "Live"}
              </span>
            </div>
            <PriceDisplay
              price={latest.price}
              changePct={latest.changePct}
              source={latest.source}
              asOf={asOf}
              size="panel"
            />
          </div>
        </div>
      </section>

      <div className="hairline" />

      <section id="about" className="scroll-mt-10 py-20 sm:py-28">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="mono-label mb-4">A market standard</p>
            <h2 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] text-white sm:text-5xl">
              A credible reference point for quantum compute.
            </h2>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-[var(--muted)]">
            QCI turns fragmented provider pricing into a consistent benchmark that can be tracked
            over time.
          </p>
        </div>

        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {FEATURES.map((f, index) => (
            <div
              key={f.title}
              className="glass glass-hover flex min-h-48 flex-col justify-between rounded-2xl p-6"
            >
              <div className="flex items-center justify-between">
                <span className="tabular text-xs text-[var(--muted-dim)]">0{index + 1}</span>
                <div className="h-8 w-12 opacity-50">
                  <BarsGraphic />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-medium text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-24">
        <div className="glass-panel flex flex-col items-start justify-between gap-8 rounded-[1.4rem] px-7 py-10 sm:flex-row sm:items-center sm:px-10 sm:py-12">
          <div>
            <p className="mono-label mb-3">Private preview</p>
            <h2 className="max-w-2xl text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">
              Bring a market view to quantum infrastructure.
            </h2>
          </div>
          <Link href="/contact" className="btn btn-solid shrink-0">
            Request access
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
