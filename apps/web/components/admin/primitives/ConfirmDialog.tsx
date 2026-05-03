"use client";

import { useEffect, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
  onCancel,
  busy
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter" && !busy) onConfirm();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm, busy]);

  if (!open) return null;
  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onCancel} aria-hidden="true" />
      <div
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        style={{
          width: "min(420px, 92vw)",
          top: "50%",
          right: "50%",
          transform: "translate(50%, -50%)",
          bottom: "auto",
          borderRadius: 14
        }}
      >
        <header className="admin-drawer__head">
          <div className="admin-drawer__title">{title}</div>
        </header>
        <div className="admin-drawer__body">{body}</div>
        <footer className="admin-drawer__footer">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`admin-btn ${destructive ? "admin-btn--danger" : "admin-btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </footer>
      </div>
    </>
  );
}
