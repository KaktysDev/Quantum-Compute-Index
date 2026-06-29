"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";

export default function DashboardNav({
  email,
  isViewer = false,
  unread = 0,
}: {
  email: string | null;
  isViewer?: boolean;
  unread?: number;
}) {
  const pathname = usePathname();

  const tabs = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/settings", label: "Settings" },
    ...(isViewer ? [{ href: "/dashboard/requests", label: "Requests" }] : []),
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-[rgba(5,5,5,0.6)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="flex items-center gap-6">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1">
            {tabs.map((t) => {
              const active =
                t.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(t.href);
              const showBadge = t.href === "/dashboard/requests" && unread > 0;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`relative rounded-lg px-3.5 py-1.5 text-sm transition-colors ${
                    active ? "bg-white/10 text-white" : "text-[var(--muted)] hover:text-white"
                  }`}
                >
                  {t.label}
                  {showBadge && (
                    <span className="tabular ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-black">
                      {unread}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {email && <span className="hidden text-sm text-[var(--muted)] sm:inline">{email}</span>}
          <form action="/auth/signout" method="post">
            <button type="submit" className="btn btn-glass !py-1.5 !text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
