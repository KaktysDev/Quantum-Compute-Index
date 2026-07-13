"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LifeBuoy, Loader2, Send } from "lucide-react";
import GlassCard from "./GlassCard";

export interface UserReport {
  id: number;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

const CATEGORIES = [
  { id: "bug", label: "Bug / something broke" },
  { id: "billing", label: "Billing & credits" },
  { id: "provider", label: "Provider / job issue" },
  { id: "account", label: "Account & access" },
  { id: "other", label: "Something else" },
];

const STATUS_STYLE: Record<string, string> = {
  open: "text-amber-300 border-amber-300/30",
  in_progress: "text-sky-300 border-sky-300/30",
  resolved: "text-emerald-300 border-emerald-300/30",
  closed: "text-[var(--muted)] border-white/10",
};

export default function SupportPanel({ reports }: { reports: UserReport[] }) {
  const router = useRouter();
  const [category, setCategory] = useState("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to submit report");
      setSubject("");
      setMessage("");
      setSent(true);
      router.refresh();
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
    } finally {
      setSending(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-[var(--muted)] outline-none focus:border-[var(--qr-emerald,#34d399)] transition-colors";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <GlassCard className="p-6 self-start">
        <div className="mb-4 flex items-center gap-2 text-white">
          <LifeBuoy size={16} />
          <h2 className="text-sm font-semibold tracking-wide">File a report</h2>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs text-[var(--muted)]">Category</label>
            <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[var(--muted)]">Subject</label>
            <input
              className={inputClass}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Job stuck in processing on IonQ"
              minLength={3}
              maxLength={200}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-[var(--muted)]">What happened?</label>
            <textarea
              className={`${inputClass} min-h-[120px] resize-y`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Include job IDs, timestamps, anything that helps us reproduce it."
              minLength={10}
              maxLength={5000}
              required
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={sending} className="console-primary justify-center">
            {sending ? <Loader2 size={13} className="animate-spin" /> : sent ? <CheckCircle2 size={13} /> : <Send size={13} />}
            {sending ? "Sending…" : sent ? "Report received" : "Submit report"}
          </button>
        </form>
      </GlassCard>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-white">Your reports</h2>
        {reports.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-[var(--muted)]">No reports yet. Anything broken? Tell us on the left.</p>
          </GlassCard>
        ) : (
          reports.map((r) => (
            <GlassCard key={r.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_STYLE[r.status] ?? STATUS_STYLE.closed}`}>
                    {r.status.replace("_", " ")}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">{r.category}</span>
                </div>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium text-white">{r.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">{r.message}</p>
              {r.admin_notes && (
                <div className="mt-3 rounded-lg border border-emerald-300/20 bg-emerald-300/5 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-emerald-300">Team response</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-white/90">{r.admin_notes}</p>
                </div>
              )}
            </GlassCard>
          ))
        )}
      </div>
    </div>
  );
}
