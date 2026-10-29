"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";

const LINKS = [
  { href: "/#workflow", label: "Product" },
  { href: "/research", label: "Research" },
  { href: "/pricing", label: "Value" },
];

export default function LandingNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const nav = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); toggle.current?.focus(); }
    };
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !nav.current?.contains(event.target)) setOpen(false);
    };
    const closeOnResize = () => setOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [open]);

  return (
    <header className="qt-nav" ref={nav}>
      <Link href="/" className="qt-wordmark" aria-label="QRouter home">QRouter<span aria-hidden="true">↗</span></Link>
      <nav id="public-navigation" className={"qt-nav-links" + (open ? " is-open" : "")} aria-label="Main navigation">
        {LINKS.map(({ href, label }) => (
          <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} onClick={() => setOpen(false)}>{label}</Link>
        ))}
        <Link className="qt-mobile-signin" href="/signin" onClick={() => setOpen(false)}>Sign in <ArrowUpRight size={14} /></Link>
      </nav>
      <div className="qt-nav-actions">
        <Link href="/signin" className="qt-signin">Sign in</Link>
        <Link href="/contact" className="qt-button qt-button-dark qt-nav-cta">Talk to us <ArrowUpRight size={15} /></Link>
        <button ref={toggle} className="qt-menu-toggle" type="button" aria-controls="public-navigation" aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} onClick={() => {
          setOpen(!open);
          if (!open) requestAnimationFrame(() => nav.current?.querySelector<HTMLAnchorElement>("#public-navigation a")?.focus());
        }}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
    </header>
  );
}
