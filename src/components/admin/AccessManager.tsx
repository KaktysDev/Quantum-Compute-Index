"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ExternalLink,
  Loader2,
  ShieldCheck,
  UserPlus,
  UserX,
  X,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";

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

  const pending = waitlist.filter((w) => w.status === "pending" || w.status === "contacted");
  const decided = waitlist.filter((w) => w.status === "approved" || w.status === "declined");
  const granted = new Set(access.map((a) => a.email.toLowerCase()));

  async function run(action: Action, email: string, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setNotice(
        action === "grant"
          ? `${email} can now sign in to the console.`
          : action === "revoke"
            ? `Removed console access for ${email}.`
            : `Declined ${email}.`,
      );
      if (action === "grant") setManual("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">
        Console access lives in the database. Approving someone here adds them to{" "}
        <b className="text-white">allowed_emails</b>, which is what the sign-in gate checks — no
        redeploy needed. Admins are set in the SQL editor (<b className="text-white">admin_emails</b>
        , see <span className="font-mono">supabase/access.sql</span>) and always keep access.
      </p>

      {migrationNeeded && (
        <GlassCard className="border-amber-300/30 p-4">
          <p className="text-xs text-amber-300">
            Could not read the access lists. Run{" "}
            <span className="font-mono">supabase/access.sql</span> in the Supabase SQL editor.
          </p>
        </GlassCard>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {notice && <p className="text-xs text-emerald-300">{notice}</p>}

      {/* Grant access directly, without a waitlist request. */}
      <GlassCard className="p-5">
        <p className="text-sm font-semibold text-white">Grant access directly</p>
        <p className="mt-1 text-xs text-[var(--muted)]">
          For teammates who never filled in the waitlist form.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="email"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="person@example.com"
            className="min-w-[16rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white placeholder:text-[var(--muted)] outline-none focus:border-[var(--qr-emerald,#34d399)]"
          />
          <button
            onClick={() => run("grant", manual.trim(), "manual")}
            disabled={busy !== null || !manual.trim()}
            className="console-primary disabled:opacity-40"
          >
            {busy === "manual" ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
            Grant access
          </button>
        </div>
      </GlassCard>

      {/* Pending waitlist requests. */}
      <GlassCard className="p-5">
        <p className="text-sm font-semibold text-white">
          Waitlist requests{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {pending.length} pending
          </span>
        </p>
        {pending.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">No pending requests.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {pending.map((w) => (
              <li
                key={w.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-white/10 bg-black/20 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white">
                    {w.name}{" "}
                    <span className="font-mono text-xs text-[var(--muted)]">{w.email}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {w.jobTitle} · {w.quantumExperience} · via {w.referralSource} ·{" "}
                    {new Date(w.createdAt).toLocaleDateString()}
                  </p>
                  <a
                    href={w.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"
                  >
                    LinkedIn <ExternalLink size={11} />
                  </a>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => run("grant", w.email, `approve-${w.id}`)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-lg border border-emerald-300/30 px-3 py-1.5 text-xs text-emerald-300 transition-colors hover:bg-emerald-300/10 disabled:opacity-50"
                  >
                    {busy === `approve-${w.id}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Check size={12} />
                    )}
                    Approve
                  </button>
                  <button
                    onClick={() => run("decline", w.email, `decline-${w.id}`)}
                    disabled={busy !== null}
                    className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-white/5 disabled:opacity-50"
                  >
                    {busy === `decline-${w.id}` ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <X size={12} />
                    )}
                    Decline
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {decided.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 border-t border-white/10 pt-3">
            {decided.slice(0, 20).map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="font-mono text-[var(--muted)]">{w.email}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={
                      w.status === "approved" ? "text-emerald-300" : "text-[var(--muted)]"
                    }
                  >
                    {w.status}
                  </span>
                  {w.status === "declined" && !granted.has(w.email.toLowerCase()) && (
                    <button
                      onClick={() => run("grant", w.email, `regrant-${w.id}`)}
                      disabled={busy !== null}
                      className="text-emerald-300 hover:underline disabled:opacity-50"
                    >
                      approve anyway
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      {/* Everyone who can currently sign in. */}
      <GlassCard className="p-5">
        <p className="text-sm font-semibold text-white">
          Console access{" "}
          <span className="ml-1 font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {access.length} {access.length === 1 ? "account" : "accounts"}
          </span>
        </p>
        {access.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Nobody is on the list yet — run <span className="font-mono">supabase/access.sql</span>.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1">
            {access.map((a) => (
              <li
                key={a.email}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-white">{a.email}</span>
                  {a.isAdmin && (
                    <span className="flex items-center gap-1 rounded border border-emerald-300/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-emerald-300">
                      <ShieldCheck size={10} /> admin
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-[var(--muted)]">
                    added by {a.addedBy ?? "—"}
                  </span>
                  {a.isAdmin ? (
                    <span
                      className="font-mono text-[10px] text-[var(--muted)]"
                      title="Remove them from admin_emails in the SQL editor first."
                    >
                      protected
                    </span>
                  ) : (
                    <button
                      onClick={() => run("revoke", a.email, `revoke-${a.email}`)}
                      disabled={busy !== null}
                      className="flex items-center gap-1.5 text-xs text-red-400 transition-colors hover:underline disabled:opacity-50"
                    >
                      {busy === `revoke-${a.email}` ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <UserX size={12} />
                      )}
                      Revoke
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>
    </div>
  );
}
