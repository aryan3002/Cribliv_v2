"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import type { Locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";
// Type-only import, same discipline as mobile-nav-sections.tsx: NavLink is a
// plain { label, href } shape, never the value-importable nav-model.ts.
import type { NavLink } from "../../lib/nav/types";

const DEFAULT_CITY_LABEL = "Lucknow";

/**
 * Turns a kebab-case slug into a display label. Deliberately duplicated from
 * city-chip.tsx rather than imported/shared — that mirrors this codebase's
 * existing precedent for this exact helper (search-pill.tsx and
 * lib/nav/localities.ts each already keep their own copy too), and city-chip's
 * version isn't exported.
 */
function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * Identical derivation to city-chip.tsx's own (unexported)
 * cityLabelFromPathname: same regex, same fallback. Deliberately duplicated,
 * not invented anew — the whole point of this trigger's label is to agree
 * with what the desktop chip would show on the same route, and there is only
 * one correct way to compute that.
 */
function cityLabelFromPathname(pathname: string | null, locale: Locale): string {
  if (!pathname) return DEFAULT_CITY_LABEL;
  const match = pathname.match(new RegExp(`^/${locale}/(?:city|pg|rent-in)/([a-z0-9-]+)`));
  return match ? titleCaseSlug(match[1]) : DEFAULT_CITY_LABEL;
}

/**
 * The hamburger sheet's counterpart to the desktop city chip (city-chip.tsx).
 *
 * Rendered as its own section, above MobileNavSections' Rent/PG/Owners
 * accordions, rather than folded in as a fourth same-weight one: on desktop
 * the city chip sits leftmost, immediately after the logo and before every
 * nav menu — a hierarchy signal that picking a city outranks picking a
 * browse category. This mirrors that ordering inside the sheet instead of
 * flattening it away.
 *
 * Deliberately does not mark a "current" city inside the expanded list:
 * city-chip.tsx's own popover doesn't either — it renders every link with no
 * active-state at all. Only the *trigger* reflects the current city, via the
 * exact same pathname-derived label as the desktop chip. Matching that
 * omission keeps this from inventing a highlight desktop has never had.
 */
export function MobileCitySection({
  locale,
  cities,
  onNavigate
}: {
  locale: Locale;
  cities: NavLink[];
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Mirrors MobileNavSections' own empty-safe default: a caller with no nav
  // data (e.g. HeaderMenu's safe default) gets a sheet with no city section
  // at all, rather than a trigger over an empty list.
  if (cities.length === 0) return null;

  const cityLabel = cityLabelFromPathname(pathname, locale);
  const triggerId = "mobile-city-section-trigger";
  const panelId = "mobile-city-section-panel";

  return (
    <div className="mobile-city-section">
      <button
        type="button"
        id={triggerId}
        className={`mobile-city-section__trigger${
          open ? " mobile-city-section__trigger--open" : ""
        }`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <MapPin size={16} aria-hidden="true" />
        <span className="mobile-city-section__trigger-label">{t(locale, "menuChangeCity")}</span>
        <span className="mobile-city-section__trigger-value">{cityLabel}</span>
        <ChevronDown size={16} className="mobile-city-section__chevron" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={triggerId}
          className="mobile-city-section__panel"
        >
          {cities.map((city) => (
            <Link
              key={city.href}
              href={city.href as Route}
              className="mobile-city-section__link"
              onClick={onNavigate}
            >
              {city.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
