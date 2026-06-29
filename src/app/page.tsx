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
    title: "Performance-adjusted",
    body: "Weighted by Quantum Volume, speed, and gate fidelity.",
  },
  {
    title: "Provider-sourced",
    body: "IBM, IonQ, Rigetti, IQM and more — one benchmark.",
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

      {/* ── Hero — big bright title left, glass price card center-right ──── */}
      <section className="grid min-h-[80vh] items-center gap-12 py-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-7">
          <p className="mono-label flex items-center gap-2 text-white/70">
            <span className="inline-block h-1.5 w-1.5 bg-white" />
            QCI — Quantum Compute Index
          </p>

          <AnimatedTitle />

          <div className="flex flex-col gap-5">
            <p className="max-w-md text-2xl font-light leading-snug text-white/90 sm:text-3xl">
              The financial layer for quantum compute.
            </p>
            <div className="flex items-center gap-4">
              <Link href="/contact" className="btn btn-solid sheen">
                Request access
              </Link>
              <span className="mono-label">EST. 2026 · Invite only</span>
            </div>
          </div>
        </div>

        {/* glass price panel */}
        <div className="flex justify-center lg:justify-end">
          <div className="glass-panel sheen w-full max-w-md rounded-3xl p-7 sm:p-9">
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

      {/* ── Section — headline + two glass feature cards ────────────────── */}
      <section id="about" className="scroll-mt-10 py-24">
        <h2 className="max-w-2xl text-5xl font-medium leading-[1.05] tracking-tight text-white sm:text-6xl">
          Sourced. Adjusted. Benchmarked.
        </h2>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="glass glass-hover sheen flex items-center justify-between gap-6 rounded-2xl p-7"
            >
              <div>
                <h3 className="text-xl font-medium text-white">{f.title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-relaxed text-[var(--muted)]">
                  {f.body}
                </p>
              </div>
              <div className="h-20 w-24 shrink-0 opacity-80">
                <BarsGraphic />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Closing CTA — glass panel ───────────────────────────────────── */}
      <section className="pb-24">
        <div className="glass-panel sheen flex flex-col items-center justify-center gap-7 rounded-3xl px-8 py-24 text-center">
          <h2 className="text-glow-strong max-w-3xl text-5xl font-medium tracking-tight text-white sm:text-7xl">
            The market behind quantum compute
          </h2>
          <Link href="/contact" className="btn btn-solid sheen">
            Request access
          </Link>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
