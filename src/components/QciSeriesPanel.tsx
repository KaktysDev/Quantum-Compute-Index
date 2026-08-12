"use client";

// ──────────────────────────────────────────────────────────────────────────────
// QCI v2 history.
//
// Two things this panel is careful about.
//
// It draws only what was measured. The legacy market panel fell back to
// `sampleSeries()` — a seeded pseudo-random walk — whenever it had no data, and
// rendered it as a smooth, entirely convincing price history. Here an empty
// series is an empty panel that says why.
//
// It is quiet until asked. At rest there is a label, a number, and a line. The
// unit, the point count, the provisional count and the per-point values are all
// real and all available, but none of them are worth permanent furniture around
// a four-point series — they appear on hover, which is also when a reader is
// actually asking for them.
// ──────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from "react";
import QciChart, { chartDateLong, type ChartPoint } from "@/components/QciChart";
import type { QciSeries, SeriesPoint } from "@/lib/qci/v2/store";

const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
  { label: "ALL", days: 36_500 },
] as const;

type MetricKey = keyof QciSeries;

// Labels are words, not tickers. "QCI-Q" told a reader nothing they could act
// on; "Quality-adjusted" at least names the idea.
const METRICS: Array<{
  key: MetricKey;
  symbol: string;
  label: string;
  unit: string;
  dp: number;
  money: boolean;
}> = [
  {
    key: "usdPerQpuHour",
    symbol: "Price",
    label: "Price of a quantum hour",
    unit: "USD per QPU-hour",
    dp: 0,
    money: true,
  },
  {
    key: "usdPerQcu",
    symbol: "Quality-adj.",
    label: "Cost per unit of capability",
    unit: "USD per capability-hour",
    dp: 0,
    money: true,
  },
  {
    key: "level",
    symbol: "Level",
    label: "Index level",
    unit: "1,000 at inception",
    dp: 2,
    money: false,
  },
  {
    key: "costBasis",
    symbol: "Cost",
    label: "Modelled cost to produce",
    unit: "USD per QPU-hour",
    dp: 0,
    money: true,
  },
];

function num(v: number, dp: number) {
  return v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** "over all" was not a phrase. Say the window the way a person would. */
function window_(range: string): string {
  return range === "ALL" ? "over all time" : `over ${range.toLowerCase()}`;
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
  const [range, setRange] = useState<(typeof RANGES)[number]["label"]>("ALL");
  const [hovered, setHovered] = useState<ChartPoint | null>(null);

  const active = METRICS.find((m) => m.key === metric) ?? METRICS[0];
  const all = useMemo(() => series[metric] ?? [], [series, metric]);

  const visible = useMemo(() => {
    const days = RANGES.find((r) => r.label === range)?.days ?? 36_500;
    const end = all.at(-1)?.time ?? 0;
    const cut = all.filter((p) => p.time >= end - days * 86_400);
    return cut.length > 1 ? cut : all;
  }, [all, range]);

  const first = visible[0]?.value ?? 0;
  const latest = visible.at(-1)?.value ?? 0;
  const shown = hovered?.value ?? latest;
  const delta = latest - first;
  const deltaPct = first > 0 ? (delta / first) * 100 : 0;
  const flat = Math.abs(deltaPct) < 0.005;
  const provisional = visible.filter((p) => p.status === "provisional").length;

  const fmt = (v: number) => `${active.money ? "$" : ""}${num(v, active.dp)}`;

  if (!hasData || all.length === 0) {
    return (
      <section className="qci-series">
        <header className="qci-sec-head">
          <div>
            <h2>History</h2>
            <p>One point per day, drawn only from what was measured.</p>
          </div>
        </header>
        <div className="qci-empty">
          <h3>{hasData ? "Not enough points to chart yet" : "Nothing recorded yet"}</h3>
          <p>{emptyReason ?? "The index needs one recorded point before it can be charted."}</p>
          <p>A blank chart means nothing was measured — never that a line failed to draw.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="qci-series">
      <header className="qci-sec-head">
        <div>
          <h2>History</h2>
          <p>One point per day, drawn only from what was measured.</p>
        </div>
      </header>

      <div className="qci-series-body">
        <div className="qci-series-quote">
          <div className="qci-quote-main">
            <span className="qci-quote-label">{active.label}</span>
            <strong>{fmt(shown)}</strong>
            <span className="qci-quote-move" data-dir={flat ? "flat" : delta > 0 ? "up" : "down"}>
              {hovered ? (
                chartDateLong(hovered.time)
              ) : flat ? (
                <>
                  — unchanged <small>{window_(range)}</small>
                </>
              ) : (
                <>
                  {delta > 0 ? "▲" : "▼"} {num(Math.abs(delta), active.dp)}{" "}
                  <small>
                    ({deltaPct >= 0 ? "+" : "−"}
                    {Math.abs(deltaPct).toFixed(2)}%) {window_(range)}
                  </small>
                </>
              )}
            </span>
          </div>

          {/* Everything a reader might want to check, and nothing they need at
              rest. Revealed with the panel, not printed onto it. */}
          <dl className="qci-quote-meta">
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
              <dd data-warn={provisional > 0 ? "true" : undefined}>{provisional}</dd>
            </div>
          </dl>
        </div>

        <QciChart
          points={visible as SeriesPoint[]}
          height={215}
          format={fmt}
          onHover={setHovered}
          ariaLabel={active.label}
          className="qci-series-chart"
        />

        <div className="qci-series-controls">
          <div className="qci-seg">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                data-active={metric === m.key ? "true" : undefined}
                onClick={() => {
                  setMetric(m.key);
                  setHovered(null);
                }}
              >
                {m.symbol}
              </button>
            ))}
          </div>
          <div className="qci-seg">
            {RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                data-active={range === r.label ? "true" : undefined}
                onClick={() => {
                  setRange(r.label);
                  setHovered(null);
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
