"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import SignInButton from "./SignInButton";

const NAV = [
  { href: "/history", label: "History" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#workflows", label: "About" },
];

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="qci-site-header">
      <Link href="/" aria-label="QuantumForge home" className="qci-site-brand">
        <Logo />
      </Link>
      <div className="flex items-center gap-5">
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => {
            const active = !n.href.includes("#") && pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`qci-site-link ${
                  active ? "qci-site-link-active" : ""
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <SignInButton label="Sign in" />
      </div>
    </header>
  );
}
