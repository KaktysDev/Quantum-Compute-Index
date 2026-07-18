"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Particle typography — the landing hero headline.
//
// Renders the label ("QROUTER") into an offscreen canvas, samples the filled
// pixels into target points, and animates a swarm of particles that assemble
// the word out of a scattered "superposition" cloud. Quantum hints:
//   · entanglement links — faint lines joining nearby particles
//   · decoherence cycles — every ~9s the word briefly scatters and re-forms
//   · measurement — clicking collapses/scatters the wavefunction at the cursor
//   · jitter — each particle carries a phase and oscillates around its target
//
// Perf/a11y: DPR capped at 2, spatial-hash link pass over a strided subset,
// rAF paused when offscreen or the tab is hidden, and prefers-reduced-motion
// renders the settled word once with no animation loop.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  phase: number;
  speed: number;
  size: number;
  accent: boolean;
}

const EMERALD = [66, 229, 158] as const;
const VIOLET = [139, 123, 255] as const;

function rgba(c: readonly [number, number, number], a: number) {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

export default function QuantumParticles({
  label = "QROUTER",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let particles: Particle[] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let running = false;
    let visible = true;
    let lastScatter = performance.now();
    const mouse = { x: -9999, y: -9999, active: false };

    /** Rasterize the label and sample filled pixels into particle targets. */
    function buildTargets(): Array<{ x: number; y: number }> {
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.floor(width));
      off.height = Math.max(1, Math.floor(height));
      const octx = off.getContext("2d");
      if (!octx) return [];

      const family =
        getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
      // Fit the word: binary-ish shrink from a guess based on width/labels.
      let size = Math.min(height * 0.92, (width / label.length) * 1.62);
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      for (let i = 0; i < 24; i += 1) {
        octx.font = `800 ${Math.round(size)}px ${family}`;
        if (octx.measureText(label).width <= width * 0.96) break;
        size *= 0.94;
      }
      octx.fillStyle = "#fff";
      octx.fillText(label, width / 2, height * 0.54);

      const gap = Math.max(3, Math.round(width / 260)); // sample stride (CSS px)
      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const points: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < off.height; y += gap) {
        for (let x = 0; x < off.width; x += gap) {
          if (data[(y * off.width + x) * 4 + 3] > 128) {
            points.push({ x, y });
          }
        }
      }
      return points;
    }

    function seed(settled: boolean) {
      const targets = buildTargets();
      particles = targets.map((t) => ({
        x: settled ? t.x : Math.random() * width,
        y: settled ? t.y : Math.random() * height,
        vx: 0,
        vy: 0,
        tx: t.x,
        ty: t.y,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 0.9,
        size: 0.9 + Math.random() * 1.3,
        accent: Math.random() < 0.16,
      }));
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // If we can't animate yet (reduced motion, hidden/prerendered tab), start
      // settled so the word is visible immediately instead of a blank canvas.
      seed(reduced || document.hidden);
      drawStatic();
    }

    /** Paint one static frame at the settled positions. */
    function drawStatic() {
      ctx!.clearRect(0, 0, width, height);
      for (const p of particles) {
        ctx!.fillStyle = p.accent ? rgba(VIOLET, 0.9) : rgba(EMERALD, 0.9);
        ctx!.fillRect(p.tx, p.ty, p.size, p.size);
      }
    }

    function scatter(cx?: number, cy?: number, force = 7) {
      for (const p of particles) {
        if (cx !== undefined && cy !== undefined) {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.hypot(dx, dy) || 1;
          const reach = Math.max(0, 1 - d / (width * 0.35));
          p.vx += (dx / d) * force * 2.2 * reach + (Math.random() - 0.5) * 2;
          p.vy += (dy / d) * force * 2.2 * reach + (Math.random() - 0.5) * 2;
        } else {
          p.vx += (Math.random() - 0.5) * force;
          p.vy += (Math.random() - 0.5) * force;
        }
      }
    }

    function step(now: number) {
      // Periodic decoherence: burst apart, then the springs re-form the word.
      if (now - lastScatter > 9000) {
        lastScatter = now;
        scatter(undefined, undefined, 5.2);
      }

      const t = now * 0.001;
      ctx!.clearRect(0, 0, width, height);

      // Physics
      for (const p of particles) {
        const jx = Math.sin(t * p.speed * 2.1 + p.phase) * 0.28;
        const jy = Math.cos(t * p.speed * 1.7 + p.phase) * 0.28;
        p.vx += (p.tx + jx - p.x) * 0.022;
        p.vy += (p.ty + jy - p.y) * 0.022;

        if (mouse.active) {
          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          const r = 92;
          if (d2 < r * r && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const f = ((r - d) / r) * 1.35;
            p.vx += (dx / d) * f;
            p.vy += (dy / d) * f;
          }
        }

        p.vx *= 0.86;
        p.vy *= 0.86;
        p.x += p.vx;
        p.y += p.vy;
      }

      // Entanglement links over a strided subset with a coarse spatial hash.
      const stride = Math.max(4, Math.floor(particles.length / 420));
      const cell = 26;
      const grid = new Map<number, number[]>();
      for (let i = 0; i < particles.length; i += stride) {
        const p = particles[i];
        const key = Math.floor(p.x / cell) * 4096 + Math.floor(p.y / cell);
        const bucket = grid.get(key);
        if (bucket) bucket.push(i);
        else grid.set(key, [i]);
      }
      ctx!.lineWidth = 0.6;
      let links = 0;
      for (let i = 0; i < particles.length && links < 130; i += stride) {
        const p = particles[i];
        const gx = Math.floor(p.x / cell);
        const gy = Math.floor(p.y / cell);
        for (let ox = 0; ox <= 1 && links < 130; ox += 1) {
          for (let oy = -1; oy <= 1 && links < 130; oy += 1) {
            if (ox === 0 && oy < 0) continue;
            const bucket = grid.get((gx + ox) * 4096 + (gy + oy));
            if (!bucket) continue;
            for (const j of bucket) {
              if (j <= i) continue;
              const q = particles[j];
              const dx = p.x - q.x;
              const dy = p.y - q.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < cell * cell) {
                const a = (1 - Math.sqrt(d2) / cell) * 0.35;
                ctx!.strokeStyle =
                  p.accent || q.accent ? rgba(VIOLET, a) : rgba(EMERALD, a);
                ctx!.beginPath();
                ctx!.moveTo(p.x, p.y);
                ctx!.lineTo(q.x, q.y);
                ctx!.stroke();
                links += 1;
                if (links >= 130) break;
              }
            }
          }
        }
      }

      // Points
      for (const p of particles) {
        const twinkle = 0.62 + 0.38 * Math.sin(t * 2.4 * p.speed + p.phase);
        ctx!.fillStyle = p.accent
          ? rgba(VIOLET, 0.55 + twinkle * 0.45)
          : rgba(EMERALD, 0.5 + twinkle * 0.5);
        ctx!.fillRect(p.x, p.y, p.size, p.size);
      }

      raf = requestAnimationFrame(step);
    }

    function start() {
      // No document.hidden guard: rAF self-throttles in hidden tabs, and some
      // embedded/prerendered contexts report hidden while still visible.
      if (running || reduced || !visible) return;
      running = true;
      lastScatter = performance.now();
      raf = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    function onPointerMove(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    }
    function onPointerLeave() {
      mouse.active = false;
      mouse.x = -9999;
      mouse.y = -9999;
    }
    function onClick(e: MouseEvent) {
      if (reduced) return;
      const rect = canvas!.getBoundingClientRect();
      scatter(e.clientX - rect.left, e.clientY - rect.top, 8.5);
    }
    function onVisibility() {
      if (!document.hidden) start();
    }

    const ro = new ResizeObserver(() => {
      stop();
      resize();
      start();
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("click", onClick);
    document.addEventListener("visibilitychange", onVisibility);

    resize();
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [label]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={label}
    />
  );
}
