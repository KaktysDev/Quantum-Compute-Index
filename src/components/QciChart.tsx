"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The one price chart the platform draws.
//
// WHY THIS EXISTS RATHER THAN lightweight-charts
// The QCI publishes one point per day and has four of them. A trading-chart
// library is built for the opposite case — thousands of bars, panning, zooming,
// a bar-spacing model that survives a resize. On a four-point series that model
// worked against us: `fitContent()` runs before the ResizeObserver hands the
// chart its real width, and the library keeps bar spacing rather than the
// logical range across that resize, so the whole series ended up squeezed into
// the right-hand tenth of the panel with an unreadable axis. It also drags in
// its own grid, crosshair, price scale and fonts, all of which had to be fought
// back to neutral one option at a time.
//
// This draws the series across the full width, always, because the x-scale is
// recomputed from the data on every render and the SVG scales with its box.
// There is nothing to synchronise.
//
// HOW IT LOOKS
// At rest: a line, a soft wash under it, a dashed rule at the opening value and
// a single dot on today. Nothing else — no grid, no axis furniture, no colour.
// On hover: the guide, the marker and the readout fade in. Everything that is
// only true of the point under the cursor is only drawn while the cursor is
// there.
//
// GEOMETRY
// The SVG is non-uniformly scaled (`preserveAspectRatio="none"`) so the line
// always spans the box, and every stroke inside carries
// `vector-effect="non-scaling-stroke"` so that scaling never thickens it.
// Anything that must stay round or legible — dots, labels — is HTML positioned
// in percentages over the top, not SVG inside the skewed coordinate system.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useRef, useState } from "react";

export interface ChartPoint {
  /** UNIX seconds. */
  time: number;
  value: number;
  /** Thin-coverage days are marked so a provisional point looks provisional. */
  status?: "final" | "provisional";
}

/** Internal viewBox. Width and height are both arbitrary — the box is stretched. */
const VB_W = 1000;
const VB_H = 100;
/** Headroom so the peak and trough never touch the edge of the plot. */
const PAD_T = 9;
const PAD_B = 9;
/**
 * Horizontal inset, in viewBox units.
 *
 * The end dots are HTML positioned at `left: x%`, so an unpadded series puts
 * today's dot centred exactly on the container's right edge — and any host that
 * clips its overflow (the landing card does, for its rounded corners) cuts it in
 * half. Six units of a thousand is under 4px at any realistic width: invisible
 * as a gap, sufficient to keep every mark inside the box.
 */
const PAD_X = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Dates are formatted from UTC parts rather than `toLocaleDateString`.
 *
 * The chart renders on the server first. `toLocaleDateString` resolves against
 * the host's locale and timezone, so the server and the browser disagree and
 * React reports a hydration mismatch on every load. UTC parts are the same
 * string in both places.
 */
