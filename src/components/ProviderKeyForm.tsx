"use client";

import { useCallback, useEffect, useState } from "react";

interface ProviderStatus {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  keyPlaceholder: string;
  covers: string[];
  configured: boolean;
  enabled: boolean;
  label: string | null;
  updatedAt: string | null;
}

export default function ProviderKeyForm() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed to load (${res.status})`);
      }
      const j = await res.json();
      setProviders(j.providers ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setBusyFor = (id: string, v: boolean) =>
    setBusy((b) => ({ ...b, [id]: v }));

  async function save(id: string) {
    const apiKey = (drafts[id] ?? "").trim();
    if (apiKey.length < 4) {
      setError("Enter a valid API key (min 4 characters).");
      return;
    }
    setBusyFor(id, true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, apiKey }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Save failed");
      setDrafts((d) => ({ ...d, [id]: "" }));
      setNotice(`Saved key for ${id}. The next 9:30 AM ET refresh will include it.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusyFor(id, false);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusyFor(id, true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, enabled }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Update failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyFor(id, false);
    }
  }

  async function remove(id: string) {
    setBusyFor(id, true);
    setError(null);
    try {
      const res = await fetch(`/api/keys?provider=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Remove failed");
      setNotice(`Removed key for ${id}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setBusyFor(id, false);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading providers…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg border border-white/25 bg-white/[0.06] px-4 py-2.5 text-sm text-white">
          ! {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-white/12 bg-white/[0.03] px-4 py-2.5 text-sm text-[var(--muted)]">
          {notice}
        </div>
      )}

      {providers.map((p) => (
        <div key={p.id} className="glass rounded-2xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-medium text-white">{p.name}</h3>
                {p.configured ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      p.enabled
                        ? "border border-white/30 bg-white/10 text-white"
                        : "border border-white/12 bg-white/5 text-[var(--muted)]"
                    }`}
                  >
                    {p.enabled ? "active" : "disabled"}
                  </span>
                ) : (
                  <span className="rounded-full border border-white/12 bg-white/5 px-2 py-0.5 text-[10px] text-[var(--muted)]">
                    not set
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{p.description}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Covers: {p.covers.join(", ")} ·{" "}
                <a
                  href={p.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white hover:underline"
                >
                  get a key ↗
                </a>
              </p>
            </div>
            {p.configured && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  disabled={busy[p.id]}
                  onChange={(e) => toggle(p.id, e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                enabled
              </label>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="password"
              autoComplete="off"
              placeholder={p.configured ? "Replace key…" : p.keyPlaceholder}
              value={drafts[p.id] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
              className="tabular min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/40 px-3.5 py-2 text-sm text-white outline-none placeholder:text-[var(--muted)] focus:border-white/40"
            />
            <button
              onClick={() => save(p.id)}
              disabled={busy[p.id]}
              className="btn btn-solid !py-2 !text-sm"
            >
              {busy[p.id] ? "Saving…" : "Save key"}
            </button>
            {p.configured && (
              <button
                onClick={() => remove(p.id)}
                disabled={busy[p.id]}
                className="btn btn-glass !py-2 !text-sm"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
