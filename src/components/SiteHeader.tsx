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
    <header className="sticky top-0 z-30 -mx-6 flex items-center justify-between border-b border-white/[0.06] bg-[rgba(8,9,11,0.82)] px-6 py-4 backdrop-blur-xl sm:-mx-10 sm:px-10">
      <Link href="/" aria-label="QuantumForge home">
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
                className={`rounded-full px-3 py-2 text-sm font-medium transition-colors hover:bg-white/[0.05] hover:text-white ${
                  active ? "bg-white/[0.07] text-white" : "text-[var(--muted)]"
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
