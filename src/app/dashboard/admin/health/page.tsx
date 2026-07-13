import { Activity, Database, Radio, Wifi, WifiOff } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import HealthActions from "@/components/admin/HealthActions";
import { requireAdmin } from "@/lib/admin";
import { checkProviderConnections, type ProviderHealth } from "@/lib/qrouter/providerHealth";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // live probes can take up to ~10s each (parallel)

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default async function AdminHealthPage() {
  const { supabase } = await requireAdmin();

  let probes: ProviderHealth[] = [];
  try {
    probes = await checkProviderConnections();
  } catch {
    probes = [];
  }

  const [latest, { data: backends }, { data: recentSnapshots }] = await Promise.all([
    getLatestSnapshot(),
    supabase.from("backends").select("id, provider, display_name, kind, status, queue_seconds, updated_at").order("provider"),
    supabase.from("qci_snapshots").select("ts, source, price, vwap").order("ts", { ascending: false }).limit(7),
  ]);

  const reachable = probes.filter((p) => p.reachable).length;
  const configured = probes.filter((p) => p.configured).length;
  const snapshotAgeH = Math.round((Date.now() - new Date(latest.ts).getTime()) / 3_600_000);
  const staleProviders = latest.components.filter((c) => c.status === "stale").map((c) => c.provider);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Platform health</h2>
        <HealthActions />
      </div>

      {/* QCI freshness */}
      <GlassCard className="p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Database size={14} /> QCI index freshness</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Last snapshot</p>
            <p className={`mt-1 text-sm font-semibold ${snapshotAgeH > 30 ? "text-amber-300" : "text-white"}`}>
              {new Date(latest.ts).toLocaleString()}
            </p>
            <p className="text-xs text-[var(--muted)]">{snapshotAgeH}h ago{snapshotAgeH > 30 ? " — check the cron + CRON_SECRET" : ""}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Source</p>
            <p className={`mt-1 text-sm font-semibold ${latest.source === "live" ? "text-[var(--qr-emerald,#34d399)]" : "text-amber-300"}`}>
              {latest.source.toUpperCase()}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">$/NQH · level</p>
            <p className="mt-1 text-sm font-semibold text-white">{usd(latest.vwap)} · {latest.price.toFixed(2)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Carried forward</p>
            <p className={`mt-1 text-sm font-semibold ${staleProviders.length ? "text-amber-300" : "text-[var(--qr-emerald,#34d399)]"}`}>
              {staleProviders.length ? staleProviders.join(", ") : "none"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(recentSnapshots ?? []).map((s) => (
            <span key={s.ts} className="rounded border border-white/10 bg-black/30 px-2 py-1 font-mono text-[10px] text-[var(--muted)]">
              {new Date(s.ts).toLocaleDateString()} · {s.source} · {usd(Number(s.vwap ?? 0))}
            </span>
          ))}
        </div>
      </GlassCard>

      {/* Live execution-credential probes */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Radio size={14} /> Provider connectivity (live probe)</h3>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {reachable}/{configured} configured reachable
          </span>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {probes.map((p) => (
            <div key={p.provider} className="flex items-start justify-between gap-3 rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-medium text-white">
                  {p.reachable ? <Wifi size={12} className="text-[var(--qr-emerald,#34d399)]" /> : <WifiOff size={12} className={p.configured ? "text-red-400" : "text-[var(--muted)]"} />}
                  {p.provider}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]" title={p.detail}>{p.detail}</p>
              </div>
              <span className={`shrink-0 font-mono text-[10px] uppercase tracking-widest ${
                !p.configured ? "text-[var(--muted)]" : p.reachable ? "text-[var(--qr-emerald,#34d399)]" : "text-red-400"
              }`}>
                {!p.configured ? "no creds" : p.reachable ? "up" : "down"}
              </span>
            </div>
          ))}
          {probes.length === 0 && (
            <p className="text-sm text-[var(--muted)]">Probe run failed — check server logs.</p>
          )}
        </div>
      </GlassCard>

      {/* Routing catalog state */}
      <GlassCard className="p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Activity size={14} /> Routing catalog (backends table)</h3>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {(backends ?? []).map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2">
              <span className="text-xs text-white">
                {b.display_name} <span className="text-[var(--muted)]">· {b.provider} · {b.kind} · queue {b.queue_seconds}s</span>
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-widest ${
                b.status === "online" ? "text-[var(--qr-emerald,#34d399)]" : b.status === "degraded" ? "text-amber-300" : "text-red-400"
              }`}>
                {b.status}
              </span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
