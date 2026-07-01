"use client";

import { useState } from "react";

const MAX_MESSAGE = 2000;

export default function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong.");
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <div className="glass-panel rounded-3xl p-10 text-center">
        <h2 className="text-glow-strong text-3xl font-medium text-white">Request received</h2>
        <p className="mt-3 text-[var(--muted)]">
          Thanks, {form.name.split(" ")[0] || "there"}. Our team will be in touch shortly.
        </p>
      </div>
    );
  }

  const remaining = MAX_MESSAGE - form.message.length;
  const inputClass =
    "tabular w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none placeholder:text-[var(--muted)] focus:border-emerald-400/60";

  return (
    <form onSubmit={onSubmit} className="glass-panel flex flex-col gap-4 rounded-3xl p-7 sm:p-9">
      {error && (
        <div className="rounded-lg border border-white/25 bg-white/[0.06] px-4 py-2.5 text-sm text-white">
          ! {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mono-label">Name</label>
          <input
            className={`mt-2 ${inputClass}`}
            value={form.name}
            onChange={set("name")}
            required
            maxLength={120}
            autoComplete="name"
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label className="mono-label">Email</label>
          <input
            className={`mt-2 ${inputClass}`}
            type="email"
            value={form.email}
            onChange={set("email")}
            required
            maxLength={200}
            autoComplete="email"
            placeholder="jane@company.com"
          />
        </div>
      </div>

      <div>
        <label className="mono-label">Phone</label>
        <input
          className={`mt-2 ${inputClass}`}
          type="tel"
          value={form.phone}
          onChange={set("phone")}
          required
          minLength={5}
          maxLength={40}
          autoComplete="tel"
          placeholder="+1 555 000 1234"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="mono-label">Message</label>
          <span className="mono-label normal-case tracking-normal text-[var(--muted-dim)]">
            {remaining} left
          </span>
        </div>
        <textarea
          className={`mt-2 min-h-[140px] resize-y ${inputClass}`}
          value={form.message}
          onChange={set("message")}
          required
          maxLength={MAX_MESSAGE}
          placeholder="Tell us a bit about you and what you're looking for."
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="btn btn-solid sheen mt-1 self-start"
      >
        {status === "sending" ? "Sending…" : "Submit request"}
      </button>
    </form>
  );
}
