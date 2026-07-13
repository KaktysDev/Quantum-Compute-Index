"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Inbox, KeyRound, LayoutDashboard, Users } from "lucide-react";

const TABS = [
  { href: "/dashboard/admin/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/admin/users", label: "Users", icon: Users },
  { href: "/dashboard/admin/reports", label: "Reports", icon: Inbox },
  { href: "/dashboard/admin/provider-keys", label: "Provider keys", icon: KeyRound },
  { href: "/dashboard/admin/health", label: "Health", icon: Activity },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/30 p-1" aria-label="Admin sections">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium tracking-wide transition-colors ${
              active
                ? "bg-[var(--qr-emerald,#34d399)]/15 text-[var(--qr-emerald,#34d399)]"
                : "text-[var(--muted)] hover:bg-white/5 hover:text-white"
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
