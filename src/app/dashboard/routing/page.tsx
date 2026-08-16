import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import MagnetField from "@/components/routing/MagnetField";
import RoutingDiagram from "@/components/routing/RoutingDiagram";
import { BACKENDS } from "@/lib/qrouter/catalog";

// This tab used to be the routing fabric's reference sheet: the five-stage
// execution path, the four policy weight tables, the hard-constraint list, a
// live candidate table, and the route advisor. All of that is real, and all of
// it answered a question you only have once you are already routing.
//
// What it never did was say what QRouter IS. So the tab is now the one picture
// that does — you talk to one thing, it talks to all of them — and two ways
// out: read how it works, or go and do it. The reference material lives in the
// docs; the candidate table lives on Providers; the advisor is still in
// components/RouteAdvisor.tsx if it should come back somewhere.

export const metadata = { title: "QRouter Console — Routing" };

/**
 * Six provider names, taken from the live catalog rather than typed in, so the
 * picture cannot drift from what the router can actually reach. Deduped by
 * provider — the diagram is about who we reach, not how many machines each of
 * them runs.
 */
const PROVIDER_LABELS: Record<string, string> = {
  ibm: "IBM Quantum",
  ionq: "IonQ",
  "aws-braket": "AWS Braket",
  xanadu: "Xanadu",
  quandela: "Quandela",
  "quantum-inspire": "Quantum Inspire",
  qci: "QCI Simulator",
};

const PROVIDERS = [...new Set(BACKENDS.map((backend) => backend.provider))]
  .map((id) => PROVIDER_LABELS[id] ?? id)
  .slice(0, 6);

export default function RoutingPage() {
  return (
    <div className="console-page routing-page">
      <section className="rt-stage">
        <MagnetField />

        <div className="rt-content">
          <header className="rt-lede">
            <h1>One request. Every quantum machine.</h1>
            <p>
              QRouter sits in the middle. Send one circuit with one key — it prices every provider
              you could run on, picks the machine that fits, compiles for that hardware and hands
              the result back. No accounts to open, no SDKs to learn.
            </p>
          </header>

          <RoutingDiagram providers={PROVIDERS} />

          <div className="rt-actions">
            <Link className="rt-btn rt-btn-quiet" href="/docs">
              <BookOpen size={15} /> Read docs
            </Link>
            <Link className="rt-btn rt-btn-loud" href="/dashboard">
              Start routing <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
