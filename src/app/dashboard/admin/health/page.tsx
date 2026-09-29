import QciMap from "@/components/QciMap";
import { InlineAlert, Panel, Stat, StatGrid } from "@/components/console/ui";
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

  const runState = (run: (typeof index.runs)[number]) =>
    !run.ok || run.error ? <span className="status danger">Failed</span> : run.wrote ? <span className="status success">Wrote</span> : <span className="status neutral">Skipped</span>;
  const probeState = (state: "up" | "down" | "none" | "stored") =>
    state === "up" ? <span className="status success">Up</span> : state === "down" ? <span className="status danger">Down</span> : state === "stored" ? <span className="status neutral">Stored</span> : <span className="status neutral">No key</span>;

  return (
    <div className="stack">
      <div className="row-between">
        <h2 className="section-title">Platform health</h2>
        <HealthActions />
      </div>

      {index.error ? <InlineAlert tone="danger">Could not read the index tables: {index.error}</InlineAlert> : null}
      {pointAgeH != null && pointAgeH > 30 ? <InlineAlert tone="warning">The latest index point is {pointAgeH}h old. The daily cron may be failing.</InlineAlert> : null}
      {!cronSecretSet ? <InlineAlert tone="danger">CRON_SECRET is not set, so scheduled refreshes receive 401.</InlineAlert> : null}

      <StatGrid>
        <Stat label="Latest point" value={index.latestDate ?? "None"} meta={index.latest ? ago(index.latest.ts) : "No point written yet"} tone={pointAgeH != null && pointAgeH > 30 ? "warning" : undefined} />
        <Stat label="Price · level" value={point ? usd(point.usdPerQpuHour) : "—"} meta={point ? `Level ${point.level.toFixed(2)} · ${point.changePct >= 0 ? "+" : ""}${point.changePct.toFixed(4)}%` : "Per QPU-hour"} />
        <Stat
          label="Coverage"
          value={point ? `${Math.round(point.coverage * 100)}%` : "—"}
          tone={point && !point.inception && point.coverage < 0.6 ? "warning" : undefined}
          meta={point?.inception ? "Inception point" : point ? `${point.matched}/${point.priced ?? point.devices.length} matched · ${measured} re-measured` : undefined}
        />
        <Stat label="Archive" value={point ? `${index.archivedToday}/${point.devices.length}` : "—"} tone={archiveShort ? "warning" : undefined} meta={archiveShort ? "Rows missing from the audit trail" : "Raw rows for the latest date"} />
        <Stat label="Series length" value={index.pointCount.toLocaleString()} meta="Published daily points" />
      </StatGrid>

      <Panel title="Recent refresh runs" flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead><tr><th>Started</th><th>Result</th><th>Detail</th></tr></thead>
            <tbody>
              {index.runs.length === 0 ? (
                <tr><td colSpan={3} className="empty-row">No refresh has been recorded yet.</td></tr>
              ) : (
                index.runs.map((run) => (
                  <tr key={run.started_at}>
                    <td className="nowrap muted">{new Date(run.started_at).toLocaleString()}</td>
                    <td>{runState(run)}</td>
                    <td className="muted">
                      {run.error ?? run.reason ?? `${run.observed ?? 0} observed · ${run.matched ?? 0} matched · ${Math.round((run.coverage ?? 0) * 100)}% coverage${run.price_card_version ? ` · AWS card v${run.price_card_version}` : ""}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {index.runs.some((run) => (run.warnings ?? []).length > 0) ? (
          <ul className="panel-foot" style={{ display: "block", margin: 0, paddingLeft: 32 }}>
            {[...new Set(index.runs.flatMap((run) => run.warnings ?? []))].slice(0, 6).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        ) : null}
      </Panel>

      <Panel
        title="Cost-model inputs"
        description={`${feeds.length - defaulted.length}/${feeds.length} live${staleFeeds.length ? ` · ${staleFeeds.length} past their limit` : ""}. A default row means a pinned constant is standing in for a missing live reading.`}
        flush
      >
        <div className="table-wrap">
          <table className="qr-table">
            <thead><tr><th>Input</th><th className="num">Value</th><th className="hide-sm">Source</th><th>Tier</th></tr></thead>
            <tbody>
              {feeds.map((feed) => (
                <tr key={feed.id}>
                  <td>{feed.label}</td>
                  <td className="num">{feed.value.toPrecision(4)} <span className="dim">{feed.unit}</span></td>
                  <td className="hide-sm muted">
                    {feed.usingDefault
                      ? "No live reading"
                      : `${feed.source}${feed.ageDays != null ? ` · effective ${feed.ageDays < 1 ? "today" : `${Math.round(feed.ageDays)}d ago`}` : ""}`}
                    {feed.stale ? <span className="status warning" style={{ marginLeft: 8 }}>Past {feed.maxAgeDays}d limit</span> : null}
                  </td>
                  <td>{feed.usingDefault ? <span className="status warning">Default</span> : <span className="badge">{feed.tier}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {assumedQuality > 0 && point ? (
          <div className="panel-foot">
            {assumedQuality} of {point.devices.length} machines use a provider-typical quality default because their operator exposes no calibration.
          </div>
        ) : null}
      </Panel>

      {point ? <QciMap point={point} mode="diagnostic" /> : null}

      <div className="grid-2">
        <Panel title="QCI feed keys" description={`${feedUp}/${feedStored} stored keys reachable. Managed under Provider keys.`} flush>
          <div className="table-wrap">
            <table className="qr-table">
              <thead><tr><th>Provider</th><th>State</th></tr></thead>
              <tbody>
                {feedChecks.map((check) => (
                  <tr key={check.id}>
                    <td>
                      <span className="cell-main">
                        <b>{check.name}{!check.enabled && check.state !== "no_key" ? <span className="dim"> · disabled</span> : null}</b>
                        <small title={check.message}>{check.message}</small>
                        {check.details?.length ? <small className="mono">{check.details.join(" · ")}</small> : null}
                      </span>
                    </td>
                    <td>{probeState(check.state === "no_key" ? "none" : check.state)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Execution plane" description={`${reachable}/${configured} configured providers reachable. Uses server environment credentials, not the stored feed keys.`} flush>
          <div className="table-wrap">
            <table className="qr-table">
              <thead><tr><th>Provider</th><th>State</th></tr></thead>
              <tbody>
                {probes.length === 0 ? (
                  <tr><td colSpan={2} className="empty-row">Probe run failed. Check server logs.</td></tr>
                ) : (
                  probes.map((probe) => (
                    <tr key={probe.provider}>
                      <td><span className="cell-main"><b>{probe.provider}</b><small title={probe.detail}>{probe.detail}</small></span></td>
                      <td>{!probe.configured ? <span className="status neutral">No credentials</span> : probeState(probe.reachable ? "up" : "down")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Routing catalog" description="Cached backend rows the router reads, with the age of each." flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead><tr><th>Backend</th><th>Status</th><th className="num hide-sm">Queue</th><th className="hide-sm">Updated</th></tr></thead>
            <tbody>
              {(backends ?? []).map((backend) => (
                <tr key={backend.id}>
                  <td><span className="cell-main"><b>{backend.display_name}</b><small>{backend.provider} · {backend.kind}</small></span></td>
                  <td>{backend.status === "online" ? <span className="status success">Online</span> : backend.status === "degraded" ? <span className="status warning">Degraded</span> : <span className="status danger">Offline</span>}</td>
                  <td className="num hide-sm">{backend.queue_seconds}s</td>
                  <td className="hide-sm muted">{ago(backend.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
