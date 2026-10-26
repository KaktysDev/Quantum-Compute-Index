"use client";

// The hero's interactive console: the five QRouter stages as a dark terminal.
// Auto-advances with a progress sweep; clicking a stage pins it for a while.
// The prompt line types itself in; a scanline drifts over the panel.

import { useEffect, useRef, useState } from "react";
import { Check, Play } from "lucide-react";

const STAGES = [
  { name: "Define", label: "Experiment intent", prompt: "Question: does bell.qasm preserve the expected two-qubit correlation? Record the reference and success criterion.", result: "QUESTION + CRITERION RECORDED" },
  { name: "Quote", label: "Execution plan", prompt: "Choose a simulation or hardware run. Review the provider estimate, compilation fee, and platform fee together.", result: "EXECUTION PLAN READY FOR REVIEW" },
  { name: "Approve", label: "Campaign budget", prompt: "Review the complete quote against the campaign budget. Approve the plan explicitly before execution.", result: "BUDGET APPROVAL PRECEDES EXECUTION" },
  { name: "Run", label: "Execution record", prompt: "Compile the circuit for a supported backend. Keep the source, compilation settings, and provider attempt with the experiment.", result: "INPUTS + EXECUTION CONTEXT CONNECTED" },
  { name: "Review", label: "Result evidence", prompt: "Compare the recorded result with the reference. Inspect uncertainty and keep an inconclusive outcome visible.", result: "ASSESS THE EVIDENCE AGAINST THE QUESTION" },
] as const;

const STAGE_MS = 4600;

export default function HeroConsole() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState("");
  const pinnedUntil = useRef(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Auto-advance unless the user recently picked a stage, the tab is hidden,
  // or the console has scrolled offscreen.
  useEffect(() => {
    const host = hostRef.current;
    let onScreen = true;
    const io = host
      ? new IntersectionObserver(([entry]) => {
          onScreen = entry.isIntersecting;
        }, { threshold: 0.2 })
      : null;
    if (host) io?.observe(host);

    const timer = window.setInterval(() => {
      if (document.hidden || !onScreen) return;
      if (Date.now() > pinnedUntil.current) {
        setActive((v) => (v + 1) % STAGES.length);
      }
    }, STAGE_MS);
    return () => {
      window.clearInterval(timer);
      io?.disconnect();
    };
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
      if (document.hidden) return;
      i += 2;
      setTyped(text.slice(0, i));
      if (i >= text.length) window.clearInterval(timer);
    }, 14);
    return () => window.clearInterval(timer);
  }, [active]);

  const stage = STAGES[active];

  return (
    <div ref={hostRef} className="ql-console" aria-label="Illustrative experiment workflow">
      <span className="ql-console-scanline" aria-hidden="true" />
      <header className="ql-console-chrome">
        <i /><i /><i />
        <b>qrouter · experiment workflow</b>
        <em>illustrative campaign</em>
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
          <span>QUESTION <b>DEFINED</b></span>
          <span>BUDGET <b>REVIEWED</b></span>
          <span>EVIDENCE <b>RECORDED</b></span>
          <button type="button" aria-label="Show next workflow stage" onClick={() => {
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
        <small>WORKFLOW ILLUSTRATION · NO JOB IS SUBMITTED</small>
      </footer>
    </div>
  );
}
