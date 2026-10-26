import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import SiteFooter from "@/components/SiteFooter";
import LandingNav from "@/components/landing/LandingNav";
import "../landing.css";

export const metadata: Metadata = {
  title: "Execution Pricing — QRouter",
  description: "Understand QRouter's provider execution estimates, compilation fees, platform fees, and experiment campaign budgets.",
};

const PARTS = [
  { n: "01", title: "Provider execution", formula: "The selected backend’s execution reservation", body: "Estimated from a dated native rate for the selected provider channel, multiplied by the allowed attempt budget. Unknown or expired rates block paid routing." },
  { n: "02", title: "Compilation fee", formula: "$0.01 + $0.00002 × gates + $0.00008 × two-qubit gates", body: "Calculated from the compiled circuit. Two-qubit gates also count toward the total gate count. This software fee is shown separately from provider execution." },
  { n: "03", title: "Platform fee", formula: "The greater of $0.005 or 8% of the provider reservation", body: "Charged per execution for the platform workflow. The exact amount appears in the quote alongside the compilation fee and provider estimate." },
];

export default function PricingPage() {
  return (
    <>
      <LandingNav />
      <main className="qci-subpage qci-light relative mx-auto w-full max-w-7xl px-6 sm:px-10">
        <section className="qci-subpage-hero py-16 sm:py-20">
          <p className="mono-label flex items-center gap-2"><span className="inline-block h-1.5 w-1.5 bg-current" /> EXECUTION PRICING</p>
          <h1 className="qci-subpage-title mt-5 max-w-4xl">Know what you are approving.</h1>
          <p className="qci-subpage-lede mt-6 max-w-2xl">Each execution quote separates the provider estimate from QRouter’s software fees. Review the combined amount before approving an experiment campaign.</p>
          <div className="mt-8 flex flex-wrap gap-5"><Link href="/dashboard/experiments" className="inline-flex items-center gap-2 text-sm font-medium">Open experiments <ArrowRight size={16} /></Link><Link href="/docs#pricing" className="text-sm underline underline-offset-4">Read the quote contract</Link></div>
        </section>

        <section id="fees" className="pb-16" aria-label="Quote components">
          <div className="grid items-stretch gap-4 md:grid-cols-3">
            {PARTS.map((part) => <article key={part.n} className="glass rounded-2xl p-7"><p className="tabular text-3xl leading-none text-emerald-700">{part.n}</p><h2 className="mt-4 text-xl font-medium">{part.title}</h2><p className="mt-4 font-mono text-sm leading-relaxed">{part.formula}</p><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">{part.body}</p></article>)}
          </div>
          <div className="glass mt-5 rounded-2xl p-7"><p className="mono-label">TOTAL QUOTE</p><p className="mt-4 text-xl font-medium sm:text-2xl">Provider reservation + compilation fee + platform fee</p><p className="mt-3 max-w-3xl text-sm leading-relaxed text-[var(--muted)]">A campaign combines the quotes for its executions. Adding targets, repetitions, or permitted retry attempts increases the reservation. Review the full campaign total and set a budget that includes both.</p></div>
        </section>

        <section className="grid gap-10 border-t border-black/10 py-14 md:grid-cols-2" id="budget">
          <div><h2 className="text-2xl font-medium tracking-tight">Estimates have a scope.</h2><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">A quote records its backend, rate basis, shot count, and expiry. Provider execution time and reported costs may differ from estimates. Inspect the execution record for the cost information actually available; an estimated amount is not an invoice.</p><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">Quotes expire after 15 minutes. Credits are reserved before submission. Cancellation and credit settlement follow the <Link href="/terms#credits" className="underline underline-offset-4">credit and quote terms</Link>.</p></div>
          <div><h2 className="text-2xl font-medium tracking-tight">Start with the workflow you need.</h2><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">The current product uses per-execution quotes and prepaid credits. We do not publish subscription tiers or a separate campaign-service price. <Link href="/contact" className="underline underline-offset-4">Contact us</Link> to discuss your experiment workflow and access requirements.</p><p className="mt-4 text-sm leading-relaxed text-[var(--muted)]">The Quantum Compute Index is a separate research view. Its modelled aggregate does not determine your experiment’s software fees or establish which backend will meet your success criterion.</p><Link href="/dashboard/qci" className="mt-5 inline-flex items-center gap-2 text-sm underline underline-offset-4">View index research <ArrowRight size={14} /></Link></div>
        </section>
        <SiteFooter />
      </main>
    </>
  );
}
