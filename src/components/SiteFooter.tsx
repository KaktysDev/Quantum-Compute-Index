import Link from "next/link";
import Logo from "./Logo";

export default function SiteFooter() {
  return (
    <footer className="qci-site-footer">
      <Link href="/" aria-label="QRouter home">
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
      <span className="mono-label">© {new Date().getFullYear()} QRouter</span>
    </footer>
  );
}
