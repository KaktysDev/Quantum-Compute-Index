"use client";

import { useEffect, useRef } from "react";

// Spotlight sizes as a fraction of the viewport (per axis).
const GLOW_FACTOR = 0.5; // big soft glow behind the glass
const SPOT_FACTOR = 0.45; // crisp spotlight on top (screen-blend)

/**
 * Cursor light. Two layers, both following the cursor with smooth (non-bouncy)
 * easing:
 *   - .curtain-glow : large soft glow BEHIND the fluted glass (ambiance)
 *   - .cursor-spot  : a white screen-blend spotlight ON TOP of the page so the
 *                     effect is always clearly visible, never hidden by content.
 * No-ops on touch devices / reduced-motion.
 */
export default function CursorGlow() {
  const glow = useRef<HTMLDivElement>(null);
  const spot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let gw = window.innerWidth * GLOW_FACTOR;
    let gh = window.innerHeight * GLOW_FACTOR;
    let sw = window.innerWidth * SPOT_FACTOR;
    let sh = window.innerHeight * SPOT_FACTOR;

    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let x = tx;
    let y = ty;
    let raf = 0;

    const applySize = () => {
      gw = window.innerWidth * GLOW_FACTOR;
      gh = window.innerHeight * GLOW_FACTOR;
      sw = window.innerWidth * SPOT_FACTOR;
      sh = window.innerHeight * SPOT_FACTOR;
      if (glow.current) {
        glow.current.style.width = `${gw}px`;
        glow.current.style.height = `${gh}px`;
      }
      if (spot.current) {
        spot.current.style.width = `${sw}px`;
        spot.current.style.height = `${sh}px`;
      }
    };

    const onMove = (e: MouseEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };

    const tick = () => {
      const e = reduce ? 1 : 0.45; // tight, snappy follow (barely trails the cursor)
      x += (tx - x) * e;
      y += (ty - y) * e;
      if (glow.current) {
        glow.current.style.transform = `translate3d(${x - gw / 2}px, ${y - gh / 2}px, 0)`;
      }
      if (spot.current) {
        spot.current.style.transform = `translate3d(${x - sw / 2}px, ${y - sh / 2}px, 0)`;
      }
      raf = requestAnimationFrame(tick);
    };

    applySize();
    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("resize", applySize);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", applySize);
    };
  }, []);

  return (
    <>
      <div ref={glow} className="curtain-glow" aria-hidden="true" />
      <div ref={spot} className="cursor-spot" aria-hidden="true" />
    </>
  );
}
