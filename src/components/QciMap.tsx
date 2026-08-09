"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The QCI attribution map.
//
// One picture of the whole index: the published price in the middle, the PRICE
// side (providers → their individual machines) fanning left, and the COST side
// (capital, labour, cryogenics, energy) fanning right. Selecting any node opens
// what it is and where its numbers came from.
//
// TWO AUDIENCES, ONE LAYOUT
// The same geometry serves the public QCI tab and the admin health view, chosen
// by `mode`:
//
//   "public"     — what the index costs and what it is made of. Plain language,
//                  no source slugs, no ledger states, no methodology version.
//   "diagnostic" — everything the public view hides: per-field provenance and
//                  tier, staleness in days, which feeds were merged, what was
//                  excluded and why, matched sample and coverage. This is the
//                  view that answers "is any of this stale or hard-coded?".
//
// Keeping them one component rather than two is deliberate: the diagnostic view
// has to be looking at exactly the same numbers the public view shows, or it is
// not a check on anything.
//
// The map is built to be honest about magnitude. Node area is proportional to
// real contribution, so the energy node is genuinely tiny next to capital — the
// picture states the finding rather than decorating it.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
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

const HUB_R = 78;
const PROVIDER_RING = 198;
const DEVICE_RING = 312;
const FACTOR_RING = 198;
const FACTOR_DETAIL_RING = 312;
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

export type MapMode = "public" | "diagnostic";

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
  /** Depth in the tree; children animate in after their parent. */
  depth: number;
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

/** Price basis, said in words rather than in the enum's own terms. */
const PRICE_BASIS_LABEL: Record<string, string> = {
  "reservation-hour": "Hourly reservation rate",
  "metered-minute": "Metered per-minute rate",
  "shot-implied": "Derived from per-shot pricing",
};

const MODALITY_LABEL: Record<string, string> = {
  superconducting: "Superconducting",
  "trapped-ion": "Trapped ion",
  "neutral-atom": "Neutral atom",
  photonic: "Photonic",
  spin: "Spin",
};

/**
 * A number that counts up to its value on mount and on every change.
 *
 * Purely presentational, and deliberately short: the headline is the one thing
 * on the page a reader looks at first, and a value that resolves rather than
 * simply appearing makes it read as live. Skipped entirely under
 * prefers-reduced-motion, where it renders the final value immediately.
 */
function useCountUp(value: number, ms = 900): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !Number.isFinite(value)) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) return;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // easeOutCubic — fast to settle, no bounce.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      from.current = value;
    };
  }, [value, ms]);

  return shown;
}

