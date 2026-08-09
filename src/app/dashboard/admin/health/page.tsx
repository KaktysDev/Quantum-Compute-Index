import { Activity, Database, KeyRound, Radio, Waypoints, Wifi, WifiOff } from "lucide-react";
import GlassCard from "@/components/GlassCard";
import QciMap from "@/components/QciMap";
import HealthActions from "@/components/admin/HealthActions";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { PROVIDERS } from "@/lib/providers";
import { checkProviderConnections, type ProviderHealth } from "@/lib/qrouter/providerHealth";
import { feedStatuses, getIndexHealth } from "@/lib/qci/v2/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // live probes run in parallel, up to ~10s each

const usd = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: dp });

/** "3h ago" / "2 days ago". Relative, because staleness is the whole question. */
function ago(ts: string | null | undefined): string {
  if (!ts) return "never";
  const ms = Date.now() - Date.parse(ts);
  if (!Number.isFinite(ms)) return "—";
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "under an hour ago";
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)} days ago`;
}

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

  const [feedChecks, probes, index, { data: backends }] = await Promise.all([
    checkFeedCredentials().catch(() => [] as FeedCheck[]),
    checkProviderConnections().catch(() => [] as ProviderHealth[]),
    getIndexHealth(supabase),
    supabase
      .from("backends")
      .select("id, provider, display_name, kind, status, queue_seconds, updated_at")
      .order("provider"),
  ]);

  const feedUp = feedChecks.filter((c) => c.state === "up").length;
  const feedStored = feedChecks.filter((c) => c.state !== "no_key").length;
  const reachable = probes.filter((p) => p.reachable).length;
  const configured = probes.filter((p) => p.configured).length;
  const cronSecretSet = Boolean(process.env.CRON_SECRET);

  const point = index.latest;
  const feeds = feedStatuses(point);
  const defaulted = feeds.filter((f) => f.usingDefault);
  const staleFeeds = feeds.filter((f) => f.stale);

  // "Fresh" means the operator reported the machine on the day of the point, so
  // this counts genuine re-measurement rather than basket membership.
  const measured = point?.devices.filter((d) => d.fresh).length ?? 0;
  const assumedQuality = point?.devices.filter((d) => d.qualityTier === "assumed").length ?? 0;
  const pointAgeH = index.latest
    ? Math.round((Date.now() - Date.parse(index.latest.ts)) / 3_600_000)
    : null;
  const archiveShort = point != null && index.archivedToday < point.devices.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Platform health</h2>
        <HealthActions />
      </div>

      {/* ── The published index ─────────────────────────────────────────────
          Reads qci_index_points — the table the product actually publishes
          from — rather than the legacy qci_snapshots this card used to show. */}
      <GlassCard className="p-6">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Database size={14} /> Published index
        </h3>
        {index.error ? (
          <p className="mt-3 text-xs text-red-400">Could not read the index tables: {index.error}</p>
        ) : null}
        <dl className="admin-index-grid mt-5">
          <div>
            <dt>Latest point</dt>
            <dd className={pointAgeH != null && pointAgeH > 30 ? "warn" : undefined}>
              {index.latestDate ?? "none"}
            </dd>
            <small>
              {index.latest ? ago(index.latest.ts) : "no point has ever been written"}
              {pointAgeH != null && pointAgeH > 30 ? " — the daily cron may be failing" : ""}
            </small>
          </div>
          <div>
            <dt>Price · level</dt>
            <dd>{point ? `${usd(point.usdPerQpuHour)} · ${point.level.toFixed(2)}` : "—"}</dd>
            <small>
              {point
                ? `${point.changePct >= 0 ? "+" : ""}${point.changePct.toFixed(4)}% vs previous point`
                : "per QPU-hour"}
            </small>
          </div>
          <div>
            <dt>Coverage · matched</dt>
            <dd className={point && !point.inception && point.coverage < 0.6 ? "warn" : "good"}>
              {point ? `${Math.round(point.coverage * 100)}% · ${point.matched}/${point.priced ?? point.devices.length}` : "—"}
            </dd>
            <small>
              {point?.inception
                ? "inception point — nothing to match against yet"
                : point
                  ? `${point.status}, ${measured} of ${point.devices.length} re-measured today`
                  : "share of basket weight compared with the previous day"}
            </small>
          </div>
          <div>
            <dt>Observation archive</dt>
            <dd className={archiveShort ? "warn" : "good"}>
              {point ? `${index.archivedToday}/${point.devices.length}` : "—"}
            </dd>
            <small>
              {archiveShort
                ? "rows missing — the audit trail is incomplete"
                : "raw rows stored for the latest date"}
            </small>
          </div>
          <div>
            <dt>Series length</dt>
            <dd>{index.pointCount}</dd>
            <small>published daily points</small>
          </div>
          <div>
            <dt>Cron auth</dt>
            <dd className={cronSecretSet ? "good" : "bad"}>
              {cronSecretSet ? "configured" : "missing"}
            </dd>
            <small>{cronSecretSet ? "CRON_SECRET is set" : "CRON_SECRET unset — the cron gets 401"}</small>
          </div>
        </dl>

        <h4 className="mt-6 font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
          Recent refresh runs
        </h4>
        <ul className="admin-run-log mt-2">
          {index.runs.length === 0 ? (
            <li>
              <span className="detail">No refresh has been recorded yet.</span>
            </li>
          ) : null}
          {index.runs.map((r) => (
            <li key={r.started_at}>
              <time>{new Date(r.started_at).toLocaleString()}</time>
              <span
                className="state"
                data-ok={!r.ok || r.error ? "failed" : r.wrote ? "wrote" : "skipped"}
              >
                {!r.ok || r.error ? "failed" : r.wrote ? "wrote" : "skipped"}
              </span>
              <span className="detail">
                {r.error ??
                  r.reason ??
                  `${r.observed ?? 0} observed · ${r.matched ?? 0} matched · ${Math.round((r.coverage ?? 0) * 100)}% coverage${
                    r.price_card_version ? ` · AWS card v${r.price_card_version}` : ""
                  }`}
              </span>
            </li>
          ))}
        </ul>
        {index.runs.some((r) => (r.warnings ?? []).length > 0) ? (
          <ul className="admin-note-list">
            {[...new Set(index.runs.flatMap((r) => r.warnings ?? []))].slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </GlassCard>

      {/* ── Cost-model inputs, with every pinned fallback named ────────────── */}
      <GlassCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Waypoints size={14} /> Cost-model inputs
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--muted)]">
            {feeds.length - defaulted.length}/{feeds.length} live
            {staleFeeds.length > 0 ? ` · ${staleFeeds.length} past their limit` : ""}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Every input the cost model looks up for the current basket. A row marked{" "}
          <em>default</em> means the live source did not report and a pinned constant is standing
          in — the value is still used, and this is the only place that fact is visible.
        </p>
        <ul className="admin-feed-table mt-4">
          {feeds.map((f) => (
            <li key={f.id} className="admin-feed-row">
              <b>{f.label}</b>
              <span className="value">
                {f.value.toPrecision(4)} {f.unit}
              </span>
              <span className="meta">
                {f.usingDefault
                  ? "no live reading — pinned constant in force"
                  : `${f.source}${
                      f.ageDays != null
                        ? ` · effective ${f.ageDays < 1 ? "today" : `${Math.round(f.ageDays)}d ago`}`
                        : ""
                    }${f.stale ? ` · PAST its ${f.maxAgeDays}d limit` : ""}`}
              </span>
              <span className="tier" data-tier={f.tier}>
                {f.usingDefault ? "default" : f.tier}
              </span>
            </li>
          ))}
        </ul>
        {assumedQuality > 0 && point ? (
          <ul className="admin-note-list">
            <li>
              {assumedQuality} of {point.devices.length} machines are priced on a provider-typical
              quality default because their operator exposes no calibration for them. Open the
              attribution map below and select the machine to see which field.
            </li>
          </ul>
        ) : null}
      </GlassCard>

      {/* ── The full attribution map ───────────────────────────────────────── */}
      {point ? (
        <GlassCard className="p-6">
          <QciMap point={point} mode="diagnostic" />
        </GlassCard>
      ) : null}

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
        <p className="mt-1 text-xs text-[var(--muted)]">
          Cached rows the router reads. The age is shown per row because a stored status is only
          as good as the last time the health cron wrote it.
        </p>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {(backends ?? []).map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-black/20 px-3 py-2">
              <span className="min-w-0 text-xs text-white">
                {b.display_name}{" "}
                <span className="text-[var(--muted)]">
                  · {b.provider} · {b.kind} · queue {b.queue_seconds}s · updated {ago(b.updated_at)}
                </span>
              </span>
              <span className={`shrink-0 font-mono text-[10px] uppercase tracking-widest ${
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
