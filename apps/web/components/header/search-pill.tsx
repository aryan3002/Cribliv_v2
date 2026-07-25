"use client";

// This component calls useSearchParams(), which is a Next 14 build error on
// any statically rendered route unless the tree above it is wrapped in
// <Suspense>. The header mounts in the root layout, so SearchPill MUST be
// mounted inside a <Suspense fallback={null}> boundary -- that wrapping is
// Task 9's job (it owns the mount point), not this file's. See
// components/analytics/pageview-tracker.tsx + app/[locale]/layout.tsx:53 for
// the existing precedent and the reason: keeping every route statically
// rendered / ISR.

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { t } from "../../lib/i18n";
import { HUB_CITIES } from "../../lib/nav/cities";
import type { NavLocale } from "../../lib/nav/types";

/**
 * kebab-case slug -> Title Case label, e.g. "gomti-nagar" -> "Gomti Nagar".
 * A local copy of the same small helper in city-chip.tsx / lib/nav/localities.ts
 * -- duplicated rather than imported, matching this codebase's convention of
 * keeping tiny pure formatters local to their call site (see also the several
 * local `formatRent` copies under components/).
 */
function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * Resolves a city or locality slug to a display label. HUB_CITIES only ever
 * lists the 8 hub cities, so a locality slug (or a city outside the hub list,
 * e.g. "varanasi") always falls through to the title-cased raw slug -- that
 * is the brief's "renders its raw value rather than blanking", and it's what
 * turns a `locality=gomti-nagar` param into "Gomti Nagar".
 */
function placeLabel(slug: string): string {
  return HUB_CITIES.find((c) => c.slug === slug)?.label ?? titleCaseSlug(slug);
}

/**
 * ₹ formatting in the same spirit as the local `formatRent` helpers in
 * search-hero.tsx / SearchSuggestionsDropdown.tsx (thousands as "k", lakhs as
 * "L"). Kept as its own local copy rather than imported: those live in much
 * heavier components this header-resident pill shouldn't pull in.
 */
function formatRent(value: number): string {
  if (value >= 100_000) {
    return `₹${(value / 100_000).toFixed(value % 100_000 === 0 ? 0 : 1)}L`;
  }
  if (value >= 1000) {
    return `₹${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return `₹${value}`;
}

/**
 * True only for the two query-param-driven results pages (/search, /pg) --
 * the sole routes where the current querystring is worth carrying onto the
 * pill's target. Everything else (city/locality SEO pages, listing detail,
 * the homepage, ...) either ignores these params or means something
 * different by them, so dragging them onto /search would be noise.
 */
function isSearchLikeRoute(pathname: string, locale: NavLocale): boolean {
  return pathname === `/${locale}/search` || pathname === `/${locale}/pg`;
}

/**
 * Compact summary of the current search, shown in place of the city chip
 * once the page has scrolled (or on any inner page). Derived synchronously
 * from the URL -- no fetch, no state, no effects -- so it can never disagree
 * with the page it is summarising. Visibility is decided by the composing
 * header (Task 9); this component always renders its pill when mounted.
 */
export function SearchPill({ locale }: { locale: NavLocale }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();

  const q = searchParams?.get("q")?.trim() ?? "";
  const bhk = searchParams?.get("bhk")?.trim() ?? "";
  const locality = searchParams?.get("locality")?.trim() ?? "";
  const city = searchParams?.get("city")?.trim() ?? "";
  const maxRentRaw = searchParams?.get("max_rent")?.trim() ?? "";

  let label = q;
  if (!label) {
    const place = locality || city;
    const bhkPart = bhk ? `${bhk} BHK` : "";
    const placePart = place ? placeLabel(place) : "";
    const composed = [bhkPart, placePart].filter(Boolean).join(" in ");

    // Guard the empty string explicitly: Number("") is 0, not NaN, which
    // would otherwise make an absent max_rent render as "Under ₹0".
    const maxRent = maxRentRaw ? Number(maxRentRaw) : NaN;
    const maxRentPart = Number.isFinite(maxRent) ? `Under ${formatRent(maxRent)}` : "";

    label = [composed, maxRentPart].filter(Boolean).join(" · ");
  }

  if (!label) label = t(locale, "navSearchPlaceholder");

  const qs = searchParams?.toString() ?? "";
  const href = (
    isSearchLikeRoute(pathname, locale) && qs ? `/${locale}/search?${qs}` : `/${locale}/search`
  ) as Route;

  return (
    <Link href={href} className="search-pill" title={label}>
      <Search size={14} aria-hidden="true" />
      <span className="search-pill__text">{label}</span>
    </Link>
  );
}
