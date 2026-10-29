import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import TechnicalSite from "@/components/landing/TechnicalSite";

export const metadata: Metadata = { title: "Business applications — QRouter", description: "Published quantum-enabled results in production scheduling, mobile networks and power-grid planning." };

const CASES = [
  {
    id: "manufacturing", industry: "Manufacturing", company: "Ford Otosan · D-Wave", title: "Production plans.\nIn minutes.",
    goal: "Rebuild vehicle production schedules when parts or priorities change.",
    value: "~65–80%", metric: "less scheduling time", comparison: "Conservatively rounded from ~67% and >83% in two reports",
    finding: "The published comparisons use different baselines and schedule quality. These are hybrid-system results, not an isolated quantum speedup.",
    source: "https://www.dwavesys.com/media/5v4axazz/production-scheduling-data-sheet.pdf",
    cost: "Ford reports comparable cost to its proprietary classical approach.",
    costSource: "https://quantumapplicationhub.ford.com.tr/presentation.html",
  },
  {
    id: "networks", industry: "Networks", company: "NTT DOCOMO", title: "Less signalling.\nMore room for data.",
    goal: "Reduce the background traffic used to locate phones and deliver calls.",
    value: "7–15%", metric: "fewer paging signals at peak", comparison: "Reported across two DOCOMO implementations",
    finding: "DOCOMO reports 7% in its later rollout and 15% in an earlier pilot. These measure reduced signalling, not faster calculation or computing-cost savings.",
    source: "https://www.docomo.ne.jp/english/corporate/technology/rd/service/022/",
    cost: "Read the earlier 15% pilot result.", costSource: "https://www.dwavequantum.com/company/newsroom/press-release/ntt-docomo-and-d-wave-improve-mobile-network-performance-by-15-with-quantum-optimization-technology/",
  },
  {
    id: "energy", industry: "Energy", company: "Quantum Quants · TNO", title: "A better plan\nfor the power grid.",
    goal: "Find better ways to group areas of a power network.",
    value: "1–7%", metric: "lower grid-planning cost score", comparison: "Rounded down from ~1.4–7.5% in the 2–5-partition tests",
    finding: "These lower-end results compare hybrid with the best of four tested classical methods under equal solver time limits. They measure plan quality, not money saved or faster calculation.",
    source: "https://arxiv.org/pdf/2212.01625#page=10",
    cost: null, costSource: null,
  },
];

export default function ResearchPage() {
  return <TechnicalSite><main id="main-content">
    <header className="qt-research-intro qt-page-hero qt-shell"><div><p className="qt-eyebrow">Business applications</p><h1 className="qt-display">Real examples.<br />Specific results.</h1></div><div><p>Published quantum-enabled case studies from other organizations. Results depend on the workload and comparison.</p><Link className="qt-text-link" href="/contact">Explore your use case <ArrowUpRight size={15} /></Link></div></header>
    <div className="qt-shell">
      {CASES.map(item => <article className="qt-research-case" id={item.id} key={item.id}>
        <div className="qt-research-photo"><Image src={"/landing/" + item.id + ".webp"} alt={"Illustrative " + item.industry.toLowerCase() + " scene"} fill sizes="(max-width: 800px) 100vw, 50vw" /></div>
        <div className="qt-research-body qt-business-case"><p className="qt-eyebrow">{item.industry} · {item.company}</p><h2 className="qt-display">{item.title}</h2><p className="qt-case-goal">{item.goal}</p>
          <div className="qt-published-result"><strong className="qt-display">{item.value}</strong><h3>{item.metric}</h3><p>{item.comparison}</p></div>
          <p>{item.finding}</p>
          <a className="qt-text-link" href={item.source} target="_blank" rel="noopener noreferrer">Read the source <ArrowUpRight size={15} /></a>
          {item.cost && item.costSource && <p className="qt-case-cost"><a href={item.costSource} target="_blank" rel="noopener noreferrer">{item.cost}</a></p>}
        </div>
      </article>)}
      <section className="qt-research-answer"><h2>What could your business save?</h2><div><p>These are individual published results, not industry averages or QRouter customer outcomes. Your time and cost savings need a comparison on your own workload.</p><a className="qt-text-link" href="/research/evidence-summary.json" download>QRouter’s own test results <ArrowUpRight size={15} /></a></div></section>
    </div>
    <section className="qt-final-cta qt-shell"><h2 className="qt-display">Bring us your<br />bottleneck.</h2><div><p>Let’s explore whether quantum belongs in the solution.</p><Link href="/contact" className="qt-button qt-button-dark">Talk to us <ArrowUpRight size={17} /></Link></div></section>
  </main></TechnicalSite>;
}
