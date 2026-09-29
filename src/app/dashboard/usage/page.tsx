import Link from "next/link";
import UsageRangeTabs from "@/components/console/UsageRangeTabs";
import { EmptyState, InlineAlert, Money, PageHeader, Panel, Stat, StatGrid } from "@/components/console/ui";
import { SpendChart } from "@/components/usage/SpendChart";
import { loadUsage } from "@/lib/console/usage";
import { getConsoleWorkspace } from "@/lib/console/workspace";
import { getBackend } from "@/lib/qrouter/catalog";
import { formatUsd } from "@/lib/qrouter/cost";

export const dynamic = "force-dynamic";
export const metadata = { title: "QRouter Console — Usage" };

const RANGES = { "7d": 7, "30d": 30, "90d": 90 } as const;

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const { range: raw } = await searchParams;
  const range = raw === "7d" || raw === "90d" ? raw : "30d";
  const days = RANGES[range];
  const workspace = await getConsoleWorkspace();
  const usage = await loadUsage(workspace, days);

  return (
    <div className="console-page">
      <PageHeader
        title="Usage"
        description="Spend comes from the credit ledger: completed runs at their billed amount. Failed and cancelled runs are not charged."
        actions={<UsageRangeTabs current={range} />}
      />

      {workspace.mode === "demo" ? (
        <InlineAlert title="Demo workspace">Figures come from runs made in this local session.</InlineAlert>
      ) : null}

      {!usage ? (
        <Panel>
          <EmptyState title="No workspace" body="Your account is not linked to a workspace yet." />
        </Panel>
      ) : (
        <>
          <StatGrid>
            <Stat label={`Spend, last ${days} days`} value={<Money value={usage.spend} />} meta={usage.creditsAdded > 0 ? `${formatUsd(usage.creditsAdded)} credits added` : undefined} />
            <Stat
              label="Runs"
              value={usage.runs.total.toLocaleString()}
              meta={`${usage.runs.completed} completed · ${usage.runs.failed} failed${usage.runs.active ? ` · ${usage.runs.active} in progress` : ""}`}
            />
            <Stat label="Shots" value={usage.shots.toLocaleString()} meta={`${usage.backends.length} backend${usage.backends.length === 1 ? "" : "s"}`} />
            <Stat
              label="Balance"
              value={<Money value={usage.available} />}
              meta={usage.reserved > 0 ? `${formatUsd(usage.reserved)} reserved for runs in progress` : "Nothing reserved"}
              href="/dashboard/billing"
              linkLabel="Billing"
            />
          </StatGrid>

          {usage.runs.needsCredits > 0 ? (
            <InlineAlert
              tone="warning"
              title={`${usage.runs.needsCredits} run${usage.runs.needsCredits === 1 ? " is" : "s are"} waiting for credits`}
              action={<Link href="/dashboard/billing" className="btn btn-secondary btn-sm">Add credits</Link>}
            >
              They start automatically once your balance covers their quotes.
            </InlineAlert>
          ) : null}

          <Panel title="Spend per day" description={`Last ${days} days`}>
            {usage.spend > 0 ? (
              <SpendChart days={usage.days} />
            ) : (
              <EmptyState title="No spend in this period" body="Completed runs appear here at the amount they were billed." action={<Link href="/dashboard/run" className="btn btn-secondary">Run a circuit</Link>} />
            )}
          </Panel>

          <Panel title="By backend" flush>
            <div className="table-wrap">
              <table className="qr-table">
                <thead>
                  <tr>
                    <th>Backend</th>
                    <th className="num">Runs</th>
                    <th className="num hide-sm">Shots</th>
                    <th className="num">Spend</th>
                    <th className="num hide-sm">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.backends.length === 0 ? (
                    <tr><td colSpan={5} className="empty-row">No runs in this period.</td></tr>
                  ) : (
                    usage.backends.map((backend) => (
                      <tr key={backend.id}>
                        <td>
                          <span className="cell-main">
                            <b>{getBackend(backend.id)?.displayName ?? backend.id}</b>
                            <small className="mono">{backend.id}</small>
                          </span>
                        </td>
                        <td className="num">{backend.runs.toLocaleString()}</td>
                        <td className="num hide-sm">{backend.shots.toLocaleString()}</td>
                        <td className="num"><Money value={backend.spend} /></td>
                        <td className="num hide-sm">{usage.spend > 0 ? `${Math.round((backend.spend / usage.spend) * 100)}%` : "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
