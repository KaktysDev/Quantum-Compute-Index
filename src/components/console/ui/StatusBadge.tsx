import { statusView } from "@/lib/qrouter/status";

/** Dot plus label, coloured by tone. Works for execution and group statuses. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const view = statusView(status);
  return <span className={`status ${view.tone}`}>{label ?? view.label}</span>;
}
