"use client";

import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { InlineAlert } from "@/components/console/ui";
import { apiErrorMessage } from "@/lib/client/activity";

const SAMPLE = `OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;`;

/** Stores a circuit through POST /api/v2/circuits, then opens it. */
export function UploadCircuitButton({ label = "Upload circuit", variant = "primary" }: { label?: string; variant?: "primary" | "secondary" }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"openqasm2" | "openqasm3">("openqasm2");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per open dialog, so a retried submit cannot create a duplicate.
  const keyRef = useRef<string>("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function show() {
    keyRef.current = crypto.randomUUID();
    setError(null);
    setOpen(true);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    setSource(text);
    if (!name) setName(file.name.replace(/\.(qasm|txt)$/i, ""));
    setFormat(/OPENQASM\s+3/i.test(text) ? "openqasm3" : "openqasm2");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v2/circuits", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": keyRef.current },
        body: JSON.stringify({ name: name.trim() || undefined, circuit: source, format }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiErrorMessage(body, "Could not store the circuit."));
      setOpen(false);
      router.push(`/dashboard/circuits/${body.data.id}`);
      router.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not store the circuit.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={`btn btn-${variant}`} onClick={show}>
        <Upload size={14} /> {label}
      </button>
      <dialog ref={dialogRef} className="qr-dialog wide" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <header>
            <h2>Upload circuit</h2>
            <p>Stored once and referenced by id. Run it on one or more targets from its page.</p>
          </header>
          <div className="dialog-body">
            <div className="form-grid two" style={{ padding: 0 }}>
              <label className="field">
                Name
                <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Bell pair" />
              </label>
              <label className="field">
                Format
                <select className="input" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>
                  <option value="openqasm2">OpenQASM 2</option>
                  <option value="openqasm3">OpenQASM 3</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span className="row-between">
                Source
                <span className="row">
                  <button type="button" className="link-btn" onClick={() => setSource(SAMPLE)}>Use sample</button>
                  <label className="link-btn" style={{ fontWeight: 400 }}>
                    Choose file
                    <input type="file" accept=".qasm,.txt,text/plain" hidden onChange={(event) => void onFile(event.target.files?.[0])} />
                  </label>
                </span>
              </span>
              <textarea className="input" value={source} onChange={(event) => setSource(event.target.value)} rows={12} required spellCheck={false} placeholder="OPENQASM 2.0;" />
            </label>
            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          </div>
          <footer>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy || !source.trim()}>
              {busy ? <Loader2 size={14} className="spin" /> : null}
              Store circuit
            </button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
