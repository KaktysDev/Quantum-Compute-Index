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
  /** Why this metric can sit flat for days without anything being wrong. */
  flatReason: string;
}> = [
  {
    key: "usdPerQpuHour",
    symbol: "Price",
    label: "Price of a quantum hour",
    unit: "USD per QPU-hour",
    dp: 0,
    money: true,
    flatReason:
      "Every machine in the basket is still on the hourly rate its seller last published, and sellers revise rate cards a few times a year — not daily.",
  },
  {
    key: "usdPerQcu",
    symbol: "Quality-adj.",
    label: "Cost per unit of capability",
    unit: "USD per capability-hour",
    dp: 0,
    money: true,
    flatReason:
      "Neither the published rates nor the calibration behind them changed across this window.",
  },
  {
    key: "level",
    symbol: "Level",
    label: "Index level",
    unit: "1,000 at inception",
    dp: 2,
    money: false,
    flatReason:
      "No machine that could be compared with the previous day repriced or changed capability.",
  },
  {
    key: "costBasis",
    symbol: "Cost",
    label: "Modelled cost to produce",
    unit: "USD per QPU-hour",
    dp: 0,
    money: true,
    flatReason:
      "The cost model is dominated by capital amortisation, which is a pinned constant; the live energy and consumables feeds are too small a share to move it.",
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

  // ── Which metrics actually moved in this window ────────────────────────────
  //
  // The headline price is a basket of PUBLISHED HOURLY RATES, and published rates
  // are revised roughly quarterly. So across any short window it is usually a
  // dead-flat line, while the level and the quality-adjusted price — which track
  // daily calibration — move underneath it. A reader who lands on the default
  // metric and sees a ruler has no way to tell "measured, unchanged" from
  // "chart is broken", and will reasonably assume the latter.
  //
  // So the panel says which is which: a dot on every metric that moved, and,
  // when the visible one did not, a sentence explaining why and pointing at the
  // ones that did.
  const moved = useMemo(() => {
    const out: Partial<Record<MetricKey, boolean>> = {};
    const days = RANGES.find((r) => r.label === range)?.days ?? 36_500;
    for (const m of METRICS) {
      const pts = series[m.key] ?? [];
      const end = pts.at(-1)?.time ?? 0;
      const cut = pts.filter((p) => p.time >= end - days * 86_400);
      const win = cut.length > 1 ? cut : pts;
      const vals = win.map((p) => p.value);
      out[m.key] = vals.length > 1 && Math.max(...vals) - Math.min(...vals) > 0;
    }
    return out;
  }, [series, range]);

  const alsoMoved = METRICS.filter((m) => m.key !== metric && moved[m.key]);

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

      <div className="qci-series-body qci-card">
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

        {flat && visible.length > 1 ? (
          <p className="qci-flat-note">
            <b>Measured, and unchanged.</b> {active.flatReason}
            {alsoMoved.length > 0 ? (
              <>
                {" "}
                {alsoMoved.map((m, i) => (
                  <span key={m.key}>
                    {i === 0 ? "" : i === alsoMoved.length - 1 ? " and " : ", "}
                    <button type="button" onClick={() => { setMetric(m.key); setHovered(null); }}>
                      {m.symbol.replace(/\.$/, "")}
                    </button>
                  </span>
                ))}{" "}
                {alsoMoved.length === 1 ? "did move" : "did move"} over the same window.
              </>
            ) : null}
          </p>
        ) : null}

        <div className="qci-series-controls">
          <div className="qci-seg">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                data-active={metric === m.key ? "true" : undefined}
                data-moved={moved[m.key] ? "true" : undefined}
                title={moved[m.key] ? `${m.label} moved over this window` : `${m.label} is unchanged over this window`}
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
