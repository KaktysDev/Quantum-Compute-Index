"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The magnetic field behind the routing diagram.
//
// A fine grid of short segments. Every one of them is always turning: a slow
// flow field — three sine waves crossed over the lattice and drifting in time —
// gives each cell its own resting angle, and that angle never stops changing.
// Bring the pointer near and the cells inside its reach swing off the flow to
// point at it instead, and lift slightly in brightness. It is pure atmosphere:
// it encodes nothing, it is aria-hidden, and the page reads identically with it
// switched off.
//
// WHY CANVAS AND NOT SVG
// ~1,200 segments, all re-oriented every frame. As DOM nodes that is 1,200
// style recalculations per frame and a dropped frame budget on any laptop; as
// canvas strokes it is a few hundred microseconds.
//
// WHY THE FLOW IS THREE SINES AND NOT NOISE
// A noise field would need a gradient lookup per cell per frame. Three sines of
// different wavelength and drift speed, summed, never repeat visibly over the
// couple of minutes anyone looks at this, and the phase term of each one is
// constant per cell — so it is precomputed at build time and the per-frame cost
// is three Math.sin calls, roughly 90µs for the whole lattice.
//
// WHY ALPHA IS BUCKETED
// Brightness varies per cell, and `globalAlpha` is canvas state, so in
// principle that is ~1,200 state changes and ~1,200 stroke() calls per frame.
// Quantising to BUCKETS levels turns that into BUCKETS paths and BUCKETS
// strokes. At eight levels the banding is invisible against a ramp this shallow.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

/** Grid pitch, in CSS pixels. */
const SPACING = 26;
/** Length of one segment. Deliberately well under SPACING so the field reads as
    separate marks rather than as a hatched fill. */
const LEN = 8;
/** How far the pointer reaches. */
const RADIUS = 210;
/** Per-frame easing toward the target orientation — the swing, not a snap.
    Low enough that the flow field reads as something the cells are being
    carried by rather than something they are tracking exactly. */
const EASE = 0.09;

/** Resting brightness, and the ceiling the pointer lifts a cell to. The gap
    between them is the "spotlight", kept narrow on purpose — the motion is what
    this field is for, and a bright halo tracking the cursor competes with the
    diagram sitting on top of it. */
const BASE_ALPHA = 0.13;
const PEAK_ALPHA = 0.3;
/** How much of that headroom the resting shimmer is allowed to use, so the
    field breathes without ever approaching the pointer's brightness. */
const AMBIENT_LIFT = 0.3;
const BUCKETS = 8;

/** Flow field: spatial frequency of each wave (radians per pixel) and how fast
    its phase drifts (radians per second). Wavelengths ~910px / ~670px /
    ~1370px against drift periods of ~11s / ~17s / ~8.5s — three motions slow
    enough to read individually and coprime enough not to beat. */
const WAVE = [
  { fx: 0.0069, fy: 0.0033, speed: 0.55, amp: 0.72 },
  { fx: -0.0027, fy: 0.0094, speed: -0.38, amp: 0.52 },
  { fx: 0.0046, fy: 0.0046, speed: 0.74, amp: 0.36 },
] as const;

interface Cell {
  x: number;
  y: number;
  /** Current unit direction, eased toward the target every frame. */
  dx: number;
  dy: number;
  /** Constant phase of each flow wave at this position — see the note above. */
  p0: number;
  p1: number;
  p2: number;
}

/** Resting angle of the flow at a cell, at time `t` seconds. */
const flowAngle = (cell: Cell, t: number) =>
  WAVE[0].amp * Math.sin(cell.p0 + t * WAVE[0].speed) +
  WAVE[1].amp * Math.sin(cell.p1 + t * WAVE[1].speed) +
  WAVE[2].amp * Math.sin(cell.p2 + t * WAVE[2].speed);

