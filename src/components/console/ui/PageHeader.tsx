import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type Crumb = { href: string; label: string };

/** The page's only title. Detail pages pass `crumbs` for the path back. */
export function PageHeader({
  title,
  description,
  actions,
  crumbs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  crumbs?: Crumb[];
}) {
  return (
    <header className="page-header">
      <div>
        {crumbs?.length ? (
          <nav className="page-crumbs" aria-label="Breadcrumb">
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="row" style={{ gap: 6 }}>
                <Link href={crumb.href}>{crumb.label}</Link>
                <ChevronRight size={12} aria-hidden="true" />
              </span>
            ))}
          </nav>
        ) : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  );
}
