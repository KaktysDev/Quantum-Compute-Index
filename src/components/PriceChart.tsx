"use client";

import {
  createChart,
  ColorType,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";

export interface ChartPoint {
  time: number; // UNIX seconds (UTCTimestamp)
  value: number;
}

const RANGES: Array<{ label: string; sec: number }> = [
  { label: "1D", sec: 86_400 },
  { label: "7D", sec: 7 * 86_400 },
  { label: "30D", sec: 30 * 86_400 },
  { label: "90D", sec: 90 * 86_400 },
  { label: "1Y", sec: 365 * 86_400 },
  { label: "ALL", sec: Infinity },
];

export default function PriceChart({
  data,
  pollMs,
}: {
  data: ChartPoint[];
  /** If set, re-fetch /api/qci every pollMs and update the chart live. */
  pollMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const [points, setPoints] = useState<ChartPoint[]>(data);
  const [range, setRange] = useState<string>("ALL");

  // keep in sync if the server passes new initial data
  useEffect(() => {
    setPoints(data);
  }, [data]);

  const visible = useMemo(() => {
    const r = RANGES.find((x) => x.label === range);
    if (!r || r.sec === Infinity) return points;
    const cutoff = Date.now() / 1000 - r.sec;
    const filtered = points.filter((p) => p.time >= cutoff);
    return filtered.length > 0 ? filtered : points.slice(-1);
  }, [points, range]);

  // create the chart once
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b90a0",
        fontFamily: "var(--font-mono), monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.035)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: {
        borderColor: "rgba(255,255,255,0.08)",
        timeVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: 0,
        vertLine: { color: "rgba(255,255,255,0.35)", labelBackgroundColor: "#0a0a0b" },
        horzLine: { color: "rgba(255,255,255,0.35)", labelBackgroundColor: "#0a0a0b" },
      },
      width: el.clientWidth,
      height: el.clientHeight || 320,
    });
    chartRef.current = chart;
    seriesRef.current = chart.addAreaSeries({
      lineColor: "#f3f4f6",
      topColor: "rgba(255,255,255,0.22)",
      bottomColor: "rgba(255,255,255,0.0)",
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // push the visible slice whenever it changes (no flicker, no chart re-create)
  useEffect(() => {
    if (!seriesRef.current || visible.length === 0) return;
    seriesRef.current.setData(
      visible.map((d) => ({ time: d.time as Time, value: d.value })) as AreaData[],
    );
    chartRef.current?.timeScale().fitContent();
  }, [visible]);

  // optional live polling
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/qci", { cache: "no-store" });
        const j = await res.json();
        if (Array.isArray(j.series)) setPoints(j.series as ChartPoint[]);
      } catch {
        /* ignore transient errors */
      }
    }, pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 flex shrink-0 items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r.label}
            onClick={() => setRange(r.label)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium tracking-wide transition-colors ${
              range === r.label
                ? "bg-white/10 text-white"
                : "text-[var(--muted)] hover:text-white"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div ref={ref} className="min-h-0 w-full flex-1" />
    </div>
  );
}
