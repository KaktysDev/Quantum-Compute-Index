"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  Activity,
  BarChart3,
  BookOpen,
  ChevronDown,
  Cpu,
  CreditCard,
  GitBranch,
  KeyRound,
  LifeBuoy,
  LogOut,
  Rocket,
  Search,
  Server,
  Settings,
  ShieldCheck,
} from "lucide-react";
import Logo from "./Logo";

const PRODUCT_TABS = [
  { href: "/dashboard/providers", label: "Providers", icon: Cpu },
  { href: "/dashboard/playground", label: "Playground", icon: Rocket },
  { href: "/dashboard/tasks", label: "Activity", icon: Activity },
  { href: "/dashboard/rankings", label: "Rankings", icon: BarChart3 },
  { href: "/dashboard/qci", label: "QCI", icon: Activity },
  { href: "/docs", label: "Docs", icon: BookOpen },
];

const ADMIN_TAB = { href: "/dashboard/admin", label: "Admin", icon: ShieldCheck };

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
  const tabs = isAdmin ? [...PRODUCT_TABS, ADMIN_TAB] : PRODUCT_TABS;

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

  return (
    <header className="router-topbar">
      <div className="router-topbar-main">
        <Link className="router-brand" href="/dashboard/providers" aria-label="QRouter providers"><Logo size={28} /></Link>
        <form className="router-global-search" action="/dashboard/providers">
          <Search size={15} />
          <input ref={searchRef} name="q" placeholder="Search providers" aria-label="Search quantum providers" />
          <kbd>⌘ K</kbd>
        </form>
        <nav className="router-product-nav" aria-label="Product navigation">
          {tabs.map((tab) => {
            const active = tab.href === "/docs" ? false : pathname.startsWith(tab.href);
            return <Link href={tab.href} key={tab.href} className={active ? "active" : ""}><tab.icon size={14} /><span>{tab.label}</span></Link>;
          })}
        </nav>
        <div className="router-account-actions">
          <Link className="router-credit-button" href="/dashboard/billing"><span>Credits</span><b>${balance.toFixed(2)}</b></Link>
          <Link className="router-key-button" href="/dashboard/api-keys" aria-label="API keys" title="API keys"><KeyRound size={15} /></Link>
          <details className="router-account-menu">
            <summary><span>{(email ?? "D").slice(0, 1).toUpperCase()}</span><ChevronDown size={13} /></summary>
            <div>
              <header><b>{organization}</b><small>{email ?? "Local developer"}</small></header>
              <Link href="/dashboard/github"><GitBranch size={14} /> Repositories</Link>
              <Link href="/dashboard/instances"><Server size={14} /> Instances</Link>
              <Link href="/dashboard/api-keys"><KeyRound size={14} /> API keys</Link>
              <Link href="/dashboard/billing"><CreditCard size={14} /> Credits</Link>
              <Link href="/dashboard/support"><LifeBuoy size={14} /> Support</Link>
              <Link href="/dashboard/settings"><Settings size={14} /> Settings</Link>
              <form action="/auth/signout" method="post"><button type="submit"><LogOut size={14} /> Sign out</button></form>
            </div>
          </details>
        </div>
      </div>
      <nav className="router-mobile-nav" aria-label="Mobile product navigation">
        {tabs.map((tab) => {
          const active = tab.href === "/docs" ? false : pathname.startsWith(tab.href);
          return <Link href={tab.href} key={tab.href} className={active ? "active" : ""}>{tab.label}</Link>;
        })}
      </nav>
    </header>
  );
}
