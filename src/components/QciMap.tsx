"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The QRouter map.
//
// One picture of the whole system: the ROUTER in the middle, the machines it can
// route to fanning left, and what an hour on them costs to produce fanning
// right. The router scores today's basket under the selected policy, and the
// winning path lights up.
//
// WHY THE ROUTER IS THE CENTRE AND NOT THE PRICE
// The index and the router are not two products. The index is the price signal
// the router routes on. Drawing the price alone in the middle showed a number
// with no consumer; drawing the router with the price inside it shows what the
// number is FOR.
//
// THE RANKING IS REAL, THE TRAFFIC IS NOT
// The winning machine is computed from the published point by routing.ts under
// QRouter's own published policy weights. It is a real answer to "where would a
// job land right now". It is NOT a replay of live jobs, and the map says so.
//
// ── WHY THIS VERSION IS SO MUCH QUIETER THAN THE LAST ────────────────────────
// The previous map drew everything it knew, all the time: a four-chip intake
// pipeline across the top, three counter-rotating orbit rings, a rotating radar
// sweep, a hub glow, a verdict ribbon, and two labels under every node — inside
// a 1280×980 viewBox that rendered ~0.77× the panel width tall. Every one of
// those marks was defensible on its own and together they buried the finding.
//
// So the resting state now carries only what cannot be recovered by pointing at
// something: the core price, the shape of the two fans, and which node won.
// Everything else — names, rates, weights, shares — is one hover away. Node area
// is still strictly proportional to real contribution, so the energy node is
// genuinely a dot next to capital; the picture still states that finding, it
// just no longer shouts the rest.
//
// COLOUR
// There is none, and that is the console's own house rule (see the header of
// console.css): neutral surfaces, hue reserved for status. This map used to
// break it with a blue "price" token and an amber "cost" token. The two sides
// are now told apart by FORM instead — targets are rings, cost drivers are
// filled discs — which survives at dot size the way the console's greys do and
// does not fight the rest of the shell.
//
// TWO AUDIENCES, ONE LAYOUT
//   "public"     — what it costs, where a job lands, what it is made of.
//   "diagnostic" — per-field provenance and tier, staleness, merges, exclusions.
// Keeping them one component is deliberate: the diagnostic view has to be
// looking at exactly the same numbers the public view shows, or it is not a
// check on anything.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { COST_CONSTANTS_REVIEWED_ON } from "@/lib/qci/v2/registry";
import {
  AXIS_LABEL,
  AXIS_SOURCE,
  POLICIES,
  rankDevices,
  type PolicyId,
  type PolicyWeights,
} from "@/lib/qci/v2/routing";
import type { DeviceDerived, FactorObservation, IndexPoint } from "@/lib/qci/v2/types";

// Geometry is sized so the OUTERMOST ring — a selected cluster's expanded
// children plus their label line — still fits inside the viewBox. Getting this
// wrong does not clip (the SVG allows overflow so labels can breathe); it spills
// children over the panel edge instead, which is worse.
//
// Budget, with SIDE_SPREAD at ±60°:
//   top    CY − DEVICE_RING·sin60 − r_max  = 218 − 177.5 − 14 = 26  (> axis row)
//   bottom CY + DEVICE_RING·sin60 + r_max + LABEL_ROOM = 431  (< H)
const W = 720;
const H = 460;
const CX = W / 2;
const CY = 218;

const HUB_R = 50;
const PROVIDER_RING = 138;
const DEVICE_RING = 205;
const FACTOR_RING = 138;
const FACTOR_DETAIL_RING = 205;
/** Vertical room a node's label line needs below its circle. */
const LABEL_ROOM = 22;

/**
 * Total arc each side occupies, in degrees. Kept well under 180 so the target
 * cluster and the cost cluster never bleed into each other's half — the
 * left/right split is the first thing the map has to communicate — and so an
 * expanded cluster at the extreme of the arc still lands inside the viewBox.
 * It also leaves the top and bottom centre columns clear for the intake conduit.
 */
const SIDE_SPREAD = 120;
/** Arc an expanded cluster's children occupy around their parent. */
const CHILD_SPREAD = 50;

/** Where the intake conduit starts its run down into the core. */
const INTAKE_Y = 46;

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
  /** On the winning route under the current policy. */
  onRoute?: boolean;
}

/**
 * Polar → cartesian, ROUNDED.
 *
 * The rounding is not cosmetic. Math.cos/Math.sin are not required to be
 * correctly rounded, so Node and Chrome can disagree in the last bit for the
 * same input — which React sees as a server/client attribute mismatch and
 * reports as a hydration error on every load. Two decimals is far finer than a
 * pixel at this viewBox scale and makes the geometry bit-identical on both sides.
 */
