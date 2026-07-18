"use client";

// Scroll-reveal wrapper: adds .in once the element enters the viewport.
// Direction/stagger are CSS concerns (variants: up, left, right, zoom).
//
// Robustness: IntersectionObserver is the primary trigger, but some contexts
// (prerender, embedded/hidden documents) suspend IO callbacks — so we also
// check the rect directly at mount and on scroll/resize as a fallback. The
// content must never be lost to a missed observer callback.

import { useEffect, useRef, type ReactNode } from "react";

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
    let io: IntersectionObserver | null = null;

    const show = () => {
      if (done) return;
      done = true;
      el.classList.add("in");
      io?.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };

    const check = () => {
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight - 24 && rect.bottom > 0) show();
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      show();
      return;
    }

    io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) show();
      },
      { threshold: 0.14, rootMargin: "0px 0px -40px" },
    );
    io.observe(el);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check(); // already in view at mount → reveal immediately

    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
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
