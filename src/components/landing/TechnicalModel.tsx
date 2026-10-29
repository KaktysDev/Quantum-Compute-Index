"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { TechnicalScene } from "./technical-model-scene";

const STAGES = [
  { title: "Scope", detail: "Define the workload and its constraints." },
  { title: "Compare", detail: "Test candidates against a classical reference." },
  { title: "Verify", detail: "Check the original problem before accepting a result." },
];

export default function TechnicalModel() {
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<TechnicalScene | null>(null);
  const selected = useRef(1);
  const [stage, setStage] = useState(1);
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    let disposed = false;
    let started = false;
    let generation = 0;
    let inView = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const desktop = window.matchMedia("(min-width: 800px)");
    const activate = async () => {
      if (started || disposed || !inView || reduced.matches || !desktop.matches) return;
      started = true;
      const activation = ++generation;
      try {
        const { createTechnicalScene } = await import("./technical-model-scene");
        if (disposed || activation !== generation || reduced.matches || !desktop.matches) return;
        const model = createTechnicalScene(element, () => setEnhanced(false));
        if (disposed || activation !== generation) { model.dispose(); return; }
        scene.current = model;
        model.setVisible(inView);
        model.select(selected.current);
        setEnhanced(true);
      } catch {
        // The static image is the complete fallback when WebGL is unavailable.
        if (!disposed && activation === generation) { started = false; setEnhanced(false); }
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (entry.isIntersecting) void activate();
      scene.current?.setVisible(entry.isIntersecting);
    }, { rootMargin: "120px" });
    observer.observe(element);
    const onPreferenceChange = () => {
      if (reduced.matches || !desktop.matches) {
        generation++;
        scene.current?.dispose(); scene.current = null; started = false; setEnhanced(false);
      } else void activate();
    };
    reduced.addEventListener("change", onPreferenceChange);
    desktop.addEventListener("change", onPreferenceChange);
    return () => {
      disposed = true;
      generation++;
      observer.disconnect();
      reduced.removeEventListener("change", onPreferenceChange);
      desktop.removeEventListener("change", onPreferenceChange);
      scene.current?.dispose(); scene.current = null;
    };
  }, []);

  function choose(index: number) {
    selected.current = index;
    setStage(index);
    scene.current?.select(index);
  }

  return (
    <section className="qt-model" aria-label="Illustrative workload model">
      <div className="qt-model-grid">
        <div className={"qt-model-stage" + (enhanced ? " is-enhanced" : "")}>
          <Image className="qt-model-fallback" src="/landing/hero-model.webp" alt="Illustrative white graph model on an orange drafting surface, with one black path" fill priority sizes="(max-width: 800px) 100vw, 82vw" />
          <div className="qt-model-canvas" ref={mount} aria-hidden="true" />
          <div className="qt-model-controls" role="group" aria-label="Explore the approach">
            {STAGES.map((item, index) => <button type="button" key={item.title} aria-pressed={stage === index} onClick={() => choose(index)}><span>{String(index + 1).padStart(2, "0")}</span>{item.title}</button>)}
          </div>
          <div className="qt-model-bottom"><p aria-live="polite">{STAGES[stage].detail}</p><span>Illustrative model</span></div>
        </div>
        <div className="qt-model-details" aria-hidden="true">
          <div><div className="qt-model-image"><Image src="/landing/cryogenic-hardware.webp" alt="" fill priority quality={90} sizes="16vw" className="qt-model-hardware" /></div><span>Quantum hardware</span></div>
          <div><div className="qt-model-image"><Image src="/landing/quantum-processor.webp" alt="" fill priority quality={90} sizes="16vw" className="qt-model-processor" /></div><span>Processor</span></div>
        </div>
      </div>
    </section>
  );
}
