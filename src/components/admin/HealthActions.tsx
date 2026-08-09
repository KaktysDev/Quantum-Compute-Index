"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, Zap } from "lucide-react";

/**
 * Shape of POST /api/refresh. Both engines run independently and either can
 * fail without the other, so the response is a pair rather than a single
 * result. Reading it as a flat object — which this component used to do — makes
 * every run report "No write: nothing to record" no matter what happened.
 */
interface RefreshResponse {
  v2?: {
    ok?: boolean;
    wrote?: boolean;
    reason?: string;
    error?: string;
    usdPerQpuHour?: number;
    level?: number;
    changePct?: number;
    matched?: number;
    priced?: number;
    observed?: number;
    archived?: number;
    coverage?: number;
    inception?: boolean;
    warnings?: string[];
  };
  legacy?: { wrote?: boolean; reason?: string; error?: string; qpus?: number; price?: number };
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** One line describing what the index engine actually did. */
function describe(v2: RefreshResponse["v2"]): string {
  if (!v2) return "No response from the index engine.";
  if (v2.error) return `Index refresh failed — ${v2.error}`;
  if (!v2.wrote) return `No point written — ${v2.reason ?? "nothing to record"}`;

  const parts = [`${usd(v2.usdPerQpuHour ?? 0)}/QPU-hour`];
  if (v2.level != null) parts.push(`level ${v2.level.toFixed(2)}`);
  if (v2.inception) {
    parts.push(`baseline set from ${v2.priced ?? 0} priced devices`);
  } else {
    parts.push(
      `${(v2.changePct ?? 0) >= 0 ? "+" : ""}${(v2.changePct ?? 0).toFixed(3)}%`,
      `${v2.matched ?? 0}/${v2.priced ?? 0} matched`,
    );
  }
  parts.push(`${v2.archived ?? 0}/${v2.observed ?? 0} archived`);
  return `Index point written — ${parts.join(" · ")}`;
}

/** Re-probe button + "run QCI refresh now" trigger for the Health tab. */
export default function HealthActions() {
  const router = useRouter();
  const [rechecking, setRechecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  function recheck() {
    setRechecking(true);
    router.refresh();
    // router.refresh() re-runs the server component (and its probes).
    setTimeout(() => setRechecking(false), 1200);
  }

  async function refreshIndex() {
    setRefreshing(true);
    setMessage(null);
    setWarnings([]);
    setFailed(false);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = (await res.json()) as RefreshResponse & { error?: string };
      if (!res.ok && data.error) throw new Error(data.error);

      const legacy = data.legacy?.wrote
        ? ` · legacy snapshot ${usd(Number(data.legacy.price ?? 0))}`
        : data.legacy?.error
          ? " · legacy engine failed"
          : "";
      setMessage(describe(data.v2) + legacy);
      setFailed(Boolean(data.v2?.error) || data.v2?.wrote === false);
      setWarnings(data.v2?.warnings ?? []);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Refresh failed");
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="admin-health-actions">
      <div className="admin-health-buttons">
        <button onClick={recheck} disabled={rechecking} className="console-primary disabled:opacity-50">
          {rechecking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
          Re-probe providers
        </button>
        <button onClick={refreshIndex} disabled={refreshing} className="admin-refresh-button">
          {refreshing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
          Run QCI refresh now
        </button>
      </div>
      {message && (
        <p className="admin-health-result" data-failed={failed ? "true" : undefined}>
          {message}
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="admin-health-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
