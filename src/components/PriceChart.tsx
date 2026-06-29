"use client";

import { createChart, ColorType, type AreaData, type Time } from "lightweight-charts";
import { useEffect, useRef } from "react";

export interface ChartPoint {
  time: string; // 'YYYY-MM-DD'
  value: number;
}

export default function PriceChart({ data }: { data: ChartPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || data.length === 0) return;

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

    const series = chart.addAreaSeries({
      lineColor: "#f3f4f6",
      topColor: "rgba(255,255,255,0.22)",
      bottomColor: "rgba(255,255,255,0.0)",
      lineWidth: 2,
      priceLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });

    series.setData(data.map((d) => ({ time: d.time as Time, value: d.value })) as AreaData[]);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return <div ref={ref} className="h-full w-full" />;
}
