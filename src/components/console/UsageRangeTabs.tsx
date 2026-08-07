"use client";

// Range switcher for the Usage tab. The page reads `?range` on the server, so
// these are plain links — no client state to keep in sync with the data.

import Link from "next/link";

const RANGES = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

export default function UsageRangeTabs({ current }: { current: string }) {
  return (
    <div className="console-range-tabs" role="group" aria-label="Time range">
      {RANGES.map((range) => (
        <Link
          key={range.key}
          href={`/dashboard/usage?range=${range.key}`}
          className={current === range.key ? "active" : ""}
          aria-current={current === range.key ? "true" : undefined}
        >
          {range.label}
        </Link>
      ))}
    </div>
  );
}
