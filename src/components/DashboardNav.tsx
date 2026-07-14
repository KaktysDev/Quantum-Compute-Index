"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronsUpDown,
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
} from "lucide-react";
import Logo from "./Logo";

type NavItem = { href: string; label: string; icon: typeof Cpu };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Build",
    items: [
      { href: "/dashboard/playground", label: "Playground", icon: Rocket },
      { href: "/dashboard/submit", label: "Submit", icon: Send },
      { href: "/dashboard/github", label: "Repositories", icon: GitBranch },
      { href: "/dashboard/instances", label: "Instances", icon: Server },
    ],
  },
  {
    label: "Monitor",
    items: [
      { href: "/dashboard/tasks", label: "Activity", icon: Activity },
      { href: "/dashboard/requests", label: "Requests", icon: Inbox },
    ],
  },
  {
    label: "Market",
    items: [
      { href: "/dashboard/providers", label: "Providers", icon: Cpu },
      { href: "/dashboard/rankings", label: "Rankings", icon: BarChart3 },
      { href: "/dashboard/qci", label: "QCI", icon: LineChart },
    ],
  },
];

const UTILITY_LINKS: NavItem[] = [
  { href: "/docs", label: "Docs", icon: BookOpen },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/support", label: "Support", icon: LifeBuoy },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

// Compact bottom bar shown on mobile (sidebar is hidden < 820px).
const MOBILE_TABS: NavItem[] = [
  { href: "/dashboard/providers", label: "Providers", icon: Cpu },
  { href: "/dashboard/playground", label: "Build", icon: Rocket },
  { href: "/dashboard/tasks", label: "Activity", icon: Activity },
  { href: "/dashboard/github", label: "Repos", icon: GitBranch },
  { href: "/dashboard/qci", label: "QCI", icon: LineChart },
];

export default function DashboardNav({
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

  const groups = isAdmin
    ? [...NAV_GROUPS, { label: "Admin", items: [{ href: "/dashboard/admin", label: "Admin", icon: ShieldCheck }] }]
    : NAV_GROUPS;

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const initial = (email ?? "D").slice(0, 1).toUpperCase();
  const creditPct = Math.max(4, Math.min(100, (balance / 100) * 100));

  return (
    <>
      <aside className="console-sidebar">
        <div className="console-brand-row">
          <Link href="/dashboard/providers" aria-label="QRouter console"><Logo size={26} /></Link>
          <span className="console-product-badge">Console</span>
        </div>

        <Link className="console-workspace" href="/dashboard/settings">
          <span className="workspace-avatar">{(organization ?? "Q").slice(0, 1).toUpperCase()}</span>
          <span><b>{organization}</b><small>{email ?? "Local developer"}</small></span>
          <ChevronsUpDown size={14} />
        </Link>

        <form className="console-search" action="/dashboard/providers">
          <Search size={14} />
          <input ref={searchRef} name="q" placeholder="Search providers" aria-label="Search quantum providers" />
          <kbd>⌘K</kbd>
        </form>

        <nav className="console-nav" aria-label="Console navigation">
          {groups.map((group) => (
            <div key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <Link href={item.href} key={item.href} className={isActive(item.href) ? "active" : ""}>
                  <item.icon size={15} /> {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        <div className="console-sidebar-bottom">
          <div className="console-credit-meter">
            <div><span>Credits</span><strong>${balance.toFixed(2)}</strong></div>
            <i><span style={{ width: `${creditPct}%` }} /></i>
            <Link href="/dashboard/billing">Add credits →</Link>
          </div>
          <div className="console-utility-links">
            {UTILITY_LINKS.map((item) => (
              <Link href={item.href} key={item.href} className={item.href !== "/docs" && isActive(item.href) ? "active" : ""}>
                <item.icon size={15} /> {item.label}
              </Link>
            ))}
          </div>
          <div className="console-user">
            <span>{initial}</span>
            <b>{email ?? "Local developer"}</b>
            <form action="/auth/signout" method="post"><button type="submit" aria-label="Sign out" title="Sign out"><LogOut size={15} /></button></form>
          </div>
        </div>
      </aside>

      <div className="console-mobile-bar">
        <Link href="/dashboard/providers" aria-label="QRouter console"><Logo size={24} /></Link>
        <span><KeyRound size={13} /> ${balance.toFixed(2)}</span>
      </div>
      <nav className="console-mobile-tabs" aria-label="Mobile navigation">
        {MOBILE_TABS.map((item) => (
          <Link href={item.href} key={item.href} className={isActive(item.href) ? "active" : ""}>
            <item.icon size={16} /> {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
