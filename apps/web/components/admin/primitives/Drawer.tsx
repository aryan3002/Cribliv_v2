"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

export function Drawer({ open, onClose, title, subtitle, children, footer }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside
        className="admin-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
      >
        <header className="admin-drawer__head">
          <div>
            {title && <div className="admin-drawer__title">{title}</div>}
            {subtitle && <div className="admin-drawer__sub">{subtitle}</div>}
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--icon"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <div className="admin-drawer__body">{children}</div>
        {footer && <footer className="admin-drawer__footer">{footer}</footer>}
      </aside>
    </>
  );
}
