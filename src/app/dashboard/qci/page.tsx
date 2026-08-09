import Link from "next/link";
import { ArrowRight, Cpu, Network, Play, Route, ShieldCheck, Terminal, Zap } from "lucide-react";
import QciMap from "@/components/QciMap";
import QciSeriesPanel from "@/components/QciSeriesPanel";
import { getQciView } from "@/lib/qci/v2/store";
import { BACKENDS } from "@/lib/qrouter/catalog";

export default async function QciPage() {
  // This tab is pure v2. The legacy market panel used to sit below the map, but
  // it falls back to a seeded pseudo-random walk when it has no data and draws
  // it as history — the exact behaviour this rewrite exists to remove. It is
  // still used by the landing and pricing pages, which have not been migrated.
  const v2 = await getQciView(365);

  const providers = new Set(BACKENDS.map((backend) => backend.provider)).size;
  const connected = BACKENDS.filter((backend) => backend.available).length;
  const qpus = BACKENDS.filter((backend) => backend.kind === "qpu").length;

  return (
    <div className="console-page overview-page">
      <div className="console-page-heading overview-heading">
        <div>
          <p className="qr-eyebrow">
            <span /> QCI / USD PER QPU-HOUR
          </p>
          <h1>Quantum Compute Index</h1>
          <p>
            Quality-adjusted price of one hour of quantum compute, chain-linked daily across the
            provider market.
          </p>
        </div>
        <Link href="/dashboard/github/deploy" className="console-primary">
          <Play size={14} fill="currentColor" /> New deployment
        </Link>
      </div>

      <section className="console-status-strip" aria-label="Index status">
        <div>
          <span>
            <Network size={15} /> Constituents
          </span>
          <strong>{v2.latest ? v2.latest.devices.length : providers}</strong>
          <small>{v2.latest ? `${v2.latest.matched} matched today` : "configured adapters"}</small>
        </div>
        <div>
          <span>
            <Cpu size={15} /> Catalog targets
          </span>
          <strong>{BACKENDS.length}</strong>
          <small>{qpus} physical QPU records</small>
        </div>
        <div>
          <span>
            <Zap size={15} /> Routable now
          </span>
          <strong>{connected}</strong>
          <small>configured targets</small>
        </div>
        <div>
          <span>
            <ShieldCheck size={15} /> Index status
          </span>
          <strong>
            {v2.latest ? (v2.latest.status === "final" ? "Final" : "Provisional") : "Awaiting data"}
          </strong>
          <small>
            {v2.latest
              ? `${Math.round(v2.latest.coverage * 100)}% basket coverage`
              : "no points recorded yet"}
          </small>
        </div>
      </section>

      {v2.latest ? (
        <QciMap point={v2.latest} />
      ) : (
        <section className="console-panel qci-map-panel">
          <div className="panel-title">
            <Network size={16} />
            <div>
              <h2>Index attribution map</h2>
              <small>What the QCI is made of, and where every number comes from</small>
            </div>
          </div>
          <div className="qci-empty">
            <h3>No index points yet</h3>
            <p>{v2.emptyReason}</p>
            <p>
              Apply <code>supabase/qci-v2.sql</code>, then trigger a refresh from Settings or{" "}
              <code>POST /api/cron/refresh</code>. Nothing is shown here until real observations
              exist — the index never renders synthetic history.
            </p>
          </div>
        </section>
      )}

      <QciSeriesPanel series={v2.series} hasData={v2.hasData} emptyReason={v2.emptyReason} />

      <nav className="qci-console-links" aria-label="Console system views">
        <Link href="/dashboard/routing">
          <Route size={15} />
          <span>
            <b>Routing fabric</b>
            <small>Policy, constraints, and candidate scoring</small>
          </span>
          <ArrowRight size={13} />
        </Link>
        <Link href="/dashboard/api-keys">
          <Terminal size={15} />
          <span>
            <b>API endpoint</b>
            <small>Authentication and request contracts</small>
          </span>
          <ArrowRight size={13} />
        </Link>
        <Link href="/dashboard/providers">
          <Cpu size={15} />
          <span>
            <b>Compute network</b>
            <small>Providers, queues, fidelity, and rates</small>
          </span>
          <ArrowRight size={13} />
        </Link>
      </nav>
    </div>
  );
}
