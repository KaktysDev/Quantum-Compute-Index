"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Mail, MailOpen } from "lucide-react";
import GlassCard from "@/components/GlassCard";

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

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

const STATUS_STYLE: Record<string, string> = {
  open: "text-amber-300 border-amber-300/30",
  in_progress: "text-sky-300 border-sky-300/30",
  resolved: "text-emerald-300 border-emerald-300/30",
  closed: "text-[var(--muted)] border-white/10",
};

function ReportCard({ report }: { report: AdminReport }) {
  const router = useRouter();
  const [status, setStatus] = useState(report.status);
  const [notes, setNotes] = useState(report.admin_notes ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = status !== report.status || notes !== (report.admin_notes ?? "");

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, status, admin_notes: notes || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_STYLE[status] ?? ""}`}>
            {status.replace("_", " ")}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">{report.category}</span>
          <span className="text-xs text-[var(--muted)]">{report.email ?? "unknown user"}</span>
        </div>
        <span className="font-mono text-[10px] text-[var(--muted)]">{new Date(report.created_at).toLocaleString()}</span>
      </div>

      <p className="mt-2 text-sm font-medium text-white">{report.subject}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">{report.message}</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto]">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white outline-none focus:border-[var(--qr-emerald,#34d399)]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </select>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Response / internal notes (visible to the user)"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder:text-[var(--muted)] outline-none focus:border-[var(--qr-emerald,#34d399)]"
        />
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="console-primary justify-center disabled:opacity-40"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </GlassCard>
  );
}

function ContactCard({ item }: { item: AdminContact }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggleRead() {
    setBusy(true);
    try {
      await fetch("/api/admin/contact", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, read: !item.read }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard className={`p-4 ${item.read ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-white">
          <b>{item.name}</b> <span className="text-[var(--muted)]">· {item.email} · {item.phone}</span>
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] text-[var(--muted)]">{new Date(item.created_at).toLocaleString()}</span>
          <button onClick={toggleRead} disabled={busy} className="flex items-center gap-1 text-xs text-[var(--qr-emerald,#34d399)] hover:underline disabled:opacity-50">
            {item.read ? <Mail size={12} /> : <MailOpen size={12} />}
            {item.read ? "Mark unread" : "Mark read"}
          </button>
        </div>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-[var(--muted)]">{item.message}</p>
    </GlassCard>
  );
}

export default function ReportsManager({
  reports,
  contacts,
}: {
  reports: AdminReport[];
  contacts: AdminContact[];
}) {
  const [filter, setFilter] = useState<string>("active");
  const filtered = reports.filter((r) =>
    filter === "all" ? true : filter === "active" ? r.status === "open" || r.status === "in_progress" : r.status === filter,
  );

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Support reports</h2>
          <div className="flex gap-1 rounded-lg border border-white/10 bg-black/30 p-1">
            {["active", "resolved", "closed", "all"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  filter === f ? "bg-[var(--qr-emerald,#34d399)]/15 text-[var(--qr-emerald,#34d399)]" : "text-[var(--muted)] hover:text-white"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-[var(--muted)]">No {filter === "all" ? "" : `${filter} `}reports.</p>
          </GlassCard>
        ) : (
          filtered.map((r) => <ReportCard key={r.id} report={r} />)
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-white">Contact / access requests</h2>
        {contacts.length === 0 ? (
          <GlassCard className="p-8 text-center">
            <p className="text-sm text-[var(--muted)]">No contact submissions.</p>
          </GlassCard>
        ) : (
          contacts.map((c) => <ContactCard key={c.id} item={c} />)
        )}
      </section>
    </div>
  );
}
