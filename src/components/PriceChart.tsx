"use client";

import {
  createChart,
  ColorType,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

export interface ChartPoint {
  time: number; // UNIX seconds (UTCTimestamp)
  value: number;
}

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

  // keep in sync if the server passes new initial data
  useEffect(() => {
    setPoints(data);
  }, [data]);

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

  // push data whenever points change (no flicker, no chart re-create)
  useEffect(() => {
    if (!seriesRef.current || points.length === 0) return;
    seriesRef.current.setData(
      points.map((d) => ({ time: d.time as Time, value: d.value })) as AreaData[],
    );
    chartRef.current?.timeScale().fitContent();
  }, [points]);

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

  return <div ref={ref} className="h-full w-full" />;
}
