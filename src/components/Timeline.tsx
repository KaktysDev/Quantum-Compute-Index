"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef, useState } from "react";

export type TimelineMediaSpec =
  | { kind: "image"; src: string; alt: string }
  | { kind: "cloud" }
  | { kind: "qci" };

export interface TimelinePoint {
  era: string;
  title: string;
  body: string;
  media: TimelineMediaSpec;
}

/* ── media renderers ─────────────────────────────────────────────────────── */

function ImagePlaceholder({ src }: { src: string }) {
  const file = src.split("/").pop();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-[var(--muted)]">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="10" r="2" />
        <path d="M4 19l5-5 4 4 3-3 4 4" />
      </svg>
      <span className="mono-label normal-case tracking-normal">add {file}</span>
    </div>
  );
}

function MediaImage({ src, alt }: { src: string; alt: string }) {
  const [err, setErr] = useState(false);
  if (err) return <ImagePlaceholder src={src} />;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setErr(true)}
      className="h-full w-full object-cover grayscale [filter:grayscale(1)_contrast(1.05)_brightness(0.95)]"
    />
  );
}

function CloudShape() {
  return (
    <svg
      viewBox="0 0 140 100"
      className="h-24 w-32 text-white/85"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* cloud */}
      <path d="M40 52 a16 16 0 0 1 3 -31 a22 22 0 0 1 41 5 a14 14 0 0 1 -2 27 z" />
      {/* compute nodes wired to the cloud */}
      <line x1="50" y1="52" x2="42" y2="74" />
      <line x1="70" y1="53" x2="70" y2="74" />
      <line x1="90" y1="52" x2="98" y2="74" />
      <rect x="35" y="74" width="14" height="11" rx="2" />
      <rect x="63" y="74" width="14" height="11" rx="2" />
      <rect x="91" y="74" width="14" height="11" rx="2" />
    </svg>
  );
}

function QciShape() {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="serif text-5xl leading-none text-white sm:text-6xl">QCI</span>
      <svg
        viewBox="0 0 140 48"
        className="h-12 w-36 text-white/85"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="4,40 28,30 48,34 72,18 96,24 120,8" />
        <path d="M120 8 l-9 1 M120 8 l1 9" />
      </svg>
    </div>
  );
}

function TimelineMedia({ media }: { media: TimelineMediaSpec }) {
  return (
    <div className="glass relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl">
      {media.kind === "image" ? (
        <MediaImage src={media.src} alt={media.alt} />
      ) : media.kind === "cloud" ? (
        <CloudShape />
      ) : (
        <QciShape />
      )}
    </div>
  );
}

/* ── timeline ────────────────────────────────────────────────────────────── */

function Card({ point }: { point: TimelinePoint }) {
  return (
    <div className="glass glass-hover sheen rounded-2xl p-6">
      <p className="mono-label">{point.era}</p>
      <h3 className="mt-2 text-2xl font-medium text-white sm:text-3xl">{point.title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{point.body}</p>
    </div>
  );
}

function TimelineItem({ point, index }: { point: TimelinePoint; index: number }) {
  const left = index % 2 === 0;
  const card = <Card point={point} />;
  const media = <TimelineMedia media={point.media} />;

  return (
    <motion.div
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-120px" }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="relative grid items-center gap-6 pl-12 sm:grid-cols-2 sm:gap-14 sm:pl-0"
    >
      {/* node on the track */}
      <span className="absolute left-4 top-6 z-10 -translate-x-1/2 sm:left-1/2">
        <span className="block h-3 w-3 rounded-full border-2 border-emerald-400/80 bg-[var(--bg)]" />
      </span>

      {left ? (
        <>
          {card}
          {media}
        </>
      ) : (
        <>
          {media}
          {card}
        </>
      )}
    </motion.div>
  );
}

export default function Timeline({ points }: { points: TimelinePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start center", "end center"],
  });
  const lineHeight = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <div ref={ref} className="relative mx-auto max-w-5xl py-10">
      {/* track */}
      <div className="absolute left-4 top-0 h-full w-px bg-white/10 sm:left-1/2" />
      {/* filled portion driven by scroll */}
      <motion.div
        style={{ height: lineHeight }}
        className="absolute left-4 top-0 w-px bg-emerald-400/70 sm:left-1/2"
      />

      <div className="flex flex-col gap-16 sm:gap-28">
        {points.map((p, i) => (
          <TimelineItem key={p.title} point={p} index={i} />
        ))}
      </div>
    </div>
  );
}
