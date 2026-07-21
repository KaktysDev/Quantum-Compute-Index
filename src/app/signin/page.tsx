import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import LogoMark from "@/components/LogoMark";
import WaitlistAccess from "@/components/WaitlistAccess";
import QuantumParticles from "@/components/landing/QuantumParticles";
import "./signin.css";

export const metadata: Metadata = {
  title: "Join the QRouter pilot",
  description: "Request private-pilot access to the QRouter unified quantum execution API.",
};

export default async function SigninPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const query = await searchParams;
  return (
    <main className="access-shell">
      <header className="access-nav">
        <Link href="/" className="access-brand"><LogoMark size={28} /><strong>QROUTER</strong></Link>
        <Link href="/"><ArrowLeft /> Back to product</Link>
      </header>
      <div className="access-layout">
        <section className="access-identity">
          <div className="access-particle-wrap">
            <QuantumParticles label="HELLO, QUANTUM." className="access-particle-canvas" />
          </div>
          <div className="access-identity-copy">
            <p>ONE API / EVERY BACKEND</p>
            <h2>Build against quantum compute as a network, not a pile of provider SDKs.</h2>
            <dl>
              <div><dt>Route</dt><dd>QCI-scored</dd></div>
              <div><dt>Price</dt><dd>Before execution</dd></div>
              <div><dt>Observe</dt><dd>One job lifecycle</dd></div>
            </dl>
          </div>
        </section>
        <WaitlistAccess unauthorized={query.status === "not-authorized"} />
      </div>
    </main>
  );
}
