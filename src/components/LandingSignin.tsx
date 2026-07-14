"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { KeyRound, X } from "lucide-react";
import SignInButton from "./SignInButton";

/**
 * Sign-in modal for the public landing page.
 *
 * The console buttons link to /dashboard; middleware bounces unauthenticated
 * visitors back to /?signin=required (signed-in users pass straight through).
 * This component watches for that param and opens the OAuth modal — so the
 * "Console" buttons work for both states without knowing the auth state at
 * render time. It also opens on a `qr:signin` window event for instant open.
 */
function SigninInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const flag = params.get("signin");
    if (flag === "required" || flag === "1") setOpen(true);
  }, [params]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("qr:signin", onOpen);
    return () => window.removeEventListener("qr:signin", onOpen);
  }, []);

  function close() {
    setOpen(false);
    // Clear ?signin so a refresh / back-nav doesn't re-open the modal.
    if (params.get("signin")) router.replace("/", { scroll: false });
  }

  if (!open) return null;

  return (
    <div className="qh-signin-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="qh-signin-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qh-signin-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="qh-signin-close" onClick={close} aria-label="Close">
          <X size={18} />
        </button>
        <div className="qh-signin-mark"><KeyRound size={20} /></div>
        <p className="qh-signin-eyebrow">QROUTER CONSOLE</p>
        <h2 id="qh-signin-title">Sign in to route quantum work</h2>
        <p className="qh-signin-lede">
          One identity across every backend. New here? You start with $10 in
          simulator credits.
        </p>
        <div className="qh-signin-actions">
          <SignInButton
            label="Continue with Google"
            variant="solid"
            next="/dashboard"
            className="qh-signin-btn w-full [&>button]:w-full [&>button]:justify-center"
          />
          <SignInButton
            label="Continue with GitHub"
            provider="github"
            variant="glass"
            next="/dashboard"
            className="qh-signin-btn w-full [&>button]:w-full [&>button]:justify-center"
          />
        </div>
        <small className="qh-signin-fine">Secure OAuth via Supabase · no passwords stored.</small>
      </section>
    </div>
  );
}

export default function LandingSignin() {
  return (
    <Suspense fallback={null}>
      <SigninInner />
    </Suspense>
  );
}
