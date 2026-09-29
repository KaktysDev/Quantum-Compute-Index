import Link from "next/link";
import { InlineAlert, Money, Panel, Stat, StatGrid } from "@/components/console/ui";
import { requireAdmin } from "@/lib/admin";
import { getLatestPoint } from "@/lib/qci/v2/store";
import { isSettled } from "@/lib/qrouter/status";

export const dynamic = "force-dynamic";

function backendStatus(status: string) {
  if (status === "online") return <span className="status success">Online</span>;
  if (status === "degraded") return <span className="status warning">Degraded</span>;
  return <span className="status danger">Offline</span>;
}

export default async function AdminOverviewPage() {
  const { supabase } = await requireAdmin();

  const [
    { count: userCount },
    { data: jobRows },
    { data: ledgerRows },
    { data: creditRows },
    { data: backendRows },
    { count: openReports },
    { count: unreadContacts },
    latest,
  ] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("jobs").select("status, selected_backend_id, created_at").order("created_at", { ascending: false }).limit(2000),
    supabase.from("ledger_entries").select("type, amount"),
    supabase.from("credit_accounts").select("available, reserved"),
    supabase.from("backends").select("id, provider, display_name, status, kind, queue_seconds, updated_at"),
    supabase.from("user_reports").select("id", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("read", false),
    getLatestPoint(),
  ]);

  const jobs = jobRows ?? [];
  const completed = jobs.filter((job) => job.status === "completed").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  const inFlight = jobs.filter((job) => !isSettled(job.status)).length;
  const needsCredits = jobs.filter((job) => job.status === "awaiting_payment").length;

  const backendById = new Map((backendRows ?? []).map((backend) => [backend.id, backend]));
  const providerUse = jobs.reduce<Record<string, number>>((acc, job) => {
    if (!job.selected_backend_id) return acc;
    const provider = backendById.get(job.selected_backend_id)?.provider ?? job.selected_backend_id;
    acc[provider] = (acc[provider] ?? 0) + 1;
    return acc;
  }, {});
  const providerRanking = Object.entries(providerUse).sort((a, b) => b[1] - a[1]);

  const purchased = (ledgerRows ?? []).filter((row) => row.type === "purchase").reduce((sum, row) => sum + Number(row.amount), 0);
  const charged = (ledgerRows ?? []).filter((row) => row.type === "charge").reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0);
  const outstanding = (creditRows ?? []).reduce((sum, row) => sum + Number(row.available) + Number(row.reserved), 0);

  const staleDevices = (latest?.devices ?? []).filter((device) => !device.fresh).map((device) => device.device);
  const snapshotAge = latest ? Math.round((Date.now() - new Date(latest.ts).getTime()) / 3_600_000) : null;

  return (
    <div className="stack">
      <StatGrid>
        <Stat label="Users" value={(userCount ?? 0).toLocaleString()} meta="Registered accounts" />
        <Stat label="Jobs, latest 2,000" value={jobs.length.toLocaleString()} meta={`${completed} completed · ${failed} failed · ${inFlight} in progress${needsCredits ? ` · ${needsCredits} need credits` : ""}`} />
        <Stat label="Credits purchased" value={<Money value={purchased} />} meta={<>Charged <Money value={charged} /> · <Money value={outstanding} /> outstanding</>} />
        <Stat label="Open tickets" value={((openReports ?? 0) + (unreadContacts ?? 0)).toLocaleString()} meta={`${openReports ?? 0} support · ${unreadContacts ?? 0} unread contact`} href="/dashboard/admin/reports" linkLabel="Reports" />
      </StatGrid>

      <div className="grid-2">
        <Panel title="QCI index" actions={<Link href="/dashboard/admin/health" className="btn btn-ghost btn-sm">Health</Link>}>
          <dl className="kv">
            <dt>Price per QPU-hour</dt>
            <dd><Money value={latest?.usdPerQpuHour ?? null} /></dd>
            <dt>Index level</dt>
            <dd className="num">{latest ? latest.level.toFixed(2) : "—"}</dd>
            <dt>Status</dt>
            <dd>
              {!latest ? (
                <span className="status neutral">No data</span>
              ) : latest.inception ? (
                <span className="status success">Inception</span>
              ) : latest.status === "final" ? (
                <span className="status success">Final</span>
              ) : (
                <span className="status warning">{latest.status}</span>
              )}
            </dd>
            <dt>Last update</dt>
            <dd>{latest ? `${new Date(latest.ts).toLocaleString()} (${snapshotAge}h ago)` : "—"}</dd>
          </dl>
          {snapshotAge != null && snapshotAge > 30 ? (
            <div style={{ marginTop: 16 }}><InlineAlert tone="warning">The last point is over 30 hours old. The daily refresh may be failing.</InlineAlert></div>
          ) : null}
          {staleDevices.length ? (
            <p className="muted" style={{ marginTop: 12 }}>Carried forward: {staleDevices.join(", ")}</p>
          ) : null}
          {!latest ? <p className="muted" style={{ marginTop: 12 }}>No index point yet. Run a refresh from Health.</p> : null}
        </Panel>

        <Panel title="Backends" flush>
          <div className="table-wrap">
            <table className="qr-table">
              <thead>
                <tr><th>Backend</th><th>Status</th><th className="num hide-sm">Queue</th></tr>
              </thead>
              <tbody>
                {(backendRows ?? []).length === 0 ? (
                  <tr><td colSpan={3} className="empty-row">No backends recorded.</td></tr>
                ) : (
                  (backendRows ?? []).map((backend) => (
                    <tr key={backend.id}>
                      <td>
                        <span className="cell-main">
                          <b>{backend.display_name}</b>
                          <small>{backend.provider} · {backend.kind}</small>
                        </span>
                      </td>
                      <td>{backendStatus(backend.status)}</td>
                      <td className="num hide-sm">{backend.queue_seconds != null ? `${backend.queue_seconds}s` : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Provider usage" description="All workspaces, latest 2,000 jobs." flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr><th>Provider</th><th className="num">Jobs</th><th className="num">Share</th></tr>
            </thead>
            <tbody>
              {providerRanking.length === 0 ? (
                <tr><td colSpan={3} className="empty-row">No routed jobs yet.</td></tr>
              ) : (
                providerRanking.map(([provider, count]) => (
                  <tr key={provider}>
                    <td>{provider}</td>
                    <td className="num">{count.toLocaleString()}</td>
                    <td className="num">{Math.round((count / jobs.length) * 100)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
