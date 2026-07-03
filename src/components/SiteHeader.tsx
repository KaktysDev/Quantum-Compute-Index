"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import SignInButton from "./SignInButton";

// One nav, used on every public page: QuantumForge (left) · History · Pricing ·
// Request access · Sign in (right).
const NAV = [
  { href: "/history", label: "History" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Request access" },
];

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="qci-nav">
      <div className="qci-nav-inner">
        <Link href="/" aria-label="QuantumForge home" className="qci-site-brand">
          <Logo />
        </Link>
        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`qci-site-link ${pathname === n.href ? "qci-site-link-active" : ""}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <SignInButton label="Sign in" />
        </div>
      </div>
    </header>
  );
}
