import type { ReactNode } from "react";

/** Bordered surface with an optional title row. `flush` drops body padding for tables. */
export function Panel({
  title,
  description,
  actions,
  flush = false,
  className,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ""}`}>
      {title ? (
        <div className="panel-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="panel-head-actions">{actions}</div> : null}
        </div>
      ) : null}
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}
