"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";

export interface IndexPoint {
  time: number; // UNIX seconds
  value: number; // $/QC-hour (VWAP)
}

const RANGES = [
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
] as const;

/**
 * The landing "03 / Price" index card — now driven by the REAL VWAP history
 * (server passes getSeries()) with 7D/1M/3M/6M/1Y range toggles, replacing the
 * old hardcoded decorative polyline. Renders a clean light SVG line to match the
 * .pl-index-card design.
 */
export default function LandingPriceIndex({
  vwap,
  source,
  series,
}: {
  vwap: number;
  source: "live" | "sample";
  series: IndexPoint[];
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("3M");

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.label === range)?.days ?? 90;
    const cutoff = Date.now() / 1000 - days * 86_400;
    const inRange = series.filter((p) => Number.isFinite(p.value) && p.time >= cutoff);
    // If a short window has <2 points, fall back to the last couple so the line
    // still renders instead of collapsing.
    return inRange.length >= 2 ? inRange : series.slice(-2);
  }, [series, range]);

  const { line, area } = useMemo(() => {
    if (visible.length < 2) return { line: "", area: "" };
    const xs = visible.map((p) => p.time);
    const ys = visible.map((p) => p.value);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const W = 500;
    const H = 180;
    const pad = 10; // keep the peak/trough off the edges
    const pts = visible.map((p) => {
      const x = ((p.time - minX) / spanX) * W;
      const y = H - pad - ((p.value - minY) / spanY) * (H - 2 * pad);
      return [x, y] as const;
    });
    const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `0,${H} ${line} ${W},${H}`;
    return { line, area };
  }, [visible]);

  return (
    <div className="pl-product-visual white">
      <div className="pl-index-card">
        <header>
          <span>QUANTUM COMPUTE INDEX</span>
          <b>{source === "sample" ? "SAMPLE DATA" : "PROVIDER SNAPSHOT"}</b>
        </header>
        <strong>
          <sup>$</sup>
          {vwap.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </strong>
        <p>per QC-hour</p>

        <div className="pl-index-ranges" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              role="tab"
              aria-selected={range === r.label}
              className={range === r.label ? "active" : ""}
              onClick={() => setRange(r.label)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="pl-index-line">
          {line ? (
            <svg viewBox="0 0 500 180" preserveAspectRatio="none">
              <polygon className="pl-index-area" points={area} />
              <polyline points={line} />
            </svg>
          ) : (
            <p className="pl-index-empty">Not enough data in this range yet.</p>
          )}
        </div>

        <footer>
          <Link href="/pricing#methodology">
            Methodology <ArrowRight />
          </Link>
          <span>Indicative · not audited</span>
        </footer>
      </div>
    </div>
  );
}
