"use client";

import { memo } from "react";
import type { BitstringRow } from "@/lib/qrouter/report/types";

export const CountsChart = memo(function CountsChart({
  rows,
  emptyLabel,
}: {
  rows: BitstringRow[];
  emptyLabel?: string;
}) {
  if (!rows.length) {
    return <p className="muted">{emptyLabel ?? "No distribution is stored for this job."}</p>;
  }
  const max = Math.max(...rows.map((row) => row.count ?? row.probability ?? 0), 1e-9);
  const rowH = 22;
  const height = Math.max(160, rows.length * rowH + 16);
  const width = 640;
  const longest = Math.max(...rows.map((row) => row.bitstring.length), 1);
  const labelW = Math.min(168, 36 + longest * 7.2);
  const right = 72;
  const barMax = width - labelW - right - 8;
  const label = `${rows.length} stored bitstring${rows.length === 1 ? "" : "s"}`;

  return (
    <div className="jr-chart" role="img" aria-label={`Bitstring distribution from stored results, ${label}`}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="xMinYMid meet">
        {rows.map((row, index) => {
          const value = row.count ?? row.probability ?? 0;
          const y = 8 + index * 22;
          const barW = Math.max(2, (value / max) * barMax);
          const caption = row.count != null
            ? `${row.count.toLocaleString()}${row.probability != null ? `  ${(row.probability * 100).toFixed(1)}%` : ""}`
            : row.probability != null ? `${(row.probability * 100).toFixed(2)}%` : "";
          return (
            <g key={`${row.bitstring}-${index}`}>
              <text x={0} y={y + 11} className="jr-chart-label">{`|${row.bitstring}⟩`}</text>
              <rect x={labelW} y={y} width={barW} height={12} rx={1.5} className="jr-chart-bar" />
              <text x={labelW + barW + 8} y={y + 11} className="jr-chart-value">{caption}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
