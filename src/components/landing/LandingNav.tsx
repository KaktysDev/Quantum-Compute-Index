"use client";

// Sticky site nav, shared by the landing and the public subpages: organized
// tabs with scroll-spy for on-page sections, a working mobile drawer, and a
// glass background once the page scrolls. Section links carry the "/" prefix
// so they navigate home first when clicked from a subpage.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import LogoMark from "@/components/LogoMark";

const SECTION_TABS = [
  { id: "product", label: "Product" },
  { id: "engine", label: "Engine" },
  { id: "index", label: "Index" },
  { id: "developers", label: "Developers" },
] as const;

const PAGE_TABS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/history", label: "History" },
  { href: "/docs", label: "Docs" },
] as const;

export default function LandingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-spy: highlight the tab of the section closest to the viewport top.
  useEffect(() => {
    const sections = SECTION_TABS.map((t) => document.getElementById(t.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: "-30% 0px -55%", threshold: [0, 0.2, 0.5] },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  // Close the drawer on any navigation.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("hashchange", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("hashchange", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div className={`ql-nav-wrap ${scrolled ? "scrolled" : ""}`}>
      <div className="ql-announce">
        <i aria-hidden="true" />
        <span>QRouter private beta is live</span>
        <Link href="/contact">Request access →</Link>
      </div>

      <header className="ql-nav ql-shell">
        <Link href="/" className="ql-brand" aria-label="QRouter home">
          <LogoMark size={26} />
          <strong>QROUTER</strong>
        </Link>

        <nav className={`ql-tabs ${open ? "open" : ""}`} aria-label="Site">
          {SECTION_TABS.map((tab) => (
            <a
              key={tab.id}
              href={`/#${tab.id}`}
              className={active === tab.id ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {tab.label}
            </a>
          ))}
          {PAGE_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={pathname === tab.href ? "active" : ""}
              onClick={() => setOpen(false)}
            >
              {tab.label}
            </Link>
          ))}
          <div className="ql-tabs-mobile-actions">
            <Link href="/dashboard" onClick={() => setOpen(false)}>
              Log in <ArrowUpRight />
            </Link>
            <Link href="/contact" className="cta" onClick={() => setOpen(false)}>
              Request access
            </Link>
          </div>
        </nav>

        <div className="ql-nav-actions">
          <Link href="/dashboard" className="ql-login">
            Log in <ArrowUpRight />
          </Link>
          <Link href="/contact" className="ql-cta">
            Request access
          </Link>
          <button
            type="button"
            className="ql-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {open && <button type="button" aria-label="Close menu" className="ql-scrim" onClick={() => setOpen(false)} />}
    </div>
  );
}
