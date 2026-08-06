import Link from "next/link";
import Logo from "./Logo";

// Rendered on every public subpage. The hover color reads --fg rather than a
// literal so the footer stays legible on the light subpages, the dark contact
// page, and the legal pages alike.
const LINKS = [
  { href: "/history", label: "History" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/contact", label: "Contact" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
] as const;

export default function SiteFooter() {
  return (
    <footer className="qci-site-footer">
      <Link href="/" aria-label="QRouter home">
        <Logo size={22} />
      </Link>
      <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2" aria-label="Footer">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)]"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <span className="mono-label">© {new Date().getFullYear()} QRouter</span>
    </footer>
  );
}
