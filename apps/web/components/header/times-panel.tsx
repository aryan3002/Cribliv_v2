"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import type { NavLocale, NavPanel } from "../../lib/nav/types";
import { loadTimesPosts, type TimesPost } from "../../lib/nav/times-posts";
import { BLOG_DESKS } from "../../lib/blog-desks";
import { t } from "../../lib/i18n";

// Small, static (7-line) data — NOT the ~46 KB nav-model.ts/nav-data.ts the
// rest of this file's doc comment warns against — so it is safe to
// value-import here. Used only to translate a post's category slug into the
// same desk label buildTimesPanel already put in the Desks column, without
// re-deriving it from that column's hrefs.
function deskKicker(category: string | null, hi: boolean): string {
  const desk = BLOG_DESKS.find((d) => d.slug === category);
  if (desk) return hi ? desk.hi : desk.en;
  return t(hi ? "hi" : "en", "navTimesReport");
}

/** "20 Jul 2026" — short, locale-aware, and pure: never touches Date.now(). */
function formatByDate(iso: string | null | undefined, locale: NavLocale): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(d);
}

function Byline({ post, locale }: { post: TimesPost; locale: NavLocale }) {
  const hi = locale === "hi";
  const date = formatByDate(post.publishedAt, locale);
  if (!post.author && !date) return null;
  return (
    <p className="times-panel__byline">
      {post.author ? `${hi ? "द्वारा " : "By "}${post.author}` : ""}
      {post.author && date ? " · " : ""}
      {date}
    </p>
  );
}

/**
 * Cribliv Times' hover panel: the desks column from `panel` — built
 * server-side by lib/nav/nav-model.ts's buildTimesPanel, so this component
 * never constructs a desk URL — plus a front-page-in-miniature built from
 * posts loaded client-side: a lead story (kicker/headline/dek/byline), an
 * "Also Reported" rail of up to 3 more headlines, and a static link into the
 * blog hub itself (`/{locale}/blog` — the one URL this file builds outside
 * nav-model.ts, matching the identical hardcoded href header.tsx already
 * gives the Cribliv Times trigger itself; per-post permalinks are the other
 * sanctioned exception, and come straight off the API response).
 *
 * Rendered via nav-menu-bar.tsx's `renderPanel` escape hatch instead of the
 * static NavPanelView, because the posts are not known until a fetch
 * resolves. The panel only mounts when its trigger is hovered (see
 * nav-menu-bar.tsx), so mounting the component IS the first hover — the
 * effect below has no other trigger to wait for.
 *
 * `id`/`labelledBy` are the same identity NavPanelView takes as props
 * (nav-panel.tsx) — put them on this component's own root, not a wrapper
 * around it, so the id/role="group"/aria-labelledby triple lands on the
 * exact node `.nav-panel` (position: absolute) styles. Optional only so this
 * component stays renderable standalone in isolation (see times-panel.test.tsx);
 * nav-menu-bar.tsx always supplies both in real usage.
 *
 * Never a value-import of lib/nav/nav-model.ts: this file (and header.tsx,
 * which renders it) sits in the root layout's client bundle for every route,
 * and that module pulls in ~46 KB of city prose, FAQs and rent tips. `panel`
 * arrives fully built as a prop instead — see lib/nav/types.ts.
 */
export function TimesPanel({
  locale,
  panel,
  onNavigate,
  id,
  labelledBy
}: {
  locale: NavLocale;
  panel: NavPanel;
  onNavigate: () => void;
  id?: string;
  labelledBy?: string;
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

  const hi = locale === "hi";
  const lead = posts[0] ?? null;
  // Capped at 3 (MAX_POSTS in the route is 4 total) so the rail never grows
  // past what the lead story visually balances.
  const secondary = posts.slice(1, 4);
  const hasLead = lead !== null;
  const hasRail = secondary.length > 0;

  // Width-only modifiers (globals.css) — desks-only, lead-only and
  // lead+rail each get a deliberately different panel width instead of one
  // full-width box holding a variable amount of sparse content. See the
  // regression test pinning this in times-panel.test.tsx.
  const rootClassName = [
    "nav-panel",
    "nav-panel--times",
    hasLead && "nav-panel--times-lead",
    hasRail && "nav-panel--times-rail"
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div id={id} className={rootClassName} role="group" aria-labelledby={labelledBy}>
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

        {hasLead && lead && (
          <div className="times-panel__stories">
            <div className="times-panel__lead">
              <p className="times-panel__kicker">{deskKicker(lead.category, hi)}</p>
              <Link
                href={`/${locale}/blog/${lead.slug}` as Route}
                className="times-panel__lead-link"
                onClick={onNavigate}
              >
                <h3 className="times-panel__headline">{lead.title}</h3>
              </Link>
              {lead.excerpt ? <p className="times-panel__dek">{lead.excerpt}</p> : null}
              <Byline post={lead} locale={locale} />
            </div>

            {hasRail && (
              <div className="times-panel__rail">
                <p className="times-panel__rail-head">{t(locale, "navTimesAlsoReported")}</p>
                {secondary.map((post) => (
                  // The kicker sits OUTSIDE the anchor (matching the lead
                  // story above): nested inside, its text would fold into the
                  // link's accessible name ("Tenancy Tenant Rights 101"
                  // instead of just the headline), which is both a
                  // screen-reader regression and what broke this component's
                  // own tests the first time it was written this way.
                  <div className="times-panel__rail-item" key={post.slug}>
                    <p className="times-panel__kicker times-panel__kicker--sm">
                      {deskKicker(post.category, hi)}
                    </p>
                    <Link
                      href={`/${locale}/blog/${post.slug}` as Route}
                      className="times-panel__rail-link"
                      onClick={onNavigate}
                    >
                      <p className="times-panel__rail-title">{post.title}</p>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="times-panel__footer">
        <Link
          href={`/${locale}/blog` as Route}
          className="times-panel__footer-link"
          onClick={onNavigate}
        >
          {t(locale, "navTimesReadAll")}
        </Link>
      </div>
    </div>
  );
}
