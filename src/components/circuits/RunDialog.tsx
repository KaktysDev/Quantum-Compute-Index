"use client";

// Start a single or compare run of a stored circuit: pick 1–10 targets, share
// one set of run settings, submit one v2 job.

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { InlineAlert } from "@/components/console/ui";
import { apiErrorMessage } from "@/lib/client/activity";
import { buildRunRequest, DEFAULT_RUN_SETTINGS, estimateProviderCost, MAX_COMPARE_TARGETS, type RunSettings } from "@/lib/client/compare";
import { formatUsd } from "@/lib/qrouter/cost";
import type { RoutingMode } from "@/lib/qrouter/types";

type BackendOption = {
  id: string;
  displayName: string;
  provider: string;
  kind: "qpu" | "simulator";
  status: string;
  qubits: number;
  available?: boolean;
  pricePerShot?: number;
  pricePerTask?: number;
  queueSeconds?: number;
};

const AUTO: BackendOption = { id: "auto", displayName: "Automatic", provider: "Routed by QRouter", kind: "simulator", status: "online", qubits: 0, available: true };

export function RunDialog({
  circuitId,
  qubits,
  open,
  onClose,
  onStarted,
}: {
  circuitId: string;
  qubits?: number;
  open: boolean;
  onClose: () => void;
  onStarted: (jobId: string, parked: boolean) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keyRef = useRef("");
  const [backends, setBackends] = useState<BackendOption[] | null>(null);
  const [selected, setSelected] = useState<string[]>(["auto"]);
  const [name, setName] = useState("");
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_RUN_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parked, setParked] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      keyRef.current = crypto.randomUUID();
      setError(null);
      setParked(false);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || backends) return;
    fetch("/api/v2/backends", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(apiErrorMessage(body, "Could not load targets."));
        setBackends(body.data as BackendOption[]);
      })
      .catch((value) => setError(value instanceof Error ? value.message : "Could not load targets."));
  }, [backends, open]);

  const options = useMemo(() => [AUTO, ...(backends ?? [])], [backends]);
  const fits = (backend: BackendOption) => backend.id === "auto" || !qubits || backend.qubits >= qubits;
  const usable = (backend: BackendOption) => backend.id === "auto" || (backend.available !== false && backend.status !== "offline" && fits(backend));

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= MAX_COMPARE_TARGETS) return current;
      return [...current, id];
    });
  }

  const set = <K extends keyof RunSettings>(key: K, value: RunSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const estimate = selected.reduce<number | null>((total, id) => {
    const backend = options.find((item) => item.id === id);
    const value = backend && backend.id !== "auto" ? estimateProviderCost(backend, settings.shots) : null;
    return value === null ? total : (total ?? 0) + value;
  }, null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected.length) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v2/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": keyRef.current },
        body: JSON.stringify(buildRunRequest({ circuitId, name, targets: selected, settings })),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 402 && body?.data?.id) {
        setParked(true);
        onStarted(body.data.id, true);
        return;
      }
      if (!response.ok) throw new Error(apiErrorMessage(body, "Could not start the run."));
      onStarted(body.data.id, false);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not start the run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="qr-dialog wide" onClose={onClose}>
      <form onSubmit={submit}>
        <header>
          <h2>New run</h2>
          <p>Choose one target, or several to compare them on the same circuit. Each target runs as its own execution.</p>
        </header>
        <div className="dialog-body">
          <label className="field">
            Name <small>Optional</small>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="Bell pair, simulator vs QPU" />
          </label>

          <fieldset className="target-picker">
            <legend className="field">
              Targets <small>{selected.length} of {MAX_COMPARE_TARGETS} selected</small>
            </legend>
            {!backends && !error ? <div className="empty" style={{ padding: 24 }}><Loader2 size={16} className="spin" /></div> : null}
            <div className="target-list">
              {backends
                ? options.map((backend) => {
                    const checked = selected.includes(backend.id);
                    const disabled = !usable(backend) || (!checked && selected.length >= MAX_COMPARE_TARGETS);
                    const price = backend.id === "auto" ? null : estimateProviderCost(backend, settings.shots);
                    return (
                      <label key={backend.id} className={`target-option${checked ? " checked" : ""}${disabled ? " disabled" : ""}`}>
                        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(backend.id)} />
                        <span className="cell-main">
                          <b>{backend.displayName}</b>
                          <small>
                            {backend.id === "auto"
                              ? "Best match for the routing mode"
                              : `${backend.provider} · ${backend.kind === "qpu" ? "QPU" : "Simulator"} · ${backend.qubits} qubits`}
                            {backend.id !== "auto" && !fits(backend) ? " · too few qubits" : ""}
                            {backend.id !== "auto" && backend.available === false ? " · not connected" : ""}
                          </small>
                        </span>
                        <span className="num dim">{price === null ? "" : `~${formatUsd(price)}`}</span>
                      </label>
                    );
                  })
                : null}
            </div>
          </fieldset>

          <div className="form-grid two" style={{ padding: 0 }}>
            <label className="field">
              Shots
              <input className="input" type="number" min={1} max={1_000_000} value={settings.shots} onChange={(event) => set("shots", Math.max(1, Math.min(1_000_000, Number(event.target.value) || 1)))} />
            </label>
            <label className="field">
              Routing mode
              <select className="input" value={settings.routingMode} onChange={(event) => set("routingMode", event.target.value as RoutingMode)}>
                <option value="balanced">Balanced</option>
                <option value="cost">Cost</option>
                <option value="speed">Speed</option>
                <option value="quality">Quality</option>
              </select>
            </label>
          </div>

          <details className="advanced">
            <summary>Advanced</summary>
            <div className="form-grid three" style={{ padding: "12px 0 0" }}>
              <label className="field">
                Optimization level
                <select className="input" value={settings.optimizationLevel} onChange={(event) => set("optimizationLevel", Number(event.target.value))}>
                  {[0, 1, 2, 3].map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
              </label>
              <label className="field">
                Max attempts
                <input className="input" type="number" min={1} max={5} value={settings.maxAttempts} onChange={(event) => set("maxAttempts", Math.max(1, Math.min(5, Number(event.target.value) || 1)))} />
              </label>
              <label className="field">
                Timeout (minutes)
                <input className="input" type="number" min={1} max={10080} value={Math.round(settings.timeoutSeconds / 60)} onChange={(event) => set("timeoutSeconds", Math.max(60, Math.min(604_800, (Number(event.target.value) || 1) * 60)))} />
              </label>
            </div>
            <label className="check-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={settings.failover} onChange={(event) => set("failover", event.target.checked)} />
              Fail over to the next compatible backend if a target is unavailable
            </label>
          </details>

          {parked ? (
            <InlineAlert tone="warning" title="Waiting for credits" action={<Link href="/dashboard/billing" className="btn btn-secondary btn-sm">Add credits</Link>}>
              The job was created and starts automatically once credits are added.
            </InlineAlert>
          ) : null}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
        </div>
        <footer>
          <span className="dim" style={{ marginRight: "auto", alignSelf: "center" }}>
            {estimate === null ? "Quoted on submit" : `Provider estimate ~${formatUsd(estimate)} plus fees`}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !selected.length || !backends}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {selected.length > 1 ? `Run on ${selected.length} targets` : "Run"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
