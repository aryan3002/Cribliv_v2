"use client";

import Link from "next/link";
import type { Route } from "next";
import type { NavPanel } from "../../lib/nav/types";

/**
 * Presentational only. All link data — including every correctness rule about
 * which hrefs are legal — is decided by lib/nav/nav-model.ts. This component
 * must never construct a URL.
 */
export function NavPanelView({
  panel,
  labelledBy,
  onNavigate,
  id
}: {
  panel: NavPanel;
  labelledBy: string;
  onNavigate: () => void;
  id?: string;
}) {
  if (panel.columns.length === 0) return null;

  return (
    <div id={id} className="nav-panel" role="group" aria-labelledby={labelledBy}>
      <div className="nav-panel__grid">
        {panel.columns.map((col) => (
          <div className="nav-panel__col" key={col.title}>
            <p className="nav-panel__col-title">{col.title}</p>
            {col.links.map((link) => (
              <Link
                key={link.href}
                href={link.href as Route}
                className="nav-panel__link"
                onClick={onNavigate}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
