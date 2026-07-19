"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Console topbar — the navigation marketplace.css was designed around (the old
// DashboardNav sidebar is hidden by that skin; this component provides the
// .router-topbar it styles). Layout:
//   brand · global search (⌘K) · product tabs · More ▾ · credits · keys · account
// Under 900px the product tabs collapse into a horizontally-scrollable second
// row (.router-mobile-nav).
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronDown,
  Cpu,
  GitBranch,
  Inbox,
  KeyRound,
  LifeBuoy,
  LineChart,
  LogOut,
  Rocket,
  Search,
  Send,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import Logo from "./Logo";

type NavItem = { href: string; label: string; icon: typeof Cpu };

// Primary tabs — the surfaces people live in. "/dashboard" (the assistant)
// is the console home and matches exactly, never as a prefix.
const PRIMARY: NavItem[] = [
  { href: "/dashboard", label: "Assistant", icon: Sparkles },
  { href: "/dashboard/providers", label: "Providers", icon: Cpu },
  { href: "/dashboard/playground", label: "Playground", icon: Rocket },
  { href: "/dashboard/tasks", label: "Activity", icon: Activity },
  { href: "/dashboard/github", label: "Repos", icon: GitBranch },
  { href: "/dashboard/qci", label: "QCI", icon: LineChart },
];

// Everything else lives under "More".
const MORE: NavItem[] = [
  { href: "/dashboard/submit", label: "Submit a task", icon: Send },
  { href: "/dashboard/instances", label: "Instances", icon: Server },
  { href: "/dashboard/requests", label: "Requests", icon: Inbox },
  { href: "/dashboard/rankings", label: "Rankings", icon: BarChart3 },
];

export default function RouterTopbar({
  email,
  organization,
  balance,
  isAdmin = false,
}: {
  email: string | null;
  organization: string;
  balance: number;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);

  const isActive = (href: string) =>
    href === "/dashboard"
      ? pathname === "/dashboard" || pathname === "/dashboard/submit"
      : pathname === href || pathname.startsWith(`${href}/`);
  const moreActive = MORE.some((item) => isActive(item.href));

  // ⌘K / Ctrl-K focuses the global search.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the dropdowns on route change.
  useEffect(() => {
    if (moreRef.current) moreRef.current.open = false;
    if (accountRef.current) accountRef.current.open = false;
  }, [pathname]);

  const initial = (email ?? "D").slice(0, 1).toUpperCase();

  return (
    <header className="router-topbar">
      <div className="router-topbar-main">
        <Link href="/dashboard/providers" className="router-brand" aria-label="QRouter console">
          <Logo size={26} />
        </Link>

        <form className="router-global-search" action="/dashboard/providers" role="search">
          <Search size={13} />
          <input
            ref={searchRef}
            name="q"
            placeholder="Search providers"
            aria-label="Search quantum providers"
            autoComplete="off"
          />
          <kbd>⌘K</kbd>
        </form>

        <nav className="router-product-nav" aria-label="Console">
          {PRIMARY.map((item) => (
            <Link
              href={item.href}
              key={item.href}
              className={isActive(item.href) ? "active" : ""}
            >
              <item.icon size={14} /> {item.label}
            </Link>
          ))}

          <details className="router-account-menu router-more-menu" ref={moreRef}>
            <summary className={`router-more-summary ${moreActive ? "active" : ""}`}>
              More <ChevronDown size={12} />
            </summary>
            <div>
              {MORE.map((item) => (
                <Link href={item.href} key={item.href} className={isActive(item.href) ? "active" : ""}>
                  <item.icon size={14} /> {item.label}
                </Link>
              ))}
              <Link href="/docs">
                <BookOpen size={14} /> Docs
              </Link>
              {isAdmin && (
                <Link href="/dashboard/admin" className={isActive("/dashboard/admin") ? "active" : ""}>
                  <ShieldCheck size={14} /> Admin
                </Link>
              )}
            </div>
          </details>
        </nav>

        <div className="router-account-actions">
          <Link href="/dashboard/billing" className="router-credit-button" title="Credits & billing">
            <Wallet size={13} />
            Credits <b>${balance.toFixed(2)}</b>
          </Link>
          <Link href="/dashboard/api-keys" className="router-key-button" aria-label="API keys" title="API keys">
            <KeyRound size={14} />
          </Link>

          <details className="router-account-menu" ref={accountRef}>
            <summary aria-label="Account menu">
              <span>{initial}</span>
              <ChevronDown size={12} />
            </summary>
            <div>
              <header>
                <b>{organization}</b>
                <small>{email ?? "Local developer"}</small>
              </header>
              <Link href="/dashboard/settings">
                <Settings size={14} /> Settings
              </Link>
              <Link href="/dashboard/billing">
                <Wallet size={14} /> Billing
              </Link>
              <Link href="/dashboard/support">
                <LifeBuoy size={14} /> Support
              </Link>
              <Link href="/docs">
                <BookOpen size={14} /> Documentation
              </Link>
              {isAdmin && (
                <Link href="/dashboard/admin">
                  <ShieldCheck size={14} /> Admin
                </Link>
              )}
              <form action="/auth/signout" method="post">
                <button type="submit">
                  <LogOut size={14} /> Sign out
                </button>
              </form>
            </div>
          </details>
        </div>
      </div>

      <nav className="router-mobile-nav" aria-label="Console (mobile)">
        {PRIMARY.map((item) => (
          <Link href={item.href} key={item.href} className={isActive(item.href) ? "active" : ""}>
            <item.icon size={14} /> {item.label}
          </Link>
        ))}
        {MORE.map((item) => (
          <Link href={item.href} key={item.href} className={isActive(item.href) ? "active" : ""}>
            <item.icon size={14} /> {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
