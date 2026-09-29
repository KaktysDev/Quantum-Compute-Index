import Link from "next/link";
import { ArrowRight } from "lucide-react";
import RoutingDiagram from "@/components/routing/RoutingDiagram";
import { PageHeader, Panel } from "@/components/console/ui";
import { ROUTABLE_PROVIDERS } from "@/lib/qrouter/providers";
import { routingWeights } from "@/lib/qrouter/route";
import type { RoutingMode } from "@/lib/qrouter/types";

export const metadata = { title: "QRouter Console — Routing" };

const TARGETS = ROUTABLE_PROVIDERS.map((name) => ({
  name,
  href: `/dashboard/run?route=${encodeURIComponent(name)}`,
}));

const MODES: Array<{ mode: RoutingMode; summary: string }> = [
  { mode: "balanced", summary: "Default. Weighs price, queue time and hardware quality evenly." },
  { mode: "cost", summary: "Cheapest compatible backend that meets your constraints." },
  { mode: "speed", summary: "Shortest expected queue." },
  { mode: "quality", summary: "Highest fidelity and reliability." },
];

const pct = (value: number) => `${Math.round(value * 100)}%`;

export default function RoutingPage() {
  return (
    <div className="console-page">
      <PageHeader
        title="Routing"
        description="Every request is analyzed, priced against each compatible backend, and sent to the best match for the routing mode you choose."
        actions={
          <Link className="btn btn-primary" href="/dashboard/run">
            Run a circuit <ArrowRight size={14} />
          </Link>
        }
      />

      <Panel title="How a request is routed" description="Select a provider to start a run pinned to it.">
        <div className="routing-figure">
          <RoutingDiagram providers={TARGETS} />
        </div>
      </Panel>

      <Panel title="Routing modes" description="Scores are normalized across the compatible candidates for each request." flush>
        <div className="table-wrap">
          <table className="qr-table">
            <thead>
              <tr>
                <th>Mode</th>
                <th className="hide-sm">Behavior</th>
                <th className="num">Cost</th>
                <th className="num">Speed</th>
                <th className="num">Quality</th>
                <th className="num">Reliability</th>
              </tr>
            </thead>
            <tbody>
              {MODES.map(({ mode, summary }) => {
                const weights = routingWeights(mode);
                return (
                  <tr key={mode}>
                    <td><code>{mode}</code></td>
                    <td className="hide-sm muted">{summary}</td>
                    <td className="num">{pct(weights.cost)}</td>
                    <td className="num">{pct(weights.speed)}</td>
                    <td className="num">{pct(weights.quality)}</td>
                    <td className="num">{pct(weights.reliability)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="panel-foot">
          <span>Hard constraints such as max cost, qubit count and provider allowlists are applied before scoring.</span>
          <Link href="/docs" className="link-btn">Routing reference</Link>
        </div>
      </Panel>
    </div>
  );
}
