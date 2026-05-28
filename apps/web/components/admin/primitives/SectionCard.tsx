"use client";

import type { ReactNode } from "react";

interface Props {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
  className?: string;
}

export function SectionCard({ title, subtitle, action, flush, children, className }: Props) {
  return (
    <section className={`admin-card${className ? ` ${className}` : ""}`}>
      {(title || action) && (
        <header className="admin-card__head">
          <div>
            {title && <div className="admin-card__title">{title}</div>}
            {subtitle && <div className="admin-card__sub">{subtitle}</div>}
          </div>
          {action && <div>{action}</div>}
        </header>
      )}
      <div className={`admin-card__body${flush ? " admin-card__body--flush" : ""}`}>{children}</div>
    </section>
  );
}
