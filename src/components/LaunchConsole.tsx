"use client";

import { useState } from "react";
import { ArrowRight, Command, KeyRound, X } from "lucide-react";
import SignInButton from "./SignInButton";

export default function LaunchConsole() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="qr-launch" onClick={() => setOpen(true)}>
        <span className="qr-launch-pulse" />
        <Command size={17} /> Launch Console <ArrowRight size={16} />
      </button>
      {open && (
        <div className="qr-modal-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section className="qr-modal" role="dialog" aria-modal="true" aria-labelledby="launch-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="qr-icon-button absolute right-4 top-4" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
            <div className="qr-modal-mark"><KeyRound size={22} /></div>
            <p className="qr-eyebrow">QRouter Console</p>
            <h2 id="launch-title">One identity. Every quantum backend.</h2>
            <p>Sign in to create your universal API key and run your first circuit with $10 in test credits.</p>
            <SignInButton label="Continue with Google" variant="solid" next="/onboarding" className="mt-6 w-full [&>button]:w-full" />
            <small>By continuing, you agree to usage-based billing and acceptable use terms.</small>
          </section>
        </div>
      )}
    </>
  );
}
