"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Braces, ChevronDown, CreditCard, KeyRound, ListChecks, Settings } from "lucide-react";
import Logo from "./Logo";

const TABS = [
  { href: "/dashboard", label: "Get started", icon: BookOpen },
  { href: "/dashboard/submit", label: "Submit task", icon: Braces },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardNav({ email, organization, balance }: { email: string | null; organization: string; balance: number }) {
  const pathname = usePathname();
  return (
    <>
      <header className="console-topbar">
        <Link href="/"><Logo size={27} /></Link>
        <div className="console-workspace"><span className="provider-dot simulator" /><b>{organization}</b><ChevronDown size={14} /></div>
        <div className="console-account"><span className="console-balance">${balance.toFixed(2)} credits</span>{email && <span>{email}</span>}<form action="/auth/signout" method="post"><button type="submit">Sign out</button></form></div>
      </header>
      <nav className="console-tabs">
        {TABS.map((tab) => {
          const active = tab.href === "/dashboard" ? pathname === tab.href : pathname.startsWith(tab.href);
          return <Link href={tab.href} key={tab.href} className={active ? "active" : ""}><tab.icon size={15} /><span>{tab.label}</span></Link>;
        })}
      </nav>
    </>
  );
}
