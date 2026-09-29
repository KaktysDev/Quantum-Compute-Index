"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog> confirmation. The caller owns `open` and runs the action. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  busy = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="qr-dialog" onClose={onClose} onCancel={(event) => busy && event.preventDefault()}>
      <div>
        <header>
          <h2>{title}</h2>
        </header>
        <div className="dialog-body">
          <div className="muted">{body}</div>
          {error}
        </div>
        <footer>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
