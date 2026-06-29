import Link from "next/link";
import Logo from "./Logo";

export default function SiteFooter() {
  return (
    <footer className="flex flex-col items-center justify-between gap-4 border-t border-white/5 py-8 sm:flex-row">
      <Link href="/" aria-label="QuantumForge home">
        <Logo size={22} />
      </Link>
      <nav className="flex items-center gap-6">
        <Link href="/history" className="mono-label transition-colors hover:text-white">
          History
        </Link>
        <Link href="/pricing" className="mono-label transition-colors hover:text-white">
          Pricing
        </Link>
      </nav>
      <span className="mono-label">© {new Date().getFullYear()} QuantumForge</span>
    </footer>
  );
}
