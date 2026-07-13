"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  Braces,
  ChevronDown,
  CircleHelp,
  CreditCard,
  KeyRound,
  ListChecks,
  LogOut,
  PanelLeft,
  Settings,
  Sparkles,
} from "lucide-react";
import Logo from "./Logo";

const TABS = [
  { href: "/dashboard", label: "Overview", icon: Activity },
  { href: "/dashboard/submit", label: "Playground", icon: Braces },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export default function DashboardNav({
  email,
  organization,
  balance,
}: {
  email: string | null;
  organization: string;
  balance: number;
}) {
  const pathname = usePathname();

  return (
    <>
      <header className="console-mobile-bar">
        <Link href="/" aria-label="QRouter home"><Logo size={25} /></Link>
        <span><PanelLeft size={15} /> Console</span>
      </header>

      <aside className="console-sidebar">
        <div className="console-brand-row">
          <Link href="/" aria-label="QRouter home"><Logo size={28} /></Link>
          <span className="console-product-badge">Console</span>
        </div>

        <button className="console-workspace" type="button">
          <span className="workspace-avatar">{organization.slice(0, 1).toUpperCase()}</span>
          <span><b>{organization}</b><small>Developer workspace</small></span>
          <ChevronDown size={14} />
        </button>

        <nav className="console-nav" aria-label="Console navigation">
          <p>Control plane</p>
          {TABS.map((tab) => {
            const active = tab.href === "/dashboard" ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link href={tab.href} key={tab.href} className={active ? "active" : ""}>
                <tab.icon size={16} />
                <span>{tab.label}</span>
                {tab.href === "/dashboard/submit" && <Sparkles size={12} className="nav-spark" />}
              </Link>
            );
          })}
        </nav>

        <div className="console-sidebar-bottom">
          <div className="console-credit-meter">
            <div><span>QCI credits</span><strong>${balance.toFixed(2)}</strong></div>
            <i><span style={{ width: `${Math.min(100, Math.max(5, balance * 2))}%` }} /></i>
            <Link href="/dashboard/billing">Manage balance</Link>
          </div>
          <div className="console-utility-links">
            <a href="/openapi.json"><BookOpen size={15} /> API reference</a>
            <Link href="/contact"><CircleHelp size={15} /> Support</Link>
            <Link href="/dashboard/settings" className={pathname.startsWith("/dashboard/settings") ? "active" : ""}><Settings size={15} /> Settings</Link>
          </div>
          <div className="console-user">
            <span>{(email ?? "D").slice(0, 1).toUpperCase()}</span>
            <div><b>{email ?? "Local developer"}</b><small>Workspace owner</small></div>
            <form action="/auth/signout" method="post">
              <button type="submit" aria-label="Sign out" title="Sign out"><LogOut size={15} /></button>
            </form>
          </div>
        </div>
      </aside>

      <nav className="console-mobile-tabs" aria-label="Mobile console navigation">
        {TABS.map((tab) => {
          const active = tab.href === "/dashboard" ? pathname === tab.href : pathname.startsWith(tab.href);
          return <Link href={tab.href} key={tab.href} className={active ? "active" : ""}><tab.icon size={16} /><span>{tab.label}</span></Link>;
        })}
      </nav>
    </>
  );
}
