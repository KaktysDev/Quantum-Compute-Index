import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import TechnicalSite from "@/components/landing/TechnicalSite";
import TechnicalModel from "@/components/landing/TechnicalModel";
import SupporterNetwork from "@/components/landing/SupporterNetwork";

export const metadata: Metadata = {
  title: "QRouter — Quantum, Where It Fits",
  description: "Explore quantum methods for your business software. Compare against classical computing and keep the evidence behind the decision.",
  openGraph: { title: "QRouter — Quantum, Where It Fits", description: "Business workloads, classical baselines and evidence you can review." },
};

const SECTORS = [
  { id: "manufacturing", name: "Manufacturing", detail: "Routing and scheduling", alt: "Illustrative industrial robot in a manufacturing facility" },
  { id: "networks", name: "Networks", detail: "Planning and allocation", alt: "Illustrative telecommunications tower overlooking mountains at sunset" },
  { id: "energy", name: "Energy", detail: "Planning and prediction", alt: "Illustrative wind turbines along a mountain ridge at sunset" },
];

export default function LandingPage() {
  return (
    <TechnicalSite>
      <main id="main-content">
        <section className="qt-hero qt-shell" aria-labelledby="hero-title">
          <div className="qt-hero-heading">
            <p className="qt-eyebrow"><span /> Research preview</p>
            <h1 id="hero-title" className="qt-display"><span>Quantum,</span><span>where it fits.</span></h1>
          </div>
          <div className="qt-hero-copy">
            <p>Explore quantum methods for your business software.</p>
            <div className="qt-actions"><a className="qt-button qt-button-orange" href="#workflow">See the workflow <ArrowRight size={17} /></a><Link className="qt-text-link" href="/research">View research <ArrowUpRight size={15} /></Link></div>
            <a className="qt-scroll-cue" href="#product">Built around your workload <ArrowDown size={14} /></a>
          </div>
        </section>

        <TechnicalModel />

        <section className="qt-industry" id="product" aria-labelledby="sector-title">
          <div className="qt-industry-heading qt-shell"><h2 id="sector-title">Real problems. Clearer decisions.</h2></div>
          <div className="qt-industry-strip">
            {SECTORS.map((sector) => <Link key={sector.id} href={"/research#" + sector.id} className={"qt-sector qt-sector-" + sector.id}>
              <Image src={"/landing/" + sector.id + ".webp"} alt={sector.alt} fill sizes="(max-width: 560px) 100vw, 33.33vw" />
              <div className="qt-sector-caption"><strong>{sector.name}</strong><ArrowRight size={20} /></div>
            </Link>)}
          </div>
        </section>

        <section className="qt-workflow qt-shell qt-workflow-editorial" id="workflow" aria-labelledby="workflow-title">
          <div className="qt-workflow-visual"><Image src="/landing/hero-model.webp" alt="Abstract connected model on an orange surface" fill sizes="(max-width: 800px) 100vw, 40vw" /><span aria-hidden="true">↗</span></div>
          <div className="qt-workflow-story"><p className="qt-eyebrow">Built around your software</p><h2 className="qt-display" id="workflow-title">One hard problem.<br />A clearer way forward.</h2>
            <dl><div><dt>Bring the bottleneck</dt><dd>Choose a calculation that costs your team time or money.</dd></div><div><dt>Challenge the usual approach</dt><dd>Explore quantum candidates against a strong classical alternative.</dd></div><div><dt>Know what comes next</dt><dd>Use the results to decide whether further integration is worth pursuing.</dd></div></dl>
            <Link href="/contact" className="qt-button qt-button-dark">Discuss your workload <ArrowUpRight size={16} /></Link>
          </div>
        </section>

        <section className="qt-evidence qt-shell" aria-labelledby="evidence-title">
          <div className="qt-evidence-copy"><p className="qt-eyebrow">The standard</p><h2 className="qt-display" id="evidence-title">Evidence.<br />Before integration.</h2><p>A finished calculation is only the start. Every candidate needs an independent check.</p><Link href="/research" className="qt-text-link">Inside our research <ArrowUpRight size={16} /></Link></div>
          <div className="qt-evidence-record" aria-label="Assessment record structure, illustrative">
            <header><span className="qt-status-dot" /> Assessment record <small>Illustrative</small></header>
            {[["Input", "A pinned workload"], ["Reference", "A classical baseline"], ["Decision", "Verified, failed or inconclusive"], ["Record", "The evidence behind the result"]].map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}
            <footer>A useful answer can be “stay classical.”</footer>
          </div>
        </section>

        <SupporterNetwork />

        <section className="qt-final-cta qt-shell"><p className="qt-eyebrow">Your next question</p><h2 className="qt-display">Where could quantum<br />fit in your software?</h2><div><p>Bring a workload.<br />Let’s find out together.</p><Link className="qt-button qt-button-dark" href="/contact">Talk to QRouter <ArrowUpRight size={19} /></Link></div></section>
      </main>
    </TechnicalSite>
  );
}
