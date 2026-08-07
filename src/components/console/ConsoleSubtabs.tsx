"use client";

// Page-level sub-navigation. Styled by `.console-subtabs` in console.css.
// `exact` is for a parent route that would otherwise stay active on every
// child (e.g. /dashboard/github vs /dashboard/github/deploy).

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SubtabItem = { href: string; label: string; exact?: boolean };

export default function ConsoleSubtabs({ items }: { items: SubtabItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="console-subtabs" aria-label="Section">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
