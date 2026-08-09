"use client";

// ──────────────────────────────────────────────────────────────────────────────
// QCI v2 history chart.
//
// Replaces the legacy market panel on the QCI tab. The difference that matters
// is not visual: the old panel fell back to `sampleSeries()`, a seeded
// pseudo-random walk, whenever there was no data — and drew it as a smooth,
// entirely convincing price history. This one draws what exists and says so when
// nothing does.
//
// Points recorded on a thin day (coverage below the threshold) are marked, so a
// provisional value is visibly provisional on the chart rather than only in the
// underlying row.
// ──────────────────────────────────────────────────────────────────────────────

import {
  ColorType,
  CrosshairMode,
  createChart,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QciSeries, SeriesPoint } from "@/lib/qci/v2/store";

const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "ALL", days: 36_500 },
] as const;

type MetricKey = keyof QciSeries;

const METRICS: Array<{
  key: MetricKey;
  symbol: string;
  label: string;
  unit: string;
  dp: number;
}> = [
  { key: "usdPerQpuHour", symbol: "QCI", label: "Price of a quantum hour", unit: "USD / QPU-hour", dp: 2 },
  { key: "usdPerQcu", symbol: "QCI-Q", label: "Quality-adjusted", unit: "USD / QCU-hour", dp: 2 },
  { key: "level", symbol: "QCI-L", label: "Index level", unit: "1000 at inception", dp: 2 },
  { key: "costBasis", symbol: "QCI-C", label: "Modelled cost basis", unit: "USD / QPU-hour", dp: 2 },
];

function money(v: number, dp: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function movement(points: SeriesPoint[]) {
  const first = points[0]?.value ?? 0;
  const last = points.at(-1)?.value ?? first;
  const absolute = last - first;
  return { absolute, percent: first > 0 ? (absolute / first) * 100 : 0 };
}

export default function QciSeriesPanel({
  series,
  hasData,
  emptyReason,
}: {
  series: QciSeries;
  hasData: boolean;
  emptyReason?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>("usdPerQpuHour");
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("3M");
  const [hovered, setHovered] = useState<{ value: number; time: number } | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const active = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const all = useMemo(() => series[metric] ?? [], [series, metric]);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.label === range)?.days ?? 365;
    const end = all.at(-1)?.time ?? Date.now() / 1000;
    const cut = all.filter((p) => p.time >= end - days * 86_400);
    return cut.length > 1 ? cut : all;
  }, [all, range]);

  const move = movement(visible);
  const positive = move.absolute >= 0;
  const display = hovered?.value ?? visible.at(-1)?.value ?? 0;
  const provisional = visible.filter((p) => p.status === "provisional").length;

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight || 300,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        // Read from the console's own tokens so the chart follows the light/dark
        // switch instead of hard-coding a dark palette the way v1's panel did.
        textColor: getComputedStyle(el).getPropertyValue("--qr-dim") || "#8c8c8c",
        fontFamily: "var(--qr-mono), monospace",
        fontSize: 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: {
          color: getComputedStyle(el).getPropertyValue("--qr-line") || "rgba(0,0,0,0.08)",
          style: 1,
        },
      },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: false, secondsVisible: false, rightOffset: 0 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { width: 1, style: 2, labelVisible: false },
        horzLine: { visible: false, labelVisible: false },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: false },
    });
    const area = chart.addAreaSeries({
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    chartRef.current = chart;
    seriesRef.current = area;
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) {
        setHovered(null);
        return;
      }
      const point = p.seriesData.get(area) as AreaData | undefined;
      setHovered(point ? { value: point.value, time: typeof p.time === "number" ? p.time : 0 } : null);
    });
    const ro = new ResizeObserver(() =>
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight }),
    );
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || visible.length === 0) return;
    const el = element.current;
    const accent =
      (el && getComputedStyle(el).getPropertyValue("--qci-price").trim()) || "#24406e";
    seriesRef.current.applyOptions({
      lineColor: accent,
      topColor: `color-mix(in srgb, ${accent} 18%, transparent)`,
      bottomColor: "transparent",
      crosshairMarkerBackgroundColor: accent,
    });
    seriesRef.current.setData(
      visible.map((p) => ({ time: p.time as Time, value: p.value })) as AreaData[],
    );
    chartRef.current?.timeScale().fitContent();
  }, [visible]);

  if (!hasData || all.length === 0) {
    return (
      <section className="console-panel qci-series-panel">
        <div className="panel-title">
          <Activity size={16} />
          <div>
            <h2>Index history</h2>
            <small>Recorded daily points — no synthetic history is ever drawn</small>
          </div>
        </div>
        <div className="qci-empty">
          <h3>{hasData ? "Not enough points to chart yet" : "No history recorded yet"}</h3>
          <p>
            {emptyReason ??
              "The index needs at least one recorded point before it can be charted."}
          </p>
          <p>
            The previous version drew a seeded random walk here whenever the database was empty.
            This one draws nothing, because nothing has been measured.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="console-panel qci-series-panel">
      <div className="panel-title">
        <Activity size={16} />
        <div>
          <h2>Index history</h2>
          <small>Recorded daily points — no synthetic history is ever drawn</small>
        </div>
        <span className="market-source">
          <i /> {all.length} recorded point{all.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="qci-series-body">
        <header className="market-quote">
          <div>
            <span>
              {active.symbol} <small>{active.label}</small>
            </span>
            <strong>
              {active.key === "level" ? null : <sup>$</sup>}
              {money(display, active.dp)}
            </strong>
            <p className={positive ? "positive" : "negative"}>
              {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {move.absolute >= 0 ? "+" : ""}
              {money(move.absolute, active.dp)} ({move.percent >= 0 ? "+" : ""}
              {move.percent.toFixed(2)}%)
              <small>
                {hovered ? new Date(hovered.time * 1000).toLocaleDateString() : range}
              </small>
            </p>
          </div>
          <dl>
            <div>
              <dt>Unit</dt>
              <dd>{active.unit}</dd>
            </div>
            <div>
              <dt>Points</dt>
              <dd>{visible.length}</dd>
            </div>
            <div>
              <dt>Provisional</dt>
              <dd className={provisional > 0 ? "warn" : undefined}>{provisional}</dd>
            </div>
          </dl>
        </header>

        <div className="qci-series-chart" ref={element} aria-label={`${active.label} history`} />

        <div className="market-ranges">
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={metric === m.key ? "active" : ""}
              onClick={() => {
                setMetric(m.key);
                setHovered(null);
              }}
              style={{ width: "auto", padding: "0 0.6rem" }}
            >
              {m.symbol}
            </button>
          ))}
          <span style={{ marginLeft: "auto", display: "flex", gap: "0.25rem" }}>
            {RANGES.map((r) => (
              <button
                key={r.label}
                className={range === r.label ? "active" : ""}
                onClick={() => setRange(r.label)}
              >
                {r.label}
              </button>
            ))}
          </span>
        </div>
      </div>
    </section>
  );
}
