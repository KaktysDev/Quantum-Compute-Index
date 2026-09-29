import { formatUsd } from "@/lib/qrouter/cost";

export function Money({ value, fallback = "—" }: { value: number | null | undefined; fallback?: string }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return <span className="dim">{fallback}</span>;
  return <span className="num">{formatUsd(value)}</span>;
}
