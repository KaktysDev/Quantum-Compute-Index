"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The QRouter map.
//
// One picture of the whole system: the ROUTER in the middle, the machines it can
// route to fanning left, and what an hour on them costs to produce fanning
// right. A job descends the intake column into the router, the router scores
// today's basket under the selected policy, and the winning path lights up.
//
// WHY THE ROUTER IS THE CENTRE AND NOT THE PRICE
// The index and the router are not two products. The index is the price signal
// the router routes on — that is the entire reason it exists. Drawing the price
// alone in the middle showed a number with no consumer; drawing the router in
// the middle with the price inside it shows what the number is FOR. The QCI has
// not moved to the side, it has moved into the core, where the router reads it.
//
// THE RANKING IS REAL, THE TRAFFIC IS NOT
// The winning machine is computed from the published point by routing.ts, under
// QRouter's own published policy weights. It is a real answer to "where would a
// job land right now". It is NOT a replay of live jobs, and the map says so
// rather than letting the animation imply otherwise.
//
// TWO AUDIENCES, ONE LAYOUT
//   "public"     — what it costs, where a job lands, what it is made of.
//   "diagnostic" — everything the public view hides: per-field provenance and
//                  tier, staleness, merges, exclusions, matched sample.
// Keeping them one component is deliberate: the diagnostic view has to be
// looking at exactly the same numbers the public view shows, or it is not a
// check on anything.
//
// Node area is proportional to real contribution throughout, so the energy node
// is genuinely tiny next to capital — the picture states the finding rather than
// decorating it.
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
// children, plus their two lines of label — still fits inside the viewBox.
// Getting this wrong does not clip (the SVG deliberately allows overflow so
// labels can breathe); it spills children over the panel edge instead, which is
// worse. Budget: CY + DEVICE_RING + LABEL_ROOM ≤ H.
const W = 1280;
const H = 980;
const CX = W / 2;
const CY = 545;

const HUB_R = 94;
const PROVIDER_RING = 258;
const DEVICE_RING = 396;
const FACTOR_RING = 258;
const FACTOR_DETAIL_RING = 396;
/** Vertical room a node's two label lines need below its circle. */
const LABEL_ROOM = 34;
/**
 * Baseline of the verdict ribbon. Below the lowest a node's second label line
 * can reach (CY + DEVICE_RING·sin 66° + r + LABEL_ROOM), so the ribbon never has
 * to compete with the graph for space.
 */
const VERDICT_Y = 918;

/**
 * Total arc each side occupies, in degrees. Kept well under 180 so the target
 * cluster and the cost cluster never bleed into each other's half — the
 * left/right split is the first thing the map has to communicate — and so an
 * expanded cluster at the extreme of the arc still lands inside the viewBox.
 *
 * It also leaves the top and bottom centre columns empty, which is what makes
 * room for the intake column above the hub and the verdict ribbon below it.
 */
const SIDE_SPREAD = 132;
/** Arc an expanded cluster's children occupy around their parent. */
const CHILD_SPREAD = 58;

/**
 * The intake pipeline — a job being parsed, filtered and scored on its way into
 * the router.
 *
 * It runs HORIZONTALLY across the top and then elbows down the centre column,
 * and both of those are forced by the arcs rather than chosen for looks. A
 * vertical stack of stage chips down the middle is the obvious first attempt and
 * it does not fit: with four providers the topmost target node sits at roughly
 * (CX−105, CY−236) and the topmost cost node mirrors it, leaving a gap of about
 * 120px between them — narrower than any chip wide enough to hold a label. Only
 * the bare conduit is thin enough to thread that gap, so the chips live above
 * the whole graph and the conduit does the descending.
 */
const INTAKE_Y = 68;
const INTAKE_CAP_W = 150;
const INTAKE_CHIP_W = 186;
const INTAKE_GAP = 14;
/** y of the horizontal leg of the elbow that carries the flow back to centre. */
const INTAKE_ELBOW_Y = 152;
const INTAKE_STAGES = [
  { label: "Parse & analyze", sub: "width · depth · gates" },
  { label: "Filter targets", sub: "capacity · credentials" },
  { label: "Score candidates", sub: "policy weights" },
];

/** Left-to-right centres for the intake row, centred as a whole on CX. */
function intakeLayout(): { capX: number; stageX: number[]; lastX: number } {
  const total =
    INTAKE_CAP_W + INTAKE_STAGES.length * INTAKE_CHIP_W + INTAKE_STAGES.length * INTAKE_GAP;
  let cursor = CX - total / 2;
  const capX = cursor + INTAKE_CAP_W / 2;
  cursor += INTAKE_CAP_W + INTAKE_GAP;
  const stageX = INTAKE_STAGES.map(() => {
    const x = cursor + INTAKE_CHIP_W / 2;
    cursor += INTAKE_CHIP_W + INTAKE_GAP;
    return x;
  });
  return { capX, stageX, lastX: stageX[stageX.length - 1] };
}

