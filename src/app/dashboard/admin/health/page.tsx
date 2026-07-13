import { Activity, Database, KeyRound, Radio, Wifi, WifiOff } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import HealthActions from "@/components/admin/HealthActions";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { PROVIDERS } from "@/lib/providers";
import { checkProviderConnections, type ProviderHealth } from "@/lib/qrouter/providerHealth";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // live probes run in parallel, up to ~10s each

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

interface FeedCheck {
  id: string;
  name: string;
  state: "up" | "down" | "no_key" | "stored";
  enabled: boolean;
  message: string;
  details?: string[];
}

/** Race a probe against a timeout so one hung provider can't stall the page. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

/**
 * Probe the QCI feed credentials — the keys saved in Admin → Provider keys
 * (NOT env vars). This is what actually feeds the daily index refresh.
 */
async function checkFeedCredentials(): Promise<FeedCheck[]> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("provider_keys")
    .select("provider, enabled, encrypted_key");
  const byId = new Map((rows ?? []).map((r) => [r.provider, r]));

  return Promise.all(
    PROVIDERS.map(async (p): Promise<FeedCheck> => {
      const row = byId.get(p.id);
      if (!row) {
        return { id: p.id, name: p.name, state: "no_key", enabled: false, message: "No key stored — add one in Provider keys." };
      }
      let secret: string;
      try {
        secret = decryptSecret(row.encrypted_key);
      } catch {
        return { id: p.id, name: p.name, state: "down", enabled: row.enabled, message: "Stored key cannot be decrypted (KEY_ENCRYPTION_SECRET changed?)." };
      }
      if (!p.testConnection) {
        return { id: p.id, name: p.name, state: "stored", enabled: row.enabled, message: "Key stored — this provider has no connection test." };
      }
      try {
        const result = await withTimeout(p.testConnection(secret), 12_000);
        return {
          id: p.id,
          name: p.name,
          state: result.ok ? "up" : "down",
          enabled: row.enabled,
          message: result.message,
          details: result.details?.slice(0, 4),
        };
      } catch (e) {
        return { id: p.id, name: p.name, state: "down", enabled: row.enabled, message: e instanceof Error ? e.message : "Probe failed." };
      }
    }),
  );
}

export default async function AdminHealthPage() {
  const { supabase } = await requireAdmin();

  const [feedChecks, probes, latest, { data: backends }, { data: recentSnapshots }] =
    await Promise.all([
      checkFeedCredentials().catch(() => [] as FeedCheck[]),
      checkProviderConnections().catch(() => [] as ProviderHealth[]),
      getLatestSnapshot(),
      supabase.from("backends").select("id, provider, display_name, kind, status, queue_seconds, updated_at").order("provider"),
      supabase.from("qci_snapshots").select("ts, source, price, vwap").order("ts", { ascending: false }).limit(7),
    ]);

  const feedUp = feedChecks.filter((c) => c.state === "up").length;
  const feedStored = feedChecks.filter((c) => c.state !== "no_key").length;
  const reachable = probes.filter((p) => p.reachable).length;
  const configured = probes.filter((p) => p.configured).length;
  const snapshotAgeH = Math.round((Date.now() - new Date(latest.ts).getTime()) / 3_600_000);
  const staleProviders = latest.components.filter((c) => c.status === "stale").map((c) => c.provider);
  const cronSecretSet = Boolean(process.env.CRON_SECRET);

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
            <p className="text-xs text-[var(--muted)]">{snapshotAgeH}h ago{snapshotAgeH > 30 ? " — daily cron may be failing" : ""}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">Source · cron auth</p>
            <p className={`mt-1 text-sm font-semibold ${latest.source === "live" ? "text-[var(--qr-emerald,#34d399)]" : "text-amber-300"}`}>
              {latest.source.toUpperCase()}
            </p>
            <p className={`text-xs ${cronSecretSet ? "text-[var(--muted)]" : "text-red-400"}`}>
              CRON_SECRET {cronSecretSet ? "configured" : "MISSING — cron gets 401"}
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

      {/* QCI feed credentials — the keys managed in Admin → Provider keys */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><KeyRound size={14} /> QCI feed keys (stored credentials, live probe)</h3>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {feedUp}/{feedStored} stored keys reachable
          </span>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {feedChecks.map((c) => (
            <div key={c.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-medium text-white">
                    {c.state === "up" ? (
                      <Wifi size={12} className="text-[var(--qr-emerald,#34d399)]" />
                    ) : (
                      <WifiOff size={12} className={c.state === "down" ? "text-red-400" : "text-[var(--muted)]"} />
                    )}
                    {c.name}
                    {!c.enabled && c.state !== "no_key" && (
                      <span className="rounded border border-amber-300/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-300">disabled</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--muted)]" title={c.message}>{c.message}</p>
                  {c.details && c.details.length > 0 && (
                    <ul className="mt-1">
                      {c.details.map((d) => (
                        <li key={d} className="truncate font-mono text-[10px] text-[var(--muted)]">· {d}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <span className={`shrink-0 font-mono text-[10px] uppercase tracking-widest ${
                  c.state === "up" ? "text-[var(--qr-emerald,#34d399)]" : c.state === "down" ? "text-red-400" : "text-[var(--muted)]"
                }`}>
                  {c.state === "up" ? "up" : c.state === "down" ? "down" : c.state === "stored" ? "stored" : "no key"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Execution-plane env credentials (separate system from the stored keys) */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white"><Radio size={14} /> Execution plane (server env credentials)</h3>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {reachable}/{configured} configured reachable
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          These are the job-execution credentials set as Vercel environment variables
          (IBM_QUANTUM_TOKEN, AWS_ACCESS_KEY_ID, IONQ_API_KEY, bridge URLs…) — separate
          from the stored QCI feed keys above.
        </p>
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
