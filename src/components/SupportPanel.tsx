"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { InlineAlert, Panel, Timestamp } from "@/components/console/ui";

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
  { id: "bug", label: "Bug or something broke" },
  { id: "billing", label: "Billing and credits" },
  { id: "provider", label: "Provider or job issue" },
  { id: "account", label: "Account and access" },
  { id: "other", label: "Something else" },
];

const STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "progress" },
  in_progress: { label: "In progress", tone: "progress" },
  resolved: { label: "Resolved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export default function SupportPanel({ reports }: { reports: UserReport[] }) {
  const router = useRouter();
  const [category, setCategory] = useState("bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    setSent(false);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, subject, message }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message ?? "Failed to submit the report.");
      setSubject("");
      setMessage("");
      setSent(true);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Failed to submit the report.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="support-layout">
      <Panel title="New report" description="Include job IDs and timestamps if you have them.">
        <form onSubmit={submit} className="stack">
          <label className="field">
            Category
            <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="field">
            Subject
            <input className="input" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Job stuck in processing on IonQ" minLength={3} maxLength={200} required />
          </label>
          <label className="field">
            Details
            <textarea className="input prose-input" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What happened, and what did you expect?" minLength={10} maxLength={5000} required />
          </label>
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          {sent ? <InlineAlert tone="success">Report received. We reply here and by email.</InlineAlert> : null}
          <div className="row-between">
            <small className="dim">Used only to respond to you. See the <a href="/privacy" className="underline">privacy policy</a>.</small>
            <button type="submit" disabled={sending} className="btn btn-primary">
              {sending ? <Loader2 size={14} className="spin" /> : null}
              Submit
            </button>
          </div>
        </form>
      </Panel>

      <section className="stack-sm">
        <h2 className="section-title">Your reports</h2>
        {reports.length === 0 ? (
          <Panel>
            <p className="muted">No reports yet.</p>
          </Panel>
        ) : (
          reports.map((report) => {
            const status = STATUS[report.status] ?? STATUS.closed;
            return (
              <article key={report.id} className="panel report">
                <header className="row-between">
                  <span className="row" style={{ gap: 12 }}>
                    <span className={`status ${status.tone}`}>{status.label}</span>
                    <span className="dim">{CATEGORIES.find((item) => item.id === report.category)?.label ?? report.category}</span>
                  </span>
                  <span className="dim"><Timestamp value={report.created_at} /></span>
                </header>
                <b>{report.subject}</b>
                <p className="muted report-body">{report.message}</p>
                {report.admin_notes ? (
                  <div className="report-reply">
                    <span className="dim">Reply from QRouter</span>
                    <p className="report-body">{report.admin_notes}</p>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}
