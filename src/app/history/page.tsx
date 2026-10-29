import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import TechnicalSite from "@/components/landing/TechnicalSite";

export const metadata: Metadata = { title: "Quantum Computing: A Short History — QRouter", description: "The ideas, algorithms and workflows behind quantum computing." };
const MOMENTS = [
  { era: "1982", title: "A different way to simulate nature.", copy: "Richard Feynman explored computing with quantum systems. The idea connected the physics of the machine to the physics of the problem.", image: "feynman.png", alt: "Richard Feynman", source: "https://quantum.cloud.ibm.com/learning/en/courses/quantum-computing-in-practice/introduction", label: "The original idea" },
  { era: "1994", title: "An algorithmic opening.", copy: "Shor’s algorithm showed how a quantum computer could factor integers efficiently. It combines a quantum subroutine with classical processing.", image: "google.png", alt: "Quantum computing hardware illustration", source: "https://quantum.cloud.ibm.com/docs/en/tutorials/shors-algorithm", label: "Shor’s algorithm" },
  { era: "Today", title: "Hybrid workflows.", copy: "Quantum experiments can combine classical software, simulators and hardware. Access is a starting point for testing useful applications.", image: "currentquantum.jpg", alt: "Quantum computing laboratory hardware", source: "https://aws.amazon.com/braket/", label: "Hybrid computing" },
];
export default function HistoryPage() {
  return <TechnicalSite><main id="main-content">
    <header className="qt-page-hero qt-shell"><p className="qt-eyebrow">A short history</p><h1 className="qt-display">Ideas.<br />Algorithms. Applications.</h1><p>Quantum computing grew from a question about nature. Useful software needs questions of its own.</p></header>
    <div className="qt-shell">{MOMENTS.map(moment => <article className="qt-history-row" key={moment.era}><span className="qt-step-number">{moment.era}</span><div><h2>{moment.title}</h2><p>{moment.copy}</p><a className="qt-text-link" href={moment.source} target="_blank" rel="noopener noreferrer">{moment.label} <ArrowUpRight size={15} /></a></div><div className="qt-history-image"><Image src={"/history/" + moment.image} alt={moment.alt} fill sizes="(max-width: 480px) 100vw, 45vw" /></div></article>)}</div>
    <section className="qt-final-cta qt-shell"><p className="qt-eyebrow">The work ahead</p><h2 className="qt-display">Potential needs<br />a fair test.</h2><div><p>See what our public research establishes.</p><Link href="/research" className="qt-button qt-button-dark">Explore the research <ArrowUpRight size={16} /></Link></div></section>
  </main></TechnicalSite>;
}
