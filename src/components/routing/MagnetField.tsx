"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The magnetic field behind the routing diagram.
//
// A fine grid of short segments lying flat at rest. Bring the pointer near and
// they swing to point at it and brighten, falling off with distance — iron
// filings over a magnet. It is pure atmosphere: it encodes nothing, it is
// aria-hidden, and the page reads identically with it switched off.
//
// WHY CANVAS AND NOT SVG
// ~1,200 segments, all re-oriented every frame. As DOM nodes that is 1,200
// style recalculations per frame and a dropped frame budget on any laptop; as
// canvas strokes it is a few hundred microseconds.
//
// WHY ALPHA IS BUCKETED
// Brightness rises with proximity, so in principle every segment wants its own
// alpha — and `globalAlpha` is canvas state, so that would be ~1,200 state
// changes and ~1,200 stroke() calls per frame. Quantising to BUCKETS levels
// turns that into BUCKETS paths and BUCKETS strokes. At eight levels the
// banding is invisible against a 6% opacity ramp.
// ──────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

/** Grid pitch, in CSS pixels. */
const SPACING = 26;
/** Length of one segment. Deliberately well under SPACING so the field reads as
    separate marks rather than as a hatched fill. */
const LEN = 8;
/** How far the pointer reaches. */
const RADIUS = 210;
/** Per-frame easing toward the target orientation — the swing, not a snap. */
const EASE = 0.16;
const BASE_ALPHA = 0.16;
const PEAK_ALPHA = 0.62;
const BUCKETS = 8;

interface Cell {
  x: number;
  y: number;
  /** Current unit direction, eased toward the target every frame. */
  dx: number;
  dy: number;
}

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
    // Off-canvas until the pointer actually arrives, so the field starts flat
    // rather than pulled toward a corner.
    let px = Number.NEGATIVE_INFINITY;
    let py = Number.NEGATIVE_INFINITY;
    let pointerInside = false;
    let frame = 0;
    let visible = true;

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
          cells.push({ x: offsetX + c * SPACING, y: offsetY + r * SPACING, dx: 1, dy: 0 });
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
        let tx = 1;
        let ty = 0;
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
              tx = 1 + (ddx / dist - 1) * boost;
              ty = (ddy / dist) * boost;
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

        const bucket = Math.min(BUCKETS - 1, Math.round(boost * (BUCKETS - 1)));
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

    const render = () => {
      frame = requestAnimationFrame(render);
      if (visible) draw();
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

    // Under reduced motion the field is drawn once, flat, and never listens for
    // a pointer — the whole point of the effect is the movement.
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
