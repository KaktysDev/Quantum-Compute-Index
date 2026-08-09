"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The QCI attribution map.
//
// Shows the whole index as one picture: the published price in the middle, the
// PRICE side (providers → their individual models) fanning left, and the COST
// side (energy, cryogenics, labour, capital) fanning right. Clicking any node
// opens its statistics, its data source, and how fresh that source actually is.
//
// The map is built to be honest about magnitude. Node area is proportional to
// real contribution, so the energy node is genuinely tiny next to capital — the
// picture states the finding rather than decorating it.
// ──────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import type { DeviceDerived, FactorObservation, IndexPoint } from "@/lib/qci/v2/types";

// Geometry is sized so the OUTERMOST ring — a selected cluster's expanded
// children, plus their two lines of label — still fits inside the viewBox.
// Getting this wrong does not clip (the SVG deliberately allows overflow so
// labels can breathe); it spills children over the panel edge instead, which is
// worse. Budget: CY + DEVICE_RING + LABEL_ROOM ≤ H.
const W = 1000;
const H = 720;
const CX = W / 2;
const CY = H / 2;

const HUB_R = 76;
const PROVIDER_RING = 198;
const DEVICE_RING = 300;
const FACTOR_RING = 198;
const FACTOR_DETAIL_RING = 300;
/** Vertical room a node's two label lines need below its circle. */
const LABEL_ROOM = 34;

/**
 * Total arc each side occupies, in degrees. Kept well under 180 so the price
 * cluster and the cost cluster never bleed into each other's half — the
 * left/right split is the first thing the map has to communicate — and so an
 * expanded cluster at the extreme of the arc still lands inside the viewBox.
 */
const SIDE_SPREAD = 132;
/** Arc an expanded cluster's children occupy around their parent. */
const CHILD_SPREAD = 58;

type Selection =
  | { kind: "root" }
  | { kind: "provider"; provider: string }
  | { kind: "device"; id: string }
  | { kind: "factor"; group: string }
  | { kind: "factorItem"; id: string };

interface Node {
  key: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  r: number;
  side: "price" | "cost";
  selection: Selection;
  /** 0..1 — how fresh the underlying data is; drives the ring styling. */
  freshness: number;
  dim?: boolean;
}

function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
}

/** Spread n items evenly across an arc, centred on `centre`. */
function fan(n: number, centre: number, spread: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [centre];
  const step = spread / (n - 1);
  return Array.from({ length: n }, (_, i) => centre - spread / 2 + i * step);
}

function money(v: number, dp = 0): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function pct(v: number, dp = 1): string {
  return `${(v * 100).toFixed(dp)}%`;
}

const FACTOR_GROUP_LABEL: Record<string, string> = {
  energy: "Energy",
  cryogenics: "Cryogenics",
  capital: "Capital",
  labour: "Labour",
  fx: "FX",
};

const TIER_LABEL: Record<string, string> = {
  primary: "Seller / operator feed",
  official: "Official statistics",
  published: "Published list rate",
  modelled: "Modelled",
  assumed: "Engineering assumption",
};

