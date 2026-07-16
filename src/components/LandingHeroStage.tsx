"use client";

import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Menu, Play, X } from "lucide-react";
import { useState } from "react";
import { PUBLIC_CONFIG } from "@/lib/publicConfig";
import LogoMark from "@/components/LogoMark";
import SignalBars from "@/components/SignalBars";

const stages = [
  { name: "Analyze", label: "Circuit requirements", prompt: "Inspect a 6-qubit variational circuit for width, depth, gate set, and execution constraints.", result: "CIRCUIT PROFILE READY" },
  { name: "Transpile", label: "Target-aware compile", prompt: "Compile the circuit against each eligible hardware architecture and preserve artifacts.", result: "3 TARGET PROGRAMS READY" },
  { name: "Score", label: "QCI Engine", prompt: "Compare compatibility, projected quality, queue time, cost, and backend reliability.", result: "WORKLOAD SCORES READY" },
  { name: "Route", label: "Balanced policy", prompt: "Select the best eligible QPU under a $1.00 cost ceiling and 30-minute queue limit.", result: "QPU ALPHA SELECTED" },
  { name: "Execute", label: "Normalized lifecycle", prompt: "Submit through one authenticated API and return provider-neutral result artifacts.", result: "EXECUTION CONTRACT READY" },
] as const;

export default function LandingHeroStage() {
  const [active, setActive] = useState(3);
  const [menuOpen, setMenuOpen] = useState(false);
  const stage = stages[active];

  return (
    <>
      <div className="pl-announcement"><span>QRouter private beta</span><Link href="/contact">Request access <ArrowRight /></Link></div>
      <header className="pl-nav pl-shell">
        <Link href="/" className="pl-logo"><LogoMark size={24} /><strong>qrouter</strong></Link>
        <nav className={menuOpen ? "open" : ""}>
          <a href="#products">Products <ChevronDown /></a><a href="#engine">QCI Engine</a><Link href="/docs">Developers <ChevronDown /></Link><Link href="/pricing">Pricing</Link>
        </nav>
        <div className="pl-nav-actions"><Link href="/contact">Contact</Link><Link className="pl-login" href="/dashboard">Log in <ArrowUpRight /></Link><button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Toggle navigation">{menuOpen ? <X /> : <Menu />}</button></div>
      </header>

      <section className="pl-hero pl-shell">
        <div className="pl-hero-copy">
          <p>Quantum compute&apos;s new control plane</p>
          <h1>The intelligent routing layer <span>for quantum compute</span></h1>
          <div><Link href={PUBLIC_CONFIG.accessUrl} className="pl-button primary">Request access</Link><Link href={PUBLIC_CONFIG.docsUrl} className="pl-button">Onboard your workload <ArrowRight /></Link></div>
        </div>

        <div className="pl-hero-demo">
          <SignalBars />
          <div className="pl-demo-glow" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="pl-demo-tabs" role="tablist" aria-label="QRouter workflow">{stages.map((item, index) => <button type="button" role="tab" aria-selected={active === index} className={active === index ? "active" : ""} onClick={() => setActive(index)} key={item.name}>{item.name}</button>)}</div>
          <div className="pl-demo-prompt">
            <header><span>{stage.label}</span><b>SAMPLE WORKLOAD</b></header>
            <p>{stage.prompt}</p>
            <footer><span>MODE <b>BALANCED</b></span><span>TARGET <b>QPU ONLY</b></span><span>MAX COST <b>$1.00</b></span><button type="button" aria-label="Run sample"><Play /></button></footer>
          </div>
          <div className="pl-demo-result"><Check /><span>{stage.result}</span><small>{String(active + 1).padStart(2, "0")} / 05</small></div>
        </div>
      </section>
    </>
  );
}
