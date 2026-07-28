import Link from "next/link";
import type { Route } from "next";
import { buildPgPanel, buildRentPanel, type NavLocale } from "../../lib/nav/nav-model";
import { t } from "../../lib/i18n";

/**
 * Mobile-only row of intent chips for the three browse pages (Homes search,
 * PG search, city hub). Desktop reaches these same links through the
 * header's Rent / PG & Co-living mega-menu panels (nav-menu-bar.tsx via
 * header.tsx), which never mount below 900px (see header.tsx's
 * useDesktopNav) — this rail is the only way phone users reach them.
 *
 * Deliberately a plain Server Component with no "use client": horizontal
 * scroll needs only CSS `overflow-x: auto` (globals.css `.intent-rail`), so
 * there is no interaction here to justify shipping this to the client. And
 * unlike everywhere else in the header work, this file MAY value-import
 * nav-model.ts — the client-bundle constraint on that module exists only
 * because the header renders in the root layout. This rail renders inside a
 * page instead, so the ~46 KB of city prose behind nav-model.ts is used to
 * produce server-rendered HTML and never reaches client JS. nav-model is
 * pure and synchronous (no fetch), so mounting this adds no dynamic-
 * rendering risk to the (possibly ISR'd) page it sits on.
 *
 * Sources every href from the same builder the desktop panel uses — one
 * source of truth — filtered to intent columns only (`kind !== "place"`).
 * The locality / PG-hub column is long and place-specific, wrong for a
 * compact chip row. This component never constructs a URL itself.
 */
export function IntentChipRail({
  locale,
  citySlug,
  surface
}: {
  locale: NavLocale;
  citySlug: string;
  surface: "rent" | "pg";
}) {
  const panel =
    surface === "pg" ? buildPgPanel(locale, citySlug) : buildRentPanel(locale, citySlug);
  const chips = panel.columns
    .filter((column) => column.kind !== "place")
    .flatMap((column) => column.links);

  if (chips.length === 0) return null;

  return (
    <nav className="intent-rail" aria-label={t(locale, "navIntentRailLabel")}>
      {chips.map((chip) => (
        <Link key={chip.href} href={chip.href as Route} className="intent-rail__chip">
          {chip.label}
        </Link>
      ))}
    </nav>
  );
}
