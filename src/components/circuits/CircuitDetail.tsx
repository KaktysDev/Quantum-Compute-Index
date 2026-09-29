"use client";

import Link from "next/link";
import { Loader2, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ActivityList } from "@/components/activity/ActivityList";
import { ConfirmDialog, InlineAlert, PageHeader, Panel, Timestamp } from "@/components/console/ui";
import { apiErrorMessage } from "@/lib/client/activity";
import type { CircuitResource } from "@/lib/qrouter/v2";
import { RunDialog } from "./RunDialog";
import { circuitState } from "./CircuitsList";

type Action = "release" | "delete" | null;

export function CircuitDetail({ id }: { id: string }) {
  const router = useRouter();
  const [circuit, setCircuit] = useState<CircuitResource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch(`/api/v2/circuits/${id}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      setError(apiErrorMessage(body, response.status === 404 ? "This circuit does not exist." : "Could not load the circuit."));
      return;
    }
    setCircuit(body.data as CircuitResource);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirm() {
    if (!action) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(action === "release" ? `/api/v2/circuits/${id}/release` : `/api/v2/circuits/${id}`, { method: action === "release" ? "POST" : "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = body?.code;
        throw new Error(code === "circuit_active" ? "This circuit still has jobs in progress or waiting for credits. Cancel them or let them finish first." : apiErrorMessage(body, "The request failed."));
      }
      if (action === "delete") {
        router.push("/dashboard/circuits");
        router.refresh();
        return;
      }
      setAction(null);
      await load();
      setListKey((value) => value + 1);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }

  const crumbs = [{ href: "/dashboard/circuits", label: "Circuits" }];
  if (error) {
    return (
      <div className="console-page">
        <PageHeader title="Circuit" crumbs={crumbs} />
        <InlineAlert tone="danger">{error}</InlineAlert>
      </div>
    );
  }
  if (!circuit) {
    return (
      <div className="console-page">
        <PageHeader title="Circuit" crumbs={crumbs} />
        <div className="empty"><Loader2 size={16} className="spin" /></div>
      </div>
    );
  }

  const analysis = circuit.analysis as Record<string, unknown>;
  const released = Boolean(circuit.released_at);
  const state = circuitState(circuit);
  const gateCounts = Object.entries((analysis.gateCounts ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const figure = (key: string) => (typeof analysis[key] === "number" ? (analysis[key] as number).toLocaleString() : "—");

  return (
    <div className="console-page wide">
      <PageHeader
        crumbs={crumbs}
        title={circuit.name ?? "Untitled circuit"}
        description={<span className="row" style={{ gap: 10 }}><span className={`status ${state.tone}`}>{state.label}</span><span className="mono dim">{circuit.id}</span></span>}
        actions={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => { setActionError(null); setAction("release"); }} disabled={released}>Release source</button>
            <button type="button" className="btn btn-danger" onClick={() => { setActionError(null); setAction("delete"); }}>Delete</button>
            <button type="button" className="btn btn-primary" onClick={() => setRunning(true)} disabled={released} title={released ? "Released circuits cannot be run" : undefined}>
              <Play size={13} /> New run
            </button>
          </>
        }
      />

      {released ? (
        <InlineAlert title="Source released">
          The circuit source and compiled programs were purged <Timestamp value={circuit.released_at} />. Metrics, results and billing records are kept; new runs are not possible.
        </InlineAlert>
      ) : null}

      <div className="circuit-summary">
        <Panel title="Circuit">
          <dl className="kv">
            <dt>Format</dt><dd>{circuit.format === "openqasm3" ? "OpenQASM 3" : "OpenQASM 2"}</dd>
            <dt>Qubits</dt><dd className="num">{figure("qubits")}</dd>
            <dt>Classical bits</dt><dd className="num">{figure("classicalBits")}</dd>
            <dt>Depth</dt><dd className="num">{figure("depth")}</dd>
            <dt>Gates</dt><dd className="num">{figure("gates")} <span className="dim">({figure("twoQubitGates")} two-qubit)</span></dd>
            <dt>Measurements</dt><dd className="num">{figure("measurements")}</dd>
            <dt>Created</dt><dd><Timestamp value={circuit.created_at} /></dd>
            {circuit.expires_at ? (<><dt>Expires</dt><dd><Timestamp value={circuit.expires_at} /></dd></>) : null}
            <dt>Source hash</dt><dd className="mono dim truncate" title={circuit.source_hash}>{circuit.source_hash.slice(0, 16)}…</dd>
          </dl>
        </Panel>
        <Panel title="Gate counts" flush>
          <div className="table-wrap">
            <table className="qr-table">
              <thead><tr><th>Gate</th><th className="num">Count</th></tr></thead>
              <tbody>
                {gateCounts.length === 0 ? (
                  <tr><td colSpan={2} className="empty-row">{released ? "Released." : "No gates recorded."}</td></tr>
                ) : (
                  gateCounts.slice(0, 12).map(([gate, count]) => (
                    <tr key={gate}><td><code>{gate}</code></td><td className="num">{count.toLocaleString()}</td></tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <section className="stack">
        <h2 className="section-title">Jobs</h2>
        <ActivityList key={listKey} circuitId={circuit.id} includeV1={false} />
      </section>

      <RunDialog
        circuitId={circuit.id}
        qubits={typeof analysis.qubits === "number" ? analysis.qubits : undefined}
        open={running}
        onClose={() => setRunning(false)}
        onStarted={(jobId, parked) => {
          setListKey((value) => value + 1);
          if (!parked) {
            setRunning(false);
            router.push(`/dashboard/activity?job=${jobId}`);
          }
        }}
      />

      <ConfirmDialog
        open={action !== null}
        title={action === "release" ? "Release circuit source?" : "Delete circuit?"}
        body={
          action === "release" ? (
            <>This permanently deletes the circuit source and compiled programs for this circuit and every job that used it. Metrics, results and billing records are kept. New runs will no longer be possible.</>
          ) : (
            <>This purges the circuit source and removes the circuit and all of its jobs. Billing records are kept. This cannot be undone. <Link href="/docs" className="link-btn">Learn more</Link></>
          )
        }
        confirmLabel={action === "release" ? "Release source" : "Delete circuit"}
        tone="danger"
        busy={busy}
        error={actionError ? <InlineAlert tone="danger">{actionError}</InlineAlert> : null}
        onConfirm={confirm}
        onClose={() => { if (!busy) setAction(null); }}
      />
    </div>
  );
}
