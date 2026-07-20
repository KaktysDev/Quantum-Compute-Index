"use client";

// The hero's interactive console: the five QRouter stages as a dark terminal.
// Auto-advances with a progress sweep; clicking a stage pins it for a while.
// The prompt line types itself in; a scanline drifts over the panel.

import { useEffect, useRef, useState } from "react";
import { Check, Play } from "lucide-react";

const STAGES = [
  {
    name: "Analyze",
    label: "Circuit profile",
    prompt: "bell.qasm validated · OpenQASM 2.0 · 2 qubits · depth 4 · H + CX",
    result: "CIRCUIT PROFILE READY · 2Q / DEPTH 4",
  },
  {
    name: "Transpile",
    label: "Target-aware compile",
    prompt: "Compile for QCI Aer GPU · all-to-all connectivity · optimization level 2.",
    result: "LOCAL COMPILE READY · ARTIFACT STORED",
  },
  {
    name: "Score",
    label: "Eligibility and QCI score",
    prompt: "Apply credentials and hard constraints first · 1 of 8 catalog targets is routable.",
    result: "QCI AER GPU · ONLY ELIGIBLE TARGET",
  },
  {
    name: "Route",
    label: "Balanced policy",
    prompt: "Select QCI Aer GPU · 2-second queue · reserve the $0.018246 total quote.",
    result: "QCI AER GPU SELECTED · QUOTE RESERVED",
  },
  {
    name: "Execute",
    label: "Normalized result",
    prompt: "Execution completed · |00⟩ 51.4% · |11⟩ 48.6% · result and QASM ready.",
    result: "EXECUTION COMPLETED · NORMALIZED COUNTS READY",
  },
] as const;

const STAGE_MS = 4600;

export default function HeroConsole() {
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState("");
  const pinnedUntil = useRef(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Auto-advance unless the user recently picked a stage.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (Date.now() > pinnedUntil.current) {
        setActive((v) => (v + 1) % STAGES.length);
      }
    }, STAGE_MS);
    return () => window.clearInterval(timer);
  }, []);

  // Typewriter for the prompt.
  useEffect(() => {
    const text = STAGES[active].prompt;
    if (reduced.current) {
      setTyped(text);
      return;
    }
    setTyped("");
    let i = 0;
    const timer = window.setInterval(() => {
      i += 2;
      setTyped(text.slice(0, i));
      if (i >= text.length) window.clearInterval(timer);
    }, 14);
    return () => window.clearInterval(timer);
  }, [active]);

  const stage = STAGES[active];

  return (
    <div className="ql-console" aria-label="QRouter workflow demo">
      <span className="ql-console-scanline" aria-hidden="true" />
      <header className="ql-console-chrome">
        <i /><i /><i />
        <b>qrouter · local execution</b>
        <em>~/examples/bell.qasm</em>
      </header>

      <div className="ql-console-tabs" role="tablist" aria-label="Workflow stages">
        {STAGES.map((item, index) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            aria-selected={active === index}
            className={active === index ? "active" : index < active ? "done" : ""}
            onClick={() => {
              pinnedUntil.current = Date.now() + 9000;
              setActive(index);
            }}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.name}
          </button>
        ))}
        <i
          className="ql-console-progress"
          key={active}
          style={{ animationDuration: `${STAGE_MS}ms` }}
          aria-hidden="true"
        />
      </div>

      <div className="ql-console-body">
        <p className="ql-console-label">
          <b>▸ {stage.label}</b>
          <span>{String(active + 1).padStart(2, "0")} / 05</span>
        </p>
        <p className="ql-console-prompt">
          {typed}
          <span className="ql-caret" aria-hidden="true" />
        </p>
        <div className="ql-console-meta">
          <span>MODE <b>BALANCED</b></span>
          <span>TARGET <b>AUTO</b></span>
          <span>SHOTS <b>1,024</b></span>
          <button type="button" aria-label="Run sample" onClick={() => {
            pinnedUntil.current = Date.now() + 9000;
            setActive((v) => (v + 1) % STAGES.length);
          }}>
            <Play />
          </button>
        </div>
      </div>

      <footer className="ql-console-result">
        <Check />
        <span key={stage.result} className="ql-result-text">{stage.result}</span>
        <small>LOCAL DEMO · CATALOG RATE SNAPSHOT</small>
      </footer>
    </div>
  );
}