export default function MagnetField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let cells: Cell[] = [];
    let width = 0;
    let height = 0;
    let ink = "#888888";
    // Off-canvas until the pointer actually arrives, so the field starts on the
    // flow rather than pulled toward a corner.
    let px = Number.NEGATIVE_INFINITY;
    let py = Number.NEGATIVE_INFINITY;
    let pointerInside = false;
    let frame = 0;
    let visible = true;
    /** Seconds since the first animated frame. Held outside `draw` so the
        resize and theme redraws below can repaint the field where it is rather
        than snapping it back to t=0. */
    let clock = 0;
    let originMs = 0;

    const readInk = () => {
      ink = getComputedStyle(canvas).color || ink;
    };

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      if (width < 1 || height < 1) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cols = Math.ceil(width / SPACING) + 1;
      const rows = Math.ceil(height / SPACING) + 1;
      // Centre the lattice so the margins match on both sides at any width,
      // which is the difference between a field and a grid that ran out.
      const offsetX = (width - (cols - 1) * SPACING) / 2;
      const offsetY = (height - (rows - 1) * SPACING) / 2;

      cells = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const x = offsetX + c * SPACING;
          const y = offsetY + r * SPACING;
          const cell: Cell = {
            x,
            y,
            dx: 1,
            dy: 0,
            p0: x * WAVE[0].fx + y * WAVE[0].fy,
            p1: x * WAVE[1].fx + y * WAVE[1].fy,
            p2: x * WAVE[2].fx + y * WAVE[2].fy,
          };
          // Seed each cell already lying on the flow. Starting them all flat
          // costs a visible half-second of the whole lattice fanning out from
          // horizontal on first paint and after every resize.
          const a = flowAngle(cell, clock);
          cell.dx = Math.cos(a);
          cell.dy = Math.sin(a);
          cells.push(cell);
        }
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.lineCap = "round";

      // One path per alpha bucket — see the note at the top of the file.
      const paths: Array<Array<number>> = Array.from({ length: BUCKETS }, () => []);
      const half = LEN / 2;

      for (const cell of cells) {
        // The resting state is the flow, not a flat line, so every cell is
        // turning whether or not the pointer is anywhere near it.
        const swell = Math.sin(cell.p2 + clock * WAVE[2].speed);
        const angle =
          WAVE[0].amp * Math.sin(cell.p0 + clock * WAVE[0].speed) +
          WAVE[1].amp * Math.sin(cell.p1 + clock * WAVE[1].speed) +
          WAVE[2].amp * swell;
        let tx = Math.cos(angle);
        let ty = Math.sin(angle);
        let boost = 0;

        if (pointerInside) {
          const ddx = px - cell.x;
          const ddy = py - cell.y;
          const dist = Math.hypot(ddx, ddy);
          if (dist < RADIUS) {
            // Squared falloff: a linear one leaves the whole radius faintly
            // disturbed, which reads as a wobble rather than as a magnet.
            const t = 1 - dist / RADIUS;
            boost = t * t;
            if (dist > 0.001) {
              // Blend off the flow toward the pointer rather than off a fixed
              // baseline, so a cell entering the radius bends out of the
              // current it was already in.
              tx += (ddx / dist - tx) * boost;
              ty += (ddy / dist - ty) * boost;
              const m = Math.hypot(tx, ty) || 1;
              tx /= m;
              ty /= m;
            }
          }
        }

        if (reduced) {
          cell.dx = tx;
          cell.dy = ty;
        } else {
          cell.dx += (tx - cell.dx) * EASE;
          cell.dy += (ty - cell.dy) * EASE;
          const m = Math.hypot(cell.dx, cell.dy) || 1;
          cell.dx /= m;
          cell.dy /= m;
        }

        // Resting brightness rides the slowest wave — the field breathes in
        // broad bands rather than twinkling per cell — and the pointer only
        // ever raises it.
        const level = Math.max(boost, AMBIENT_LIFT * (0.5 + 0.5 * swell));
        const bucket = Math.min(BUCKETS - 1, Math.round(level * (BUCKETS - 1)));
        paths[bucket].push(
          cell.x - cell.dx * half,
          cell.y - cell.dy * half,
          cell.x + cell.dx * half,
          cell.y + cell.dy * half,
        );
      }

      for (let b = 0; b < BUCKETS; b += 1) {
        const coords = paths[b];
        if (coords.length === 0) continue;
        ctx.globalAlpha = BASE_ALPHA + (PEAK_ALPHA - BASE_ALPHA) * (b / (BUCKETS - 1));
        ctx.beginPath();
        for (let i = 0; i < coords.length; i += 4) {
          ctx.moveTo(coords[i], coords[i + 1]);
          ctx.lineTo(coords[i + 2], coords[i + 3]);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (!originMs) originMs = now;
      // Scrolled out of view the clock stops with it, so the field is not
      // somewhere unrelated when it comes back — and nothing is computed for a
      // surface nobody is looking at.
      if (!visible) {
        originMs = now - clock * 1000;
        return;
      }
      clock = (now - originMs) / 1000;
      draw();
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      px = event.clientX - rect.left;
      py = event.clientY - rect.top;
      pointerInside = true;
    };
    const onPointerLeave = () => {
      pointerInside = false;
    };

    readInk();
    build();
    draw();

    const resizeObserver = new ResizeObserver(() => {
      build();
      draw();
    });
    resizeObserver.observe(canvas);

    // The token set is swapped by an attribute on <html>, not by a media query,
    // so a stylesheet change is the only signal that the ink colour moved.
    const themeObserver = new MutationObserver(() => {
      readInk();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    intersection.observe(canvas);

    // Under reduced motion the field is drawn once, frozen mid-flow, and never
    // listens for a pointer — the whole point of the effect is the movement.
    if (!reduced) {
      const host = canvas.parentElement ?? canvas;
      host.addEventListener("pointermove", onPointerMove);
      host.addEventListener("pointerleave", onPointerLeave);
      frame = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(frame);
        host.removeEventListener("pointermove", onPointerMove);
        host.removeEventListener("pointerleave", onPointerLeave);
        resizeObserver.disconnect();
        themeObserver.disconnect();
        intersection.disconnect();
      };
    }

    return () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      intersection.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="rt-field" aria-hidden="true" />;
}
