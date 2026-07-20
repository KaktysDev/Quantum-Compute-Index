"use client";

import { useEffect, useRef } from "react";

type Dot = { x: number; y: number; tx: number; ty: number; phase: number; size: number; dust: boolean };

export default function HeroParticleText({ children }: { children: string }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const text = textRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!host || !text || !canvas || !context) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    let dots: Dot[] = [];
    let frame = 0;
    let hovered = false;
    let visible = true;

    const random = (seed: number) => {
      const value = Math.sin(seed * 91.173) * 43758.5453;
      return value - Math.floor(value);
    };

    const build = () => {
      const bounds = text.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const padX = 18;
      const padY = 10;
      const width = Math.ceil(bounds.width + padX * 2);
      const height = Math.ceil(bounds.height + padY * 2);
      canvas.width = Math.ceil(width * ratio);
      canvas.height = Math.ceil(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.left = `${-padX}px`;
      canvas.style.top = `${-padY}px`;

      const sample = document.createElement("canvas");
      sample.width = canvas.width;
      sample.height = canvas.height;
      const sampleContext = sample.getContext("2d", { willReadFrequently: true });
      if (!sampleContext) return;
      const style = getComputedStyle(text);
      sampleContext.scale(ratio, ratio);
      sampleContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      sampleContext.textBaseline = "top";
      sampleContext.fillStyle = "#009c63";
      sampleContext.fillText(children, padX, padY - 1);

      const image = sampleContext.getImageData(0, 0, sample.width, sample.height);
      const points: Array<[number, number]> = [];
      const stride = Math.max(5, Math.round(5 * ratio));
      for (let y = 0; y < sample.height; y += stride) {
        for (let x = 0; x < sample.width; x += stride) {
          if (image.data[(y * sample.width + x) * 4 + 3] > 90) points.push([x / ratio, y / ratio]);
        }
      }
      const count = Math.min(640, points.length);
      dots = Array.from({ length: count }, (_, index) => {
        const [x, y] = points[Math.floor((index / Math.max(1, count)) * points.length)];
        return { x, y, tx: x, ty: y, phase: random(index + 9) * Math.PI * 2, size: .45 + random(index + 27), dust: random(index + 63) > .86 };
      });
    };

    const draw = (time = 0) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(ratio, ratio);
      context.fillStyle = "#009c63";
      dots.forEach((dot) => {
        const energy = reduced ? 0 : hovered ? 8 : dot.dust ? 2.6 : .65;
        dot.x += (dot.tx + Math.cos(dot.phase + time * .00045) * energy - dot.x) * .08;
        dot.y += (dot.ty + Math.sin(dot.phase * 1.7 + time * .00055) * energy - dot.y) * .08;
        context.globalAlpha = dot.dust ? .25 : hovered ? .64 : .38;
        context.beginPath();
        context.arc(dot.x, dot.y, dot.size, 0, Math.PI * 2);
        context.fill();
      });
      context.restore();
      if (visible && !reduced) frame = requestAnimationFrame(draw);
    };

    const start = () => { if (!frame && !reduced) frame = requestAnimationFrame(draw); };
    const stop = () => { cancelAnimationFrame(frame); frame = 0; };
    const enter = () => { hovered = true; };
    const leave = () => { hovered = false; };
    const resize = new ResizeObserver(() => { build(); if (reduced) draw(); });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start(); else stop();
    });

    host.addEventListener("mouseenter", enter);
    host.addEventListener("mouseleave", leave);
    resize.observe(text);
    intersection.observe(host);
    void document.fonts.ready.then(() => { build(); if (reduced) draw(); else start(); });

    return () => {
      stop();
      resize.disconnect();
      intersection.disconnect();
      host.removeEventListener("mouseenter", enter);
      host.removeEventListener("mouseleave", leave);
    };
  }, [children]);

  return <span ref={hostRef} className="ql-particle-word"><span ref={textRef}>{children}</span><canvas ref={canvasRef} aria-hidden="true" /></span>;
}
