"use client";

// Scroll-reveal wrapper: adds .in once the element enters the viewport.
// Direction/stagger are CSS concerns (variants: up, left, right, zoom).
//
// One shared IntersectionObserver (plus one window scroll/resize fallback)
// instead of a listener pair per card. The landing page mounts ~17 of these.

import { useEffect, useRef, type ReactNode } from "react";

type RevealFn = () => void;

const watchers = new Map<Element, RevealFn>();
let sharedIo: IntersectionObserver | null = null;
let fallbackBound = false;

function checkRect(el: Element, show: RevealFn) {
  const rect = el.getBoundingClientRect();
  if (rect.top < window.innerHeight - 24 && rect.bottom > 0) show();
}

function onScrollOrResize() {
  for (const [el, show] of watchers) checkRect(el, show);
}

function ensureFallback() {
  if (fallbackBound) return;
  fallbackBound = true;
  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize);
}

function releaseFallback() {
  if (watchers.size > 0 || !fallbackBound) return;
  fallbackBound = false;
  window.removeEventListener("scroll", onScrollOrResize);
  window.removeEventListener("resize", onScrollOrResize);
}

function observeReveal(el: Element, show: RevealFn) {
  if (!sharedIo) {
    sharedIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) watchers.get(entry.target)?.();
        }
      },
      { threshold: 0.14, rootMargin: "0px 0px -40px" },
    );
  }
  watchers.set(el, show);
  sharedIo.observe(el);
  ensureFallback();
}

function unobserveReveal(el: Element) {
  watchers.delete(el);
  sharedIo?.unobserve(el);
  releaseFallback();
}

export default function Reveal({
  children,
  className = "",
  variant = "up",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  variant?: "up" | "left" | "right" | "zoom";
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      el.classList.add("in");
      unobserveReveal(el);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      show();
      return;
    }

    observeReveal(el, show);
    checkRect(el, show);

    return () => {
      unobserveReveal(el);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`ql-reveal ql-reveal-${variant} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
