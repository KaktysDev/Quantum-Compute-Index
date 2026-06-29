"use client";

import { useEffect, useRef, useState } from "react";

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
}: {
  price: number;
  changePct: number;
  source: "live" | "sample";
  asOf: string;
  size?: "hero" | "panel";
}) {
  const animated = useCountUp(price);
  const up = changePct >= 0;
  const big = size === "hero" ? "text-7xl sm:text-8xl" : "text-5xl sm:text-6xl";
  const dollar = size === "hero" ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl";

  return (
    <div className="w-full max-w-md">
      <div className="hairline" />

      <div className="mt-6 flex items-end justify-between gap-6">
        <div className="serif leading-[0.85] text-white">
          <span className={`align-top text-[var(--muted)] ${dollar}`}>$</span>
          <span className={big}>
            {animated.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>

        <div className="flex flex-col items-start gap-2 pb-2">
          <span className="mono-label flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 animate-pulse-soft bg-white" />
            QCI Index
          </span>
          <span className="tabular text-sm text-[var(--muted)]">
            {up ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="mt-7">
        <p className="mono-label">
          {source === "sample" ? "Sample · Index Updated" : "Index Updated"}
        </p>
        <p className="tabular mt-1.5 text-sm text-[var(--muted)]">
          &lt;&nbsp;&nbsp;{asOf} · 9:30 AM ET&nbsp;&nbsp;&gt;
        </p>
      </div>
    </div>
  );
}