export default function QciMap({
  point,
  mode = "public",
}: {
  point: IndexPoint;
  mode?: MapMode;
}) {
  const [selected, setSelected] = useState<Selection>({ kind: "root" });
  const [hovered, setHovered] = useState<string | null>(null);
  const diagnostic = mode === "diagnostic";

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
        sub: `${p.devices.length} machine${p.devices.length === 1 ? "" : "s"} · ${pct(p.weight, 0)}`,
        x,
        y,
        // Area ∝ weight, so visual size reads as real influence.
        r: 20 + 22 * Math.sqrt(p.weight / maxW),
        side: "price",
        selection: { kind: "provider", provider: p.provider },
        freshness: p.devices.length > 0 ? p.fresh / p.devices.length : 0,
        depth: 0,
        dim: activeProvider != null && activeProvider !== p.provider,
      });
    });

    // The selected provider's machines fan out on an outer arc around it.
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
            depth: 1,
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
        depth: 0,
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
            depth: 1,
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
  const flat = Math.abs(point.changePct) < 0.00005;
  const shownPrice = useCountUp(point.usdPerQpuHour);

  return (
    <section className="qci-map-panel" data-mode={mode}>
      <header className="qci-map-head">
        <div>
          <h2>{diagnostic ? "Index attribution — full detail" : "What the index is made of"}</h2>
          <p>
            {diagnostic
              ? "Every constituent with its source tier, staleness and exclusion state."
              : "The price on the left is what the market charges. The right is what an hour costs to produce."}
          </p>
        </div>
        {diagnostic ? (
          <span className="qci-map-status" data-status={point.inception ? "inception" : point.status}>
            {point.inception
              ? "Inception"
              : point.status === "final"
                ? "Final"
                : "Provisional"}{" "}
            · {pct(point.coverage, 0)} coverage · {point.matched}/{point.priced ?? point.devices.length} matched
          </span>
        ) : null}
      </header>

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
                <stop offset="0%" stopColor="var(--qci-hub-glow)" stopOpacity="0.55" />
                <stop offset="70%" stopColor="var(--qci-hub-glow)" stopOpacity="0.12" />
                <stop offset="100%" stopColor="var(--qci-hub-glow)" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="qciFieldGlow">
                <stop offset="0%" stopColor="var(--qci-field)" stopOpacity="0.5" />
                <stop offset="100%" stopColor="var(--qci-field)" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* A soft field behind everything, replacing the old hard ruled
                circle. It reads as depth rather than as a border. */}
            <circle cx={CX} cy={CY} r={DEVICE_RING} fill="url(#qciFieldGlow)" />

            {/* Sat close to the arcs rather than at the top of the viewBox —
                the viewBox is tall enough for an EXPANDED cluster, so anchoring
                the captions to its edge left them floating in dead space
                whenever nothing was expanded. Their x keeps them clear of the
                near-vertical extremes a child node can reach. */}
            <text className="qci-map-axis" x={CX - 288} y={118} textAnchor="middle">
              PRICE — what the market charges
            </text>
            <text className="qci-map-axis" x={CX + 288} y={118} textAnchor="middle">
              COST — what an hour takes to produce
            </text>

            {/* Two slowly counter-rotating dashed rings. The only motion on the
                map that is not driven by interaction; it keeps the picture
                feeling live without implying that anything is changing. */}
            <circle cx={CX} cy={CY} r={PROVIDER_RING} className="qci-map-orbit" />
            <circle cx={CX} cy={CY} r={PROVIDER_RING - 46} className="qci-map-orbit reverse" />

            {/* Edges */}
            <g className="qci-map-edges">
              {nodes.map((n, i) => {
                const isChild = n.depth > 0;
                let ax = CX;
                let ay = CY;
                if (isChild) {
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
                    // pathLength normalises every edge to 1 unit long, so one
                    // dash animation draws them all at the same rate regardless
                    // of their real length.
                    pathLength={1}
                    className={`qci-edge ${n.side}`}
                    style={{ animationDelay: `${(isChild ? 40 : 0) + i * 45}ms` }}
                    data-dim={n.dim ? "true" : undefined}
                    data-active={
                      selectedKey === n.key || hovered === n.key ? "true" : undefined
                    }
                  />
                );
              })}
            </g>

            {/* Centre hub */}
            <circle cx={CX} cy={CY} r={HUB_R + 52} fill="url(#qciHubGlow)" className="qci-hub-glow" />
            {/* Position on the OUTER group as an attribute, animation on the
                inner one. A CSS transform replaces the attribute outright, so
                animating a node that carries its own translate throws it to the
                viewBox origin. */}
            <g transform={`translate(${CX} ${CY})`}>
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
                <circle className="qci-hub-pulse" r={HUB_R} />
                <circle r={HUB_R} />
                <text y={-24} textAnchor="middle" className="qci-hub-eyebrow">
                  USD PER QPU-HOUR
                </text>
                <text y={6} textAnchor="middle" className="qci-hub-value">
                  ${money(shownPrice)}
                </text>
                <text
                  y={30}
                  textAnchor="middle"
                  className={`qci-hub-change ${flat ? "flat" : up ? "up" : "down"}`}
                >
                  {flat
                    ? "— unchanged"
                    : `${up ? "▲" : "▼"} ${Math.abs(point.changePct).toFixed(2)}%`}
                </text>
                <text y={50} textAnchor="middle" className="qci-hub-eyebrow">
                  LEVEL {money(point.level, 2)}
                </text>
              </g>
            </g>

            {/* Nodes */}
            {nodes.map((n, i) => (
              <g key={n.key} transform={`translate(${n.x} ${n.y})`}>
                <g
                  className={`qci-node ${n.side}`}
                  style={{ animationDelay: `${n.depth * 60 + i * 45}ms` }}
                  data-dim={n.dim ? "true" : undefined}
                  data-active={selectedKey === n.key ? "true" : undefined}
                  data-stale={n.freshness < 0.75 ? "true" : undefined}
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
                  <circle className="qci-node-halo" r={n.r} />
                  <circle r={n.r} />
                  <text y={n.r + 17} textAnchor="middle" className="qci-node-label">
                    {n.label}
                  </text>
                  <text y={n.r + LABEL_ROOM - 3} textAnchor="middle" className="qci-node-sub">
                    {n.sub}
                  </text>
                </g>
              </g>
            ))}
          </svg>
        </div>

        <QciMapDetail
          point={point}
          selected={selected}
          onSelect={setSelected}
          diagnostic={diagnostic}
        />
      </div>
    </section>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function Row({
  k,
  v,
  mono,
  hint,
}: {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="qci-detail-row">
      <dt>
        {k}
        {hint ? <small>{hint}</small> : null}
      </dt>
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
  diagnostic,
}: {
  point: IndexPoint;
  selected: Selection;
  onSelect: (s: Selection) => void;
  diagnostic: boolean;
}) {
  if (selected.kind === "device") {
    const d = point.devices.find((x) => x.id === selected.id);
    if (!d) return null;
    const contribution = point.attribution.byDevice.find((b) => b.id === d.id)?.contribution ?? 0;
    return (
      <aside className="qci-map-detail" key={`d:${d.id}`}>
        <header>
          <p className="qci-detail-eyebrow">{d.provider} · machine</p>
          <h3>{d.device}</h3>
        </header>
        <dl>
          <Row k="Price" v={`$${money(d.pricePerHour)} / hour`} mono />
          <Row k="Sold as" v={PRICE_BASIS_LABEL[d.priceBasis] ?? d.priceBasis} />
          <Row k="Technology" v={MODALITY_LABEL[d.modality] ?? d.modality} />
          <Row
            k="Usable width"
            v={`${d.effectiveWidth} qubits`}
            hint="largest square circuit it can run cleanly"
            mono
          />
          <Row
            k="Cost per capability"
            v={`$${money(d.qualityAdjustedPrice, 0)} / hour`}
            hint="price adjusted for how much it can actually do"
            mono
          />
          <Row k="Share of index" v={pct(d.weight)} mono />
          {d.costPerHour ? (
            <Row k="Costs to run" v={`$${money(d.costPerHour)} / hour`} mono />
          ) : null}
          {d.costCoverage ? (
            <Row k="Price vs cost" v={`${d.costCoverage.toFixed(1)}× cost`} mono />
          ) : null}
          <Row
            k="Data"
            v={
              d.fresh ? (
                <span className="qci-pill ok">measured today</span>
              ) : (
                <span className="qci-pill warn">
                  last seen {d.staleDays}d ago
                </span>
              )
            }
          />
          {diagnostic ? (
            <>
              <Row k="Capability" v={d.capability.toFixed(4)} mono />
              <Row k="Link weight" v={pct(d.linkWeight, 2)} mono />
              <Row
                k="Move contribution"
                v={`${contribution >= 0 ? "+" : ""}${(contribution * 100).toFixed(4)}%`}
                mono
              />
              <Row
                k="In matched sample"
                v={d.inMatchedSample ? "yes" : "no — contributes nothing"}
                mono
              />
              <Row k="Quality tier" v={TIER_LABEL[d.qualityTier] ?? d.qualityTier} />
              <Row k="Region" v={d.region} mono />
              <Row k="Device id" v={<code>{d.id}</code>} mono />
            </>
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
    const prices = devices.map((d) => d.pricePerHour).filter((p) => p > 0);
    return (
      <aside className="qci-map-detail" key={`p:${selected.provider}`}>
        <header>
          <p className="qci-detail-eyebrow">Provider</p>
          <h3>{selected.provider}</h3>
        </header>
        <dl>
          <Row k="Machines priced" v={String(devices.length)} mono />
          <Row k="Share of index" v={pct(weight)} mono />
          {prices.length > 0 ? (
            <Row
              k="Price range"
              v={
                prices.length === 1
                  ? `$${money(prices[0])} / hour`
                  : `$${money(Math.min(...prices))} – $${money(Math.max(...prices))} / hour`
              }
              mono
            />
          ) : null}
          <Row k="Measured today" v={`${devices.filter((d) => d.fresh).length} of ${devices.length}`} mono />
          {diagnostic ? (
            <Row
              k="Move contribution"
              v={`${contribution >= 0 ? "+" : ""}${(contribution * 100).toFixed(4)}%`}
              mono
            />
          ) : null}
        </dl>
        <p className="qci-detail-note">Select a machine for its numbers.</p>
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
                      {d.effectiveWidth} usable qubits · {pct(d.weight, 1)} of index
                    </small>
                  </span>
                  <span className="qci-detail-value">
                    <b>${money(d.pricePerHour)}</b>
                    <small className={d.fresh ? "ok" : "warn"}>
                      {d.fresh ? "live" : `${d.staleDays}d ago`}
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
      <aside className="qci-map-detail" key={`fi:${f.id}`}>
        <header>
          <p className="qci-detail-eyebrow">{FACTOR_GROUP_LABEL[f.group] ?? f.group} · input</p>
          <h3>{f.label}</h3>
        </header>
        <dl>
          <Row k="Value" v={`${f.observation.value.toPrecision(5)} ${f.unit}`} mono />
        </dl>
        {diagnostic ? (
          <Provenance
            tier={f.observation.tier}
            source={f.observation.source}
            citation={f.observation.citation}
            observedAt={f.observation.observedAt}
          />
        ) : (
          <p className="qci-detail-note">{f.observation.citation}</p>
        )}
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
      <aside className="qci-map-detail" key={`f:${selected.group}`}>
        <header>
          <p className="qci-detail-eyebrow">Cost driver</p>
          <h3>{FACTOR_GROUP_LABEL[selected.group] ?? selected.group}</h3>
        </header>
        <dl>
          {usd != null ? (
            <Row k="Cost" v={`$${money(usd, usd < 10 ? 2 : 0)} / hour`} mono />
          ) : null}
          {usd != null && total > 0 ? (
            <Row k="Share of cost" v={pct(usd / total, usd / total < 0.01 ? 3 : 1)} mono />
          ) : null}
          {selected.group === "energy" && c ? (
            <Row k="Power drawn" v={`${money(c.basketPowerKw, 0)} kW`} mono />
          ) : null}
        </dl>
        {selected.group === "energy" ? (
          <p className="qci-detail-note strong">
            Electricity is tracked live and it is small. The tracked hardware draws roughly{" "}
            {money(c?.basketPowerKw ?? 0, 0)} kW; at industrial tariffs that is a few dollars an
            hour against list prices in the thousands. Doubling electricity prices would move the
            cost of a quantum hour by about {((c?.energyElasticity ?? 0) * 100).toFixed(2)}%. The
            node is drawn to scale.
          </p>
        ) : null}
        {selected.group === "cryogenics" ? (
          <p className="qci-detail-note">
            Cryogens and consumables track the US producer price index for industrial gas
            manufacturing. No daily helium price feed exists anywhere, so this is an honest proxy
            rather than a helium spot price.
          </p>
        ) : null}
        {selected.group === "capital" ? (
          <p className="qci-detail-note strong">
            This is what sets the floor under quantum compute prices: paying off a
            multi-million-dollar machine over a five-year life, spread across the fraction of hours
            it can actually be sold. It dwarfs everything else.
          </p>
        ) : null}
        {selected.group === "labour" ? (
          <p className="qci-detail-note">
            Calibration, maintenance and operations staff, scaled off the installed cost of the
            system.
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
                      <small>{diagnostic ? f.observation.source : TIER_LABEL[f.observation.tier]}</small>
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
            No live feed is reporting for this driver right now — it is running on its documented
            default.
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
  const providerCount = new Set(point.devices.map((d) => d.provider)).size;
  return (
    <aside className="qci-map-detail" key="root">
      <header>
        <p className="qci-detail-eyebrow">Today</p>
        <h3>Quantum Compute Index</h3>
      </header>
      <dl>
        <Row k="Price" v={`$${money(point.usdPerQpuHour)} / hour`} mono />
        <Row
          k="Cost per capability"
          v={`$${money(point.usdPerQcu, 0)} / hour`}
          hint="adjusted for what the hardware can do"
          mono
        />
        <Row k="Index level" v={money(point.level, 2)} hint="1,000 at inception" mono />
        <Row
          k="Change"
          v={`${point.changePct >= 0 ? "+" : ""}${point.changePct.toFixed(2)}%`}
          mono
        />
        <Row
          k="Tracking"
          v={`${point.devices.length} machines · ${providerCount} providers`}
          mono
        />
        {point.costBasisPerHour ? (
          <Row k="Costs to produce" v={`$${money(point.costBasisPerHour)} / hour`} mono />
        ) : null}
        {point.costCoverageRatio ? (
          <Row k="Price vs cost" v={`${point.costCoverageRatio.toFixed(1)}× cost`} mono />
        ) : null}
        {diagnostic ? (
          <>
            <Row
              k="Coverage"
              v={
                <span className={point.coverage >= 0.6 ? "ok" : "warn"}>
                  {pct(point.coverage, 0)} of basket weight
                </span>
              }
              mono
            />
            <Row k="Matched sample" v={`${point.matched} of ${point.priced ?? point.devices.length}`} mono />
            <Row k="Methodology" v={point.methodology} mono />
          </>
        ) : null}
      </dl>

      {point.inception ? (
        <p className="qci-detail-note strong">
          This is the first published point. The level starts at 1,000 and today&rsquo;s price is
          the baseline every future move is measured against — there is nothing to compare it with
          yet, so no change is shown.
        </p>
      ) : total !== 0 ? (
        <p className="qci-detail-note">
          Today&rsquo;s move splits into <b>{pct(Math.abs(priceShare), 0)} repricing</b> and{" "}
          <b>{pct(Math.abs(1 - priceShare), 0)} hardware getting better or worse</b>.
        </p>
      ) : (
        <p className="qci-detail-note">
          No movement today — prices and hardware were unchanged across every machine that could be
          compared with yesterday.
        </p>
      )}

      {diagnostic && point.excluded.length > 0 ? (
        <>
          <p className="qci-detail-note">
            Not in today&rsquo;s matched sample — these contribute exactly nothing to the move
            rather than distorting it.
          </p>
          <ul className="qci-detail-excluded">
            {point.excluded.map((e) => (
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
