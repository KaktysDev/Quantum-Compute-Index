import type { ReactNode } from "react";

export default function GlassCard({
  children,
  className = "",
  strong = false,
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  strong?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={`${strong ? "glass-strong" : "glass"} ${
        hover ? "glass-hover" : ""
      } rounded-2xl ${className}`}
    >
      {children}
    </div>
  );
}
