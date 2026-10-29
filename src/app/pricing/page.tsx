import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import TechnicalSite from "@/components/landing/TechnicalSite";

export const metadata: Metadata = {
  title: "Value — QRouter",
  description: "Published quantum-enabled planning examples, and a clearer way to evaluate the value for your business.",
};

export default function PricingPage() {
  return <TechnicalSite><main id="main-content" className="qt-value-page">
    <header className="qt-value-hero qt-shell"><h1 className="qt-display">What could<br />quantum save?</h1><div><p>Published examples show what’s possible. Your savings need a comparison on your own workload.</p><Link className="qt-text-link" href="/contact">Explore your workload <ArrowUpRight size={17} /></Link></div></header>
    <section className="qt-value-results qt-shell" aria-label="Published results from other organizations">
      <article className="qt-value-result qt-value-time"><div className="qt-value-visual"><Image src="/landing/hero-model.webp" alt="" fill priority sizes="(max-width: 800px) 100vw, 50vw" /><span className="qt-value-percent">12.1<span>%</span></span></div><div className="qt-value-result-copy"><p className="qt-eyebrow">Port of Los Angeles · SavantX</p><h2>Shorter truck visits.</h2><p>Visits fell from 66 to 58 minutes after the whole planning-system rollout; quantum’s separate contribution wasn’t measured.</p><a className="qt-text-link" href="https://www.dwavesys.com/media/y3hl22va/dwave_port_of_la_case_story_v7.pdf" target="_blank" rel="noopener noreferrer">Read the reported result <ArrowUpRight size={15} /></a></div></article>
      <article className="qt-value-result qt-value-quality"><div className="qt-value-visual"><Image src="/landing/energy.webp" alt="Illustrative wind turbines in a mountain landscape" fill priority sizes="(max-width: 800px) 100vw, 50vw" /><span className="qt-value-percent">43.8<span>%</span></span></div><div className="qt-value-result-copy"><p className="qt-eyebrow">Grid planning · Quantum Quants & TNO</p><h2>Lower planning cost score.</h2><p>Quantum-hybrid beat the best of four classical comparators in one nine-partition test with equal solver time limits; this is not a cash-saving percentage.</p><a className="qt-text-link" href="https://arxiv.org/pdf/2212.01625#page=10" target="_blank" rel="noopener noreferrer">Read the comparison <ArrowUpRight size={15} /></a></div></article>
    </section>
    <section className="qt-value-bottom qt-shell"><div><p className="qt-eyebrow">Your bottom line</p><h2 className="qt-display">Find the value<br />in your software.</h2></div><div><p>A reliable average money-saving percentage isn’t established yet. We start with your workload and test the case for quantum.</p><Link className="qt-button qt-button-orange" href="/contact">Talk to QRouter <ArrowUpRight size={17} /></Link></div></section>
  </main></TechnicalSite>;
}
