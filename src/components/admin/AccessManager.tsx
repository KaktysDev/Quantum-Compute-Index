"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { InlineAlert, Panel } from "@/components/console/ui";

export interface WaitlistEntry {
  id: number;
  name: string;
  email: string;
  linkedinUrl: string;
  jobTitle: string;
  quantumExperience: string;
  referralSource: string;
  status: string;
  createdAt: string;
}

export interface AllowedEntry {
  email: string;
  addedBy: string | null;
  createdAt: string;
  isAdmin: boolean;
}

type Action = "grant" | "revoke" | "decline";

export default function AccessManager({
  waitlist,
  access,
  migrationNeeded,
}: {
  waitlist: WaitlistEntry[];
  access: AllowedEntry[];
  migrationNeeded: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const pending = waitlist.filter((entry) => entry.status === "pending" || entry.status === "contacted");
  const decided = waitlist.filter((entry) => entry.status === "approved" || entry.status === "declined");
  const granted = new Set(access.map((entry) => entry.email.toLowerCase()));

  async function run(action: Action, email: string, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Request failed");
      setNotice(
        action === "grant" ? `${email} can now sign in to the console.` : action === "revoke" ? `Removed console access for ${email}.` : `Declined ${email}.`,
      );
      if (action === "grant") setManual("");
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  function grantManual(event: FormEvent) {
    event.preventDefault();
    if (manual.trim()) void run("grant", manual.trim(), "manual");
  }

  const spinner = (key: string) => (busy === key ? <Loader2 size={13} className="spin" /> : null);

  return (
    <div className="stack">
      <p className="muted">Approving someone lets them sign in immediately. Admins are managed in the Supabase SQL editor.</p>

      {migrationNeeded ? (
        <InlineAlert tone="warning" title="Access lists unavailable">
          Run <code>supabase/access.sql</code> in the Supabase SQL editor.
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {notice ? <InlineAlert tone="success">{notice}</InlineAlert> : null}

      <Panel title="Grant access" description="For teammates who never filled in the waitlist form.">
        <form className="row" onSubmit={grantManual} style={{ flexWrap: "wrap" }}>
          <input
            type="email"
            className="input"
            style={{ flex: 1, minWidth: 240 }}
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            placeholder="person@example.com"
            aria-label="Email address"
          />
          <button type="submit" className="btn btn-primary" disabled={busy !== null || !manual.trim()}>
            {spinner("manual")} Grant access
          </button>
        </form>
      </Panel>

      <Panel title="Waitlist" description={`${pending.length} pending`} flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr><th>Person</th><th className="hide-sm">Background</th><th className="hide-sm">Requested</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {pending.length === 0 ? (
                <tr><td colSpan={4} className="empty-row">No pending requests.</td></tr>
              ) : (
                pending.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <span className="cell-main">
                        <b>{entry.name}</b>
                        <small className="mono">{entry.email}</small>
                      </span>
                    </td>
                    <td className="hide-sm">
                      <span className="cell-main">
                        <span>{entry.jobTitle}</span>
                        <small>
                          {entry.quantumExperience} · via {entry.referralSource} ·{" "}
                          <a href={entry.linkedinUrl} target="_blank" rel="noopener noreferrer" className="link-btn">LinkedIn</a>
                        </small>
                      </span>
                    </td>
                    <td className="hide-sm muted">{new Date(entry.createdAt).toLocaleDateString()}</td>
                    <td className="num">
                      <span className="row" style={{ justifyContent: "flex-end" }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => run("decline", entry.email, `decline-${entry.id}`)} disabled={busy !== null}>
                          {spinner(`decline-${entry.id}`)} Decline
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run("grant", entry.email, `approve-${entry.id}`)} disabled={busy !== null}>
                          {spinner(`approve-${entry.id}`)} Approve
                        </button>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {decided.length > 0 ? (
          <details className="panel-foot advanced" style={{ display: "block" }}>
            <summary>Recently decided ({Math.min(decided.length, 20)})</summary>
            <ul className="stack-sm" style={{ margin: "12px 0 0", padding: 0, listStyle: "none" }}>
              {decided.slice(0, 20).map((entry) => (
                <li key={entry.id} className="row-between">
                  <span className="mono">{entry.email}</span>
                  <span className="row">
                    <span className={`status ${entry.status === "approved" ? "success" : "neutral"}`}>{entry.status === "approved" ? "Approved" : "Declined"}</span>
                    {entry.status === "declined" && !granted.has(entry.email.toLowerCase()) ? (
                      <button type="button" className="link-btn" onClick={() => run("grant", entry.email, `regrant-${entry.id}`)} disabled={busy !== null}>
                        Approve anyway
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>

      <Panel title="Console access" description={`${access.length} ${access.length === 1 ? "account" : "accounts"}`} flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th className="hide-sm">Added by</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {access.length === 0 ? (
                <tr><td colSpan={4} className="empty-row">Nobody is on the list yet. Run <code>supabase/access.sql</code>.</td></tr>
              ) : (
                access.map((entry) => (
                  <tr key={entry.email}>
                    <td className="mono">{entry.email}</td>
                    <td>{entry.isAdmin ? <span className="badge">admin</span> : <span className="muted">Member</span>}</td>
                    <td className="hide-sm muted">{entry.addedBy ?? "—"}</td>
                    <td className="num">
                      {entry.isAdmin ? (
                        <span className="dim" title="Remove them from admin_emails in the SQL editor first.">Protected</span>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => run("revoke", entry.email, `revoke-${entry.email}`)} disabled={busy !== null}>
                          {spinner(`revoke-${entry.email}`)} Revoke
                        </button>
                      )}
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
