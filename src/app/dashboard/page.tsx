import GlassCard from "@/components/GlassCard";
import InfoTip from "@/components/InfoTip";
import PriceChart from "@/components/PriceChart";
import PriceDisplay from "@/components/PriceDisplay";
import { getLatestSnapshot, getSeries } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

/** Small freshness badge for a constituent (fresh pull / carried-forward / sample). */
function ConstituentStatus({
  status,
  source,
}: {
  status?: "active" | "stale";
  source: "live" | "sample";
}) {
  const kind = source === "sample" ? "sample" : status === "stale" ? "stale" : "active";
  const meta = {
    active: { label: "Live", dot: "var(--accent)", cls: "text-[var(--accent)]" },
    stale: { label: "Cached", dot: "#f5b544", cls: "text-[#f5b544]" },
    sample: { label: "Sample", dot: "var(--muted-dim)", cls: "text-[var(--muted)]" },
  }[kind];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-sans">
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.dot }}
      />
      <span className={`text-xs ${meta.cls}`}>{meta.label}</span>
    </span>
  );
}

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
            price={latest.vwap}
            changePct={latest.changePct}
            source={latest.source}
            asOf={asOf}
            size="panel"
            label="$ / QC-HR"
            caption="Price of one normalized quantum compute hour"
          />
          <div className="hairline my-6" />
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="flex items-center text-[var(--muted)]">
                Constituents
                <InfoTip title="Constituents">
                  The number of QPUs in the index basket — one representative machine (highest
                  capacity) per connected provider. A broader basket makes the index reflect more of
                  the market.
                </InfoTip>
              </dt>
              <dd className="tabular mt-1 text-lg text-white">{latest.components.length}</dd>
            </div>
            <div>
              <dt className="flex items-center text-[var(--muted)]">
                Source
                <InfoTip title="Source">
                  <b className="text-white">live</b> once a connected provider key produces real
                  metrics; <b className="text-white">sample</b> shows illustrative data until then.
                </InfoTip>
              </dt>
              <dd className="mt-1 text-lg capitalize text-white">{latest.source}</dd>
            </div>
            <div>
              <dt className="flex items-center text-[var(--muted)]">
                QCI index
                <InfoTip title="QCI index level">
                  The chain-linked benchmark level, anchored to <b className="text-white">1,000 at
                  inception</b> (S&amp;P-style). It tracks the VWAP&apos;s day-to-day moves but carries
                  over unchanged when the basket composition changes, so connecting a provider never
                  creates an artificial jump. The headline above is the raw $/hour it&apos;s built on.
                </InfoTip>
              </dt>
              <dd className="tabular mt-1 text-lg text-white">
                {latest.price.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </dd>
            </div>
            <div>
              <dt className="flex items-center text-[var(--muted)]">
                Base level
                <InfoTip title="Base level">
                  The index is anchored to 1,000 at inception (S&amp;P-style). The QCI index above is
                  cumulative price movement of the basket since then.
                </InfoTip>
              </dt>
              <dd className="tabular mt-1 text-lg text-white">1,000.00</dd>
            </div>
          </dl>
        </GlassCard>

        <GlassCard className="p-6 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
              $ / QC-hour
            </h3>
            {latest.source === "sample" && (
              <span className="mono-label rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5">
                sample
              </span>
            )}
          </div>
          <div className="h-[320px] w-full sm:h-[380px]">
            <PriceChart data={series} pollMs={60000} />
          </div>
        </GlassCard>
      </div>

      {/* ── Index constituents breakdown ───────────────────────────────── */}
      <GlassCard className="p-6">
        <h3 className="mb-1 text-sm font-medium uppercase tracking-[0.18em] text-[var(--muted)]">
          Index constituents
        </h3>
        <p className="mb-4 text-xs text-[var(--muted)]">
          Each QPU&apos;s live metrics and how they feed the formula. Hover any{" "}
          <span className="inline-grid h-3.5 w-3.5 place-items-center rounded-full border border-white/25 align-middle text-[9px] font-bold text-[var(--muted)]">
            i
          </span>{" "}
          for what it means and which way it pushes the index.
        </p>

        {!hasComponents ? (
          <p className="py-8 text-center text-sm text-[var(--muted)]">
            Index initializing — awaiting provider data. Add an API key in{" "}
            <span className="text-white">Settings</span> to begin computing the live index.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-[var(--muted)]">
                <tr className="border-b border-white/10">
                  <th className="py-2.5 pr-4 font-medium">Provider</th>
                  <th className="py-2.5 pr-4 font-medium">QPU</th>
                  <th className="py-2.5 pr-4 font-medium">
                    <span className="inline-flex items-center">
                      Status
                      <InfoTip title="Data status">
                        <b className="text-white">Live</b> — metrics pulled fresh this refresh.{" "}
                        <b className="text-white">Cached</b> — the provider&apos;s feed was
                        unavailable, so its last good data is carried forward to keep the price
                        stable until it comes back online. <b className="text-white">Sample</b> —
                        illustrative data (no live key yet).
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      Qubits
                      <InfoTip title="Qubits">
                        Physical qubit count (capacity). Drives the volume weight{" "}
                        <b className="text-white">V = capacity × demand</b> and the Quantum Volume.
                        More qubits → this machine carries more weight in the index.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      QV
                      <InfoTip title="Quantum Volume">
                        Overall scale/capability. Enters PQF as{" "}
                        <b className="text-white">α·(log₂QV / log₂QV_base)</b>. Higher QV → higher
                        PQF → this QPU&apos;s price pulls the index more strongly.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      CLOPS
                      <InfoTip title="CLOPS">
                        Circuit Layer Operations Per Second — speed. Enters PQF as{" "}
                        <b className="text-white">β·(CLOPS / CLOPS_base)</b>. Faster → higher PQF →
                        more weight in the index.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      Fidelity
                      <InfoTip title="2-Qubit Fidelity">
                        Median two-qubit gate fidelity — accuracy. Enters PQF directly as{" "}
                        <b className="text-white">γ·fidelity</b>. Higher fidelity → higher PQF → more
                        weight in the index.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      Error
                      <InfoTip title="2-Qubit Error Rate">
                        Two-qubit gate error = <b className="text-white">1 − fidelity</b>. Not a
                        separate formula input — shown because it&apos;s the intuitive read of
                        quality. Lower error = higher fidelity = higher PQF.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      Price/NQH
                      <InfoTip title="Price per NQH">
                        This QPU&apos;s price for one Normalized Quantum Hour (USD), converted from
                        its native $/shot or $/min. This is the <b className="text-white">P</b> value
                        the index averages — a higher price on a high-weight QPU lifts the index
                        level.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 pr-4 text-right font-medium">
                    <span className="inline-flex items-center">
                      PQF
                      <InfoTip title="Performance Quality Factor">
                        <b className="text-white">
                          PQF = α·(log₂QV/log₂QV_base) + β·(CLOPS/CLOPS_base) + γ·fidelity
                        </b>
                        . The multiplier on this QPU&apos;s weight (V × PQF). A higher PQF makes this
                        machine&apos;s price dominate the weighted average more.
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2.5 text-right font-medium">
                    <span className="inline-flex items-center">
                      Weight
                      <InfoTip title="Index weight (share)">
                        This QPU&apos;s share of the total index weight —{" "}
                        <b className="text-white">(V × PQF) ÷ Σ(V × PQF)</b>. It&apos;s how much this
                        machine&apos;s price drives today&apos;s QCI level.
                      </InfoTip>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {latest.components.map((c, i) => (
                  <tr key={`${c.provider}-${c.qpu}-${i}`} className="border-b border-white/5">
                    <td className="py-2.5 pr-4 font-sans text-white">{c.provider}</td>
                    <td className="py-2.5 pr-4 font-sans text-[var(--muted)]">{c.qpu}</td>
                    <td className="py-2.5 pr-4">
                      <ConstituentStatus status={c.status} source={latest.source} />
                    </td>
                    <td className="py-2.5 pr-4 text-right text-white">
                      {c.capacity ? c.capacity.toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-white">
                      {c.qv ? c.qv.toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-white">
                      {c.clops ? c.clops.toLocaleString() : "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-[var(--muted)]">
                      {(c.fid2q * 100).toFixed(2)}%
                    </td>
                    <td className="py-2.5 pr-4 text-right text-[var(--muted)]">
                      {((1 - c.fid2q) * 100).toFixed(2)}%
                    </td>
                    <td className="py-2.5 pr-4 text-right text-white">
                      ${c.pricePerNqh.toLocaleString()}
                    </td>
                    <td className="py-2.5 pr-4 text-right text-white">{c.pqf.toFixed(3)}</td>
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
