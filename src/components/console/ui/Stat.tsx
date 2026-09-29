import Link from "next/link";
import type { ReactNode } from "react";

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function Stat({
  label,
  value,
  meta,
  tone,
  href,
  linkLabel,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: "warning" | "danger";
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
      {meta ? <small>{meta}</small> : null}
      {href && linkLabel ? <Link href={href}>{linkLabel}</Link> : null}
    </div>
  );
}
