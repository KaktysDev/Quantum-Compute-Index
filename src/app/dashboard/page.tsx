import Link from "next/link";
import QciMarketPanel from "@/components/QciMarketPanel";
import { getLatestSnapshot, getProviderSeries, getSeries } from "@/lib/qci/store";
import {
  ArrowRight,
  Braces,
  Check,
  CircleDollarSign,
  Clock3,
  Code2,
  Cpu,
  Gauge,
  KeyRound,
  Network,
  Play,
  Route,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { BACKENDS } from "@/lib/qrouter/catalog";

const snippet = `from qrouter import QRouter

client = QRouter(api_key=os.environ["QCI_API_KEY"])

job = client.jobs.create(
    circuit=open("bell.qasm").read(),
    routing="balanced",
    shots=1024,
)

print(job.wait().counts)`;

export default async function DashboardPage() {
  const [latest, indexSeries, providerSeries] = await Promise.all([
    getLatestSnapshot(),
    getSeries(365),
    getProviderSeries(365),
  ]);
  const providers = new Set(BACKENDS.map((backend) => backend.provider)).size;
  const connected = BACKENDS.filter((backend) => backend.available).length;
  const qpus = BACKENDS.filter((backend) => backend.kind === "qpu").length;

  return (
    <div className="console-page overview-page">
      <div className="console-page-heading overview-heading">
        <div>
          <p className="qr-eyebrow"><span /> Production / API v1</p>
          <h1>Control plane</h1>
          <p>Provider health, routing decisions, execution state, and spend.</p>
        </div>
        <Link href="/dashboard/submit" className="console-primary"><Play size={15} fill="currentColor" /> New task</Link>
      </div>

      <section className="console-status-strip" aria-label="Network status">
        <div><span><Network size={15} /> Provider network</span><strong>{providers}</strong><small>integrations</small></div>
        <div><span><Cpu size={15} /> Compute targets</span><strong>{BACKENDS.length}</strong><small>{qpus} physical QPUs</small></div>
        <div><span><Zap size={15} /> Connected now</span><strong>{connected}</strong><small>ready to receive</small></div>
        <div><span><ShieldCheck size={15} /> Router status</span><strong className="status-word"><i /> Operational</strong><small>all systems normal</small></div>
      </section>

      <QciMarketPanel latest={latest} indexSeries={indexSeries} providerSeries={providerSeries} />

      <div className="overview-grid">
        <section className="console-panel routing-map-panel">
          <div className="panel-title">
            <Route size={16} />
            <div><h2>Routing fabric</h2><small>Live target inventory</small></div>
            <Link href="/dashboard/submit">Open playground <ArrowRight size={13} /></Link>
          </div>
          <div className="router-stage">
            <div className="router-input-node"><Braces size={18} /><span><b>OpenQASM</b><small>Universal input</small></span></div>
            <div className="router-trace"><i /><i /><i /></div>
            <div className="router-core"><Sparkles size={20} /><span>QCI</span><small>ROUTER</small></div>
            <div className="router-trace outgoing"><i /><i /><i /></div>
            <div className="router-targets">
              {BACKENDS.slice(0, 4).map((backend) => (
                <div key={backend.id}><span className={`provider-dot ${backend.kind}`} /><b>{backend.displayName}</b><small>{backend.qubits}q / {backend.queueSeconds < 60 ? `${backend.queueSeconds}s` : `${Math.ceil(backend.queueSeconds / 60)}m`}</small></div>
              ))}
            </div>
          </div>
          <div className="routing-phases">
            <div><span>01</span><Code2 size={15} /><b>Parse</b><small>QASM 2 / 3</small></div>
            <div><span>02</span><ServerCog size={15} /><b>Transpile</b><small>Native gate set</small></div>
            <div><span>03</span><Gauge size={15} /><b>Score</b><small>Cost / queue / fidelity</small></div>
            <div><span>04</span><Play size={15} /><b>Execute</b><small>Normalized results</small></div>
          </div>
        </section>

        <section className="console-panel endpoint-panel">
          <div className="panel-title"><Terminal size={16} /><div><h2>API endpoint</h2><small>Production</small></div><span className="live-chip"><i /> Live</span></div>
          <div className="endpoint-url"><span>POST</span><code>/api/v1/jobs</code></div>
          <pre><code>{snippet}</code></pre>
          <div className="endpoint-footer"><span><KeyRound size={14} /> Bearer authentication</span><Link href="/dashboard/api-keys">Create key <ArrowRight size={13} /></Link></div>
        </section>
      </div>

      <div className="overview-lower-grid">
        <section className="console-panel network-panel">
          <div className="panel-title"><Cpu size={16} /><div><h2>Compute network</h2><small>Provider availability and routing inputs</small></div><span>{BACKENDS.length} targets</span></div>
          <div className="network-head"><span>Backend</span><span>Type</span><span>Capacity</span><span>Queue</span><span>Fidelity</span><span>Status</span></div>
          {BACKENDS.slice(0, 5).map((backend) => (
            <div className="network-row" key={backend.id}>
              <span><i className={`provider-mark ${backend.provider}`}><Cpu size={14} /></i><span><b>{backend.displayName}</b><small>{backend.provider} / {backend.region ?? "global"}</small></span></span>
              <span className="kind-chip">{backend.kind}</span>
              <span>{backend.qubits} qubits</span>
              <span><Clock3 size={12} /> {backend.queueSeconds < 60 ? `${backend.queueSeconds}s` : `${Math.ceil(backend.queueSeconds / 60)}m`}</span>
              <span>{(backend.fidelity * 100).toFixed(1)}%</span>
              <span className={backend.available ? "connected" : "standby"}><i />{backend.available ? "Connected" : "Standby"}</span>
            </div>
          ))}
        </section>

        <aside className="overview-side-stack">
          <section className="console-panel action-panel">
            <div className="panel-title"><Sparkles size={16} /><div><h2>Get production ready</h2><small>Three required steps</small></div></div>
            <Link href="/dashboard/api-keys"><span><Check size={13} /></span><div><b>Issue a secret key</b><small>Authenticate server-side requests</small></div><ArrowRight size={14} /></Link>
            <Link href="/dashboard/submit"><span><Braces size={13} /></span><div><b>Validate a workload</b><small>Route the bundled Bell circuit</small></div><ArrowRight size={14} /></Link>
            <Link href="/dashboard/billing"><span><CircleDollarSign size={13} /></span><div><b>Fund QPU execution</b><small>Credits settle provider costs</small></div><ArrowRight size={14} /></Link>
          </section>
          <section className="console-panel policy-panel">
            <p>Default routing policy</p>
            <div><Route size={17} /><span><b>Balanced</b><small>Cost + queue + fidelity</small></span><Link href="/dashboard/settings">Edit</Link></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
