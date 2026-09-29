import Link from "next/link";
import { notFound } from "next/navigation";
import { Money, PageHeader, Panel, Stat, StatGrid } from "@/components/console/ui";
import { PROVIDER_LABELS } from "@/lib/qrouter/providers";
import { loadPublicRoutingContext } from "@/lib/qrouter/routingContext";
import type { Backend } from "@/lib/qrouter/types";

export const metadata = { title: "QRouter Console — Provider" };

function rate(backend: Backend) {
  if (backend.pricePerNqh != null) return `$${backend.pricePerNqh.toFixed(2)} per QC-hour`;
  const shot = `$${backend.pricePerShot.toFixed(6)} per shot`;
  return backend.pricePerTask ? `$${backend.pricePerTask.toFixed(3)} per task + ${shot}` : shot;
}

function statusBadge(backend: Backend) {
  if (!backend.available) return <span className="status neutral">Not connected</span>;
  if (backend.status === "online") return <span className="status success">Online</span>;
  if (backend.status === "degraded") return <span className="status warning">Degraded</span>;
  return <span className="status danger">Offline</span>;
}

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, context] = await Promise.all([params, loadPublicRoutingContext()]);
  const backend = context.backends.find((item) => item.id === id);
  if (!backend) notFound();
  const snapshotDate = new Date(context.snapshot.ts).toLocaleDateString();

  return (
    <div className="console-page">
      <PageHeader
        crumbs={[{ href: "/dashboard/providers", label: "Providers" }]}
        title={backend.displayName}
        description={<span className="row" style={{ gap: 10, flexWrap: "wrap" }}>{statusBadge(backend)}<span className="muted">{backend.provider} · {backend.kind === "qpu" ? "QPU" : "Simulator"}</span></span>}
        actions={
          <>
            <Link href={`/dashboard/repositories/deployments?target=${backend.id}`} className="btn btn-secondary">Deploy from repository</Link>
            <Link href={`/dashboard/run?route=${encodeURIComponent(PROVIDER_LABELS[backend.provider] ?? backend.provider)}`} className="btn btn-primary">Run on this target</Link>
          </>
        }
      />

      {backend.description ? <p className="muted" style={{ maxWidth: "72ch" }}>{backend.description}</p> : null}

      <StatGrid>
        <Stat label="Qubits" value={backend.qubits.toLocaleString()} meta={`${backend.connectivity} connectivity`} />
        <Stat label="Queue" value={`${backend.queueSeconds}s`} meta="Expected wait" />
        <Stat label="Two-qubit fidelity" value={`${(backend.fidelity * 100).toFixed(2)}%`} />
        <Stat label="Reliability" value={`${(backend.reliability * 100).toFixed(1)}%`} />
      </StatGrid>

      <div className="grid-2">
        <Panel title="Pricing" description={`QCI snapshot ${snapshotDate}. Quotes add transpiler and platform fees.`}>
          <dl className="kv">
            <dt>Billing rate</dt>
            <dd>{rate(backend)}</dd>
            <dt>1,024 shots</dt>
            <dd><Money value={backend.pricePerTask + backend.pricePerShot * 1024} /></dd>
            <dt>Region</dt>
            <dd>{backend.region ?? "Provider cloud"}</dd>
            <dt>Access</dt>
            <dd>{backend.available ? "Included with QRouter credits" : "Requires provider credentials"}</dd>
          </dl>
        </Panel>
        <Panel title="Routing">
          <dl className="kv">
            <dt>Target ID</dt>
            <dd><code>{backend.id}</code></dd>
            <dt>Provider</dt>
            <dd>{backend.provider}</dd>
            <dt>Input</dt>
            <dd>OpenQASM 2, OpenQASM 3 subset</dd>
            <dt>Compilation</dt>
            <dd>Hardware-aware transpilation, optimization levels 0–3</dd>
          </dl>
        </Panel>
      </div>

      <Panel title="Native gates" description={`${backend.nativeGates.length} operations`}>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {backend.nativeGates.map((gate) => <code key={gate}>{gate}</code>)}
        </div>
      </Panel>
    </div>
  );
}
