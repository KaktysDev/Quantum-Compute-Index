// ──────────────────────────────────────────────────────────────────────────────
// Display formatters shared by the landing page, dashboard, and pricing page.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Format a percent change with a leading sign, showing ENOUGH precision that a
 * small-but-real daily move is still visible. The QCI moves slowly (a stable
 * basket might shift 0.004% overnight), so a flat `toFixed(2)` would render a
 * genuine move as "+0.00%". We widen the precision (up to 4 dp) only when the
 * value would otherwise round to zero.
 */
export function formatChangePct(pct: number): string {
  if (!Number.isFinite(pct)) return "0.00%";
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  const abs = Math.abs(pct);
  let digits = 2;
  if (abs > 0 && abs < 0.01) {
    digits = Math.min(4, Math.max(2, Math.ceil(-Math.log10(abs))));
  }
  return `${sign}${abs.toFixed(digits)}%`;
}

/** Format a USD amount with thousands separators and 2 decimals (no sign). */
export function formatUsd(amount: number): string {
  return (Number.isFinite(amount) ? amount : 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
