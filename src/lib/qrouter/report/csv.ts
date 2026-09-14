import { asNumericMap } from "./analytics";
import { slimResult } from "@/lib/qrouter/encoding/public";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll("\"", "\"\"")}"`;
  return value;
}

/** CSV of the stored counts / probabilities only. */
export function resultCsv(result: unknown, requestedShots?: number | null): string {
  const slim = slimResult(result ?? {});
  const row = slim && typeof slim === "object" && !Array.isArray(slim) ? slim as Record<string, unknown> : {};
  const counts = asNumericMap(row.counts);
  const probabilities = asNumericMap(row.probabilities);
  const keys = [...new Set([
    ...(counts ? Object.keys(counts) : []),
    ...(probabilities ? Object.keys(probabilities) : []),
  ])].sort((a, b) => {
    const aRank = counts?.[a] ?? probabilities?.[a] ?? 0;
    const bRank = counts?.[b] ?? probabilities?.[b] ?? 0;
    return bRank - aRank || a.localeCompare(b);
  });
  const observed = counts ? Object.values(counts).reduce((sum, value) => sum + value, 0) : 0;
  const shots = typeof row.shots === "number" && row.shots > 0
    ? row.shots
    : requestedShots && requestedShots > 0
      ? requestedShots
      : observed;
  const lines = ["bitstring,count,probability"];
  for (const key of keys) {
    const count = counts?.[key];
    const probability = probabilities?.[key] ?? (count != null && shots ? count / shots : "");
    lines.push([
      csvEscape(key),
      count != null ? String(count) : "",
      probability === "" ? "" : String(probability),
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
}
