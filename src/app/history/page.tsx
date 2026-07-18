import type { Metadata } from "next";
import SiteFooter from "@/components/SiteFooter";
import LandingNav from "@/components/landing/LandingNav";
import Timeline, { type TimelinePoint } from "@/components/Timeline";

export const metadata: Metadata = {
  title: "History — QRouter",
  description:
    "How quantum computing began, where it stands today, and where it's headed — and why it needs a financial layer.",
};

const POINTS: TimelinePoint[] = [
  {
    era: "1980 — 1994 · The idea",
    title: "A new kind of machine",
    body: "Richard Feynman argued that to simulate nature you need a computer that obeys quantum mechanics. A decade later, Shor's algorithm showed such a machine could break problems classical computers never could — turning a thought experiment into a race.",
    media: { kind: "image", src: "/history/feynman.png", alt: "Richard Feynman" },
  },
  {
    era: "2019 · Proof it works",
    title: "Beyond classical",
    body: "Google ran a computation on a 53-qubit processor that the fastest supercomputers couldn't practically match. The NISQ era began: real quantum hardware, noisy but useful, available to researchers worldwide.",
    media: { kind: "image", src: "/history/google.png", alt: "Google's quantum processor" },
  },
  {
    era: "2025 — Today · The market forms",
    title: "Compute you can rent",
    body: "Quantum-cloud providers offer access to different machines using different billing units and capability measures. Comparing those offers remains difficult because pricing and hardware characteristics are not standardized.",
    media: { kind: "image", src: "/history/currentquantum.jpg", alt: "Quantum computing today" },
  },
  {
    era: "2027 — 2035 · The future",
    title: "The compute of the future",
    body: "As fault-tolerant machines arrive, quantum advantage reaches drug discovery, materials, cryptography and risk modeling — and the first quantum-internet links begin connecting these machines into a secure, distributed network. Compute becomes a tradable commodity, and the world needs an index to price it. That's what we're building.",
    media: { kind: "image", src: "/history/quantumfuture.jpeg", alt: "The future of quantum computing" },
  },
];

export default function HistoryPage() {
  return (
    <>
      <LandingNav />
      <main className="qci-subpage relative mx-auto w-full max-w-7xl px-6 sm:px-10">
      {/* hero */}
      <section className="qci-subpage-hero py-16 sm:py-20">
        <p className="mono-label flex items-center gap-2 text-white/70">
          <span className="inline-block h-1.5 w-1.5 bg-white" />
          History
        </p>
        <h1 className="qci-subpage-title mt-5 max-w-4xl text-white">
          The road to the compute of the future
        </h1>
        <p className="qci-subpage-lede mt-6 max-w-xl">
          Four decades from a physicist&apos;s thought experiment to a market in the making.
        </p>
      </section>

      <div className="hairline" />

      {/* timeline */}
      <section className="py-12 sm:py-16">
        <Timeline points={POINTS} />
      </section>

      <div className="hairline" />

      {/* closing */}
      <section className="py-24 text-center">
        <h2 className="mx-auto max-w-3xl text-4xl font-medium tracking-[-0.035em] text-white sm:text-6xl">
          A technology this important deserves a market.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[var(--muted)]">
          Quantum compute will reshape medicine, materials, finance and security. We give it the
          financial layer to grow.
        </p>
      </section>

      <SiteFooter />
      </main>
    </>
  );
}
