"use client";

import {
  ColorType,
  CrosshairMode,
  createChart,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { Activity, CircleDollarSign, Database, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SamplePoint } from "@/lib/qci/sample";
import type { QciSnapshot } from "@/lib/qci/types";

const RANGES = [
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
] as const;

function money(value: number) {
  if (value >= 1_000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function change(points: SamplePoint[]) {
  const first = points[0]?.value ?? 0;
  const last = points.at(-1)?.value ?? first;
  const absolute = last - first;
  return { absolute, percent: first > 0 ? absolute / first * 100 : 0 };
}

function MiniSparkline({ points, positive }: { points: SamplePoint[]; positive: boolean }) {
  const values = points.slice(-30).map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.000001);
  const line = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : index / (values.length - 1) * 72;
    const y = 22 - (value - min) / span * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return <svg className={positive ? "positive" : "negative"} viewBox="0 0 72 24" aria-hidden="true"><polyline points={line} /></svg>;
}

export default function QciMarketPanel({
  latest,
  indexSeries,
  providerSeries,
}: {
  latest: QciSnapshot;
  indexSeries: SamplePoint[];
  providerSeries: Record<string, SamplePoint[]>;
}) {
  const [selected, setSelected] = useState("qci");
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("3M");
  const [hovered, setHovered] = useState<{ value: number; time: number } | null>(null);
  const chartElement = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const instruments = useMemo(() => [
    { id: "qci", symbol: "QCI", label: "Composite basket", qpu: `${latest.components.length} constituents`, value: latest.vwap, share: 1, status: latest.source },
    ...latest.components.map((component) => ({
      id: component.provider,
      symbol: component.provider.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
      label: component.provider,
      qpu: component.qpu,
      value: component.pricePerNqh,
      share: component.share,
      status: component.status ?? latest.source,
    })),
  ], [latest]);
  const instrument = instruments.find((item) => item.id === selected) ?? instruments[0];
  const allPoints = useMemo(
    () => selected === "qci" ? indexSeries : providerSeries[selected] ?? [],
    [indexSeries, providerSeries, selected],
  );
  const visible = useMemo(() => {
    const days = RANGES.find((item) => item.label === range)?.days ?? 365;
    const end = allPoints.at(-1)?.time ?? Date.now() / 1000;
    const points = allPoints.filter((point) => point.time >= end - days * 86_400);
    return points.length > 1 ? points : allPoints;
  }, [allPoints, range]);
  const movement = change(visible);
  const positive = movement.absolute >= 0;
  const displayValue = hovered?.value ?? visible.at(-1)?.value ?? instrument.value;

  useEffect(() => {
    const element = chartElement.current;
    if (!element) return;
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight || 310,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#59645d",
        fontFamily: "var(--qr-mono), monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: "#111914", style: 1 },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false, rightOffset: 0 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#2f5f48", width: 1, style: 2, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
    });
    const series = chart.addAreaSeries({
      lineColor: "#2fbd7c",
      topColor: "rgba(47,189,124,.18)",
      bottomColor: "rgba(47,189,124,0)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerBorderColor: "#030504",
      crosshairMarkerBackgroundColor: "#48c98e",
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    chart.subscribeCrosshairMove((parameter) => {
      if (!parameter.time) {
        setHovered(null);
        return;
      }
      const point = parameter.seriesData.get(series) as AreaData | undefined;
      const time = typeof parameter.time === "number" ? parameter.time : 0;
      setHovered(point ? { value: point.value, time } : null);
    });
    const observer = new ResizeObserver(() => chart.applyOptions({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || visible.length === 0) return;
    const color = positive ? "#2fbd7c" : "#dc6677";
    seriesRef.current.applyOptions({
      lineColor: color,
      topColor: positive ? "rgba(47,189,124,.18)" : "rgba(220,102,119,.16)",
      bottomColor: positive ? "rgba(47,189,124,0)" : "rgba(220,102,119,0)",
      crosshairMarkerBackgroundColor: color,
    });
    seriesRef.current.setData(visible.map((point) => ({ time: point.time as Time, value: point.value })) as AreaData[]);
    chartRef.current?.timeScale().fitContent();
  }, [positive, visible]);

  return (
    <section className="console-panel qci-market-panel">
      <div className="panel-title">
        <Activity size={16} />
        <div><h2>Quantum compute market</h2><small>Normalized provider cost per compute hour</small></div>
        <span className="market-source"><i /> {latest.source === "live" ? "Live rates" : "Sample benchmark"}</span>
      </div>
      <div className="market-layout">
        <div className="market-chart-column">
          <header className="market-quote">
            <div>
              <span>{instrument.symbol} <small>{instrument.label}</small></span>
              <strong><sup>$</sup>{money(displayValue)}</strong>
              <p className={positive ? "positive" : "negative"}>
                {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                {movement.absolute >= 0 ? "+" : ""}${money(movement.absolute)} ({movement.percent >= 0 ? "+" : ""}{movement.percent.toFixed(2)}%)
                <small>{hovered ? new Date(hovered.time * 1000).toLocaleDateString() : range}</small>
              </p>
            </div>
            <dl>
              <div><dt>Unit</dt><dd>USD / NQH</dd></div>
              <div><dt>Basket weight</dt><dd>{(instrument.share * 100).toFixed(1)}%</dd></div>
              <div><dt>Rate state</dt><dd>{instrument.status}</dd></div>
            </dl>
          </header>
          <div className="market-chart" ref={chartElement} aria-label={`${instrument.label} normalized quantum compute cost chart`} />
          <div className="market-ranges" aria-label="Chart range">
            {RANGES.map((item) => <button key={item.label} className={range === item.label ? "active" : ""} onClick={() => setRange(item.label)}>{item.label}</button>)}
            <span>As of {new Date(latest.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          </div>
        </div>
        <aside className="market-watchlist">
          <div className="market-watch-head"><span>Instrument</span><span>Rate</span><span>Trend</span></div>
          {instruments.map((item) => {
            const points = item.id === "qci" ? indexSeries : providerSeries[item.id] ?? [];
            const itemChange = change(points.slice(-30));
            return (
              <button key={item.id} className={selected === item.id ? "active" : ""} onClick={() => { setSelected(item.id); setHovered(null); }}>
                <span><b>{item.symbol}</b><small>{item.id === "qci" ? "Holistic index" : item.qpu}</small></span>
                <span><b>${money(points.at(-1)?.value ?? item.value)}</b><small>{itemChange.percent >= 0 ? "+" : ""}{itemChange.percent.toFixed(2)}%</small></span>
                <MiniSparkline points={points.length ? points : [{ time: 0, value: item.value }]} positive={itemChange.absolute >= 0} />
              </button>
            );
          })}
          <footer><Database size={13} /><span>Rates normalized by QCI pricing methodology</span><CircleDollarSign size={13} /></footer>
        </aside>
      </div>
    </section>
  );
}