export default function QciMap({ point }: { point: IndexPoint }) {
  const [selected, setSelected] = useState<Selection>({ kind: "root" });
  const [hovered, setHovered] = useState<string | null>(null);

  // ── Aggregate devices into provider clusters ────────────────────────────────
  const providers = useMemo(() => {
    const map = new Map<
      string,
      { provider: string; weight: number; devices: DeviceDerived[]; fresh: number }
    >();
    for (const d of point.devices) {
      const cur = map.get(d.provider) ?? {
        provider: d.provider,
        weight: 0,
        devices: [],
        fresh: 0,
      };
      cur.weight += d.weight;
      cur.devices.push(d);
      cur.fresh += d.fresh ? 1 : 0;
      map.set(d.provider, cur);
    }
    return [...map.values()].sort((a, b) => b.weight - a.weight);
  }, [point.devices]);

  // ── Cost-side groups, sized by their real dollar contribution ──────────────
  const costGroups = useMemo(() => {
    const c = point.costComponents;
    if (!c) return [];
    const total = c.energy + c.consumables + c.labour + c.capital || 1;
    return [
      { group: "capital", usd: c.capital, share: c.capital / total },
      { group: "labour", usd: c.labour, share: c.labour / total },
      { group: "cryogenics", usd: c.consumables, share: c.consumables / total },
      { group: "energy", usd: c.energy, share: c.energy / total },
    ];
  }, [point.costComponents]);

  const factorsByGroup = useMemo(() => {
    const map = new Map<string, FactorObservation[]>();
    for (const f of point.factors ?? []) {
      const list = map.get(f.group) ?? [];
      list.push(f);
      map.set(f.group, list);
    }
    return map;
  }, [point.factors]);

  const activeProvider =
    selected.kind === "provider"
      ? selected.provider
      : selected.kind === "device"
        ? point.devices.find((d) => d.id === selected.id)?.provider
        : undefined;
  const activeGroup =
    selected.kind === "factor"
      ? selected.group
      : selected.kind === "factorItem"
        ? (point.factors ?? []).find((f) => f.id === selected.id)?.group
        : undefined;

  // ── Node layout ─────────────────────────────────────────────────────────────
  const nodes = useMemo(() => {
    const out: Node[] = [];

    // Providers fan across the left semicircle.
    const pAngles = fan(providers.length, 180, Math.min(SIDE_SPREAD, providers.length * 34));
    const maxW = Math.max(...providers.map((p) => p.weight), 0.0001);
    providers.forEach((p, i) => {
      const { x, y } = polar(pAngles[i], PROVIDER_RING);
      out.push({
        key: `p:${p.provider}`,
        label: p.provider,
        sub: `${p.devices.length} model${p.devices.length === 1 ? "" : "s"} · ${pct(p.weight, 0)}`,
        x,
        y,
        // Area ∝ weight, so visual size reads as real influence.
        r: 20 + 22 * Math.sqrt(p.weight / maxW),
        side: "price",
        selection: { kind: "provider", provider: p.provider },
        freshness: p.devices.length > 0 ? p.fresh / p.devices.length : 0,
        dim: activeProvider != null && activeProvider !== p.provider,
      });
    });

    // The selected provider's models fan out on an outer arc around it.
    if (activeProvider) {
      const cluster = providers.find((p) => p.provider === activeProvider);
      const idx = providers.findIndex((p) => p.provider === activeProvider);
      if (cluster && idx >= 0) {
        const centre = pAngles[idx];
        const dAngles = fan(
          cluster.devices.length,
          centre,
          Math.min(CHILD_SPREAD, cluster.devices.length * 16),
        );
        cluster.devices.forEach((d, i) => {
          const { x, y } = polar(dAngles[i], DEVICE_RING);
          out.push({
            key: `d:${d.id}`,
            label: d.device,
            sub: `$${money(d.pricePerHour)}/hr`,
            x,
            y,
            r: 15,
            side: "price",
            selection: { kind: "device", id: d.id },
            freshness: d.fresh ? 1 : Math.max(0, 1 - d.staleDays / 45),
          });
        });
      }
    }

    // Cost groups fan across the right semicircle.
    const cAngles = fan(costGroups.length, 0, Math.min(SIDE_SPREAD, costGroups.length * 40));
    const maxShare = Math.max(...costGroups.map((c) => c.share), 0.0001);
    costGroups.forEach((c, i) => {
      const { x, y } = polar(cAngles[i], FACTOR_RING);
      out.push({
        key: `f:${c.group}`,
        label: FACTOR_GROUP_LABEL[c.group] ?? c.group,
        sub: `$${money(c.usd, c.usd < 10 ? 2 : 0)}/hr · ${pct(c.share, c.share < 0.01 ? 2 : 0)}`,
        x,
        y,
        // Genuinely proportional: energy at 0.2% renders as a dot, and that is
        // the point being made.
        r: 14 + 26 * Math.sqrt(c.share / maxShare),
        side: "cost",
        selection: { kind: "factor", group: c.group },
        freshness: 1,
        dim: activeGroup != null && activeGroup !== c.group,
      });
    });

    // The selected cost group's live inputs.
    if (activeGroup) {
      const items = factorsByGroup.get(activeGroup) ?? [];
      const idx = costGroups.findIndex((c) => c.group === activeGroup);
      if (items.length > 0 && idx >= 0) {
        const centre = cAngles[idx];
        const fAngles = fan(items.length, centre, Math.min(CHILD_SPREAD, items.length * 16));
        items.forEach((f, i) => {
          const { x, y } = polar(fAngles[i], FACTOR_DETAIL_RING);
          out.push({
            key: `fi:${f.id}`,
            label: f.label,
            sub: `${f.observation.value.toPrecision(4)} ${f.unit}`,
            x,
            y,
            r: 13,
            side: "cost",
            selection: { kind: "factorItem", id: f.id },
            freshness: f.observation.tier === "assumed" ? 0.25 : 1,
          });
        });
      }
    }

    return out;
  }, [providers, costGroups, factorsByGroup, activeProvider, activeGroup]);

  const selectedKey =
    selected.kind === "provider"
      ? `p:${selected.provider}`
      : selected.kind === "device"
        ? `d:${selected.id}`
        : selected.kind === "factor"
          ? `f:${selected.group}`
          : selected.kind === "factorItem"
            ? `fi:${selected.id}`
            : "root";

  const up = point.changePct >= 0;

  return (
    <section className="console-panel qci-map-panel">
      <div className="panel-title">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="qci-map-glyph">
          <circle cx="8" cy="8" r="2.4" />
          <circle cx="2.4" cy="4" r="1.5" />
          <circle cx="2.4" cy="12" r="1.5" />
          <circle cx="13.6" cy="4" r="1.5" />
          <circle cx="13.6" cy="12" r="1.5" />
          <path d="M5.8 7 3.6 4.8M5.8 9l-2.2 2.2M10.2 7l2.2-2.2M10.2 9l2.2 2.2" />
        </svg>
        <div>
          <h2>Index attribution map</h2>
          <small>What the QCI is made of, and where every number comes from</small>
        </div>
        <span className="qci-map-status" data-status={point.status}>
          {point.status === "final" ? "Final" : "Provisional"} · {pct(point.coverage, 0)} coverage
        </span>
      </div>

      <div className="qci-map-body">
        <div className="qci-map-canvas">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Quantum Compute Index attribution map"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <radialGradient id="qciHubGlow">
                <stop offset="0%" stopColor="var(--qci-hub-glow)" stopOpacity="0.5" />
                <stop offset="100%" stopColor="var(--qci-hub-glow)" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Side labels */}
            <text className="qci-map-axis" x={CX - 305} y={22} textAnchor="middle">
              PRICE SIDE — what the market charges
            </text>
            <text className="qci-map-axis" x={CX + 305} y={22} textAnchor="middle">
              COST SIDE — what an hour costs to produce
            </text>

            <circle cx={CX} cy={CY} r={PROVIDER_RING} className="qci-map-halo" />

            {/* Edges */}
            <g className="qci-map-edges">
              {nodes.map((n) => {
                const isDeviceOrItem = n.key.startsWith("d:") || n.key.startsWith("fi:");
                let ax = CX;
                let ay = CY;
                if (isDeviceOrItem) {
                  const parentKey = n.key.startsWith("d:")
                    ? `p:${point.devices.find((d) => `d:${d.id}` === n.key)?.provider}`
                    : `f:${activeGroup}`;
                  const parent = nodes.find((p) => p.key === parentKey);
                  if (parent) {
                    ax = parent.x;
                    ay = parent.y;
                  }
                }
                return (
                  <line
                    key={`e:${n.key}`}
                    x1={ax}
                    y1={ay}
                    x2={n.x}
                    y2={n.y}
                    className={`qci-edge ${n.side}`}
                    data-dim={n.dim ? "true" : undefined}
                    data-active={
                      selectedKey === n.key || hovered === n.key ? "true" : undefined
                    }
                  />
                );
              })}
            </g>

            {/* Centre hub */}
            <circle cx={CX} cy={CY} r={HUB_R + 46} fill="url(#qciHubGlow)" />
            <g
              className="qci-node hub"
              data-active={selected.kind === "root" ? "true" : undefined}
              onClick={() => setSelected({ kind: "root" })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelected({ kind: "root" });
              }}
              tabIndex={0}
              role="button"
              aria-label="Index summary"
            >
              <circle cx={CX} cy={CY} r={HUB_R} />
              <text x={CX} y={CY - 22} textAnchor="middle" className="qci-hub-eyebrow">
                QCI · USD / QPU-HOUR
              </text>
              <text x={CX} y={CY + 6} textAnchor="middle" className="qci-hub-value">
                ${money(point.usdPerQpuHour)}
              </text>
              <text
                x={CX}
                y={CY + 28}
                textAnchor="middle"
                className={`qci-hub-change ${up ? "up" : "down"}`}
              >
                {up ? "▲" : "▼"} {Math.abs(point.changePct).toFixed(3)}%
              </text>
              <text x={CX} y={CY + 48} textAnchor="middle" className="qci-hub-eyebrow">
                LEVEL {money(point.level, 2)}
              </text>
            </g>

            {/* Nodes */}
            {nodes.map((n) => (
              <g
                key={n.key}
                className={`qci-node ${n.side}`}
                data-dim={n.dim ? "true" : undefined}
                data-active={selectedKey === n.key ? "true" : undefined}
                data-stale={n.freshness < 0.75 ? "true" : undefined}
                transform={`translate(${n.x} ${n.y})`}
                onClick={() => setSelected(n.selection)}
                onMouseEnter={() => setHovered(n.key)}
                onMouseLeave={() => setHovered(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(n.selection);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${n.label}. ${n.sub}`}
              >
                <circle r={n.r} />
                <text y={n.r + 17} textAnchor="middle" className="qci-node-label">
                  {n.label}
                </text>
                <text y={n.r + LABEL_ROOM - 3} textAnchor="middle" className="qci-node-sub">
                  {n.sub}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <QciMapDetail point={point} selected={selected} onSelect={setSelected} />
      </div>
    </section>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return (
    <div className="qci-detail-row">
      <dt>{k}</dt>
      <dd className={mono ? "mono" : undefined}>{v}</dd>
    </div>
  );
}

function Provenance({ tier, source, citation, observedAt }: {
  tier: string;
  source: string;
  citation?: string;
  observedAt?: string;
}) {
  const age = observedAt
    ? Math.max(0, Math.round((Date.now() - Date.parse(observedAt)) / 86_400_000))
    : null;
  return (
    <div className="qci-provenance" data-tier={tier}>
      <span className="qci-tier">{TIER_LABEL[tier] ?? tier}</span>
      <code>{source}</code>
      {citation ? <p>{citation}</p> : null}
      {age != null ? (
        <small>
          Effective {age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}
        </small>
      ) : null}
    </div>
  );
}

function QciMapDetail({
  point,
  selected,
  onSelect,
}: {
  point: IndexPoint;
  selected: Selection;
  onSelect: (s: Selection) => void;
}) {
  if (selected.kind === "device") {
    const d = point.devices.find((x) => x.id === selected.id);
    if (!d) return null;
    const contribution = point.attribution.byDevice.find((b) => b.id === d.id)?.contribution ?? 0;
    return (
      <aside className="qci-map-detail">
        <header>
          <p className="qci-detail-eyebrow">{d.provider} · model</p>
          <h3>{d.device}</h3>
        </header>
        <dl>
          <Row k="Price" v={`$${money(d.pricePerHour)} / QPU-hour`} mono />
          <Row k="Price basis" v={d.priceBasis.replace(/-/g, " ")} />
          <Row k="Modality" v={d.modality.replace("-", " ")} />
          <Row k="Region" v={d.region} />
          <Row k="Effective width" v={`${d.effectiveWidth} qubits`} mono />
          <Row k="Capability" v={d.capability.toFixed(3)} mono />
          <Row k="Quality-adjusted" v={`$${money(d.qualityAdjustedPrice, 2)} / QCU-hour`} mono />
          <Row k="Index weight" v={pct(d.weight)} mono />
          <Row
            k="Move contribution"
            v={`${contribution >= 0 ? "+" : ""}${(contribution * 100).toFixed(4)}%`}
            mono
          />
          <Row
            k="Data state"
            v={
              d.fresh ? (
                <span className="qci-pill ok">measured today</span>
              ) : (
                <span className="qci-pill warn">
                  {d.staleDays}d stale — imputed, contributes nothing
                </span>
              )
            }
          />
          {d.costPerHour ? (
            <Row k="Modelled cost" v={`$${money(d.costPerHour)} / hr`} mono />
          ) : null}
          {d.costCoverage ? (
            <Row k="Price ÷ cost" v={`${d.costCoverage.toFixed(2)}×`} mono />
          ) : null}
        </dl>
        <button className="qci-detail-back" onClick={() => onSelect({ kind: "provider", provider: d.provider })}>
          ← Back to {d.provider}
        </button>
      </aside>
    );
  }

  if (selected.kind === "provider") {
    const devices = point.devices.filter((d) => d.provider === selected.provider);
    const weight = devices.reduce((a, d) => a + d.weight, 0);
    const contribution =
      point.attribution.byProvider.find((b) => b.provider === selected.provider)?.contribution ?? 0;
    return (
      <aside className="qci-map-detail">
        <header>
          <p className="qci-detail-eyebrow">Provider cluster</p>
          <h3>{selected.provider}</h3>
        </header>
        <dl>
          <Row k="Models tracked" v={String(devices.length)} mono />
          <Row k="Cluster weight" v={pct(weight)} mono />
          <Row
            k="Move contribution"
            v={`${contribution >= 0 ? "+" : ""}${(contribution * 100).toFixed(4)}%`}
            mono
          />
          <Row k="Measured today" v={`${devices.filter((d) => d.fresh).length} of ${devices.length}`} mono />
        </dl>
        <p className="qci-detail-note">Models in this cluster — select one for its statistics.</p>
        <ul className="qci-detail-list">
          {devices
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .map((d) => (
              <li key={d.id}>
                <button onClick={() => onSelect({ kind: "device", id: d.id })}>
                  <span>
                    <b>{d.device}</b>
                    <small>
                      {d.effectiveWidth} eff. qubits · {pct(d.weight, 1)} weight
                    </small>
                  </span>
                  <span className="qci-detail-value">
                    <b>${money(d.pricePerHour)}</b>
                    <small className={d.fresh ? "ok" : "warn"}>
                      {d.fresh ? "live" : `${d.staleDays}d stale`}
                    </small>
                  </span>
                </button>
              </li>
            ))}
        </ul>
        <button className="qci-detail-back" onClick={() => onSelect({ kind: "root" })}>
          ← Back to index
        </button>
      </aside>
    );
  }

  if (selected.kind === "factorItem") {
    const f = (point.factors ?? []).find((x) => x.id === selected.id);
    if (!f) return null;
    return (
      <aside className="qci-map-detail">
        <header>
          <p className="qci-detail-eyebrow">{FACTOR_GROUP_LABEL[f.group] ?? f.group} · input</p>
          <h3>{f.label}</h3>
        </header>
        <dl>
          <Row k="Value" v={`${f.observation.value.toPrecision(5)} ${f.unit}`} mono />
        </dl>
        <Provenance
          tier={f.observation.tier}
          source={f.observation.source}
          citation={f.observation.citation}
          observedAt={f.observation.observedAt}
        />
        <button className="qci-detail-back" onClick={() => onSelect({ kind: "factor", group: f.group })}>
          ← Back
        </button>
      </aside>
    );
  }

  if (selected.kind === "factor") {
    const c = point.costComponents;
    const items = (point.factors ?? []).filter((f) => f.group === selected.group);
    const usd =
      selected.group === "capital"
        ? c?.capital
        : selected.group === "labour"
          ? c?.labour
          : selected.group === "cryogenics"
            ? c?.consumables
            : selected.group === "energy"
              ? c?.energy
              : undefined;
    const total = c ? c.energy + c.consumables + c.labour + c.capital : 0;
    return (
      <aside className="qci-map-detail">
        <header>
          <p className="qci-detail-eyebrow">Cost driver</p>
          <h3>{FACTOR_GROUP_LABEL[selected.group] ?? selected.group}</h3>
        </header>
        <dl>
          {usd != null ? (
            <Row k="Cost" v={`$${money(usd, usd < 10 ? 2 : 0)} / QPU-hour`} mono />
          ) : null}
          {usd != null && total > 0 ? (
            <Row k="Share of cost" v={pct(usd / total, usd / total < 0.01 ? 3 : 1)} mono />
          ) : null}
          {selected.group === "energy" && c ? (
            <>
              <Row k="Basket draw" v={`${money(c.basketPowerKw, 1)} kW continuous`} mono />
              <Row
                k="Cost elasticity"
                v={`${(c.energyElasticity * 100).toFixed(3)}% per 100% price move`}
                mono
              />
            </>
          ) : null}
        </dl>
        {selected.group === "energy" ? (
          <p className="qci-detail-note strong">
            Energy is tracked live and it is small. The basket&rsquo;s hardware draws roughly{" "}
            {money(c?.basketPowerKw ?? 0, 0)} kW; at industrial tariffs that is a few dollars an
            hour against list prices in the thousands. A doubling of electricity prices moves the
            modelled cost of a quantum hour by about{" "}
            {((c?.energyElasticity ?? 0) * 100).toFixed(2)}%. The node is drawn to scale.
          </p>
        ) : null}
        {selected.group === "cryogenics" ? (
          <p className="qci-detail-note">
            Cryogens and consumables are indexed to the BLS producer price index for industrial
            gas manufacturing. No daily helium price feed exists anywhere — USGS publishes
            annually, and the BLM auctions that once set a public reference price have ended — so
            this is an honest proxy, not a helium spot price.
          </p>
        ) : null}
        {selected.group === "capital" ? (
          <p className="qci-detail-note strong">
            This is what actually sets the floor under quantum compute prices: recovering a
            multi-million-dollar system over a five-year life, across the fraction of wall-clock
            hours it can actually be sold. It dwarfs every operating input.
          </p>
        ) : null}
        {items.length > 0 ? (
          <>
            <p className="qci-detail-note">Live inputs feeding this driver.</p>
            <ul className="qci-detail-list">
              {items.map((f) => (
                <li key={f.id}>
                  <button onClick={() => onSelect({ kind: "factorItem", id: f.id })}>
                    <span>
                      <b>{f.label}</b>
                      <small>{f.observation.source}</small>
                    </span>
                    <span className="qci-detail-value">
                      <b>{f.observation.value.toPrecision(4)}</b>
                      <small>{f.unit}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="qci-detail-note">
            No live feed configured for this driver — it is running on its pinned default.
          </p>
        )}
        <button className="qci-detail-back" onClick={() => onSelect({ kind: "root" })}>
          ← Back to index
        </button>
      </aside>
    );
  }

  // Root
  const a = point.attribution;
  const total = a.totalLogChange;
  const priceShare = total !== 0 ? a.priceLogChange / total : 0;
  return (
    <aside className="qci-map-detail">
      <header>
        <p className="qci-detail-eyebrow">Index summary</p>
        <h3>Quantum Compute Index</h3>
      </header>
      <dl>
        <Row k="Price" v={`$${money(point.usdPerQpuHour)} / QPU-hour`} mono />
        <Row k="Quality-adjusted" v={`$${money(point.usdPerQcu, 2)} / QCU-hour`} mono />
        <Row k="Level" v={money(point.level, 2)} mono />
        <Row
          k="Change"
          v={`${point.changePct >= 0 ? "+" : ""}${point.changePct.toFixed(4)}%`}
          mono
        />
        <Row k="Matched sample" v={`${point.matched} models`} mono />
        <Row
          k="Coverage"
          v={
            <span className={point.coverage >= 0.6 ? "ok" : "warn"}>
              {pct(point.coverage, 0)} of basket weight
            </span>
          }
          mono
        />
        {point.costBasisPerHour ? (
          <Row k="Modelled cost" v={`$${money(point.costBasisPerHour)} / hr`} mono />
        ) : null}
        {point.costCoverageRatio ? (
          <Row k="Price ÷ cost" v={`${point.costCoverageRatio.toFixed(2)}×`} mono />
        ) : null}
        <Row k="Methodology" v={point.methodology} mono />
      </dl>
      {total !== 0 ? (
        <p className="qci-detail-note">
          Today&rsquo;s move splits exactly into{" "}
          <b>{pct(Math.abs(priceShare), 0)} repricing</b> and{" "}
          <b>{pct(Math.abs(1 - priceShare), 0)} hardware quality change</b>. The two components
          are additive in log space, so this is an identity rather than an estimate.
        </p>
      ) : (
        <p className="qci-detail-note">
          No movement today. Either prices and quality were unchanged across the matched sample,
          or a proposed move is being held for corroboration.
        </p>
      )}
      {point.excluded.length > 0 ? (
        <>
          <p className="qci-detail-note">
            Excluded from today&rsquo;s matched sample — these contribute nothing rather than
            moving the index.
          </p>
          <ul className="qci-detail-excluded">
            {point.excluded.slice(0, 8).map((e) => (
              <li key={e.id}>
                <code>{e.id}</code>
                <span>{e.reason.replace(/-/g, " ")}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}
