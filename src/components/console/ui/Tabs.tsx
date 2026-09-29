"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TabItem = { href: string; label: string; exact?: boolean };

/** Route tabs inside a section. */
export function Tabs({ items, label = "Section" }: { items: TabItem[]; label?: string }) {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
