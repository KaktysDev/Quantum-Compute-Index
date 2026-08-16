import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import MagnetField from "@/components/routing/MagnetField";
import RoutingDiagram from "@/components/routing/RoutingDiagram";
import { ROUTABLE_PROVIDERS } from "@/lib/qrouter/providers";

// This tab used to be the routing fabric's reference sheet: the five-stage
// execution path, the four policy weight tables, the hard-constraint list, a
// live candidate table, and the route advisor. All of that is real, and all of
// it answered a question you only have once you are already routing.
//
// What it never did was say what QRouter IS. So the tab is now the one picture
// that does — you talk to one thing, it talks to all of them — and three ways
// out: press a provider to start a task against it, read how it works, or go
// and route something. The reference material lives in the docs; the candidate
// table lives on Providers; the advisor is still in components/RouteAdvisor.tsx
// if it should come back somewhere.

export const metadata = { title: "QRouter Console — Routing" };

/** Pressing a provider opens the assistant with that provider preselected. */
const TARGETS = ROUTABLE_PROVIDERS.map((name) => ({
  name,
  href: `/dashboard?route=${encodeURIComponent(name)}`,
}));

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

          <RoutingDiagram providers={TARGETS} />

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
