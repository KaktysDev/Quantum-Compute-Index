"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { InlineAlert, Timestamp } from "@/components/console/ui";
import { apiErrorMessage } from "@/lib/client/activity";
import type { CircuitListItem } from "@/lib/qrouter/v2";

function metric(analysis: Record<string, unknown>, key: string) {
  const value = analysis[key];
  return typeof value === "number" ? value.toLocaleString() : "—";
}

export function circuitState(circuit: Pick<CircuitListItem, "released_at" | "expires_at">): { label: string; tone: "neutral" | "warning" | "success" } {
  if (circuit.released_at) return { label: "Released", tone: "neutral" };
  if (circuit.expires_at) {
    const days = Math.ceil((Date.parse(circuit.expires_at) - Date.now()) / 86_400_000);
    if (days <= 7) return { label: days <= 0 ? "Expiring" : `Expires in ${days}d`, tone: "warning" };
  }
  return { label: "Active", tone: "success" };
}

export function CircuitsList() {
  const router = useRouter();
  const [circuits, setCircuits] = useState<CircuitListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(next?: string) {
    const params = new URLSearchParams({ limit: "50" });
    if (next) params.set("cursor", next);
    const response = await fetch(`/api/v2/circuits?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiErrorMessage(body, "Could not load circuits."));
    return body as { data: CircuitListItem[]; has_more: boolean; next_cursor: string | null };
  }

  useEffect(() => {
    load()
      .then((page) => {
        setCircuits(page.data);
        setCursor(page.has_more ? page.next_cursor : null);
      })
      .catch((value) => setError(value instanceof Error ? value.message : "Could not load circuits."))
      .finally(() => setLoading(false));
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setMore(true);
    try {
      const page = await load(cursor);
      setCircuits((current) => [...current, ...page.data]);
      setCursor(page.has_more ? page.next_cursor : null);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Could not load circuits.");
    } finally {
      setMore(false);
    }
  }

  return (
    <div className="stack">
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      <section className="panel">
        {loading ? (
          <div className="empty"><Loader2 size={16} className="spin" /></div>
        ) : (
          <div className="table-wrap">
            <table className="qr-table">
              <thead>
                <tr>
                  <th>Circuit</th>
                  <th>State</th>
                  <th className="num hide-sm">Qubits</th>
                  <th className="num hide-sm">Depth</th>
                  <th className="num hide-sm">Gates</th>
                  <th className="num">Jobs</th>
                  <th className="hide-sm">Last run</th>
                  <th className="hide-sm">Created</th>
                </tr>
              </thead>
              <tbody>
                {circuits.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-row">
                      No stored circuits. Upload one to run it on several targets at once. Runs from the assistant are listed under Activity.
                    </td>
                  </tr>
                ) : (
                  circuits.map((circuit) => {
                    const state = circuitState(circuit);
                    const href = `/dashboard/circuits/${circuit.id}`;
                    return (
                      <tr key={circuit.id} className="clickable" onClick={() => router.push(href)}>
                        <td>
                          <a href={href} className="cell-main" onClick={(event) => event.stopPropagation()}>
                            <b className="truncate">{circuit.name ?? "Untitled circuit"}</b>
                            <small className="mono">{circuit.id.slice(0, 8)} · {circuit.format === "openqasm3" ? "QASM 3" : "QASM 2"}</small>
                          </a>
                        </td>
                        <td><span className={`status ${state.tone}`}>{state.label}</span></td>
                        <td className="num hide-sm">{metric(circuit.analysis, "qubits")}</td>
                        <td className="num hide-sm">{metric(circuit.analysis, "depth")}</td>
                        <td className="num hide-sm">{metric(circuit.analysis, "gates")}</td>
                        <td className="num">{circuit.job_count}</td>
                        <td className="hide-sm"><Timestamp value={circuit.last_job_at} /></td>
                        <td className="hide-sm"><Timestamp value={circuit.created_at} /></td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
        {cursor ? (
          <div className="panel-foot">
            <span>{circuits.length} circuits shown</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadMore} disabled={more}>
              {more ? <Loader2 size={13} className="spin" /> : null} Load more
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
