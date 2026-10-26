import type { Metadata } from "next";
import nextDynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, FileCheck2, GitBranch, ShieldCheck } from "lucide-react";
import LandingNav from "@/components/landing/LandingNav";
import Reveal from "@/components/landing/Reveal";
import LogoMark from "@/components/LogoMark";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";
import "./landing.css";

const HeroConsole = nextDynamic(() => import("@/components/landing/HeroConsole"));
const HeroParticleText = nextDynamic(() => import("@/components/landing/HeroParticleText"));
const DeveloperApiDemo = nextDynamic(() => import("@/components/landing/DeveloperApiDemo"));

export const metadata: Metadata = {
  title: "QRouter — Quantum Experiments You Can Review",
  description: "Plan private quantum experiments, approve an execution budget, and keep circuit inputs, provider runs, and result evidence together.",
  openGraph: {
    title: "QRouter — Quantum Experiments You Can Review",
    description: "A workspace for small technical teams running reproducible, budget-approved quantum experiment campaigns.",
  },
};

const strengths = [
  ["A defined question", "Record what the experiment should demonstrate before choosing a backend."],
  ["An explicit budget", "Review execution estimates and software fees before approving a campaign."],
  ["A traceable run", "Keep source, compilation details, backend decisions, and results connected."],
  ["An honest outcome", "Separate completed execution from evidence that meets your success criterion."],
] as const;

const productRows = [
  {
    id: "plan", eyebrow: "01 / Define", title: "Start with the question you need answered.",
    copy: "Create a private experiment campaign around your circuit. Give the run a purpose, record a success criterion, and set a budget the team can review.",
    action: "Open experiments", href: "/dashboard/experiments", side: "left",
  },
  {
    id: "budget", eyebrow: "02 / Approve", title: "See what the experiment is expected to cost.",
    copy: "Keep the provider execution estimate separate from compilation and platform fees. Review the combined campaign quote before approving execution.",
    action: "Understand the fees", href: "/pricing", side: "right",
  },
  {
    id: "evidence", eyebrow: "03 / Review", title: "Keep the evidence with the experiment.",
    copy: "Inspect normalized results alongside the inputs and execution record. Use an explicit reference and criterion when evaluating success; a finished job alone is not proof that an algorithm worked.",
    action: "Read the workflow", href: "/docs#experiments", side: "left",
  },
] as const;

