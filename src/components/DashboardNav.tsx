"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BookOpen,
  ChevronDown,
  CircleHelp,
  CreditCard,
  GitBranch,
  KeyRound,
  ListChecks,
  LogOut,
  PanelLeft,
  Rocket,
  Route,
  Server,
  Settings,
  Terminal,
  Cpu,
} from "lucide-react";
import Logo from "./Logo";

const TABS = [
  { href: "/dashboard", label: "QCI", icon: Activity },
  { href: "/dashboard/playground", label: "Playground", icon: Rocket },
  { href: "/dashboard/tasks", label: "Current jobs", icon: ListChecks },
  { href: "/dashboard/instances", label: "Instances", icon: Server },
  { href: "/dashboard/github", label: "GitHub", icon: GitBranch },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

const PLAYGROUND_TABS = [
  { href: "/dashboard/playground", label: "Deployments", icon: Rocket },
  { href: "/dashboard/playground/routing", label: "Routing", icon: Route },
  { href: "/dashboard/playground/api", label: "API endpoint", icon: Terminal },
  { href: "/dashboard/playground/network", label: "Network", icon: Cpu },
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
              <Fragment key={tab.href}>
                <Link href={tab.href} className={active ? "active" : ""}>
                  <tab.icon size={16} />
                  <span>{tab.label}</span>
                </Link>
                {tab.href === "/dashboard/playground" && active && <div className="console-subnav">{PLAYGROUND_TABS.map((item) => {
                  const childActive = item.href === "/dashboard/playground" ? pathname === item.href : pathname.startsWith(item.href);
                  return <Link href={item.href} key={item.href} className={childActive ? "active" : ""}><item.icon size={12} /><span>{item.label}</span></Link>;
                })}</div>}
              </Fragment>
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
            <Link href="/docs"><BookOpen size={15} /> Documentation</Link>
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
