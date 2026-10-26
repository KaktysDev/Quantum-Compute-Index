import Link from "next/link";
import nextDynamic from "next/dynamic";
import { ArrowRight, Cpu, Route, Terminal } from "lucide-react";
import QciSeriesPanel from "@/components/QciSeriesPanel";
import { getQciView } from "@/lib/qci/v2/store";

const QciMap = nextDynamic(() => import("@/components/QciMap"));

export const dynamic = "force-dynamic";

const money = (v: number, dp = 0) =>
  v.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** "3 hours ago" / "today" — relative, because the reader cares about staleness. */
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
  // This tab is pure v2. The legacy market panel used to sit below the map, but
  // it falls back to a seeded pseudo-random walk when it has no data and draws
  // it as history — the exact behaviour this rewrite exists to remove.
  const v2 = await getQciView(365);
  const latest = v2.latest;

  const providers = latest ? new Set(latest.devices.map((d) => d.provider)).size : 0;
  const up = (latest?.changePct ?? 0) >= 0;
  const flat = Math.abs(latest?.changePct ?? 0) < 0.00005;

  return (
    <div className="console-page qci-page">
      <div className="console-page-heading"><div><p className="qr-eyebrow">Research</p><h1>Quantum Compute Index</h1><p>An experimental basket of published rates and hardware proxies.</p></div><Link href="/dashboard/experiments" className="console-primary">Open experiments <ArrowRight size={14} /></Link></div>
      <div className="console-note"><strong>Research model.</strong> This aggregate is not a job quote, a transaction benchmark, or a measure of algorithm success. Device capability and production-cost figures include modelling assumptions. Use your experiment’s quote and measured results for execution decisions.</div>
      {latest ? (
        /* The hero carries four facts and one number. Everything that used to
           sit here as permanent body copy — the methodology sentence, the
           per-stat captions — is now either a hover or a click away, because a
           reader who returns to this page daily does not need the paragraph and
           a reader arriving for the first time gets it from the map below. */
        <header className="qci-hero">
          <p className="qci-hero-eyebrow">Research index level</p>
          <div className="qci-hero-line">
            <h1>
              {money(latest.level, 2)}
            </h1>
            <span className="qci-hero-unit">1,000 at inception</span>
            <span
              className="qci-hero-change"
              data-dir={latest.inception ? "new" : flat ? "flat" : up ? "up" : "down"}
            >
              {latest.inception
                ? "baseline"
                : flat
                  ? "unchanged"
                  : `${up ? "▲" : "▼"} ${Math.abs(latest.changePct).toFixed(2)}%`}
            </span>
          </div>

          <dl className="qci-hero-stats qci-card">
            <div>
              <dt>Basket hourly rate</dt>
              <dd>${money(latest.usdPerQpuHour)}</dd>
              <small>published rate aggregate</small>
            </div>
            <div>
              <dt>Machines</dt>
              <dd>{latest.devices.length}</dd>
              <small>across {providers} providers</small>
            </div>
            <div>
              <dt>Snapshot recorded</dt>
              <dd>{since(latest.ts)}</dd>
              <small>{new Date(latest.ts).toISOString().slice(0, 10)}</small>
            </div>
          </dl>
        </header>
      ) : (
        <header className="qci-hero">
          <p className="qci-hero-eyebrow">Research index level</p>
          <div className="qci-hero-line">
            <h1 className="qci-hero-empty">Awaiting the first measurement</h1>
          </div>
          <p className="qci-hero-note">{v2.emptyReason}</p>
        </header>
      )}

      {latest ? (
        <QciMap point={latest} />
      ) : (
        <section className="qci-map-panel">
          <header className="qci-sec-head">
            <div>
              <h2>Research basket</h2>
              <p>No research basket is drawn until a stored observation exists.</p>
            </div>
          </header>
          <div className="qci-empty">
            <h3>No index points yet</h3>
            <p>{v2.emptyReason}</p>
            <p>
              No stored research snapshot is available. Experiment execution and quotes do not require a public index history.
            </p>
          </div>
        </section>
      )}

      <QciSeriesPanel series={v2.series} hasData={v2.hasData} emptyReason={v2.emptyReason} />

      <nav className="qci-console-links" aria-label="Console system views">
        <Link href="/dashboard/routing">
          <Route size={15} />
          <span>
            <b>Execution targets</b>
            <small>Inspect configured backend availability</small>
          </span>
          <ArrowRight size={13} />
        </Link>
        <Link href="/dashboard/api-keys">
          <Terminal size={15} />
          <span>
            <b>API endpoint</b>
            <small>Keys and request contracts</small>
          </span>
          <ArrowRight size={13} />
        </Link>
        <Link href="/dashboard/providers">
          <Cpu size={15} />
          <span>
            <b>Compute network</b>
            <small>Provider integration and capability details</small>
          </span>
          <ArrowRight size={13} />
        </Link>
      </nav>
    </div>
  );
}
