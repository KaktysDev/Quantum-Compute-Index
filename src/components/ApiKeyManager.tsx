"use client";

import { Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog, CopyButton, InlineAlert, Panel, Timestamp } from "@/components/console/ui";
import { apiErrorMessage } from "@/lib/client/activity";

type Key = {
  id: string;
  name: string;
  key_prefix: string;
  environment: string;
  scopes?: string[] | null;
  last_used_at?: string | null;
  created_at: string;
  revoked_at?: string | null;
};

const ACCESS = {
  full: { label: "Read and write", scopes: ["jobs:read", "jobs:write"] },
  read: { label: "Read only", scopes: ["jobs:read"] },
} as const;

function accessLabel(scopes: string[] | null | undefined) {
  if (!scopes?.length || scopes.includes("jobs:write")) return "Read and write";
  return "Read only";
}

export default function ApiKeyManager() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Production");
  const [environment, setEnvironment] = useState<"live" | "test">("live");
  const [access, setAccess] = useState<keyof typeof ACCESS>("full");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/api-keys", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setLoadError(apiErrorMessage(body, "Could not load API keys."));
      return;
    }
    setKeys((body.data as Key[]).filter((key) => !key.revoked_at));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, environment, scopes: ACCESS[access].scopes }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiErrorMessage(body, "Could not create the key."));
      setCreated(body.key);
      void load();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not create the key.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setRevokeBusy(true);
    await fetch(`/api/v1/api-keys/${revoking.id}`, { method: "DELETE" }).catch(() => null);
    setRevokeBusy(false);
    setRevoking(null);
    void load();
  }

  return (
    <>
      <Panel
        title="Secret keys"
        description="Keys belong to this workspace. Keep them server-side."
        flush
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setCreated(null); setError(null); setOpen(true); }}>
            <Plus size={14} /> Create key
          </button>
        }
      >
        {loadError ? <div className="panel-body"><InlineAlert tone="danger">{loadError}</InlineAlert></div> : null}
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key</th>
                <th className="hide-sm">Environment</th>
                <th className="hide-sm">Access</th>
                <th className="hide-sm">Last used</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {!keys ? (
                <tr><td colSpan={6} className="empty-row"><Loader2 size={16} className="spin" /></td></tr>
              ) : keys.length === 0 ? (
                <tr><td colSpan={6} className="empty-row">No active keys. Create one to call the API or use the CLI.</td></tr>
              ) : (
                keys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <span className="cell-main">
                        <b>{key.name}</b>
                        <small>Created <Timestamp value={key.created_at} /></small>
                      </span>
                    </td>
                    <td><code>{key.key_prefix}…</code></td>
                    <td className="hide-sm"><span className={`badge${key.environment === "live" ? " env live" : ""}`}>{key.environment}</span></td>
                    <td className="hide-sm muted">{accessLabel(key.scopes)}</td>
                    <td className="hide-sm">{key.last_used_at ? <Timestamp value={key.last_used_at} /> : <span className="dim">Never</span>}</td>
                    <td className="num">
                      {key.id !== "demo" ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRevoking(key)}>Revoke</button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <dialog ref={dialogRef} className="qr-dialog" onClose={() => setOpen(false)}>
        {created ? (
          <div>
            <header>
              <h2>Copy your key</h2>
              <p>This is the only time the full secret is shown. Store it somewhere safe.</p>
            </header>
            <div className="dialog-body">
              <div className="created-key">
                <code>{created}</code>
                <CopyButton value={created} label="Copy key" />
              </div>
            </div>
            <footer>
              <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>
            </footer>
          </div>
        ) : (
          <form onSubmit={create}>
            <header>
              <h2>Create API key</h2>
            </header>
            <div className="dialog-body">
              <label className="field">
                Name
                <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
              </label>
              <div className="form-grid two" style={{ padding: 0 }}>
                <label className="field">
                  Environment
                  <select className="input" value={environment} onChange={(event) => setEnvironment(event.target.value as typeof environment)}>
                    <option value="live">Live</option>
                    <option value="test">Test (simulators only)</option>
                  </select>
                </label>
                <label className="field">
                  Access
                  <select className="input" value={access} onChange={(event) => setAccess(event.target.value as keyof typeof ACCESS)}>
                    {Object.entries(ACCESS).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
              {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            </div>
            <footer>
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? <Loader2 size={14} className="spin" /> : null}
                Create key
              </button>
            </footer>
          </form>
        )}
      </dialog>

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.name ?? "key"}?`}
        body="Requests using this key will fail authentication immediately. This cannot be undone."
        confirmLabel="Revoke key"
        tone="danger"
        busy={revokeBusy}
        onConfirm={revoke}
        onClose={() => setRevoking(null)}
      />
    </>
  );
}