function polar(angleDeg: number, radius: number): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round((CX + radius * Math.cos(a)) * 100) / 100,
    y: Math.round((CY + radius * Math.sin(a)) * 100) / 100,
  };
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

/** Queue depth in the largest unit that still reads precisely. */
function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

const FACTOR_GROUP_LABEL: Record<string, string> = {
  energy: "Energy",
  cryogenics: "Cryogenics",
  capital: "Capital",
  labour: "Labour",
  fx: "FX",
};

/**
 * Whether a cost driver has a live collector at all.
 *
 * The distinction matters and the old copy erased it: "no live feed is
 * reporting right now" reads as a transient outage, which is true for
 * cryogenics (BLS is down or unkeyed) and false for labour, which has no feed
 * in existence and never will. Telling a reader to wait for a number that is
 * never coming is worse than telling them it is modelled.
 */
const DRIVER_HAS_FEED: Record<string, boolean> = {
  energy: true,
  cryogenics: true,
  capital: true,
  labour: false,
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
 * Purely presentational, and deliberately short: the price is the one thing in
 * the core a reader looks at first, and a value that resolves rather than
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
  const [policyId, setPolicyId] = useState<PolicyId>("balanced");
  const diagnostic = mode === "diagnostic";

  const policy = POLICIES.find((p) => p.id === policyId) ?? POLICIES[0];
  const ranking = useMemo(() => rankDevices(point.devices, policy), [point.devices, policy]);
  const winner = ranking.winner;

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

    // Providers fan across the left semicircle — these are the routing targets.
    const pAngles = fan(providers.length, 180, Math.min(SIDE_SPREAD, providers.length * 30));
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
        r: 11 + 13 * Math.sqrt(p.weight / maxW),
        side: "price",
        selection: { kind: "provider", provider: p.provider },
        freshness: p.devices.length > 0 ? p.fresh / p.devices.length : 0,
        depth: 0,
        dim: activeProvider != null && activeProvider !== p.provider,
        onRoute: winner?.device.provider === p.provider,
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
          Math.min(CHILD_SPREAD, cluster.devices.length * 14),
        );
        cluster.devices.forEach((d, i) => {
          const { x, y } = polar(dAngles[i], DEVICE_RING);
          out.push({
            key: `d:${d.id}`,
            label: d.device,
            sub: `$${money(d.pricePerHour)}/hr`,
            x,
            y,
            r: 9,
            side: "price",
            selection: { kind: "device", id: d.id },
            freshness: d.fresh ? 1 : Math.max(0, 1 - d.staleDays / 45),
            depth: 1,
            onRoute: winner?.device.id === d.id,
          });
        });
      }
    }

    // Cost groups fan across the right semicircle.
    const cAngles = fan(costGroups.length, 0, Math.min(SIDE_SPREAD, costGroups.length * 34));
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
        r: 6 + 18 * Math.sqrt(c.share / maxShare),
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
        const fAngles = fan(items.length, centre, Math.min(CHILD_SPREAD, items.length * 14));
        items.forEach((f, i) => {
          const { x, y } = polar(fAngles[i], FACTOR_DETAIL_RING);
          out.push({
            key: `fi:${f.id}`,
            label: f.label,
            sub: `${f.observation.value.toPrecision(4)} ${f.unit}`,
            x,
            y,
            r: 8,
            side: "cost",
            selection: { kind: "factorItem", id: f.id },
            freshness: f.observation.tier === "assumed" ? 0.25 : 1,
            depth: 1,
          });
        });
      }
    }

    return out;
  }, [providers, costGroups, factorsByGroup, activeProvider, activeGroup, winner]);

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
      <header className="qci-sec-head">
        <div>
          <h2>{diagnostic ? "Router attribution" : "How a job gets routed"}</h2>
          <p>
            {diagnostic
              ? "Every constituent with its source tier, staleness and exclusion state, under the live routing policy."
              : "QRouter in the middle. Targets left, what an hour costs to produce right, the price it decides on in the core. Point at anything to read it."}
          </p>
        </div>
        {diagnostic ? (
          <span className="qci-map-status" data-status={point.inception ? "inception" : point.status}>
            {point.inception ? "Inception" : point.status === "final" ? "Final" : "Provisional"} ·{" "}
            {pct(point.coverage, 0)} coverage · {point.matched}/
            {point.priced ?? point.devices.length} matched
          </span>
        ) : null}
      </header>

      {/* ── Policy switcher ──────────────────────────────────────────────────
          Real weights, real ranking. Changing this re-ranks the live basket and
          re-lights the winning path, so the reader can see the trade-off rather
          than be told about it. */}
      <div className="qci-policy-bar" role="group" aria-label="Routing policy">
        <span className="qci-policy-label">Policy</span>
        <div className="qci-seg">
          {POLICIES.map((p) => (
            <button
              key={p.id}
              type="button"
              data-active={p.id === policyId ? "true" : undefined}
              onClick={() => setPolicyId(p.id)}
              title={p.blurb}
            >
              {p.label}
            </button>
          ))}
        </div>
        <span className="qci-policy-note">
          {ranking.missingAxes.length > 0
            ? "No queue data today — its weight is redistributed, not scored as zero."
            : "Ranked from today's published point. Not a replay of live traffic."}
        </span>
      </div>

      <div className="qci-map-body">
        <div className="qci-map-canvas">
          <svg
            className="qci-graph"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="QRouter routing map over the Quantum Compute Index"
            preserveAspectRatio="xMidYMid meet"
          >
            <text className="qci-axis" x={CX - 268} y={26} textAnchor="middle">
              TARGETS
            </text>
            <text className="qci-axis" x={CX + 268} y={26} textAnchor="middle">
              COST TO PRODUCE
            </text>

            {/* ── Intake ────────────────────────────────────────────────────
                A job descending into the router. The travelling dash is the
                only thing on the map that depicts movement, because it is the
                only thing that actually moves. The four-chip pipeline that used
                to run across the top said the same thing in 200px of vertical
                space; its stage names live in the copy instead. */}
            <g className="qci-intake">
              <line
                className="qci-conduit"
                x1={CX}
                y1={INTAKE_Y}
                x2={CX}
                y2={CY - HUB_R - 3}
                pathLength={1}
              />
              <line
                className="qci-conduit-flow"
                x1={CX}
                y1={INTAKE_Y}
                x2={CX}
                y2={CY - HUB_R - 3}
                pathLength={1}
              />
              <text className="qci-axis" x={CX} y={INTAKE_Y - 10} textAnchor="middle">
                JOB IN
              </text>
            </g>

            {/* Edges */}
            <g className="qci-edges">
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
                  <g key={`e:${n.key}`}>
                    <line
                      x1={ax}
                      y1={ay}
                      x2={n.x}
                      y2={n.y}
                      // pathLength normalises every edge to 1 unit long, so one
                      // dash animation draws them all at the same rate
                      // regardless of their real length.
                      pathLength={1}
                      className={`qci-edge ${n.side}`}
                      style={{ animationDelay: `${(isChild ? 40 : 0) + i * 40}ms` }}
                      data-dim={n.dim ? "true" : undefined}
                      data-active={selectedKey === n.key || hovered === n.key ? "true" : undefined}
                    />
                    {/* The winning route, drawn as a second line with a running
                        dash: one segment travelling from the core to the machine
                        the policy picked. */}
                    {n.onRoute ? (
                      <line
                        x1={ax}
                        y1={ay}
                        x2={n.x}
                        y2={n.y}
                        pathLength={1}
                        className="qci-route-flow"
                        style={{ animationDelay: `${isChild ? 300 : 0}ms` }}
                      />
                    ) : null}
                  </g>
                );
              })}
            </g>

            {/* Centre hub — the router. Position on the OUTER group as an
                attribute, animation on the inner one: a CSS transform replaces
                the attribute outright, so animating a node that carries its own
                translate throws it to the viewBox origin. */}
            <g transform={`translate(${CX} ${CY})`}>
              <circle className="qci-hub-ring" r={HUB_R + 13} />
              <g
                className="qci-node hub"
                data-active={selected.kind === "root" ? "true" : undefined}
                onClick={() => setSelected({ kind: "root" })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") setSelected({ kind: "root" });
                }}
                tabIndex={0}
                role="button"
                aria-label="QRouter core and index summary"
              >
                <circle className="qci-hub-pulse" r={HUB_R} />
                <circle r={HUB_R} />
                <text y={-17} textAnchor="middle" className="qci-hub-brand">
                  QROUTER
                </text>
                <text y={8} textAnchor="middle" className="qci-hub-value">
                  ${money(shownPrice)}
                </text>
                <text
                  y={25}
                  textAnchor="middle"
                  className={`qci-hub-change ${flat ? "flat" : up ? "up" : "down"}`}
                >
                  {flat ? "— flat" : `${up ? "▲" : "▼"} ${Math.abs(point.changePct).toFixed(2)}%`}
                </text>
              </g>
            </g>

            {/* Nodes. The label is rendered always and hidden by CSS at rest —
                keeping it in the DOM is what lets it be read by assistive tech
                and found by in-page search while the resting picture stays bare. */}
            {nodes.map((n, i) => (
              <g key={n.key} transform={`translate(${n.x} ${n.y})`}>
                <g
                  className={`qci-node ${n.side}`}
                  style={{ animationDelay: `${n.depth * 60 + i * 40}ms` }}
                  data-dim={n.dim ? "true" : undefined}
                  data-active={
                    selectedKey === n.key || hovered === n.key ? "true" : undefined
                  }
                  data-stale={n.freshness < 0.75 ? "true" : undefined}
                  data-route={n.onRoute ? "true" : undefined}
                  onClick={() => setSelected(n.selection)}
                  onMouseEnter={() => setHovered(n.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(n.key)}
                  onBlur={() => setHovered(null)}
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
                  {n.onRoute ? <circle className="qci-route-ring" r={n.r + 7} /> : null}
                  <circle className="qci-node-halo" r={n.r} />
                  <circle r={n.r} />
                  <text y={n.r + 13} textAnchor="middle" className="qci-node-label">
                    {n.label}
                  </text>
                  <text y={n.r + LABEL_ROOM + 2} textAnchor="middle" className="qci-node-sub">
                    {n.sub}
                  </text>
                </g>
              </g>
            ))}
          </svg>

          {/* ── Verdict ─────────────────────────────────────────────────────
              Where a job lands under the selected policy.

              Out of the SVG entirely. Inside it, this had to be parked at the
              foot of a viewBox tall enough to clear the arcs — the two fans
              converge as they descend, so the clear span under the core shrinks
              to roughly a third of what "provider · machine · rate" needs, and
              the earlier attempt at tucking it there buried a target node and
              clipped a label. As HTML it takes the panel's own width and costs
              the picture no height at all. */}
          {winner ? (
            <button
              type="button"
              className="qci-verdict"
              onClick={() => setSelected({ kind: "device", id: winner.device.id })}
            >
              <span className="qci-verdict-eyebrow">Routes to</span>
              <span className="qci-verdict-name">
                {winner.device.provider} · {winner.device.device}
              </span>
              <span className="qci-verdict-figure">${money(winner.device.pricePerHour)}/hr</span>
              <span className="qci-verdict-sub">
                {AXIS_LABEL[winner.decidedBy].toLowerCase()} decided it · score{" "}
                {winner.score.toFixed(2)}
              </span>
            </button>
          ) : null}
        </div>

        <QciMapDetail
          point={point}
          selected={selected}
          onSelect={setSelected}
          diagnostic={diagnostic}
          ranking={ranking}
          policyLabel={policy.label}
          policyBlurb={policy.blurb}
          weights={policy.weights}
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

/** Four weighted bars showing why a device won, at a glance. */
function AxisBars({
  axes,
  weights,
}: {
  axes: Record<keyof PolicyWeights, { score: number; imputed: boolean }>;
  weights: PolicyWeights;
}) {
  const keys = Object.keys(AXIS_LABEL) as Array<keyof PolicyWeights>;
  return (
    <ul className="qci-axis-bars">
      {keys.map((k) => (
        <li key={k} data-imputed={axes[k].imputed ? "true" : undefined}>
          <span className="qci-axis-name">
            {AXIS_LABEL[k]}
            <small>{weights[k]}%</small>
          </span>
          <span className="qci-axis-track">
            <span className="qci-axis-fill" style={{ width: `${Math.round(axes[k].score * 100)}%` }} />
          </span>
          <span className="qci-axis-value">
            {axes[k].imputed ? "n/a" : axes[k].score.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function QciMapDetail({
  point,
  selected,
  onSelect,
  diagnostic,
  ranking,
  policyLabel,
  policyBlurb,
  weights,
}: {
  point: IndexPoint;
  selected: Selection;
  onSelect: (s: Selection) => void;
  diagnostic: boolean;
  ranking: ReturnType<typeof rankDevices>;
  policyLabel: string;
  policyBlurb: string;
  weights: PolicyWeights;
}) {
  if (selected.kind === "device") {
    const d = point.devices.find((x) => x.id === selected.id);
    if (!d) return null;
    const contribution = point.attribution.byDevice.find((b) => b.id === d.id)?.contribution ?? 0;
    const rankIndex = ranking.ranked.findIndex((r) => r.device.id === d.id);
    const rank = rankIndex >= 0 ? ranking.ranked[rankIndex] : null;
    return (
      <aside className="qci-map-detail" key={`d:${d.id}`}>
        <header>
          <p className="qci-detail-eyebrow">{d.provider} · machine</p>
          <h3>{d.device}</h3>
        </header>

        {rank ? (
          <div className="qci-rank-card" data-winner={rankIndex === 0 ? "true" : undefined}>
            <p>
              {rankIndex === 0 ? (
                <>
                  <b>Where a job lands right now</b> under the {policyLabel.toLowerCase()} policy.
                </>
              ) : (
                <>
                  Ranked <b>#{rankIndex + 1}</b> of {ranking.ranked.length} under the{" "}
                  {policyLabel.toLowerCase()} policy.
                </>
              )}
            </p>
            <AxisBars axes={rank.axes} weights={weights} />
          </div>
        ) : null}

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
          {d.queueSeconds != null ? (
            <Row k="Queue now" v={duration(d.queueSeconds)} hint="live from the control plane" mono />
          ) : null}
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
          <p className="qci-detail-eyebrow">Routing target</p>
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
          ← Back to the router
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
    const hasFeed = DRIVER_HAS_FEED[selected.group] ?? true;
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
        ) : hasFeed ? (
          /* A collector exists and did not answer — a real, fixable outage. */
          <p className="qci-detail-note warn">
            This driver has a live source and it is not reporting, so the pinned default is in
            force. That is an outage or a missing API key, not the normal state.
          </p>
        ) : (
          /* No feed exists in the world. Saying "not reporting right now" here
             would promise a number that is never coming. */
          <p className="qci-detail-note">
            There is no feed for this anywhere — nobody publishes it. It is modelled from the
            installed cost of the system, and those constants were last reviewed{" "}
            {COST_CONSTANTS_REVIEWED_ON}.
          </p>
        )}
        <button className="qci-detail-back" onClick={() => onSelect({ kind: "root" })}>
          ← Back to the router
        </button>
      </aside>
    );
  }

  // Root — the router itself.
  const a = point.attribution;
  const total = a.totalLogChange;
  const priceShare = total !== 0 ? a.priceLogChange / total : 0;
  const providerCount = new Set(point.devices.map((d) => d.provider)).size;
  const winner = ranking.winner;
  return (
    <aside className="qci-map-detail" key="root">
      <header>
        <p className="qci-detail-eyebrow">QRouter core</p>
        <h3>{policyLabel} routing</h3>
      </header>

      <p className="qci-detail-note">{policyBlurb}</p>

      {winner ? (
        <div className="qci-rank-card" data-winner="true">
          <p>
            A job submitted now lands on <b>{winner.device.provider} {winner.device.device}</b> at $
            {money(winner.device.pricePerHour)}/hour.
          </p>
          <AxisBars axes={winner.axes} weights={weights} />
        </div>
      ) : (
        <p className="qci-detail-note warn">
          No machine in today&rsquo;s basket carries a usable price, so there is nothing to route to.
        </p>
      )}

      {ranking.ranked.length > 1 ? (
        <>
          <p className="qci-detail-note">Full ranking under this policy.</p>
          <ul className="qci-detail-list">
            {ranking.ranked.map((r, i) => (
              <li key={r.device.id}>
                <button onClick={() => onSelect({ kind: "device", id: r.device.id })}>
                  <span>
                    <b>
                      {i + 1}. {r.device.device}
                    </b>
                    <small>
                      {r.device.provider} · {AXIS_LABEL[r.decidedBy].toLowerCase()} led
                    </small>
                  </span>
                  <span className="qci-detail-value">
                    <b>{r.score.toFixed(2)}</b>
                    <small>${money(r.device.pricePerHour)}/hr</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {ranking.missingAxes.length > 0 ? (
        <p className="qci-detail-note warn">
          {ranking.missingAxes.map((x) => AXIS_LABEL[x]).join(", ")} was not reported by any provider
          today. Its weight is redistributed across the other axes — a missing input is not scored as
          a bad one.
        </p>
      ) : null}

      <p className="qci-detail-note">
        Scored on {AXIS_SOURCE.cost.toLowerCase()}, {AXIS_SOURCE.queue.toLowerCase()},{" "}
        {AXIS_SOURCE.fidelity.toLowerCase()}, and {AXIS_SOURCE.reliability.toLowerCase()}.
      </p>

      <h4 className="qci-detail-subhead">The price it routes on</h4>
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
