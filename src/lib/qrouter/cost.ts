// How a job's money reads in the console. The quote is what was reserved; the
// ledger `charge` row is what was actually billed (it can be lower).

import { isTerminal } from "./status";

export type LedgerRow = { type?: unknown; amount?: unknown };

export type CostView = {
  /** Short verb for the amount, e.g. "Charged". */
  label: string;
  /** null when there is nothing to show beside the label. */
  amount: number | null;
  /** Muted aside, e.g. the original quote when the charge came in lower. */
  secondary?: string;
};

/** Two decimals from $1 up; below that up to four, so small runs stay legible. */
export function formatUsd(value: number): string {
  if (Math.abs(value) >= 1 || value === 0) return `$${value.toFixed(2)}`;
  const fixed = value.toFixed(4).replace(/0{1,2}$/, "");
  return `$${fixed}`;
}

/** Amount billed for a job, from its ledger rows. null when nothing was charged. */
export function chargedFromLedger(rows: unknown): number | null {
  if (!Array.isArray(rows)) return null;
  let charged = 0;
  let seen = false;
  for (const row of rows as LedgerRow[]) {
    const amount = Number(row?.amount);
    if (!Number.isFinite(amount)) continue;
    if (row.type === "charge") {
      charged += -amount;
      seen = true;
    } else if (row.type === "refund") {
      charged -= amount;
      seen = true;
    }
  }
  return seen ? Math.max(0, Number(charged.toFixed(6))) : null;
}

export function costView({
  status,
  quoted,
  charged,
}: {
  status: string;
  quoted: number | null | undefined;
  charged: number | null | undefined;
}): CostView {
  const q = typeof quoted === "number" && Number.isFinite(quoted) ? quoted : null;
  const c = typeof charged === "number" && Number.isFinite(charged) ? charged : null;

  if (status === "completed") {
    if (c !== null) {
      return {
        label: "Charged",
        amount: c,
        ...(q !== null && Math.abs(q - c) >= 0.005 ? { secondary: `quoted ${formatUsd(q)}` } : {}),
      };
    }
    return q !== null ? { label: "Charged", amount: q } : { label: "No charge", amount: null };
  }
  if (isTerminal(status)) return { label: "Not charged", amount: null };
  if (q === null) return { label: "Pricing", amount: null };
  if (status === "awaiting_payment") return { label: "Needs", amount: q };
  if (status === "quoted" || status === "created" || status === "analyzing") return { label: "Quoted", amount: q };
  return { label: "Reserved", amount: q };
}

/** One-line text form, for places that cannot render the two-part view. */
export function costText(view: CostView): string {
  return view.amount === null ? view.label : `${view.label} ${formatUsd(view.amount)}`;
}
