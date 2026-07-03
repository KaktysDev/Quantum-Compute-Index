"use client";

import { useEffect, useRef, useState } from "react";
import { formatChangePct } from "@/lib/qci/format";

function useCountUp(target: number, duration = 1400) {
  const [value, setValue] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    startRef.current = null;
    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const p = Math.min((t - startRef.current) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}

export default function PriceDisplay({
  price,
  changePct,
  source,
  asOf,
  size = "hero",
  label = "QCI Index",
  caption,
}: {
  price: number;
  changePct: number;
  source: "live" | "sample";
  asOf: string;
  size?: "hero" | "panel";
  /** Badge shown next to the % change. */
  label?: string;
  /** Optional small line under the headline number (e.g. the unit). */
  caption?: string;
}) {
  const animated = useCountUp(price);
  const big = size === "hero" ? "text-7xl sm:text-8xl" : "text-5xl sm:text-6xl";
  const dollar = size === "hero" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl";

  return (
    <div className="w-full max-w-md">
      <div className="hairline" />

      <div className="mt-6 flex items-end justify-between gap-6">
        <div className="leading-[0.9] tracking-[-0.045em] text-white">
          <span className={`align-top text-[var(--muted)] ${dollar}`}>$</span>
          <span className={`tabular font-medium ${big}`}>
            {animated.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>

        <div className="flex flex-col items-start gap-2 pb-2">
          <span className="mono-label flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-white/60" />
            {label}
          </span>
          <span className="tabular text-sm text-white/75">{formatChangePct(changePct)}</span>
        </div>
      </div>

      {caption && (
        <p className="mono-label mt-2 normal-case tracking-normal text-[var(--muted)]">{caption}</p>
      )}

      <div className="mt-7">
        <p className="mono-label">
          {source === "sample" ? "Sample · Index Updated" : "Index Updated"}
        </p>
        <p className="tabular mt-1.5 text-xs text-[var(--muted)]">
          {asOf} · 9:30 AM ET
        </p>
      </div>
    </div>
  );
}
