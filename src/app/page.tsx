import Link from "next/link";
import {
  ArrowRight,
  Braces,
  Check,
  Cpu,
  Gauge,
  Route,
  ShieldCheck,
  Timer,
} from "lucide-react";
import Logo from "@/components/Logo";
import LaunchConsole from "@/components/LaunchConsole";
import { BACKENDS } from "@/lib/qrouter/catalog";
import { getLatestSnapshot } from "@/lib/qci/store";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: Braces, n: "01", t: "Submit", d: "Send OpenQASM through one stable endpoint." },
  { icon: Gauge, n: "02", t: "Analyze", d: "Measure depth, gates, qubits, and task complexity." },
  { icon: Route, n: "03", t: "Route", d: "Balance price, queue, fidelity, and constraints." },
  { icon: Cpu, n: "04", t: "Execute", d: "Run on the selected physical or simulated core." },
];

export default async function LandingPage() {
  const latest = await getLatestSnapshot();
  const qpuCount = BACKENDS.filter((b) => b.kind === "qpu").length;

  return (
    <main className="qr-landing">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="qr-hero">
        <header className="qr-public-nav">
          <Link href="/" aria-label="QRouter home">
            <Logo size={26} />
          </Link>
          <nav>
            <a href="#network">Network</a>
            <a href="#workflow">How it works</a>
            <a href="/openapi.json">API</a>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <Link href="/dashboard" className="qr-nav-console">
            Console <ArrowRight size={14} />
          </Link>
        </header>

        <div className="qr-hero-copy">
          <p className="qr-live">
            <span />
            Quantum routing network online
          </p>
          <h1>
            One API for the world&apos;s
            <br />
            <span className="qr-accent-text">quantum computers.</span>
          </h1>
          <p className="qr-hero-body">
            Ship OpenQASM once. QRouter transpiles, prices, and routes every workload to the
            right QPU or GPU simulator — with a single key and live QCI pricing.
          </p>
          <div className="qr-hero-actions">
            <LaunchConsole />
            <a href="/openapi.json" className="qr-ghost-btn">
              Read the API <ArrowRight size={15} />
            </a>
          </div>
          <div className="qr-proof">
            <span><Check size={14} />One API key</span>
            <span><Check size={14} />Live QCI pricing</span>
            <span><Check size={14} />Automatic routing</span>
          </div>
        </div>

        <div className="qr-hero-stats">
          <div>
            <span>QCI / USD</span>
            <strong>${latest.price.toFixed(2)}</strong>
            <em className={latest.changePct >= 0 ? "positive" : "negative"}>
              {latest.changePct >= 0 ? "+" : ""}
              {latest.changePct.toFixed(2)}%
            </em>
          </div>
          <div>
            <span>Connected targets</span>
            <strong>{BACKENDS.length}</strong>
            <em>{qpuCount} QPUs</em>
          </div>
          <div>
            <span>Universal IR</span>
            <strong>OpenQASM</strong>
            <em>2.0 + 3.0</em>
          </div>
        </div>
      </section>

      {/* ── Provider strip ───────────────────────────────────── */}
      <section className="qr-trust">
        <p>One endpoint routes to</p>
        <div className="qr-trust-row">
          {Array.from(new Set(BACKENDS.map((b) => b.provider))).slice(0, 8).map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      </section>

      {/* ── Workflow ─────────────────────────────────────────── */}
      <section id="workflow" className="qr-band qr-workflow">
        <div className="qr-section-intro">
          <p className="qr-eyebrow">The execution layer</p>
          <h2>
            From circuit to result,
            <br />
            without provider glue.
          </h2>
        </div>
        <div className="qr-flow-line">
          {STEPS.map((x) => (
            <article key={x.n}>
              <div>
                <x.icon size={20} />
                <span>{x.n}</span>
              </div>
              <h3>{x.t}</h3>
              <p>{x.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ── Network ──────────────────────────────────────────── */}
      <section id="network" className="qr-band qr-network">
        <div className="qr-section-intro split">
          <div>
            <p className="qr-eyebrow">Live backend catalog</p>
            <h2>
              Every architecture.
              <br />
              One control plane.
            </h2>
          </div>
          <p>
            Pin a backend when you need control, or let QRouter choose the best eligible target
            for every workload.
          </p>
        </div>
        <div className="qr-backend-table">
          <div className="qr-table-head">
            <span>Backend</span>
            <span>Architecture</span>
            <span>Qubits</span>
            <span>Queue</span>
            <span>Fidelity</span>
            <span>Status</span>
          </div>
          {BACKENDS.slice(0, 6).map((b) => (
            <div className="qr-table-row" key={b.id}>
              <span>
                <i className={`provider-dot ${b.kind}`} />
                <b>{b.displayName}</b>
                <small>{b.provider}</small>
              </span>
              <span>{b.description}</span>
              <span>{b.qubits}</span>
              <span>{b.queueSeconds < 60 ? `${b.queueSeconds}s` : `${Math.ceil(b.queueSeconds / 60)}m`}</span>
              <span>{(b.fidelity * 100).toFixed(1)}%</span>
              <span className={b.available ? "online" : "standby"}>
                {b.available ? "Connected" : "Ready"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Developer ────────────────────────────────────────── */}
      <section className="qr-band qr-developer">
        <div className="qr-code-window">
          <div className="qr-code-bar">
            <span />
            <span />
            <span />
            <em>submit.py</em>
          </div>
          <pre>
            <code>{`from qrouter import QRouter

client = QRouter(api_key="qci_live_...")

job = client.jobs.create(
    circuit=open("bell.qasm").read(),
    routing="balanced",
    max_cost=2.00,
)

print(job.result())`}</code>
          </pre>
        </div>
        <div className="qr-developer-copy">
          <p className="qr-eyebrow">Built for production</p>
          <h2>
            Quantum compute
            <br />
            that feels like an API.
          </h2>
          <p>No provider SDK matrix. No manual queue watching. No separate billing accounts.</p>
          <ul>
            <li><ShieldCheck size={18} />Scoped, revocable API keys</li>
            <li><Timer size={18} />Async jobs and signed webhooks</li>
            <li><Gauge size={18} />Fixed quotes before execution</li>
          </ul>
          <Link href="/dashboard" className="qr-text-cta">
            Open the console <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── Closing ──────────────────────────────────────────── */}
      <section className="qr-final">
        <p className="qr-eyebrow">The quantum cloud starts here</p>
        <h2>One key. Every core.</h2>
        <LaunchConsole />
      </section>

      <footer className="qr-footer">
        <Logo />
        <p>QCI routing infrastructure · Chicago, IL</p>
        <span>© 2026 QuantumForge</span>
      </footer>
    </main>
  );
}
