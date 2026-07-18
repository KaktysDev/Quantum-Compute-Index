"use client";

// The hero's interactive console: the five QRouter stages as a dark terminal.
// Auto-advances with a progress sweep; clicking a stage pins it for a while.
// The prompt line types itself in; a scanline drifts over the panel.

import { useEffect, useRef, useState } from "react";
import { Check, Play } from "lucide-react";

const STAGES = [
  {
    name: "Analyze",
    label: "Circuit requirements",
    prompt:
      "Inspect a 6-qubit variational circuit for width, depth, gate set, and execution constraints.",
    result: "CIRCUIT PROFILE READY",
  },
  {
    name: "Transpile",
    label: "Target-aware compile",
    prompt:
      "Compile the circuit against each eligible hardware architecture and preserve artifacts.",
    result: "3 TARGET PROGRAMS READY",
  },
  {
    name: "Score",
    label: "QCI Engine",
    prompt:
      "Compare compatibility, projected quality, queue time, cost, and backend reliability.",
    result: "WORKLOAD SCORES READY",
  },
  {
    name: "Route",
    label: "Balanced policy",
    prompt:
      "Select the best eligible QPU under a $1.00 cost ceiling and 30-minute queue limit.",
    result: "QPU ALPHA SELECTED",
  },
  {
    name: "Execute",
    label: "Normalized lifecycle",
    prompt:
      "Submit through one authenticated API and return provider-neutral result artifacts.",
    result: "EXECUTION CONTRACT READY",
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
        <b>qrouter · sample workload</b>
        <em>~/circuits/vqe.qasm</em>
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
          <span>TARGET <b>QPU ONLY</b></span>
          <span>MAX COST <b>$1.00</b></span>
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
        <small>SAMPLE DATA — NO PROVIDER CLAIMS</small>
      </footer>
    </div>
  );
}
