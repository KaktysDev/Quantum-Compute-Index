"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { InlineAlert, Panel, Timestamp } from "@/components/console/ui";

export interface AdminReport {
  id: number;
  email: string | null;
  category: string;
  subject: string;
  message: string;
  status: string;
  admin_notes: string | null;
  created_at: string;
}

export interface AdminContact {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string;
  read: boolean;
  created_at: string;
}

const STATUSES = [
  { value: "open", label: "Open", tone: "progress" },
  { value: "in_progress", label: "In progress", tone: "progress" },
  { value: "resolved", label: "Resolved", tone: "success" },
  { value: "closed", label: "Closed", tone: "neutral" },
] as const;

const FILTERS = [
  { value: "active", label: "Active" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

function statusMeta(value: string) {
  return STATUSES.find((status) => status.value === value) ?? STATUSES[3];
}

function ReportCard({ report }: { report: AdminReport }) {
  const router = useRouter();
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.admin_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = status !== report.status || notes !== (report.admin_notes ?? "");
  const meta = statusMeta(report.status);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, status, admin_notes: notes || null }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Save failed");
      setSaved(true);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel report">
      <header className="row-between">
        <span className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <span className={`status ${meta.tone}`}>{meta.label}</span>
          <span className="dim">{report.category}</span>
          <span className="muted">{report.email ?? "Unknown user"}</span>
        </span>
        <span className="dim"><Timestamp value={report.created_at} /></span>
      </header>
      <b>{report.subject}</b>
      <p className="muted report-body">{report.message}</p>
      <div className="report-actions">
        <label className="select-wrap">
          <select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setSaved(false); }} aria-label="Status">
            {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <input
          className="input"
          value={notes}
          onChange={(event) => { setNotes(event.target.value); setSaved(false); }}
          placeholder="Reply to the user (visible on their Support page)"
          aria-label="Reply"
        />
        <button type="button" className="btn btn-secondary" onClick={save} disabled={!dirty || saving}>
          {saving ? <Loader2 size={13} className="spin" /> : saved ? <Check size={13} /> : null}
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </article>
  );
}

export default function ReportsManager({ reports, contacts }: { reports: AdminReport[]; contacts: AdminContact[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("active");
  const [busy, setBusy] = useState<number | null>(null);
  const filtered = reports.filter((report) =>
    filter === "all" ? true : filter === "active" ? report.status === "open" || report.status === "in_progress" : report.status === filter,
  );

  async function toggleRead(item: AdminContact) {
    setBusy(item.id);
    try {
      await fetch("/api/admin/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, read: !item.read }),
      });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <section className="stack-sm">
        <div className="row-between">
          <h2 className="section-title">Support reports</h2>
          <div className="segmented" role="group" aria-label="Filter reports">
            {FILTERS.map((option) => (
              <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setFilter(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <Panel><p className="muted">No {filter === "all" ? "" : `${filter} `}reports.</p></Panel>
        ) : (
          filtered.map((report) => <ReportCard key={report.id} report={report} />)
        )}
      </section>

      <Panel title="Contact requests" description={`${contacts.filter((item) => !item.read).length} unread`} flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr><th>From</th><th>Message</th><th className="hide-sm">Received</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {contacts.length === 0 ? (
                <tr><td colSpan={4} className="empty-row">No contact submissions.</td></tr>
              ) : (
                contacts.map((item) => (
                  <tr key={item.id} className={item.read ? "row-read" : undefined}>
                    <td>
                      <span className="cell-main">
                        <b>{item.name}</b>
                        <small>{item.email}{item.phone ? ` · ${item.phone}` : ""}</small>
                      </span>
                    </td>
                    <td className="report-body" style={{ maxWidth: 520 }}>{item.message}</td>
                    <td className="hide-sm"><Timestamp value={item.created_at} /></td>
                    <td className="num">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleRead(item)} disabled={busy === item.id}>
                        {busy === item.id ? <Loader2 size={13} className="spin" /> : null}
                        {item.read ? "Mark unread" : "Mark read"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
