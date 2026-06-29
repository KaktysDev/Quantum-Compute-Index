import GlassCard from "@/components/GlassCard";
import PriceChart from "@/components/PriceChart";
import PriceDisplay from "@/components/PriceDisplay";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

export default async function DashboardOverview() {
  const [latest, series] = await Promise.all([getLatestSnapshot(), getSeries(180)]);

  const asOf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(latest.ts))
    .toUpperCase();

  const hasComponents = latest.components.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <GlassCard className="p-6 lg:col-span-1">
          <PriceDisplay
            price={latest.price}
            changePct={latest.changePct}
            source={latest.source}
            asOf={asOf}
            size="panel"
          />
          <div className="hairline my-6" />
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[var(--muted)]">Constituents</dt>
              <dd className="tabular mt-1 text-lg text-white">{latest.components.length}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Source</dt>
              <dd className="mt-1 text-lg capitalize text-white">{latest.source}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">VWAP (USD/NQH)</dt>
              <dd className="tabular mt-1 text-lg text-white">
                {latest.vwap ? latest.vwap.toLocaleString() : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Base level</dt>
              <dd className="tabular mt-1 text-lg text-white">1,000.00</dd>
            </div>
          </dl>
        </GlassCard>

        <GlassCard className="p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              QCI · trailing 180 days
            </h3>
            {latest.source === "sample" && (
              <span className="mono-label rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5">
                sample
              </span>
            )}
          </div>
          <div className="h-[320px] w-full sm:h-[380px]">
            <PriceChart data={series} />
          </div>
        </GlassCard>
      </div>

      {/* ── Index constituents breakdown ───────────────────────────────── */}
      <GlassCard className="p-6">
        <h3 className="mb-4 text-sm font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
          Index constituents
        </h3>

        {!hasComponents ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            Index initializing — awaiting provider data. Add an API key in{" "}
            <span className="text-white">Settings</span> to begin computing the live index.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-[var(--muted)]">
                <tr className="border-b border-white/10">
                  <th className="py-2.5 pr-4 font-medium">Provider</th>
                  <th className="py-2.5 pr-4 font-medium">QPU</th>
                  <th className="py-2.5 pr-4 text-right font-medium">PQF</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Price/NQH</th>
                  <th className="py-2.5 pr-4 text-right font-medium">Fidelity</th>
                  <th className="py-2.5 text-right font-medium">Weight</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {latest.components.map((c, i) => (
                  <tr key={`${c.provider}-${c.qpu}-${i}`} className="border-b border-white/5">
                    <td className="py-2.5 pr-4 font-sans text-white">{c.provider}</td>
                    <td className="py-2.5 pr-4 font-sans text-[var(--muted)]">{c.qpu}</td>
                    <td className="py-2.5 pr-4 text-right text-white">{c.pqf.toFixed(3)}</td>
                    <td className="py-2.5 pr-4 text-right text-white">
                      ${c.pricePerNqh.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-[var(--muted)]">
                      {(c.fid2q * 100).toFixed(2)}%
                    </td>
                    <td className="py-2.5 text-right text-[var(--accent)]">
                      {(c.share * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
