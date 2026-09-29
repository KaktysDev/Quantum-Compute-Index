import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { RecentActivity } from "@/components/activity/RecentActivity";
import { UploadCircuitButton } from "@/components/circuits/UploadCircuitDialog";
import { InlineAlert, Money, PageHeader, Panel, Stat, StatGrid } from "@/components/console/ui";
import { loadUsage } from "@/lib/console/usage";
import { getConsoleWorkspace } from "@/lib/console/workspace";
import { formatUsd } from "@/lib/qrouter/cost";
import { resolveProviderLabel } from "@/lib/qrouter/providers";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";

export const dynamic = "force-dynamic";
export const metadata = { title: "QRouter Console — Overview" };

const STEPS = [
  { title: "Create an API key", body: "Authenticate the SDK, CLI or plain HTTP.", href: "/dashboard/api-keys", cta: "API keys" },
  { title: "Run a circuit", body: "Describe it to the assistant or paste OpenQASM.", href: "/dashboard/run", cta: "Run" },
  { title: "Connect a repository", body: "Deploy commit-pinned circuits from GitHub.", href: "/dashboard/repositories", cta: "Repositories" },
];

function formatQueue(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ route?: string }> }) {
  // Old provider links carry `?route=`; they open the assistant with it preselected.
  const { route } = await searchParams;
  if (route) {
    const provider = resolveProviderLabel(route);
    redirect(provider ? `/dashboard/run?route=${encodeURIComponent(provider)}` : "/dashboard/run");
  }

  const workspace = await getConsoleWorkspace();
  const [usage, routing] = await Promise.all([
    loadUsage(workspace, 30),
    loadPublicRoutingContext().catch(() => null),
  ]);
  const backends = (routing?.backends ?? [])
    .slice()
    .sort((a, b) => Number(b.available) - Number(a.available) || a.displayName.localeCompare(b.displayName))
    .slice(0, 8);
  const fresh = usage ? usage.runs.total === 0 : true;

  return (
    <div className="console-page">
      <PageHeader
        title="Overview"
        actions={
          <>
            <UploadCircuitButton variant="secondary" />
            <Link href="/dashboard/run" className="btn btn-primary">Run a circuit</Link>
          </>
        }
      />

      {usage && usage.runs.needsCredits > 0 ? (
        <InlineAlert
          tone="warning"
          title={`${usage.runs.needsCredits} run${usage.runs.needsCredits === 1 ? " is" : "s are"} waiting for credits`}
          action={<Link href="/dashboard/billing" className="btn btn-secondary btn-sm">Add credits</Link>}
        >
          They start automatically once your balance covers their quotes.
        </InlineAlert>
      ) : null}

      <StatGrid>
        <Stat label="Credit balance" value={<Money value={usage?.available ?? null} />} meta={usage && usage.reserved > 0 ? `${formatUsd(usage.reserved)} reserved` : "Available to spend"} href="/dashboard/billing" linkLabel="Billing" />
        <Stat label="Spend, last 30 days" value={<Money value={usage?.spend ?? null} />} href="/dashboard/usage" linkLabel="Usage" />
        <Stat label="In progress" value={(usage?.runs.active ?? 0).toLocaleString()} meta={`${(usage?.runs.total ?? 0).toLocaleString()} runs in the last 30 days`} />
        <Stat label="Needs credits" value={(usage?.runs.needsCredits ?? 0).toLocaleString()} tone={usage && usage.runs.needsCredits > 0 ? "warning" : undefined} meta="Parked until a top-up" />
      </StatGrid>

      {fresh ? (
        <Panel title="Get started">
          <ol className="steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="steps-index">{index + 1}</span>
                <div>
                  <b>{step.title}</b>
                  <p>{step.body}</p>
                </div>
                <Link href={step.href} className="btn btn-secondary btn-sm">{step.cta}</Link>
              </li>
            ))}
          </ol>
        </Panel>
      ) : null}

      <Panel
        title="Recent activity"
        flush
        actions={<Link href="/dashboard/activity" className="btn btn-ghost btn-sm">View all <ArrowRight size={13} /></Link>}
      >
        <RecentActivity />
      </Panel>

      <Panel
        title="Backends"
        description="Live status and list prices used for quotes."
        flush
        actions={<Link href="/dashboard/providers" className="btn btn-ghost btn-sm">All providers <ArrowRight size={13} /></Link>}
      >
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr>
                <th>Backend</th>
                <th>Status</th>
                <th className="num hide-sm">Qubits</th>
                <th className="num hide-sm">Queue</th>
                <th className="num">1,024 shots</th>
              </tr>
            </thead>
            <tbody>
              {backends.length === 0 ? (
                <tr><td colSpan={5} className="empty-row">Backend status is unavailable.</td></tr>
              ) : (
                backends.map((backend) => (
                  <tr key={backend.id}>
                    <td>
                      <Link href={`/dashboard/providers/${backend.id}`} className="cell-main">
                        <b>{backend.displayName}</b>
                        <small>{backend.provider} · {backend.kind === "qpu" ? "QPU" : "Simulator"}</small>
                      </Link>
                    </td>
                    <td>
                      {!backend.available ? (
                        <span className="status neutral">Not connected</span>
                      ) : backend.status === "online" ? (
                        <span className="status success">Online</span>
                      ) : backend.status === "degraded" ? (
                        <span className="status warning">Degraded</span>
                      ) : (
                        <span className="status danger">Offline</span>
                      )}
                    </td>
                    <td className="num hide-sm">{backend.qubits.toLocaleString()}</td>
                    <td className="num hide-sm">{formatQueue(backend.queueSeconds)}</td>
                    <td className="num"><Money value={backend.pricePerTask + backend.pricePerShot * 1024} /></td>
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
