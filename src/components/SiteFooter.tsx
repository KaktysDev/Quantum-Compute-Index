import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function SiteFooter() {
  return (
    <footer className="qt-footer">
      <div className="qt-footer-top">
        <Link href="/" className="qt-wordmark" aria-label="QRouter home">QRouter<span aria-hidden="true">↗</span></Link>
        <p>Quantum, where it fits.</p>
        <Link className="qt-text-link" href="/contact">Build with us <ArrowUpRight size={16} /></Link>
      </div>
      <div className="qt-footer-bottom">
        <span>© 2026 QRouter</span>
        <nav aria-label="Footer navigation">
          <Link href="/research">Research</Link><Link href="/pricing">Value</Link><Link href="/contact">Contact</Link><Link href="/#supporters">Our network</Link><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link>
        </nav>
        <span>Built around the evidence.</span>
      </div>
    </footer>
  );
}
