"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCcw, Zap } from "lucide-react";

/** Re-probe button + "run QCI refresh now" trigger for the Health tab. */
export default function HealthActions() {
  const router = useRouter();
  const [rechecking, setRechecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function recheck() {
    setRechecking(true);
    router.refresh();
    // router.refresh() re-runs the server component (and its probes).
    setTimeout(() => setRechecking(false), 1200);
  }

  async function refreshIndex() {
    setRefreshing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Refresh failed");
      setMessage(
        data.wrote
          ? `Snapshot written — ${data.qpus} QPUs, $${Number(data.price).toFixed(2)}${data.stale?.length ? ` (carried: ${data.stale.join(", ")})` : ""}`
          : `No write: ${data.reason ?? "nothing to record"}`,
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={recheck} disabled={rechecking} className="console-primary disabled:opacity-50">
        {rechecking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
        Re-probe providers
      </button>
      <button
        onClick={refreshIndex}
        disabled={refreshing}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-300/30 px-3.5 py-2 text-xs text-emerald-300 transition-colors hover:bg-emerald-300/10 disabled:opacity-50"
      >
        {refreshing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
        Run QCI refresh now
      </button>
      {message && <span className="text-xs text-[var(--muted)]">{message}</span>}
    </div>
  );
}
