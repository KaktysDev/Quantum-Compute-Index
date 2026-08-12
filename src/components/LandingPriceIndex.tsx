"use client";

// ──────────────────────────────────────────────────────────────────────────────
// The landing page's index card.
//
// It used to draw its own polyline from v1's VWAP series — a different number,
// on a different scale, from a different engine than the console's. On
// 12 Aug 2026 this card read $2,509.81 while the console read $5,317 for the
// same thing on the same day, and when v1 had nothing to show it fell back to a
// seeded random walk labelled "SAMPLE DATA".
//
// It now takes the published v2 point and renders it through the same QciChart
// the console and the pricing page use, so the three cannot drift again — and
// when there is no published point it says so instead of drawing one.
// ──────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";
import QciChart, { type ChartPoint } from "@/components/QciChart";

export type IndexPoint = ChartPoint;

const RANGES = [
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "ALL", days: 36_500 },
] as const;

export default function LandingPriceIndex({
  price,
  hasData,
  series,
}: {
  /** Published USD per QPU-hour. */
  price: number;
  hasData: boolean;
  series: IndexPoint[];
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("ALL");
  const [hovered, setHovered] = useState<ChartPoint | null>(null);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.label === range)?.days ?? 36_500;
    const end = series.at(-1)?.time ?? 0;
    const cut = series.filter((p) => Number.isFinite(p.value) && p.time >= end - days * 86_400);
    return cut.length > 1 ? cut : series;
  }, [series, range]);

  const shown = hovered?.value ?? series.at(-1)?.value ?? price;
  const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <div className="pl-product-visual white">
      <div className="pl-index-card">
        <header>
          <span>QUANTUM COMPUTE INDEX</span>
          <b>{hasData ? "PUBLISHED" : "AWAITING DATA"}</b>
        </header>
        <strong>
          <sup>$</sup>
          {fmt(shown)}
        </strong>
        <p>per QPU-hour</p>

        {hasData && series.length > 0 ? (
          <>
            <div className="pl-index-ranges" role="tablist" aria-label="Chart range">
              {RANGES.map((r) => (
                <button
                  key={r.label}
                  type="button"
                  role="tab"
                  aria-selected={range === r.label}
                  className={range === r.label ? "active" : ""}
                  onClick={() => {
                    setRange(r.label);
                    setHovered(null);
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="pl-index-line">
              <QciChart
                points={visible}
                height={150}
                format={(v) => `$${fmt(v)}`}
                onHover={setHovered}
                ariaLabel="Quantum Compute Index history"
              />
            </div>
          </>
        ) : (
          <div className="pl-index-line">
            <p className="pl-index-empty">
              No index point has been published yet. Nothing is drawn until one is.
            </p>
          </div>
        )}

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
