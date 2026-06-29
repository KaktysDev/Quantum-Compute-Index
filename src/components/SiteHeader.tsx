"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";
import SignInButton from "./SignInButton";

const NAV = [
  { href: "/history", label: "History" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#about", label: "About" },
];

export default function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between py-6">
      <Link href="/" aria-label="QuantumForge home">
        <Logo />
      </Link>
      <div className="flex items-center gap-6">
        <nav className="hidden items-center gap-6 sm:flex">
          {NAV.map((n) => {
            const active = !n.href.includes("#") && pathname === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`mono-label transition-colors hover:text-white ${
                  active ? "text-white" : ""
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