const intake = intakeLayout();
/** Down out of the last stage, back to centre, then down into the router. */
const INTAKE_PATH = `M ${intake.lastX} ${INTAKE_Y + 21} V ${INTAKE_ELBOW_Y} H ${CX} V ${CY - HUB_R - 4}`;

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
 * reports as a hydration error on every load ("535.0619460864435" vs
 * ...436). Two decimals is far finer than a pixel at this viewBox scale, makes
 * the geometry bit-identical on both sides, and shrinks the serialised markup.
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
        r: 22 + 24 * Math.sqrt(p.weight / maxW),
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
            r: 17,
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
        r: 15 + 29 * Math.sqrt(c.share / maxShare),
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
            r: 14,
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
      <header className="qci-map-head">
        <div>
          <h2>{diagnostic ? "Router attribution — full detail" : "How a job gets routed"}</h2>
          <p>
            {diagnostic
              ? "Every constituent with its source tier, staleness and exclusion state, under the live routing policy."
              : "QRouter sits in the middle. On the left are the machines it can send a job to, on the right is what an hour on them costs to produce, and in the core is the price it decides on."}
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

      {/* ── Policy switcher ──────────────────────────────────────────────────
          Real weights, real ranking. Changing this re-ranks the live basket and
          re-lights the winning path, so the reader can see the trade-off rather
          than be told about it. */}
      <div className="qci-policy-bar" role="group" aria-label="Routing policy">
        <span className="qci-policy-label">Policy</span>
        {POLICIES.map((p) => (
          <button
            key={p.id}
            type="button"
            className="qci-policy-chip"
            data-active={p.id === policyId ? "true" : undefined}
            onClick={() => setPolicyId(p.id)}
            title={p.blurb}
          >
            {p.label}
          </button>
        ))}
        <span className="qci-policy-note">
          {ranking.missingAxes.length > 0
            ? `No queue data reported today — its weight is redistributed, not scored as zero.`
            : `Ranked from today's published point. Not a replay of live traffic.`}
        </span>
      </div>

      <div className="qci-map-body">
        <div className="qci-map-canvas">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="QRouter routing map over the Quantum Compute Index"
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
              {/* The sweep that rotates over the candidate arc: opaque at its
                  leading edge, gone by its tail, so it reads as a scan rather
                  than as a wedge of colour. */}
              <linearGradient id="qciSweep" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--qci-price)" stopOpacity="0" />
                <stop offset="100%" stopColor="var(--qci-price)" stopOpacity="0.5" />
              </linearGradient>
            </defs>

            {/* A soft field behind everything, replacing the old hard ruled
                circle. It reads as depth rather than as a border. */}
            <circle cx={CX} cy={CY} r={DEVICE_RING} fill="url(#qciFieldGlow)" />

            <text className="qci-map-axis" x={CX - 372} y={CY - 330} textAnchor="middle">
              TARGETS — where the job can land
            </text>
            <text className="qci-map-axis" x={CX + 372} y={CY - 330} textAnchor="middle">
              COST — what an hour takes to produce
            </text>

            {/* Three slowly counter-rotating dashed rings. The only motion on
                the map that is not driven by interaction; it keeps the picture
                feeling live without implying that anything is changing. */}
            <circle cx={CX} cy={CY} r={PROVIDER_RING} className="qci-map-orbit" />
            <circle cx={CX} cy={CY} r={PROVIDER_RING - 52} className="qci-map-orbit reverse" />
            <circle cx={CX} cy={CY} r={DEVICE_RING - 24} className="qci-map-orbit wide" />

            {/* ── Intake column ────────────────────────────────────────────
                A job descending into the router. The conduit runs behind the
                stage chips, and the flowing dash on it is the only thing on the
                map that depicts movement — because it is the only thing that
                actually moves. */}
            <g className="qci-intake">
              {/* One path for the whole elbow, so a single normalised dash
                  travels the corner instead of two segments animating out of
                  step with each other. */}
              <path className="qci-conduit" pathLength={1} d={INTAKE_PATH} />
              <path className="qci-conduit-flow" pathLength={1} d={INTAKE_PATH} />
              {/* Arrowhead at the router end — the flow has a direction and the
                  dash alone does not state which way. */}
              <path
                className="qci-conduit-tip"
                d={`M ${CX - 6} ${CY - HUB_R - 14} L ${CX} ${CY - HUB_R - 4} L ${CX + 6} ${CY - HUB_R - 14}`}
              />

              {/* Connectors between the row's chips. */}
              {[intake.capX, ...intake.stageX].slice(0, -1).map((x, i) => {
                const next = [intake.capX, ...intake.stageX][i + 1];
                const from = x + (i === 0 ? INTAKE_CAP_W : INTAKE_CHIP_W) / 2;
                const to = next - INTAKE_CHIP_W / 2;
                return (
                  <line
                    key={`ic:${i}`}
                    className="qci-intake-link"
                    x1={from}
                    y1={INTAKE_Y}
                    x2={to}
                    y2={INTAKE_Y}
                  />
                );
              })}

              <g transform={`translate(${intake.capX} ${INTAKE_Y})`}>
                <rect
                  className="qci-intake-cap"
                  x={-INTAKE_CAP_W / 2}
                  y={-20}
                  width={INTAKE_CAP_W}
                  height={40}
                  rx={20}
                />
                <text className="qci-intake-cap-text" y={4} textAnchor="middle">
                  OPENQASM JOB
                </text>
              </g>

              {INTAKE_STAGES.map((s, i) => (
                <g key={s.label} transform={`translate(${intake.stageX[i]} ${INTAKE_Y})`}>
                  <rect
                    className="qci-stage"
                    x={-INTAKE_CHIP_W / 2}
                    y={-21}
                    width={INTAKE_CHIP_W}
                    height={42}
                    rx={10}
                    style={{ animationDelay: `${240 + i * 110}ms` }}
                  />
                  <text className="qci-stage-label" y={-3} textAnchor="middle">
                    {s.label}
                  </text>
                  <text className="qci-stage-sub" y={12} textAnchor="middle">
                    {s.sub}
                  </text>
                </g>
              ))}
            </g>

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
                      style={{ animationDelay: `${(isChild ? 40 : 0) + i * 45}ms` }}
                      data-dim={n.dim ? "true" : undefined}
                      data-active={
                        selectedKey === n.key || hovered === n.key ? "true" : undefined
                      }
                    />
                    {/* The winning route, drawn as a second line with a running
                        dash. One segment travelling outward from the core to the
                        machine the policy picked. */}
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

            {/* A sweep rotating over the candidate arc — the router looking at
                its options. Carries no datum; it is the one purely atmospheric
                element and it is confined to the side where evaluation happens. */}
            <g className="qci-sweep-wrap">
              <path
                className="qci-sweep"
                d={`M ${CX} ${CY} L ${CX - PROVIDER_RING - 60} ${CY - 44} A ${PROVIDER_RING + 60} ${PROVIDER_RING + 60} 0 0 1 ${CX - PROVIDER_RING - 60} ${CY + 44} Z`}
              />
            </g>

            {/* Centre hub — the router */}
            <circle cx={CX} cy={CY} r={HUB_R + 60} fill="url(#qciHubGlow)" className="qci-hub-glow" />
            {/* Position on the OUTER group as an attribute, animation on the
                inner one. A CSS transform replaces the attribute outright, so
                animating a node that carries its own translate throws it to the
                viewBox origin. */}
            <g transform={`translate(${CX} ${CY})`}>
              <circle className="qci-hub-ring outer" r={HUB_R + 26} />
              <circle className="qci-hub-ring inner" r={HUB_R + 12} />
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
                <text y={-42} textAnchor="middle" className="qci-hub-brand">
                  QROUTER
                </text>
                <text y={-22} textAnchor="middle" className="qci-hub-eyebrow">
                  ROUTING ON
                </text>
                <text y={10} textAnchor="middle" className="qci-hub-value">
                  ${money(shownPrice)}
                </text>
                <text
                  y={34}
                  textAnchor="middle"
                  className={`qci-hub-change ${flat ? "flat" : up ? "up" : "down"}`}
                >
                  {flat
                    ? "— unchanged"
                    : `${up ? "▲" : "▼"} ${Math.abs(point.changePct).toFixed(2)}%`}
                </text>
                <text y={54} textAnchor="middle" className="qci-hub-eyebrow">
                  QCI {money(point.level, 2)}
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
                  data-route={n.onRoute ? "true" : undefined}
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
                  {n.onRoute ? <circle className="qci-route-ring" r={n.r + 9} /> : null}
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

            {/* ── Verdict ribbon ───────────────────────────────────────────
                Where the job lands, under the policy currently selected.

                Parked at the FOOT of the viewBox rather than tucked under the
                hub. The space below the core looks free and is not: the two arcs
                converge as they come down, so the clear span between the
                flanking nodes shrinks from ~375px just under the hub to ~120px
                at the bottom of the ring — and this ribbon needs 464 to render
                "provider · machine · rate" without truncating. Sitting it there
                buried a target node and clipped the cryogenics label. Below the
                whole graph, the full width is available. */}
            {winner ? (
              <g
                className="qci-verdict"
                transform={`translate(${CX} ${VERDICT_Y})`}
                onClick={() => setSelected({ kind: "device", id: winner.device.id })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected({ kind: "device", id: winner.device.id });
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`Winning target: ${winner.device.provider} ${winner.device.device}`}
              >
                <rect x={-232} y={-25} width={464} height={50} rx={25} />
                <text className="qci-verdict-eyebrow" x={-206} y={-4} textAnchor="start">
                  ROUTES TO
                </text>
                <text className="qci-verdict-name" x={-206} y={13} textAnchor="start">
                  {winner.device.provider} · {winner.device.device}
                </text>
                <text className="qci-verdict-figure" x={206} y={-4} textAnchor="end">
                  ${money(winner.device.pricePerHour)}/hr
                </text>
                <text className="qci-verdict-sub" x={206} y={13} textAnchor="end">
                  {AXIS_LABEL[winner.decidedBy].toLowerCase()} decided it · score{" "}
                  {winner.score.toFixed(2)}
                </text>
              </g>
            ) : null}
          </svg>
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
