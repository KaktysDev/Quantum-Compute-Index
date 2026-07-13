"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, KeyRound, Loader2, Power, Trash2 } from "lucide-react";
import GlassCard from "@/components/GlassCard";

export interface ProviderKeyStatus {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  configured: boolean;
  enabled: boolean;
  label: string | null;
  updatedAt: string | null;
}

function ProviderRow({ item }: { item: ProviderKeyStatus }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>, method: "POST" | "DELETE" = "POST") {
    const res = await fetch("/api/admin/provider-keys", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: item.id, ...body }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Request failed");
  }

  async function saveKey() {
    if (apiKey.trim().length < 4) return;
    setBusy("save");
    setError(null);
    try {
      await call({ apiKey: apiKey.trim(), enabled: true });
      setApiKey("");
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggle() {
    setBusy("toggle");
    setError(null);
    try {
      await call({ enabled: !item.enabled });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete the stored ${item.name} credential? The QCI refresh will stop pulling this provider.`)) return;
    setBusy("delete");
    setError(null);
    try {
      await call({}, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{item.name}</p>
            <span
              className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                !item.configured
                  ? "border-white/10 text-[var(--muted)]"
                  : item.enabled
                    ? "border-emerald-300/30 text-emerald-300"
                    : "border-amber-300/30 text-amber-300"
              }`}
            >
              {!item.configured ? "not configured" : item.enabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">{item.description}</p>
          {item.updatedAt && (
            <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
              key updated {new Date(item.updatedAt).toLocaleString()}
            </p>
          )}
        </div>
        {item.configured && (
          <div className="flex items-center gap-2">
            <button
              onClick={toggle}
              disabled={busy !== null}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${
                item.enabled
                  ? "border-amber-300/30 text-amber-300 hover:bg-amber-300/10"
                  : "border-emerald-300/30 text-emerald-300 hover:bg-emerald-300/10"
              }`}
            >
              {busy === "toggle" ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
              {item.enabled ? "Disable" : "Enable"}
            </button>
            <button
              onClick={remove}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-400/10 disabled:opacity-50"
            >
              {busy === "delete" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={item.configured ? "Rotate: paste a new API key" : "Paste the provider API key"}
          className="min-w-[260px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white placeholder:text-[var(--muted)] outline-none focus:border-[var(--qr-emerald,#34d399)]"
        />
        <button
          onClick={saveKey}
          disabled={busy !== null || apiKey.trim().length < 4}
          className="console-primary disabled:opacity-40"
        >
          {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <KeyRound size={13} />}
          {busy === "save" ? "Encrypting…" : saved ? "Saved" : item.configured ? "Rotate key" : "Save key"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </GlassCard>
  );
}

export default function ProviderKeysManager({ providers }: { providers: ProviderKeyStatus[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">
        Credentials are AES-256-GCM encrypted at rest and only ever decrypted server-side by the
        daily QCI refresh. Enabled keys feed the index; disabling one carries its last data forward.
      </p>
      {providers.map((p) => (
        <ProviderRow key={p.id} item={p} />
      ))}
    </div>
  );
}
