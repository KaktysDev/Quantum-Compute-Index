import Link from "next/link";
import QciMap from "@/components/QciMap";
import QciSeriesPanel from "@/components/QciSeriesPanel";
import { EmptyState, PageHeader, Panel, Stat, StatGrid } from "@/components/console/ui";
import { getQciView } from "@/lib/qci/v2/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "QRouter Console — QCI Index" };

const money = (value: number, dp = 0) => value.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

function since(ts: string): string {
  const ms = Date.now() - Date.parse(ts);
  if (!Number.isFinite(ms)) return "—";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default async function QciPage() {
  // Pure v2 index. Nothing synthetic is drawn when there is no data.
  const v2 = await getQciView(365);
  const latest = v2.latest;
  const providers = latest ? new Set(latest.devices.map((device) => device.provider)).size : 0;
  const change = latest?.changePct ?? 0;
  const flat = Math.abs(change) < 0.00005;

  return (
    <div className="console-page wide qci-page">
      <PageHeader
        title="QCI Index"
        description={
          <>
            The market price of one QPU-hour across providers, measured daily. The rates your runs are quoted at are on{" "}
            <Link href="/dashboard/providers" className="link-btn">Providers</Link>.
          </>
        }
        actions={<Link href="/docs#qci" className="btn btn-ghost">Methodology</Link>}
      />

      {latest ? (
        <>
          <StatGrid>
            <Stat
              label="Price per QPU-hour"
              value={`$${money(latest.usdPerQpuHour)}`}
              meta={
                latest.inception ? "Baseline" : flat ? "Unchanged" : (
                  <span className={change >= 0 ? "qci-up" : "qci-down"}>{change >= 0 ? "+" : "−"}{Math.abs(change).toFixed(2)}% since last point</span>
                )
              }
            />
            <Stat label="Index level" value={money(latest.level, 2)} meta="1,000 at inception" />
            <Stat label="Machines" value={latest.devices.length.toLocaleString()} meta={`Across ${providers} providers`} />
            {latest.costBasisPerHour ? (
              <Stat
                label="Cost to produce"
                value={`$${money(latest.costBasisPerHour)}`}
                meta={latest.costCoverageRatio ? `Price is ${latest.costCoverageRatio.toFixed(1)}× cost` : "Modelled, per hour"}
              />
            ) : null}
            <Stat label="Last measured" value={since(latest.ts)} meta={new Date(latest.ts).toISOString().slice(0, 10)} />
          </StatGrid>
          <QciMap point={latest} />
        </>
      ) : (
        <Panel>
          <EmptyState
            title="No index points yet"
            body={<>{v2.emptyReason} The index never draws synthetic history, so an empty panel means nothing has been measured yet.</>}
          />
        </Panel>
      )}

      <QciSeriesPanel series={v2.series} hasData={v2.hasData} emptyReason={v2.emptyReason} />
    </div>
  );
}
