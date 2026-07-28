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
 * The results surface the current route IS, or null when it is not one of the
 * two query-param-driven results pages -- the sole routes where the current
 * querystring is worth carrying onto the pill's target. Everything else
 * (city/locality SEO pages, listing detail, the homepage, ...) either ignores
 * these params or means something different by them, so dragging them onto a
 * results page would be noise.
 *
 * Returning WHICH surface, not just whether, is load-bearing: /search forces
 * listing_type=flat_house server-side (app/[locale]/search/page.tsx) and has no
 * sharing/gender_policy/tenant_type filter at all, so sending a /pg visitor's
 * querystring there silently drops every PG filter they had chosen and swaps
 * their PG results for unfiltered flats. The pill must keep them on /pg.
 */
function searchSurface(pathname: string, locale: NavLocale): "search" | "pg" | null {
  if (pathname === `/${locale}/search`) return "search";
  if (pathname === `/${locale}/pg`) return "pg";
  return null;
}

/**
 * PG filter values -> the labels the rest of the product already shows for
 * them. Lookup maps rather than title-casing the raw value, so an unrecognised
 * value is skipped instead of rendered as-is: `sharing` and `gender_policy` are
 * closed vocabularies (lib/nav/surface-params.ts), and "Xyz sharing" in the
 * header would be worse than saying nothing. English-only, matching the
 * existing "2 BHK in Gomti Nagar" summary, which is locale-invariant by design.
 */
const PG_GENDER_LABELS: Record<string, string> = {
  girls: "Girls PG",
  boys: "Boys PG",
  coed: "Co-ed PG"
};
const PG_SHARING_LABELS: Record<string, string> = {
  single: "Single sharing",
  double: "Double sharing",
  triple: "Triple sharing",
  quad: "Four sharing"
};
// `any` is deliberately absent: it is the no-op default, so it adds nothing.
const PG_TENANT_LABELS: Record<string, string> = {
  students: "For students",
  working: "For working professionals"
};

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

  const surface = searchSurface(pathname, locale);
  const isPg = surface === "pg";

  const q = searchParams?.get("q")?.trim() ?? "";
  const bhk = searchParams?.get("bhk")?.trim() ?? "";
  const locality = searchParams?.get("locality")?.trim() ?? "";
  const city = searchParams?.get("city")?.trim() ?? "";
  const maxRentRaw = searchParams?.get("max_rent")?.trim() ?? "";

  let label = q;
  if (!label) {
    const place = locality || city;
    const placePart = place ? placeLabel(place) : "";

    // The "what kind of home" half of the summary. On /pg the flats vocabulary
    // (bhk) does not exist -- PG inventory is described by who it is for and
    // how many share a room -- so read the PG params the page actually honours
    // (lib/nav/surface-params.ts PG_PARAMS) instead. Same order the on-page PG
    // filter bar shows them in (components/pg/PgFilters.tsx).
    const kindPart = isPg
      ? [
          PG_GENDER_LABELS[searchParams?.get("gender_policy")?.trim() ?? ""],
          PG_SHARING_LABELS[searchParams?.get("sharing")?.trim() ?? ""],
          PG_TENANT_LABELS[searchParams?.get("tenant_type")?.trim() ?? ""]
        ]
          .filter(Boolean)
          .join(" · ")
      : bhk
        ? `${bhk} BHK`
        : "";

    const composed = [kindPart, placePart].filter(Boolean).join(" in ");

    // Guard the empty string explicitly: Number("") is 0, not NaN, which
    // would otherwise make an absent max_rent render as "Under ₹0".
    const maxRent = maxRentRaw ? Number(maxRentRaw) : NaN;
    const maxRentPart = Number.isFinite(maxRent) ? `Under ${formatRent(maxRent)}` : "";

    label = [composed, maxRentPart].filter(Boolean).join(" · ");
  }

  if (!label) label = t(locale, isPg ? "navSearchPlaceholderPg" : "navSearchPlaceholder");

  const qs = searchParams?.toString() ?? "";
  const base = `/${locale}/${isPg ? "pg" : "search"}`;
  const href = (surface && qs ? `${base}?${qs}` : base) as Route;

  return (
    // aria-label duplicates the visible label deliberately. Below 640px the
    // CSS hides .search-pill__text and shows the magnifier alone, and
    // `display: none` removes that text from the accessibility tree too --
    // leaving `title` as the only accessible name, which touch screen readers
    // announce inconsistently. Naming the link explicitly keeps the summary
    // available at every width. On wider screens the label is visible and the
    // two strings are identical, so "label in name" still holds.
    <Link href={href} className="search-pill" title={label} aria-label={label}>
      <Search size={14} aria-hidden="true" />
      <span className="search-pill__text">{label}</span>
    </Link>
  );
}
