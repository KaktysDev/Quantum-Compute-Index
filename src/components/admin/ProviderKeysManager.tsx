"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, InlineAlert, Panel, Timestamp } from "@/components/console/ui";

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  const anyFilled = Object.values(values).some((value) => value.trim().length > 0);
  const fields: ProviderField[] = item.fields.length > 0 ? item.fields : [{ key: "apiKey", label: `${item.name} API key`, type: "password" }];

  async function call(body: Record<string, unknown>, method: "POST" | "DELETE" = "POST", path = "/api/admin/provider-keys") {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: item.id, ...body }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
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
    } catch (value) {
      setError(value instanceof Error ? value.message : "Save failed");
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
      setTest((await call(anyFilled ? { fieldValues: values } : {}, "POST", "/api/admin/provider-keys/test")) as TestResult);
    } catch (value) {
      setTest({ ok: false, message: value instanceof Error ? value.message : "Test failed" });
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
    } catch (value) {
      setError(value instanceof Error ? value.message : "Toggle failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    setError(null);
    try {
      await call({}, "DELETE");
      setTest(null);
      setConfirmDelete(false);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  const spinner = (key: string) => (busy === key ? <Loader2 size={13} className="spin" /> : null);
  const state = !item.configured ? { label: "Not configured", tone: "neutral" } : item.enabled ? { label: "Enabled", tone: "success" } : { label: "Disabled", tone: "warning" };

  return (
    <Panel
      title={<span className="row" style={{ gap: 10 }}>{item.name}<span className={`status ${state.tone}`} style={{ fontWeight: 400 }}>{state.label}</span></span>}
      description={
        <>
          {item.description}
          {item.updatedAt ? <> · key updated <Timestamp value={item.updatedAt} /></> : null}
        </>
      }
      actions={
        item.configured ? (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={toggle} disabled={busy !== null}>
              {spinner("toggle")} {item.enabled ? "Disable" : "Enable"}
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
              Delete
            </button>
          </>
        ) : null
      }
    >
      <div className="stack">
        <div className={`form-grid ${fields.length > 1 ? "three" : ""}`} style={{ padding: 0 }}>
          {fields.map((field) => (
            <label key={field.key} className="field">
              {field.label}
              <input
                className="input mono"
                type={field.type === "password" ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(event) => { setValues((current) => ({ ...current, [field.key]: event.target.value })); setSaved(false); }}
                placeholder={field.placeholder ?? (item.configured ? "Paste a new value to rotate" : field.label)}
                autoComplete="off"
              />
            </label>
          ))}
        </div>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={saveKey} disabled={busy !== null || !anyFilled}>
            {busy === "save" ? <Loader2 size={13} className="spin" /> : saved ? <Check size={13} /> : null}
            {saved ? "Saved" : item.configured ? "Rotate key" : "Save key"}
          </button>
          {item.testable ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={testConnection}
              disabled={busy !== null || (!item.configured && !anyFilled)}
              title={anyFilled ? "Tests the values typed above, before saving" : "Tests the stored credential"}
            >
              {spinner("test")} {anyFilled ? "Test pasted key" : "Test connection"}
            </button>
          ) : null}
        </div>

        {test ? (
          <InlineAlert tone={test.ok ? "success" : "danger"} title={test.message}>
            {test.details?.length ? (
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                {test.details.map((detail) => <li key={detail} className="mono">{detail}</li>)}
              </ul>
            ) : null}
          </InlineAlert>
        ) : null}
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete the ${item.name} credential?`}
        body="The stored key is removed and the QCI refresh stops pulling this provider."
        confirmLabel="Delete credential"
        tone="danger"
        busy={busy === "delete"}
        onConfirm={remove}
        onClose={() => setConfirmDelete(false)}
      />
    </Panel>
  );
}

export default function ProviderKeysManager({ providers }: { providers: ProviderKeyStatus[] }) {
  return (
    <div className="stack">
      <p className="muted">
        Credentials are AES-256-GCM encrypted at rest and only decrypted server-side. Enabled keys feed the daily QCI refresh. Use Test
        connection to confirm a key reaches the provider and lists its QPUs.
      </p>
      {providers.map((provider) => <ProviderRow key={provider.id} item={provider} />)}
    </div>
  );
}
