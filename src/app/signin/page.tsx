import type { Metadata } from "next";
import Image from "next/image";
import WaitlistAccess from "@/components/WaitlistAccess";
import TechnicalSite from "@/components/landing/TechnicalSite";
import "./signin.css";

export const metadata: Metadata = {
  title: "Join the QRouter pilot",
  description: "Request early access to QRouter’s quantum research and execution workspace.",
};

export default async function SigninPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const query = await searchParams;
  return <TechnicalSite><main id="main-content" className="qt-access-layout">
    <section className="qt-access-identity">
      <p className="qt-eyebrow">Research preview</p>
      <p className="qt-display">A question.<br />A workload.<br />A place to start.</p>
      <p className="qt-access-copy">Join the next chapter of quantum software.</p>
      <div className="qt-access-model"><Image src="/landing/hero-model.webp" alt="Illustrative connected workload model" fill priority sizes="(max-width: 920px) 100vw, 50vw" /></div>
    </section>
    <WaitlistAccess unauthorized={query.status === "not-authorized"} />
  </main></TechnicalSite>;
}
