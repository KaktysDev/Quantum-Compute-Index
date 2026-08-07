"use client";

// First-run orientation for the Deploy tab. Three steps, then it goes away for
// good.
//
// Dismissal is recorded twice on purpose. The durable record is
// profiles.preferences.getStartedDismissed, written through the existing PATCH
// /api/profile (which deep-merges preference objects, so sibling keys are never
// clobbered). localStorage is the immediate one: it suppresses the panel on the
// next client navigation without waiting for a round-trip, and it is the only
// record that exists at all in demo / dev-bypass mode, where there is no
// profiles row to write to.
//
// Rendered above the conversation rather than as a modal — a dialog over an
// empty chat is a wall, a banner is a hint.

import { useEffect, useState } from "react";
import { FileCode2, GitBranch, ShieldCheck, X } from "lucide-react";

const DISMISS_KEY = "qrouter.getStartedDismissed";

const STEPS = [
  {
    icon: GitBranch,
    title: "Point it at a repository",
    body: "Paste a public GitHub URL. QRouter reads the repo, finds your .qasm circuits, and picks up defaults from qrouter.json if you have one.",
  },
  {
    icon: FileCode2,
    title: "Describe the run you want",
    body: "Say it in plain language — “run bell.qasm with 2048 shots on the cheapest backend”. You can also paste OpenQASM straight into the box.",
  },
  {
    icon: ShieldCheck,
    title: "Approve the quote, then it runs",
    body: "You get the real routed backend, the real price and your credit balance before anything executes. Nothing is charged until you confirm.",
  },
];

export default function GetStartedPanel({ onDismissed }: { onDismissed?: () => void }) {
  // Starts closed so the server and first client render agree; the effect below
  // opens it once localStorage says this browser has not dismissed it.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) !== "1") setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  function dismiss() {
    setOpen(false);
    onDismissed?.();
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private browsing — the profile write below is still attempted */
    }
    // Best-effort: if this fails the panel simply returns in a new browser.
    void fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences: { getStartedDismissed: true } }),
    }).catch(() => {});
  }

  if (!open) return null;

  return (
    <aside className="qc-getstarted" aria-label="Get started">
      <header>
        <b>Get started</b>
        <span>Three things to know before your first run</span>
        <button type="button" onClick={dismiss} aria-label="Dismiss get started">
          <X size={14} />
        </button>
      </header>
      <ol>
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <span className="qc-getstarted-step">
              <i>{index + 1}</i>
              <step.icon size={13} />
            </span>
            <div>
              <b>{step.title}</b>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}
