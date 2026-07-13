"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
  Power,
  Radio,
  Trash2,
  XCircle,
} from "lucide-react";
import GlassCard from "@/components/GlassCard";

export interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
}

export interface ProviderKeyStatus {
  id: string;
  name: string;
  description: string;
  docsUrl: string;
  fields: ProviderField[];
  testable: boolean;
  configured: boolean;
  enabled: boolean;
  label: string | null;
  updatedAt: string | null;
}

interface TestResult {
  ok: boolean;
  message: string;
  details?: string[];
}

function ProviderRow({ item }: { item: ProviderKeyStatus }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const anyFilled = Object.values(values).some((v) => v.trim().length > 0);
  const fields: ProviderField[] =
    item.fields.length > 0
      ? item.fields
      : [{ key: "apiKey", label: `${item.name} API key`, type: "password" }];

  async function call(body: Record<string, unknown>, method: "POST" | "DELETE" = "POST", path = "/api/admin/provider-keys") {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: item.id, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }

  async function saveKey() {
    if (!anyFilled) return;
    setBusy("save");
    setError(null);
    setTest(null);
    try {
      await call({ fieldValues: values, enabled: true });
      setValues({});
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  /** Tests the typed values if any are filled, otherwise the stored credential. */
  async function testConnection() {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      const result = (await call(
        anyFilled ? { fieldValues: values } : {},
        "POST",
        "/api/admin/provider-keys/test",
      )) as TestResult;
      setTest(result);
    } catch (err) {
      setTest({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
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
      setTest(null);
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

      {/* Credential inputs — one per adapter field (AWS gets key id + secret + region) */}
      <div className={`mt-3 grid gap-2 ${fields.length > 1 ? "sm:grid-cols-2 lg:grid-cols-3" : ""}`}>
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">{f.label}</span>
            <input
              type={f.type === "password" ? "password" : "text"}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder ?? (item.configured ? "Rotate: paste a new value" : f.label)}
              className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-xs text-white placeholder:text-[var(--muted)] outline-none focus:border-[var(--qr-emerald,#34d399)]"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={saveKey}
          disabled={busy !== null || !anyFilled}
          className="console-primary disabled:opacity-40"
        >
          {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <KeyRound size={13} />}
          {busy === "save" ? "Encrypting…" : saved ? "Saved" : item.configured ? "Rotate key" : "Save key"}
        </button>
        {item.testable && (
          <button
            onClick={testConnection}
            disabled={busy !== null || (!item.configured && !anyFilled)}
            className="flex items-center gap-1.5 rounded-lg border border-sky-300/30 px-3.5 py-2 text-xs text-sky-300 transition-colors hover:bg-sky-300/10 disabled:opacity-40"
            title={anyFilled ? "Tests the values typed above (before saving)" : "Tests the stored credential"}
          >
            {busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Radio size={13} />}
            {busy === "test" ? "Probing…" : anyFilled ? "Test pasted key" : "Test connection"}
          </button>
        )}
      </div>

      {/* Connection test outcome — proves the key actually pulls data */}
      {test && (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            test.ok ? "border-emerald-300/25 bg-emerald-300/5" : "border-red-400/25 bg-red-400/5"
          }`}
        >
          <p className={`flex items-center gap-2 text-xs font-medium ${test.ok ? "text-emerald-300" : "text-red-400"}`}>
            {test.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
            {test.message}
          </p>
          {test.details && test.details.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {test.details.map((d) => (
                <li key={d} className="font-mono text-[10px] text-[var(--muted)]">· {d}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </GlassCard>
  );
}

export default function ProviderKeysManager({ providers }: { providers: ProviderKeyStatus[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--muted)]">
        Credentials are AES-256-GCM encrypted at rest and only ever decrypted server-side.
        Enabled keys feed the daily QCI refresh; use <b className="text-white">Test connection</b> to
        verify a key actually reaches the provider and lists its QPUs — before or after saving.
      </p>
      {providers.map((p) => (
        <ProviderRow key={p.id} item={p} />
      ))}
    </div>
  );
}
