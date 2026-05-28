"use client";

import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface Props {
  title: string;
  hint?: string;
  icon?: ReactNode;
}

export function EmptyState({ title, hint, icon }: Props) {
  return (
    <div className="admin-empty">
      <div className="admin-empty__icon">{icon ?? <Inbox size={18} aria-hidden="true" />}</div>
      <div className="admin-empty__title">{title}</div>
      {hint && <div className="admin-empty__hint">{hint}</div>}
    </div>
  );
}
