"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A small "ⓘ" affordance that reveals a short explanation on hover / focus / tap.
 *
 * The popover is rendered into <body> via a portal and positioned with fixed
 * coordinates so it can't be clipped by the dashboard's `overflow-x-auto` table
 * wrapper or the `backdrop-filter` on the glass cards (both create clipping /
 * containing blocks for normal fixed descendants).
 */
export default function InfoTip({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const HALF = 150; // half of the 300px max width, for viewport clamping

  const place = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const center = Math.min(
      Math.max(r.left + r.width / 2, HALF + 8),
      window.innerWidth - HALF - 8,
    );
    setCoords({ top: r.bottom + 8, left: center });
  }, []);

  const show = useCallback(() => {
    place();
    setOpen(true);
  }, [place]);
  const hide = useCallback(() => setOpen(false), []);

  // Close on scroll / resize / Escape — the fixed popover would otherwise detach
  // from its trigger.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={title ? `About ${title}` : "More information"}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.preventDefault();
          if (open) hide();
          else show();
        }}
        className="ml-1 inline-grid h-3.5 w-3.5 shrink-0 cursor-help place-items-center rounded-full border border-white/25 font-sans text-[9px] font-bold normal-case leading-none text-[var(--muted)] transition-colors hover:border-white/55 hover:text-white"
      >
        i
      </button>
      {open &&
        coords &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: "translateX(-50%)",
              zIndex: 70,
              maxWidth: 300,
            }}
            className="pointer-events-none block rounded-xl border border-white/15 bg-[#15181d] px-3.5 py-3 text-left font-sans text-xs font-normal leading-relaxed tracking-normal text-[var(--muted)] shadow-2xl"
          >
            {title && (
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white">
                {title}
              </span>
            )}
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
