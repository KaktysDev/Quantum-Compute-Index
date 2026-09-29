"use client";

// Console app shell: a fixed sidebar and the page. Each page renders its own
// header, so there is no desktop topbar. Under 900px the sidebar becomes a
// drawer opened from a slim mobile bar.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Boxes,
  Cpu,
  FileCode2,
  GitBranch,
  Home,
  KeyRound,
  LifeBuoy,
  LineChart,
  LogOut,
  Menu,
  Play,
  Route,
  Settings,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import LogoMark from "@/components/LogoMark";
import { applyThemePreference, readThemePreference, type ThemePreference } from "@/lib/client/theme";

type NavItem = { href: string; label: string; icon: typeof Cpu; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Overview", icon: Home, exact: true },
      { href: "/dashboard/run", label: "Run", icon: Play },
      { href: "/dashboard/activity", label: "Activity", icon: Activity },
      { href: "/dashboard/circuits", label: "Circuits", icon: FileCode2 },
      { href: "/dashboard/repositories", label: "Repositories", icon: GitBranch },
    ],
  },
  {
    label: "Market",
    items: [
      { href: "/dashboard/providers", label: "Providers", icon: Cpu },
      { href: "/dashboard/qci", label: "QCI Index", icon: LineChart },
      { href: "/dashboard/routing", label: "Routing", icon: Route },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
      { href: "/dashboard/billing", label: "Billing", icon: Wallet },
      { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function ThemeControl() {
  const [preference, setPreference] = useState<ThemePreference>("light");

  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  // "System" follows the OS live, not just at page load.
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => applyThemePreference("system");
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);

  return (
    <div className="shell-theme" role="radiogroup" aria-label="Theme">
      {THEMES.map((theme) => (
        <button
          key={theme.value}
          type="button"
          role="radio"
          aria-checked={preference === theme.value}
          onClick={() => {
            setPreference(theme.value);
            applyThemePreference(theme.value);
          }}
        >
          {theme.label}
        </button>
      ))}
    </div>
  );
}

export default function ConsoleShell({
  email,
  organization,
  balance,
  isAdmin = false,
  children,
}: {
  email: string | null;
  organization: string;
  balance: number;
  isAdmin?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const accountRef = useRef<HTMLDetailsElement>(null);

  const isActive = (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNavOpen(false);
      if (accountRef.current) accountRef.current.open = false;
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setNavOpen(false);
    if (accountRef.current) accountRef.current.open = false;
  }, [pathname]);

  // Close the account menu on an outside click.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      const menu = accountRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const accountName = email ?? "Local developer";
  const initial = (organization || accountName).slice(0, 1).toUpperCase();

  const navLink = (item: NavItem) => {
    const active = isActive(item);
    return (
      <Link href={item.href} key={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
        <item.icon size={15} strokeWidth={1.75} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <div className={`console-shell ${navOpen ? "nav-open" : ""}`}>
      <div className="shell-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <header className="shell-mobilebar">
        <button type="button" className="shell-icon-button" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
          <Menu size={16} />
        </button>
        <Link href="/dashboard" className="shell-brand" aria-label="QRouter console">
          <LogoMark size={20} />
          <b>QRouter</b>
        </Link>
      </header>

      <aside className="shell-sidebar" aria-label="Console navigation">
        <div className="shell-sidebar-head">
          <Link href="/dashboard" className="shell-brand" aria-label="QRouter console">
            <LogoMark size={20} />
            <b>QRouter</b>
          </Link>
          <button type="button" className="shell-icon-button shell-close" aria-label="Close navigation" onClick={() => setNavOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <nav className="shell-nav">
          {GROUPS.map((group) => (
            <div className="shell-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map(navLink)}
            </div>
          ))}
          <div className="shell-nav-group">
            <p>Help</p>
            {navLink({ href: "/docs", label: "Documentation", icon: BookOpen })}
            {navLink({ href: "/dashboard/support", label: "Support", icon: LifeBuoy })}
            {isAdmin && navLink({ href: "/dashboard/admin", label: "Admin", icon: ShieldCheck })}
          </div>
        </nav>

        <div className="shell-sidebar-foot">
          <Link href="/dashboard/billing" className={`shell-credits ${balance < 1 ? "low" : ""}`}>
            <span>Credits</span>
            <b>${balance.toFixed(2)}</b>
          </Link>

          <details className="shell-account" ref={accountRef}>
            <summary aria-label="Account menu">
              <span className="shell-avatar" aria-hidden="true">{initial}</span>
              <span className="shell-account-id">
                <b>{organization}</b>
                <small>{accountName}</small>
              </span>
            </summary>
            <div className="shell-menu" role="menu">
              <div className="shell-menu-head">
                <b>{organization}</b>
                <small>{accountName}</small>
              </div>
              <Link href="/dashboard/settings" role="menuitem">
                <Settings size={14} /> Settings
              </Link>
              <Link href="/" role="menuitem">
                <Boxes size={14} /> QRouter home
              </Link>
              <div className="shell-menu-section">
                <span>Theme</span>
                <ThemeControl />
              </div>
              <form action="/auth/signout" method="post">
                <button type="submit" role="menuitem">
                  <LogOut size={14} /> Sign out
                </button>
              </form>
            </div>
          </details>

          <nav className="shell-legal" aria-label="Legal">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </div>
      </aside>

      <main className="shell-main">{children}</main>
    </div>
  );
}
