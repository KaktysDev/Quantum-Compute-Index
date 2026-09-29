import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";

const ICONS = { info: Info, warning: AlertTriangle, danger: AlertCircle, success: CheckCircle2 };

export function InlineAlert({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: keyof typeof ICONS;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div className={`alert ${tone === "info" ? "" : tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon size={15} />
      <div>
        {title ? <b>{title}</b> : null}
        {children ? <span>{children}</span> : null}
      </div>
      {action ? <div className="alert-action">{action}</div> : null}
    </div>
  );
}
