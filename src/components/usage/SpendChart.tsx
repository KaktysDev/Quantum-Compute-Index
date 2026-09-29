"use client";

// Daily spend as a single-series bar chart. Ink-coloured bars on a recessive
// baseline, hover for the day's exact figures. A table view sits alongside.

import { useState } from "react";
import { formatUsd } from "@/lib/qrouter/cost";
import type { UsageDay } from "@/lib/console/usage";

const H = 160;

function label(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function SpendChart({ days }: { days: UsageDay[] }) {
  const [active, setActive] = useState<number | null>(null);
  const peak = Math.max(...days.map((day) => day.spend), 0);
  const scale = peak > 0 ? peak : 1;
  const hovered = active === null ? null : days[active];
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];

  return (
    <figure className="spend-chart" aria-label="Spend per day">
      <div className="spend-chart-readout" aria-live="polite">
        {hovered ? (
          <>
            <b>{formatUsd(hovered.spend)}</b>
            <span>{label(hovered.day)} · {hovered.runs} run{hovered.runs === 1 ? "" : "s"}</span>
          </>
        ) : (
          <>
            <b>{formatUsd(peak)}</b>
            <span>Peak day</span>
          </>
        )}
      </div>
      <div className="spend-chart-plot" style={{ height: H }} onMouseLeave={() => setActive(null)}>
        <div className="spend-chart-grid" aria-hidden="true" />
        {days.map((day, index) => {
          const height = day.spend > 0 ? Math.max(2, (day.spend / scale) * H) : 0;
          return (
            <button
              key={day.day}
              type="button"
              className={`spend-chart-col${active === index ? " active" : ""}`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              aria-label={`${label(day.day)}: ${formatUsd(day.spend)}, ${day.runs} runs`}
            >
              <i style={{ height }} />
            </button>
          );
        })}
      </div>
      <div className="spend-chart-axis" aria-hidden="true">
        {ticks.map((index) => (
          <span key={index}>{days[index] ? label(days[index].day) : ""}</span>
        ))}
      </div>
    </figure>
  );
}
