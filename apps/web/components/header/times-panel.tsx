"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import type { NavLocale, NavPanel } from "../../lib/nav/types";
import { loadTimesPosts, type TimesPost } from "../../lib/nav/times-posts";
import { t } from "../../lib/i18n";

/**
 * Cribliv Times' hover panel: the desks column from `panel` — built
 * server-side by lib/nav/nav-model.ts's buildTimesPanel, so this component
 * never constructs a desk URL — plus a "Latest" column loaded client-side.
 *
 * Rendered via nav-menu-bar.tsx's `renderPanel` escape hatch instead of the
 * static NavPanelView, because the second column is not known until a fetch
 * resolves. The panel only mounts when its trigger is hovered (see
 * nav-menu-bar.tsx), so mounting the component IS the first hover — the
 * effect below has no other trigger to wait for.
 *
 * Never a value-import of lib/nav/nav-model.ts: this file (and header.tsx,
 * which renders it) sits in the root layout's client bundle for every route,
 * and that module pulls in ~46 KB of city prose, FAQs and rent tips. `panel`
 * arrives fully built as a prop instead — see lib/nav/types.ts.
 */
export function TimesPanel({
  locale,
  panel,
  onNavigate
}: {
  locale: NavLocale;
  panel: NavPanel;
  onNavigate: () => void;
}) {
  const [posts, setPosts] = useState<TimesPost[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadTimesPosts().then((loaded) => {
      if (!cancelled) setPosts(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mirrors NavPanelView's own "nothing to show" guard. Only reachable when a
  // caller has no real desk data (e.g. a safe EMPTY_NAV_DATA default) AND the
  // posts request hasn't produced anything either — real usage always has the
  // four desks from buildTimesPanel.
  if (panel.columns.length === 0 && posts.length === 0) return null;

  return (
    <div className="nav-panel nav-panel--times">
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
        {posts.length > 0 && (
          <div className="nav-panel__col">
            <p className="nav-panel__col-title">{t(locale, "navTimesLatest")}</p>
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/${locale}/blog/${post.slug}` as Route}
                className="nav-panel__link"
                onClick={onNavigate}
              >
                {post.title}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
