"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Console app shell — fixed left sidebar + content topbar.
//
// Every authenticated surface renders inside this. The sidebar is the single
// navigation contract for the console; there is no top product-tab row and no
// "More" menu any more. Under 900px the sidebar becomes an off-canvas drawer
// toggled from the topbar (`.console-shell.nav-open` in console.css).
//
// Section labels here are also the breadcrumb source, so a route only has to
// be listed once to get both nav and title treatment.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Cpu,
  GitBranch,
  KeyRound,
  LifeBuoy,
  LineChart,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  PanelsTopLeft,
  Route,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Wallet,
} from "lucide-react";
import LogoMark from "@/components/LogoMark";
import { THEME_STORAGE_KEY } from "@/components/ThemeToggle";

type NavItem = { href: string; label: string; icon: typeof Cpu; exact?: boolean };
type NavGroup = { label: string; items: NavItem[] };

// `exact` marks routes that must not match as a prefix. Deploy is a leaf route;
// Routing owns the stable `/dashboard` landing redirect.
const GROUPS: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard/routing", label: "Routing", icon: Route },
      { href: "/dashboard/deploy", label: "Deploy", icon: MessagesSquare, exact: true },
      { href: "/dashboard/github", label: "Repositories", icon: GitBranch },
      { href: "/dashboard/tasks", label: "Activity", icon: Activity },
      { href: "/dashboard/providers", label: "Providers", icon: Cpu },
      { href: "/dashboard/qci", label: "QCI Index", icon: LineChart },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: BarChart3 },
      { href: "/dashboard/billing", label: "Billing", icon: Wallet },
      { href: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
    ],
  },
];

const HELP: NavItem[] = [
  { href: "/docs", label: "Documentation", icon: BookOpen },
  { href: "/dashboard/support", label: "Support", icon: LifeBuoy },
];

// Routes that are reachable but not primary navigation still need a title.
const EXTRA_TITLES: Record<string, string> = {
  "/dashboard/admin": "Admin",
  "/dashboard/rankings": "Rankings",
  "/dashboard/instances": "Instances",
  "/dashboard/requests": "Requests",
  "/dashboard/submit": "Deploy",
  "/dashboard": "Routing",
};

function useSectionTitle(pathname: string): string {
  const flat = [...GROUPS.flatMap((group) => group.items), ...HELP];
  const exact = flat.find((item) => item.href === pathname);
  if (exact) return exact.label;
  const prefix = flat
    .filter((item) => !item.exact && pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (prefix) return prefix.label;
  const extra = Object.keys(EXTRA_TITLES)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  return extra ? EXTRA_TITLES[extra] : "Console";
}

/** Compact light/dark switch. Mirrors ThemeToggle's storage contract. */
function ThemeSwitch() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);

  function choose(next: "light" | "dark") {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private browsing — the choice just will not persist */
    }
  }

  return (
    <div className="console-theme-toggle" role="group" aria-label="Appearance">
      <button type="button" aria-label="Light theme" aria-pressed={theme === "light"} onClick={() => choose("light")}>
        <Sun size={14} />
      </button>
      <button type="button" aria-label="Dark theme" aria-pressed={theme === "dark"} onClick={() => choose("dark")}>
        <Moon size={14} />
      </button>
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
  const searchRef = useRef<HTMLInputElement>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);
  const title = useSectionTitle(pathname);

  const isActive = (item: NavItem) =>
    item.exact
      ? pathname === item.href || (item.href === "/dashboard/deploy" && pathname === "/dashboard/submit")
      : pathname === item.href || pathname.startsWith(`${item.href}/`);

  // ⌘K / Ctrl-K focuses search; Escape closes the mobile drawer.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setNavOpen(true);
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setNavOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the drawer and the account menu whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
    if (accountRef.current) accountRef.current.open = false;
  }, [pathname]);

  const initial = (email ?? "D").slice(0, 1).toUpperCase();
  const accountName = email ?? "Local developer";

  const navLink = (item: NavItem) => (
    <Link href={item.href} key={item.href} className={isActive(item) ? "active" : ""}>
      <item.icon size={15} /> {item.label}
    </Link>
  );

  return (
    <div className={`console-shell ${navOpen ? "nav-open" : ""}`}>
      <div className="console-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className="console-sidebar">
        <div className="console-sidebar-head">
          <Link href="/dashboard" className="console-brand" aria-label="QRouter console">
            <LogoMark size={22} />
            <b>QROUTER</b>
          </Link>
        </div>

        <form className="console-search" action="/dashboard/providers" role="search">
          <button type="submit" className="console-search-submit" aria-label="Search providers">
            <Search size={13} />
          </button>
          <input
            ref={searchRef}
            name="q"
            placeholder="Search providers"
            aria-label="Search quantum providers"
            autoComplete="off"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <kbd>⌘K</kbd>
        </form>

        <nav className="console-nav" aria-label="Console">
          {GROUPS.map((group) => (
            <div className="console-nav-group" key={group.label}>
              <p className="console-nav-label">{group.label}</p>
              {group.items.map(navLink)}
            </div>
          ))}
          <div className="console-nav-group">
            <p className="console-nav-label">Help</p>
            {HELP.map(navLink)}
            {isAdmin && (
              <Link
                href="/dashboard/admin"
                className={pathname.startsWith("/dashboard/admin") ? "active" : ""}
              >
                <ShieldCheck size={15} /> Admin
              </Link>
            )}
          </div>
        </nav>

        <div className="console-sidebar-foot">
          <details className="console-account" ref={accountRef}>
            <summary aria-label="Account menu">
              <span className="console-account-avatar">{initial}</span>
              <span className="console-account-id">
                <b>{organization}</b>
                <small>{accountName}</small>
              </span>
            </summary>
            <div>
              <header>
                <b>{organization}</b>
                <small>{accountName}</small>
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
              <Link href="/">
                <PanelsTopLeft size={14} /> Home page
              </Link>
              <form action="/auth/signout" method="post">
                <button type="submit">
                  <LogOut size={14} /> Sign out
                </button>
              </form>
              <nav className="console-account-legal" aria-label="Legal">
                <Link href="/terms">Terms</Link>
                <Link href="/privacy">Privacy</Link>
              </nav>
            </div>
          </details>
        </div>
      </aside>

      <header className="console-topbar">
        <button
          type="button"
          className="console-menu-button"
          aria-label="Open navigation"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          <Menu size={16} />
        </button>
        <div className="console-crumbs">
          <b>{title}</b>
        </div>
        <div className="console-topbar-actions">
          <Link
            href="/dashboard/billing"
            className={`console-credits ${balance < 1 ? "low" : ""}`}
            title="Credits and billing"
          >
            <Wallet size={13} /> <b>${balance.toFixed(2)}</b>
          </Link>
          <ThemeSwitch />
        </div>
      </header>

      <div className="console-body">
        <main className="console-main">{children}</main>
        <footer className="console-legal">
          <span>© {new Date().getFullYear()} QRouter</span>
          <nav aria-label="Legal">
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}
