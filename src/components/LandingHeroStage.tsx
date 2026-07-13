"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Play, Terminal } from "lucide-react";
import { useEffect, useRef } from "react";

export default function LandingHeroStage() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      stage.style.setProperty("--hero-progress", "1");
      stage.style.setProperty("--hero-copy-scale", "1");
      stage.style.setProperty("--hero-hand-scale", "1");
      stage.style.setProperty("--hero-copy-y", "0px");
      stage.style.setProperty("--hero-hand-x", "0px");
      stage.style.setProperty("--hero-reveal-y", "0px");
      stage.style.setProperty("--hero-nav-opacity", "1");
      stage.style.setProperty("--hero-index-width", "100%");
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = stage.getBoundingClientRect();
      const distance = Math.max(1, stage.offsetHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, -rect.top / distance));
      stage.style.setProperty("--hero-progress", progress.toFixed(4));
      stage.style.setProperty("--hero-copy-scale", (1.42 - progress * 0.42).toFixed(4));
      stage.style.setProperty("--hero-hand-scale", (1.28 - progress * 0.28).toFixed(4));
      stage.style.setProperty("--hero-copy-y", `${((1 - progress) * 34).toFixed(2)}px`);
      stage.style.setProperty("--hero-hand-x", `${((1 - progress) * -52).toFixed(2)}px`);
      stage.style.setProperty("--hero-reveal-y", `${((1 - progress) * 28).toFixed(2)}px`);
      stage.style.setProperty("--hero-nav-opacity", (0.62 + progress * 0.38).toFixed(4));
      stage.style.setProperty("--hero-index-width", `${(progress * 100).toFixed(2)}%`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <div className="qh-hero-scroll" ref={stageRef}>
      <div className="qh-hero-sticky">
        <header className="qh-nav">
          <Link href="/" className="qh-nav-word">QCI</Link>
          <a href="#network">NETWORK</a>
          <Link href="/" className="qh-nav-center"><span>Q</span>ROUTER<small>QCI</small></Link>
          <Link href="/pricing">PRICING</Link>
          <Link href="/dashboard">CONSOLE <ArrowRight size={11} /></Link>
        </header>

        <div className="qh-hero-grid">
          <div className="qh-hero-copy">
            <p>OPEN API <i /> USAGE BASED</p>
            <h1><span className="qh-robot-word" data-text="QUANTUM.">QUANTUM.</span><br />FOR ALL.</h1>
            <div className="qh-hero-reveal">
              <p className="qh-hero-lede">One API key to transpile, price, route, and execute across the quantum cloud.</p>
              <Link href="/dashboard" className="qh-action"><Play size={12} fill="currentColor" /> OPEN CONSOLE</Link>
              <div className="qh-install">
                <span>RUN YOUR FIRST TASK</span>
                <code><b>POST</b> api.qci.dev/v1/jobs</code>
                <button type="button" title="API endpoint"><Terminal size={13} /></button>
              </div>
            </div>
          </div>

          <div className="qh-hands" aria-hidden="true">
            <Image src="/assets/qrouter-hands-transparent.png" alt="" fill priority sizes="100vw" className="qh-hand-base" />
            <Image src="/assets/qrouter-hands-transparent.png" alt="" fill sizes="100vw" className="qh-hand-glitch" />
            <div className="qh-hand-scan"><i /><i /><i /><i /><i /><i /></div>
          </div>
        </div>
        <div className="qh-scroll-index"><span>01</span><i><b /></i><span>02</span></div>
      </div>
    </div>
  );
}