export default function LandingPage() {
  return (
    <main className="ql-site">
      <LandingNav />
      <header className="ql-hero ql-shell">
        <p className="ql-eyebrow"><span className="ql-blink" aria-hidden="true" /> PRIVATE QUANTUM EXPERIMENTS</p>
        <h1 className="ql-hero-title">From quantum runs <HeroParticleText>to evidence.</HeroParticleText></h1>
        <div className="ql-hero-grid">
          <div className="ql-hero-copy">
            <h2>Give every experiment a question, a budget, and a result your team can review.</h2>
            <p>QRouter brings circuit execution and its evidence into one workspace for small technical teams. Spend less time stitching together provider runs and reports.</p>
            <div className="ql-cta-row">
              <Link href="/dashboard/experiments" className="ql-btn primary">Open experiments <ArrowRight /></Link>
              <Link href="/docs#experiments" className="ql-btn ghost">See the workflow</Link>
            </div>
            <dl className="ql-hero-stats">
              <div><dt>Start with</dt><dd>Your question</dd></div>
              <div><dt>Approve</dt><dd>Your budget</dd></div>
              <div><dt>Review</dt><dd>Your evidence</dd></div>
            </dl>
          </div>
          <Reveal variant="left" className="ql-hero-console"><HeroConsole /></Reveal>
        </div>
      </header>

      <section id="product" className="ql-proof ql-shell" aria-label="Product qualities">
        <Reveal>
          <header className="ql-section-head">
            <p className="ql-kicker">{"// 01 — BUILT FOR TECHNICAL TEAMS"}</p>
            <h2>Make the experiment<br /><span>easier to trust.</span></h2>
            <p className="ql-section-sub">Bring your existing circuits and domain knowledge. QRouter helps organize execution and review across the backends configured for your workspace.</p>
          </header>
        </Reveal>
        <div className="ql-proof-grid">
          {strengths.map(([title, copy], index) => (
            <Reveal key={title} delay={index * 90}><article className="ql-proof-card"><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{copy}</p></article></Reveal>
          ))}
        </div>
      </section>

      <section id="workflow" className="ql-engine ql-shell">
        <Reveal><header className="ql-section-head"><p className="ql-kicker">{"// 02 — A REVIEWABLE WORKFLOW"}</p><h2>A campaign connects<br /><span>the whole decision.</span></h2><p className="ql-section-sub">Capture the intent before running, preserve the execution record, and assess the result against the question you asked.</p></header></Reveal>
        <div className="ql-engine-grid">
          <Reveal variant="right" className="ql-engine-copy">
            <p>Routing and compilation support the experiment. Compatibility checks and cost estimates help you choose an execution path; they do not establish algorithm accuracy or quantum advantage.</p>
            <ul><li><Check /> Private workspace and reusable circuits</li><li><Check /> Explicit estimates and software fees</li><li><Check /> Source, results, and execution context</li></ul>
            <Link href="/docs#experiments" className="ql-inline-link">Explore the experiment workflow <ArrowRight /></Link>
          </Reveal>
          <Reveal variant="left"><ProductVisual id="evidence" /></Reveal>
        </div>
      </section>

      <section className="ql-products ql-shell" aria-label="Experiment workflow">
        {productRows.map((row) => (
          <article className={`ql-product-row ${row.side === "right" ? "reverse" : ""}`} id={row.id} key={row.id}>
            <Reveal variant={row.side === "right" ? "left" : "right"} className="ql-product-copy"><p className="ql-kicker">{row.eyebrow}</p><h2>{row.title}</h2><span>{row.copy}</span><Link href={row.href} className="ql-inline-link">{row.action} <ArrowUpRight /></Link></Reveal>
            <Reveal variant={row.side === "right" ? "right" : "left"}><ProductVisual id={row.id} /></Reveal>
          </article>
        ))}
      </section>
      <DeveloperApiDemo />
      <footer className="ql-footer">
        <div className="ql-shell ql-footer-grid">
          <div className="ql-footer-brand"><LogoMark size={30} /><strong>QROUTER</strong><p>Quantum experiments you can review.</p></div>
          <nav aria-label="Product"><h3>Product</h3><Link href="/dashboard/experiments">Experiments</Link><a href="#workflow">Workflow</a><Link href="/pricing">Pricing</Link></nav>
          <nav aria-label="Developers"><h3>Developers</h3><Link href="/docs">Documentation</Link><a href="/openapi.json">Execution API</a><Link href="/docs#repositories">Repositories</Link></nav>
          <nav aria-label="Company"><h3>Company</h3><Link href="/contact">Contact</Link><Link href="/dashboard/qci">Index research</Link><Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Policy</Link></nav>
          <div className="ql-footer-bottom"><span>{PUBLIC_CONFIG.copyright}</span><nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></nav><span>Backend access depends on the configured execution integrations.</span></div>
        </div>
      </footer>
    </main>
  );
}

function ProductVisual({ id }: { id: string }) {
  const steps = id === "plan"
    ? ["Question: does this circuit preserve the expected correlation?", "Source: bell.qasm · version recorded", "Criterion: compare measurements with the stated reference", "Budget: review before approving execution"]
    : id === "budget"
      ? ["Provider execution · native billing basis", "Compilation fee · circuit gate counts", "Platform fee · explicit in each quote", "Campaign total · reviewed before approval"]
      : ["Experiment intent and success criterion", "Circuit source and compiled artifact", "Backend, quote, and execution history", "Measured counts and assessment context"];
  return (
    <div className="ql-visual"><div className="ql-deploy-window">
      <header>{id === "plan" ? <GitBranch /> : <FileCheck2 />} {id === "budget" ? "QUOTE BREAKDOWN" : "EXPERIMENT RECORD"}<span>ILLUSTRATIVE</span></header>
      {steps.map((step, index) => <div key={step}><span>{String(index + 1).padStart(2, "0")}</span><b>{step}</b><Check /></div>)}
      <footer><ShieldCheck /> {id === "budget" ? "Execution estimates and software fees stay separate" : "A completed run and a successful experiment are different outcomes"}</footer>
    </div></div>
  );
}
