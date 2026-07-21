"use client";

import { useState } from "react";
import { ArrowRight, Check, Loader2, LogIn } from "lucide-react";
import SignInButton from "./SignInButton";

type WaitlistForm = {
  name: string;
  email: string;
  linkedin: string;
  jobTitle: string;
  quantumExperience: string;
  referralSource: string;
  website: string;
};

const INITIAL_FORM: WaitlistForm = {
  name: "",
  email: "",
  linkedin: "",
  jobTitle: "",
  quantumExperience: "",
  referralSource: "",
  website: "",
};

export default function WaitlistAccess({ unauthorized = false }: { unauthorized?: boolean }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [status, setStatus] = useState<"idle" | "submitting" | "complete">("idle");
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof WaitlistForm>(key: K, value: WaitlistForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setError(null);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to join the waitlist.");
      setStatus("complete");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "Unable to join the waitlist.");
    }
  }

  if (status === "complete") {
    return (
      <section className="access-form access-complete" aria-live="polite">
        <span className="access-success-mark"><Check /></span>
        <p className="access-kicker">REQUEST RECEIVED</p>
        <h1>You&apos;re on the list.</h1>
        <p>We&apos;ll review your background and reach out at <strong>{form.email}</strong> as pilot access opens.</p>
        <a href="/" className="access-submit">Return to QRouter <ArrowRight /></a>
      </section>
    );
  }

  return (
    <section className="access-form">
      <p className="access-kicker">PRIVATE PILOT</p>
      <h1>Join the waitlist</h1>
      <p className="access-lede">Tell us how you work with quantum systems. We&apos;re onboarding a small group of developers and researchers first.</p>
      {unauthorized && <div className="access-notice">That Google account does not have console access. Join the waitlist below.</div>}
      {error && <div className="access-error" role="alert">{error}</div>}

      <form onSubmit={submit}>
        <label>
          <span>Name</span>
          <input required autoComplete="name" maxLength={120} value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Your full name" />
        </label>
        <label>
          <span>Email</span>
          <input required type="email" autoComplete="email" maxLength={200} value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="you@company.com" />
        </label>
        <label className="access-span-two">
          <span>LinkedIn</span>
          <input required type="url" autoComplete="url" maxLength={500} value={form.linkedin} onChange={(event) => update("linkedin", event.target.value)} placeholder="https://linkedin.com/in/your-profile" />
        </label>
        <label>
          <span>Job title</span>
          <input required autoComplete="organization-title" maxLength={160} value={form.jobTitle} onChange={(event) => update("jobTitle", event.target.value)} placeholder="Quantum software engineer" />
        </label>
        <label>
          <span>Quantum experience</span>
          <select required value={form.quantumExperience} onChange={(event) => update("quantumExperience", event.target.value)}>
            <option value="" disabled>Select experience</option>
            <option value="exploring">Exploring quantum</option>
            <option value="student">Student</option>
            <option value="researcher">Academic researcher</option>
            <option value="developer">Quantum developer</option>
            <option value="professional">Industry professional</option>
          </select>
        </label>
        <label className="access-span-two">
          <span>How did you hear about QRouter?</span>
          <select required value={form.referralSource} onChange={(event) => update("referralSource", event.target.value)}>
            <option value="" disabled>Select a source</option>
            <option value="linkedin">LinkedIn</option>
            <option value="search">Search</option>
            <option value="university">University or research group</option>
            <option value="colleague">Colleague or friend</option>
            <option value="event">Conference or event</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="access-honeypot" aria-hidden="true">
          <span>Website</span>
          <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => update("website", event.target.value)} />
        </label>
        <button className="access-submit access-span-two" type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? <><Loader2 className="spin" /> Submitting</> : <>Request pilot access <ArrowRight /></>}
        </button>
      </form>

      <div className="access-signin">
        <span><LogIn /> Already approved?</span>
        <SignInButton label="Sign in with Google" variant="glass" next="/dashboard" className="access-google" />
      </div>
    </section>
  );
}
