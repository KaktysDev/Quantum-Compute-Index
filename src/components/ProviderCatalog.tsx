"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, CheckSquare, Gauge, Search, SlidersHorizontal, Table2 } from "lucide-react";
import type { Backend } from "@/lib/qrouter/types";

type CatalogView = "list" | "table";
type CatalogKind = "all" | "qpu" | "simulator" | "connected";

function priceLabel(backend: Backend) {
  if (backend.pricePerNqh != null) return `$${backend.pricePerNqh.toFixed(2)} / QC-hour`;
  if (backend.pricePerTask) return `$${backend.pricePerTask.toFixed(3)} + $${backend.pricePerShot.toFixed(6)} / shot`;
  return `$${backend.pricePerShot.toFixed(6)} / shot`;
}

function estimatedRunPrice(backend: Backend) {
  return backend.pricePerTask + backend.pricePerShot * 1024;
}

export default function ProviderCatalog({ backends, initialQuery = "" }: { backends: Backend[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<CatalogKind>("all");
  const [view, setView] = useState<CatalogView>("list");
  const [sort, setSort] = useState("price");
  const [minQubits, setMinQubits] = useState(0);
  const [maxRunPrice, setMaxRunPrice] = useState(5);
  const [providers, setProviders] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const providerOptions = useMemo(() => [...new Set(backends.map((backend) => backend.provider))].sort(), [backends]);

  const visible = useMemo(() => backends.filter((backend) => {
    const terms = `${backend.displayName} ${backend.provider} ${backend.description} ${backend.nativeGates.join(" ")}`.toLowerCase();
    return (!query.trim() || terms.includes(query.trim().toLowerCase()))
      && (kind === "all" || kind === "connected" ? kind !== "connected" || backend.available : backend.kind === kind)
      && backend.qubits >= minQubits
      && estimatedRunPrice(backend) <= maxRunPrice
      && (!providers.length || providers.includes(backend.provider));
  }).sort((a, b) => {
    if (sort === "queue") return a.queueSeconds - b.queueSeconds;
    if (sort === "fidelity") return b.fidelity - a.fidelity;
    if (sort === "capacity") return b.qubits - a.qubits;
    return estimatedRunPrice(a) - estimatedRunPrice(b);
  }), [backends, kind, maxRunPrice, minQubits, providers, query, sort]);

  const selected = compare.map((id) => backends.find((backend) => backend.id === id)).filter(Boolean) as Backend[];

  function toggleProvider(provider: string) {
    setProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]);
  }

  function toggleCompare(id: string) {
    setCompare((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current);
  }

  return <div className="provider-marketplace">
    <aside className={`provider-filter-rail ${filtersOpen ? "open" : ""}`}>
      <div className="filter-rail-title"><SlidersHorizontal size={15} /><b>Filters</b><button className="mobile-filter-toggle" onClick={() => setFiltersOpen((current) => !current)}>{filtersOpen ? "Hide" : "Show"}</button><button onClick={() => { setKind("all"); setMinQubits(0); setMaxRunPrice(5); setProviders([]); }}>Reset</button></div>
      <section><h3>Compute type</h3>{[["all","All targets"],["qpu","Physical QPU"],["simulator","Simulator"],["connected","Connected"]].map(([value,label]) => <label key={value}><input type="radio" name="kind" checked={kind === value} onChange={() => setKind(value as CatalogKind)} /><span>{label}</span><small>{value === "all" ? backends.length : value === "connected" ? backends.filter((item) => item.available).length : backends.filter((item) => item.kind === value).length}</small></label>)}</section>
      <section><h3>Minimum qubits <span>{minQubits}</span></h3><input type="range" min="0" max="200" step="5" value={minQubits} onChange={(event) => setMinQubits(Number(event.target.value))} /><div className="filter-range"><span>0</span><span>200+</span></div></section>
      <section><h3>Max 1K-shot price <span>${maxRunPrice.toFixed(2)}</span></h3><input type="range" min="0.01" max="5" step="0.01" value={maxRunPrice} onChange={(event) => setMaxRunPrice(Number(event.target.value))} /><div className="filter-range"><span>$0.01</span><span>$5</span></div></section>
      <section><h3>Providers</h3>{providerOptions.map((provider) => <label key={provider}><input type="checkbox" checked={providers.includes(provider)} onChange={() => toggleProvider(provider)} /><span>{provider}</span><small>{backends.filter((item) => item.provider === provider).length}</small></label>)}</section>
      <section><h3>Capabilities</h3><p>OpenQASM 2 / 3</p><p>Hardware transpilation</p><p>Commit-pinned source</p><p>Normalized results</p></section>
    </aside>

    <main className="provider-catalog-main">
      <div className="provider-catalog-heading"><div><h1>Quantum providers</h1><p>Route one API across simulators and physical quantum computers.</p></div><Link href="/dashboard/playground">Deploy workload <ArrowRight size={13} /></Link></div>
      <div className="provider-catalog-toolbar">
        <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers, targets, and gates..." /></label>
        <div className="catalog-sort"><ArrowUpDown size={13} /><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="price">Lowest price</option><option value="queue">Shortest queue</option><option value="fidelity">Highest fidelity</option><option value="capacity">Most qubits</option></select></div>
        <button className={compare.length ? "active" : ""} onClick={() => document.getElementById("provider-compare")?.scrollIntoView({ behavior: "smooth" })}><CheckSquare size={13} /> Compare {compare.length || ""}</button>
        <div className="catalog-view-switch"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}><Table2 size={13} /> Table</button></div>
      </div>
      <div className="provider-category-tabs">{[["all","All"],["qpu","QPU"],["simulator","Simulators"],["connected","Connected"]].map(([value,label]) => <button key={value} className={kind === value ? "active" : ""} onClick={() => setKind(value as CatalogKind)}>{label}<span>{value === "all" ? backends.length : value === "connected" ? backends.filter((item) => item.available).length : backends.filter((item) => item.kind === value).length}</span></button>)}</div>
      <div className="provider-result-line"><span>{visible.length} targets</span><span>Rates normalized by QCI</span></div>

      {view === "list" ? <div className="provider-list">{visible.map((backend) => <article key={backend.id} className="provider-listing">
        <div className="provider-listing-top"><Link href={`/dashboard/providers/${backend.id}`}><span className="provider-mark">{backend.displayName.slice(0, 2).toUpperCase()}</span><div><h2>{backend.displayName}</h2><p>by {backend.provider}</p></div></Link><div><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Connected" : "Credential required"}</span><label title="Add to comparison"><input type="checkbox" checked={compare.includes(backend.id)} onChange={() => toggleCompare(backend.id)} /></label></div></div>
        <p className="provider-description">{backend.description}. {backend.connectivity} connectivity in {backend.region ?? "provider cloud"}.</p>
        <div className="provider-listing-meta"><span><b>{backend.qubits}</b> qubits</span><span><b>{Math.round(backend.queueSeconds)}s</b> queue</span><span><b>{(backend.fidelity * 100).toFixed(2)}%</b> fidelity</span><span><b>{(backend.reliability * 100).toFixed(1)}%</b> uptime</span><span><b>{priceLabel(backend)}</b></span><Link href={`/dashboard/providers/${backend.id}`}>Details <ArrowRight size={12} /></Link></div>
      </article>)}</div> : <div className="provider-table"><div className="provider-table-head"><span>Target</span><span>Type</span><span>Qubits</span><span>Queue</span><span>Fidelity</span><span>Price</span><span>Status</span></div>{visible.map((backend) => <Link href={`/dashboard/providers/${backend.id}`} key={backend.id}><span><b>{backend.displayName}</b><small>{backend.provider}</small></span><span>{backend.kind}</span><span>{backend.qubits}</span><span>{backend.queueSeconds}s</span><span>{(backend.fidelity * 100).toFixed(2)}%</span><span>{priceLabel(backend)}</span><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Connected" : "BYOK"}</span></Link>)}</div>}
      {!visible.length && <div className="provider-no-results"><Search size={22} /><b>No matching targets</b><p>Adjust filters or clear the search query.</p></div>}

      {selected.length > 0 && <section className="provider-compare" id="provider-compare"><header><div><Gauge size={15} /><span><b>Compare targets</b><small>Up to four provider endpoints</small></span></div><button onClick={() => setCompare([])}>Clear</button></header><div className="provider-compare-grid" style={{ gridTemplateColumns: `130px repeat(${selected.length}, minmax(0, 1fr))` }}><span>Metric</span>{selected.map((backend) => <b key={`name-${backend.id}`}>{backend.displayName}</b>)}<span>Type</span>{selected.map((backend) => <code key={`type-${backend.id}`}>{backend.kind}</code>)}<span>Capacity</span>{selected.map((backend) => <code key={`capacity-${backend.id}`}>{backend.qubits} qubits</code>)}<span>Queue</span>{selected.map((backend) => <code key={`queue-${backend.id}`}>{backend.queueSeconds}s</code>)}<span>Fidelity</span>{selected.map((backend) => <code key={`fidelity-${backend.id}`}>{(backend.fidelity * 100).toFixed(2)}%</code>)}<span>Price</span>{selected.map((backend) => <code key={`price-${backend.id}`}>{priceLabel(backend)}</code>)}</div></section>}
    </main>
  </div>;
}
