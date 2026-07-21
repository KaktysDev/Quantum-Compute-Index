import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import LogoMark from "@/components/LogoMark";

export default function AccessDeniedPage() {
  return (
    <main className="access-page">
      <section className="access-panel">
        <header><LogoMark size={30} /><span>QROUTER</span></header>
        <LockKeyhole size={24} />
        <p className="ql-kicker">CONSOLE ACCESS</p>
        <h1>This account is not authorized.</h1>
        <p>QRouter is in a closed pilot. Join the waitlist and we will contact you as console seats open.</p>
        <div>
          <Link href="/signin" className="ql-btn primary">Join the waitlist</Link>
          <Link href="/" className="ql-btn ghost"><ArrowLeft /> Back home</Link>
        </div>
      </section>
    </main>
  );
}
