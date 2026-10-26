"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, ArrowUpDown, CheckSquare, Gauge, Search, SlidersHorizontal, Table2 } from "lucide-react";
import type { Backend } from "@/lib/qrouter/types";
import { describeProviderPricing, pricingDate } from "@/components/providers/pricing-display";

type CatalogView = "list" | "table";
type CatalogKind = "all" | "qpu" | "simulator" | "connected";

export default function ProviderCatalog({ backends, asOf, initialQuery = "" }: { backends: Backend[]; asOf: number; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [kind, setKind] = useState<CatalogKind>("all");
  const [view, setView] = useState<CatalogView>("list");
  const [sort, setSort] = useState("price");
  const [minQubits, setMinQubits] = useState(0);
  const [maxRunPrice, setMaxRunPrice] = useState(5);
  const [applyPriceLimit, setApplyPriceLimit] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [compare, setCompare] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const pricing = useMemo(() => new Map(backends.map((backend) => [backend.id, describeProviderPricing(backend, asOf)])), [backends, asOf]);
  const providerOptions = useMemo(() => [...new Set(backends.map((backend) => backend.provider))].sort(), [backends]);
  const visible = useMemo(() => backends.filter((backend) => {
    const terms = `${backend.displayName} ${backend.provider} ${backend.description} ${backend.nativeGates.join(" ")}`.toLowerCase();
    const estimate = pricing.get(backend.id)?.estimate;
    return (!query.trim() || terms.includes(query.trim().toLowerCase()))
      && (kind === "all" || kind === "connected" ? kind !== "connected" || backend.available : backend.kind === kind)
      && backend.qubits >= minQubits
      && (!applyPriceLimit || (estimate != null && estimate <= maxRunPrice))
      && (!providers.length || providers.includes(backend.provider));
  }).sort((a, b) => {
    if (sort === "queue") return a.queueSeconds - b.queueSeconds;
    if (sort === "fidelity") return b.fidelity - a.fidelity;
    if (sort === "capacity") return b.qubits - a.qubits;
    return (pricing.get(a.id)?.estimate ?? Infinity) - (pricing.get(b.id)?.estimate ?? Infinity) || a.displayName.localeCompare(b.displayName);
  }), [backends, kind, maxRunPrice, applyPriceLimit, minQubits, pricing, providers, query, sort]);
  const selected = compare.map((id) => backends.find((backend) => backend.id === id)).filter(Boolean) as Backend[];
  const toggleProvider = (provider: string) => setProviders((current) => current.includes(provider) ? current.filter((item) => item !== provider) : [...current, provider]);
  const toggleCompare = (id: string) => setCompare((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 4 ? [...current, id] : current);

  return <div className="provider-marketplace">
    <aside className={`provider-filter-rail ${filtersOpen ? "open" : ""}`}>
      <div className="filter-rail-title"><SlidersHorizontal size={15} /><b>Filters</b><button className="mobile-filter-toggle" onClick={() => setFiltersOpen((current) => !current)}>{filtersOpen ? "Hide" : "Show"}</button><button onClick={() => { setKind("all"); setMinQubits(0); setMaxRunPrice(5); setApplyPriceLimit(false); setProviders([]); }}>Reset</button></div>
      <section><h3>Minimum qubits <span>{minQubits}</span></h3><input aria-label="Minimum qubits" type="range" min="0" max="200" step="5" value={minQubits} onChange={(event) => setMinQubits(Number(event.target.value))} /><div className="filter-range"><span>0</span><span>200+</span></div></section>
      <section><h3>Native estimate cap <span>${maxRunPrice.toFixed(2)}</span></h3><label><input type="checkbox" checked={applyPriceLimit} onChange={(event) => setApplyPriceLimit(event.target.checked)} /><span>Apply price filter</span></label><input aria-label="Maximum native provider estimate for 1024 shots" type="range" min="0.01" max="5" step="0.01" value={maxRunPrice} disabled={!applyPriceLimit} onChange={(event) => setMaxRunPrice(Number(event.target.value))} /><p className="text-xs leading-relaxed text-[var(--qr-muted)]">1,024 shots, one attempt. Excludes fees. Unknown rates are hidden only when this filter is enabled.</p></section>
      <section><h3>Providers</h3>{providerOptions.map((provider) => <label key={provider}><input type="checkbox" checked={providers.includes(provider)} onChange={() => toggleProvider(provider)} /><span>{provider}</span><small>{backends.filter((item) => item.provider === provider).length}</small></label>)}</section>
    </aside>
    <main className="provider-catalog-main">
      <div className="provider-catalog-heading"><div><h1>Providers</h1></div><Link href="/dashboard/experiments">Plan an experiment <ArrowRight size={13} /></Link></div>
      <div className="console-note">Native rate evidence is separate from configuration status. Queue, fidelity, and reliability values are catalog observations, not predictions of your experiment’s outcome. Review the complete execution quote before running.</div>
      <div className="provider-catalog-toolbar">
        <label><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers, targets, and gates..." aria-label="Search providers" /></label>
        <div className="catalog-sort"><ArrowUpDown size={13} /><select aria-label="Sort targets" value={sort} onChange={(event) => setSort(event.target.value)}><option value="price">Lowest known native estimate</option><option value="queue">Catalog queue</option><option value="fidelity">Catalog fidelity</option><option value="capacity">Most qubits</option></select></div>
        <button className={compare.length ? "active" : ""} onClick={() => document.getElementById("provider-compare")?.scrollIntoView({ behavior: "smooth" })}><CheckSquare size={13} /> Compare {compare.length || ""}</button>
        <div className="catalog-view-switch"><button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>List</button><button className={view === "table" ? "active" : ""} onClick={() => setView("table")}><Table2 size={13} /> Table</button></div>
      </div>
      <div className="provider-category-tabs">{[["all", "All"], ["qpu", "QPU"], ["simulator", "Simulators"], ["connected", "Configured"]].map(([value, label]) => <button key={value} className={kind === value ? "active" : ""} onClick={() => setKind(value as CatalogKind)}>{label}<span>{value === "all" ? backends.length : value === "connected" ? backends.filter((item) => item.available).length : backends.filter((item) => item.kind === value).length}</span></button>)}</div>
      <div className="provider-result-line"><span>{visible.length} targets</span><span>Native rates · source and expiry shown</span></div>
      {view === "list" ? <div className="provider-list">{visible.map((backend) => {
        const rate = pricing.get(backend.id)!;
        return <article key={backend.id} className="provider-listing">
          <div className="provider-listing-top"><Link href={`/dashboard/providers/${backend.id}`}><span className="provider-mark">{backend.displayName.slice(0, 2).toUpperCase()}</span><div><h2>{backend.displayName}</h2><p>by {backend.provider}</p></div></Link><div><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Configured" : "Unavailable"}</span><label title="Add to comparison"><input type="checkbox" aria-label={`Compare ${backend.displayName}`} checked={compare.includes(backend.id)} onChange={() => toggleCompare(backend.id)} /></label></div></div>
          <p className="provider-description">{backend.description}. {backend.connectivity} connectivity in {backend.region ?? "provider cloud"}. {backend.capabilityNote}</p>
          <div className="provider-listing-meta"><span><b>{backend.qubits}</b> qubits</span><span><b>{Math.round(backend.queueSeconds)}s</b> catalog queue</span><span><b>{(backend.fidelity * 100).toFixed(2)}%</b> calibration proxy</span><span><b>{rate.label}</b></span><Link href={`/dashboard/providers/${backend.id}`}>Details <ArrowRight size={12} /></Link></div>
          <p className="provider-description">{rate.known ? `Rate observed ${pricingDate(rate.observedAt)} · valid until ${pricingDate(rate.validUntil)} · ${rate.channel}` : rate.reason}{rate.source ? <> · Source: <code>{rate.source}</code></> : null}</p>
        </article>;
      })}</div> : <div className="provider-table"><div className="provider-table-head"><span>Target</span><span>Type</span><span>Qubits</span><span>Catalog queue</span><span>Calibration proxy</span><span>Native rate</span><span>Configuration</span></div>{visible.map((backend) => <Link href={`/dashboard/providers/${backend.id}`} key={backend.id}><span><b>{backend.displayName}</b><small>{backend.provider}</small></span><span>{backend.kind}</span><span>{backend.qubits}</span><span>{backend.queueSeconds}s</span><span>{(backend.fidelity * 100).toFixed(2)}%</span><span>{pricing.get(backend.id)!.label}</span><span className={backend.available ? "catalog-live" : "catalog-standby"}><i />{backend.available ? "Configured" : "Unavailable"}</span></Link>)}</div>}
      {!visible.length && <div className="provider-no-results"><Search size={22} /><b>No matching targets</b><p>Adjust filters or clear the search query.</p></div>}
      {selected.length > 0 && <section className="provider-compare" id="provider-compare"><header><div><Gauge size={15} /><span><b>Compare targets</b><small>Catalog observations; up to four endpoints</small></span></div><button onClick={() => setCompare([])}>Clear</button></header><div className="provider-compare-grid" style={{ gridTemplateColumns: `130px repeat(${selected.length}, minmax(0, 1fr))` }}><span>Metric</span>{selected.map((backend) => <b key={`name-${backend.id}`}>{backend.displayName}</b>)}<span>Type</span>{selected.map((backend) => <code key={`type-${backend.id}`}>{backend.kind}</code>)}<span>Capacity</span>{selected.map((backend) => <code key={`capacity-${backend.id}`}>{backend.qubits} qubits</code>)}<span>Catalog queue</span>{selected.map((backend) => <code key={`queue-${backend.id}`}>{backend.queueSeconds}s</code>)}<span>Calibration proxy</span>{selected.map((backend) => <code key={`fidelity-${backend.id}`}>{(backend.fidelity * 100).toFixed(2)}%</code>)}<span>Native rate</span>{selected.map((backend) => <code key={`price-${backend.id}`}>{pricing.get(backend.id)!.label}</code>)}<span>Rate expiry</span>{selected.map((backend) => <code key={`expiry-${backend.id}`}>{pricingDate(pricing.get(backend.id)!.validUntil)}</code>)}</div></section>}
    </main>
  </div>;
}
