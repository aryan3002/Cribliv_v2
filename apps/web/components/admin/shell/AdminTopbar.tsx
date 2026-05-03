"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { formatRelativeTime } from "../../../lib/admin/format";

interface Props {
  title: string;
  lastRefreshed: number | null;
  onRefresh: () => void;
  onOpenCommand: () => void;
  refreshing?: boolean;
}

export function AdminTopbar({ title, lastRefreshed, onRefresh, onOpenCommand, refreshing }: Props) {
  // Re-render every 20s so "12s ago" stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 20_000);
    return () => window.clearInterval(t);
  }, []);

  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.userAgent);

  return (
    <header className="admin-topbar">
      <div className="admin-topbar__title">{title}</div>
      <div className="admin-topbar__spacer" />
      <button
        type="button"
        className="admin-topbar__search"
        onClick={onOpenCommand}
        aria-label="Open command palette"
      >
        <Search size={13} aria-hidden="true" />
        Jump to anything
        <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
        <kbd>K</kbd>
      </button>
      <span className="admin-topbar__refresh-meta">
        {lastRefreshed
          ? `updated ${formatRelativeTime(new Date(lastRefreshed).toISOString())}`
          : "—"}
      </span>
      <button
        type="button"
        className="admin-topbar__icon-btn"
        onClick={onRefresh}
        aria-label="Refresh"
        data-spinning={refreshing ? "true" : undefined}
      >
        <RefreshCw size={15} aria-hidden="true" />
      </button>
    </header>
  );
}
