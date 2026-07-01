import Link from "next/link";
import Logo from "./Logo";

export default function SiteFooter() {
  return (
    <footer className="flex flex-col items-center justify-between gap-5 border-t border-white/[0.08] py-8 sm:flex-row">
      <Link href="/" aria-label="QuantumForge home">
        <Logo size={22} />
      </Link>
      <nav className="flex items-center gap-6">
        <Link href="/history" className="text-xs font-medium text-[var(--muted)] transition-colors hover:text-white">
          History
        </Link>
        <Link href="/pricing" className="text-xs font-medium text-[var(--muted)] transition-colors hover:text-white">
          Pricing
        </Link>
      </nav>
      <span className="mono-label">© {new Date().getFullYear()} QuantumForge</span>
    </footer>
  );
}