export function chartDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function chartDateLong(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

interface Placed extends ChartPoint {
  x: number;
  y: number;
}

interface Geometry {
  placed: Placed[];
  line: string;
  area: string;
  /** y of the first value — the rule every later point is read against. */
  baseY: number;
  /** One point cannot describe a movement; it is drawn as a mark, not a line. */
  single: boolean;
}

function build(points: ChartPoint[]): Geometry | null {
  const pts = points.filter((p) => Number.isFinite(p.value) && Number.isFinite(p.time));
  if (pts.length === 0) return null;

  const times = pts.map((p) => p.time);
  const values = pts.map((p) => p.value);
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const spanT = t1 - t0;
  const spanV = hi - lo;

  // A perfectly flat series has no span to scale against. Giving it a synthetic
  // one centres the line instead of dividing by zero — and a flat price SHOULD
  // read as flat, not be stretched into noise.
  const padV = spanV === 0 ? Math.max(Math.abs(hi) * 0.05, 1) : spanV * 0.22;
  const vMin = lo - padV;
  const vMax = hi + padV;

  const plotH = VB_H - PAD_T - PAD_B;
  const plotW = VB_W - 2 * PAD_X;
  const xOf = (t: number, i: number) =>
    pts.length === 1
      ? VB_W / 2
      : PAD_X +
        (spanT === 0 ? i / (pts.length - 1) : (t - t0) / spanT) * plotW;
  const yOf = (v: number) => PAD_T + (1 - (v - vMin) / (vMax - vMin)) * plotH;

  const placed: Placed[] = pts.map((p, i) => ({
    ...p,
    x: r2(xOf(p.time, i)),
    y: r2(yOf(p.value)),
  }));

  const single = placed.length === 1;
  const d = placed.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return {
    placed,
    line: single ? "" : d,
    area: single ? "" : `${d} L ${placed[placed.length - 1].x} ${VB_H} L ${placed[0].x} ${VB_H} Z`,
    baseY: placed[0].y,
    single,
  };
}

export default function QciChart({
  points,
  height = 240,
  format,
  prefix = "",
  decimals = 0,
  onHover,
  className,
  ariaLabel = "Price history",
  showDates = true,
}: {
  points: ChartPoint[];
  /** CSS height of the plot. */
  height?: number;
  /**
   * Custom value formatter. CLIENT CALLERS ONLY — a function cannot cross the
   * server/client boundary, so a Server Component rendering this must use
   * `prefix`/`decimals` instead (React throws "Functions cannot be passed
   * directly to Client Components" otherwise).
   */
  format?: (value: number) => string;
  /** Serializable formatting, for server callers. */
  prefix?: string;
  decimals?: number;
  /** Fires with the hovered point, or null on leave. Lets a host header track it. */
  onHover?: (point: ChartPoint | null) => void;
  className?: string;
  ariaLabel?: string;
  /** The window's first and last date, in the bottom padding. Ghosted at rest. */
  showDates?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const geo = useMemo(() => build(points), [points]);

  // Pinned to en-US rather than the ambient locale: the aria-label below is
  // rendered on the server, and a host whose locale groups digits differently
  // from the browser's would make that string a hydration mismatch.
  const fmt =
    format ??
    ((v: number) =>
      `${prefix}${v.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`);

  const pick = useCallback(
    (clientX: number) => {
      const el = box.current;
      if (!el || !geo || geo.placed.length === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const x = ((clientX - rect.left) / rect.width) * VB_W;
      let best = 0;
      let bestD = Infinity;
      geo.placed.forEach((p, i) => {
        const d = Math.abs(p.x - x);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      setActive((prev) => {
        if (prev !== best) onHover?.(geo.placed[best]);
        return best;
      });
    },
    [geo, onHover],
  );

  const clear = useCallback(() => {
    setActive(null);
    onHover?.(null);
  }, [onHover]);

  if (!geo) {
    return (
      <div className={`qcx${className ? ` ${className}` : ""}`} style={{ height }}>
        <p className="qcx-empty">Nothing measured yet.</p>
      </div>
    );
  }

  const last = geo.placed[geo.placed.length - 1];
  const cursor = active != null ? geo.placed[active] : null;
  // The readout flips to the left of the guide near the right edge so it can
  // never be clipped by the panel.
  const flip = cursor != null && cursor.x > VB_W * 0.62;

  return (
    <div
      className={`qcx${className ? ` ${className}` : ""}`}
      style={{ height }}
      ref={box}
      onPointerMove={(e) => pick(e.clientX)}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerLeave={clear}
      data-hover={cursor ? "true" : undefined}
      role="img"
      aria-label={`${ariaLabel}. ${geo.placed.length} point${geo.placed.length === 1 ? "" : "s"}, latest ${fmt(last.value)}.`}
    >
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="qcxWash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.1" />
            <stop offset="55%" stopColor="currentColor" stopOpacity="0.028" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Opening value. The one reference mark drawn at rest, because "up or
            down since the start of this window" is the question the chart is
            actually asked. */}
        <line
          className="qcx-base"
          x1="0"
          y1={geo.baseY}
          x2={VB_W}
          y2={geo.baseY}
          vectorEffect="non-scaling-stroke"
        />

        {geo.single ? null : (
          <>
            <path className="qcx-wash" d={geo.area} fill="url(#qcxWash)" />
            <path
              className="qcx-line"
              d={geo.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
            />
          </>
        )}

        {cursor ? (
          <line
            className="qcx-guide"
            x1={cursor.x}
            y1="0"
            x2={cursor.x}
            y2={VB_H}
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>

      {/* Today. Kept in HTML so it stays a circle under the stretched viewBox. */}
      <span
        className="qcx-dot last"
        style={{ left: `${(last.x / VB_W) * 100}%`, top: `${(last.y / VB_H) * 100}%` }}
        data-provisional={last.status === "provisional" ? "true" : undefined}
      />

      {cursor ? (
        <>
          <span
            className="qcx-dot cursor"
            style={{ left: `${(cursor.x / VB_W) * 100}%`, top: `${(cursor.y / VB_H) * 100}%` }}
          />
          <span
            className="qcx-readout"
            data-flip={flip ? "true" : undefined}
            style={{ left: `${(cursor.x / VB_W) * 100}%` }}
          >
            <b>{fmt(cursor.value)}</b>
            <small>
              {chartDate(cursor.time)}
              {cursor.status === "provisional" ? " · provisional" : ""}
            </small>
          </span>
        </>
      ) : null}

      {/* The window's ends. Two dates is the whole x-axis — a series of daily
          points does not need tick marks to be read, and the value under the
          cursor already carries its own date. */}
      {showDates && geo.placed.length > 1 ? (
        <span className="qcx-dates" aria-hidden="true">
          <i>{chartDate(geo.placed[0].time)}</i>
          <i>{chartDate(last.time)}</i>
        </span>
      ) : null}
    </div>
  );
}
