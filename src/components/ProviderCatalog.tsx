"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Money, PageHeader } from "@/components/console/ui";
import type { Backend } from "@/lib/qrouter/types";

type Kind = "all" | "qpu" | "simulator" | "connected";
type Sort = "price" | "queue" | "fidelity" | "capacity";

const KINDS: Array<[Kind, string]> = [["all", "All"], ["qpu", "QPU"], ["simulator", "Simulators"], ["connected", "Connected"]];

const runPrice = (backend: Backend) => backend.pricePerTask + backend.pricePerShot * 1024;

function queue(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function status(backend: Backend) {
  if (!backend.available) return <span className="status neutral">Not connected</span>;
  if (backend.status === "online") return <span className="status success">Online</span>;
  if (backend.status === "degraded") return <span className="status warning">Degraded</span>;
  return <span className="status danger">Offline</span>;
}

export default function ProviderCatalog({ backends, initialQuery = "" }: { backends: Backend[]; initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<Kind>("all");
  const [sort, setSort] = useState<Sort>("price");

  const counts = useMemo(() => ({
    all: backends.length,
    qpu: backends.filter((backend) => backend.kind === "qpu").length,
    simulator: backends.filter((backend) => backend.kind === "simulator").length,
    connected: backends.filter((backend) => backend.available).length,
  }), [backends]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return backends
      .filter((backend) => {
        if (kind === "connected" && !backend.available) return false;
        if ((kind === "qpu" || kind === "simulator") && backend.kind !== kind) return false;
        if (!term) return true;
        return `${backend.displayName} ${backend.id} ${backend.provider} ${backend.description} ${backend.nativeGates.join(" ")}`.toLowerCase().includes(term);
      })
      .sort((a, b) => {
        if (sort === "queue") return a.queueSeconds - b.queueSeconds;
        if (sort === "fidelity") return b.fidelity - a.fidelity;
        if (sort === "capacity") return b.qubits - a.qubits;
        return runPrice(a) - runPrice(b);
      });
  }, [backends, kind, query, sort]);

  return (
    <div className="console-page wide">
      <PageHeader
        title="Providers"
        description="Every backend QRouter can route to, with the list prices quotes are built from."
        actions={<Link href="/dashboard/run" className="btn btn-primary">Run a circuit</Link>}
      />

      <div className="catalog-toolbar">
        <label className="catalog-search">
          <Search size={14} aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, provider or gate" aria-label="Search backends" />
        </label>
        <div className="segmented" role="group" aria-label="Backend type">
          {KINDS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)}>
              {label} <span className="dim num">{counts[value]}</span>
            </button>
          ))}
        </div>
        <label className="select-wrap catalog-sort">
          <select className="input" value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort by">
            <option value="price">Lowest price</option>
            <option value="queue">Shortest queue</option>
            <option value="fidelity">Highest fidelity</option>
            <option value="capacity">Most qubits</option>
          </select>
        </label>
      </div>

      <section className="panel">
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr>
                <th>Backend</th>
                <th>Status</th>
                <th className="hide-sm">Type</th>
                <th className="num">Qubits</th>
                <th className="num hide-sm">Queue</th>
                <th className="num hide-sm">Fidelity</th>
                <th className="num">1,024 shots</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={7} className="empty-row">No backends match. Clear the search or pick another type.</td></tr>
              ) : (
                visible.map((backend) => {
                  const href = `/dashboard/providers/${backend.id}`;
                  return (
                    <tr key={backend.id} className="clickable" onClick={() => router.push(href)}>
                      <td>
                        <Link href={href} className="cell-main" onClick={(event) => event.stopPropagation()}>
                          <b>{backend.displayName}</b>
                          <small>{backend.provider} · <span className="mono">{backend.id}</span></small>
                        </Link>
                      </td>
                      <td>{status(backend)}</td>
                      <td className="hide-sm muted">{backend.kind === "qpu" ? "QPU" : "Simulator"}</td>
                      <td className="num">{backend.qubits.toLocaleString()}</td>
                      <td className="num hide-sm">{queue(backend.queueSeconds)}</td>
                      <td className="num hide-sm">{(backend.fidelity * 100).toFixed(2)}%</td>
                      <td className="num"><Money value={runPrice(backend)} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span>{visible.length} of {backends.length} backends</span>
          <span>Quotes add transpiler and platform fees</span>
        </div>
      </section>
    </div>
  );
}
