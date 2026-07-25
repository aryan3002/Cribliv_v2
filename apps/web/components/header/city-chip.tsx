"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
// Type-only import: erased at compile time, so this never pulls nav-model.ts
// (and the ~46 KB of city prose behind it) into the client bundle. Links
// arrive as a prop from the server-rendered parent instead — see the header
// comment below.
import type { NavLink, NavLocale } from "../../lib/nav/types";

const DEFAULT_CITY_LABEL = "Lucknow";

/**
 * Turns a kebab-case slug into a display label: "greater-noida" -> "Greater Noida".
 * Every current HUB_CITIES slug is a single word, so this is equivalent to a
 * plain capitalize — the hyphen-splitting just keeps it correct if a
 * multi-word slug is ever added.
 */
function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(" ");
}

/**
 * Derives the display label from the current pathname with a single regex,
 * anchored to the active locale so a route belonging to a different locale
 * segment can never mislabel the chip. Recognises /{locale}/city/{slug},
 * /{locale}/pg/{slug} and /{locale}/rent-in/{slug} (and any deeper path under
 * them, e.g. a locality sub-page); anything else — including no match at all
 * — falls back to the default city.
 */
function cityLabelFromPathname(pathname: string | null, locale: NavLocale): string {
  if (!pathname) return DEFAULT_CITY_LABEL;
  const match = pathname.match(new RegExp(`^/${locale}/(?:city|pg|rent-in)/([a-z0-9-]+)`));
  return match ? titleCaseSlug(match[1]) : DEFAULT_CITY_LABEL;
}

/**
 * The city chip just right of the logo: shows the city derived from the
 * current route and opens a small popover to switch. All link data —
 * including which cities exist and what URL each one is — is decided
 * upstream by lib/nav/nav-model.ts's cityChipLinks(); this component only
 * ever renders the hrefs it is given, never constructs one.
 */
export function CityChip({
  locale,
  links,
  hidden
}: {
  locale: NavLocale;
  links: NavLink[];
  hidden: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reactId = useId();
  const triggerId = `city-chip-trigger-${reactId}`;
  const popoverId = `city-chip-popover-${reactId}`;

  const close = useCallback(() => setOpen(false), []);

  // Close on outside pointerdown / Escape — same pattern as NavMenuBar.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  if (hidden) return null;

  const label = cityLabelFromPathname(pathname, locale);

  return (
    <div className="city-chip" ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className={`city-chip__trigger${open ? " city-chip__trigger--open" : ""}`}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => setOpen((v) => !v)}
      >
        <MapPin size={14} aria-hidden="true" />
        <span>{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {open && (
        <div id={popoverId} className="city-chip__popover" role="group" aria-labelledby={triggerId}>
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href as Route}
              className="city-chip__link"
              onClick={close}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
