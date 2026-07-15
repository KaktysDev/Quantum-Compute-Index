"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Route } from "lucide-react";
import { useEffect, useState } from "react";

const RoutingTopology = dynamic(() => import("./RoutingTopology"), { ssr: false });

const candidates = [
  { backend: "QCI Aer GPU", architecture: "SIMULATOR", compatibility: "PASS", score: "0.96", state: "selected" },
  { backend: "IBM Brisbane", architecture: "SUPERCONDUCTING", compatibility: "PASS", score: "0.73", state: "" },
  { backend: "IonQ Aria 1", architecture: "TRAPPED ION", compatibility: "PASS", score: "0.68", state: "" },
];

export default function LandingHeroStage() {
  const [scrolled, setScrolled] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 40);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <>
      <header className={`qr-nav ${scrolled ? "is-scrolled" : ""}`}>
        <Link href="/" className="qr-brand"><strong>QROUTER</strong><i /><span>QCI NETWORK</span></Link>
        <nav aria-label="Primary navigation">
          <a href="#network">NETWORK</a><a href="#routing">ROUTING</a><a href="#benchmarks">BENCHMARKS</a><Link href="/docs">DOCS</Link><Link href="/pricing">PRICING</Link>
        </nav>
        <div className="qr-nav-actions"><span><i /> ONLINE</span><Link href="/dashboard">OPEN CONSOLE <ArrowUpRight size={13} /></Link></div>
      </header>

      <section className="qr-hero" aria-labelledby="hero-title">
        <div className="qr-hero-copy">
          <p className="qr-kicker">QROUTER / QUANTUM EXECUTION NETWORK</p>
          <h1 id="hero-title"><span>QUANTUM</span><span>COMPUTE,</span><span>ROUTED.</span></h1>
          <p className="qr-hero-lede">One API to transpile, score, price, route, and execute across heterogeneous quantum backends.</p>
          <div className="qr-hero-actions"><Link href="/dashboard">OPEN CONSOLE <ArrowUpRight size={14} /></Link><Link href="/docs">READ THE API <span aria-hidden="true">→</span></Link></div>
          <button className="qr-endpoint" type="button" onClick={() => { navigator.clipboard?.writeText("POST /api/v1/jobs"); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>
            <span>POST</span><code>/api/v1/jobs</code>{copied ? <Check size={13} /> : <Copy size={13} />}<em>{copied ? "COPIED" : "COPY"}</em>
          </button>
        </div>

        <div className="qr-instrument" aria-label="Sample QRouter routing decision for a two-qubit Bell circuit">
          <header><div><Route size={14} /><span>ROUTING INSTRUMENT</span></div><code>job_sample_92ac7f</code></header>
          <div className="qr-topology"><div className="qr-topology-poster" /><RoutingTopology /><div className="qr-circuit-meta"><span>INPUT CIRCUIT</span><b>2 QUBITS / DEPTH 4</b><small>OpenQASM 3 / 1,024 shots</small></div></div>
          <ol className="qr-stage-line" aria-label="Routing progress"><li className="done">ANALYZE</li><li className="done">TRANSPILE</li><li className="done">SCORE</li><li className="active">ROUTE</li><li>EXECUTE</li></ol>
          <div className="qr-candidate-table"><header><span>BACKEND</span><span>ARCHITECTURE</span><span>CHECK</span><span>SCORE</span></header>{candidates.map((candidate) => <div key={candidate.backend} className={candidate.state}><span><i />{candidate.backend}</span><span>{candidate.architecture}</span><span>{candidate.compatibility}</span><strong>{candidate.score}</strong></div>)}</div>
          <div className="qr-decision"><span>SELECTED ROUTE</span><strong>QCI Aer GPU</strong><p>Compatible gate set. Lowest sampled queue and estimated execution cost.</p></div>
          <footer><span><i /> NORMALIZED RESULT READY</span><code>{`{"00":507,"11":517}`}</code></footer>
        </div>
      </section>
    </>
  );
}
