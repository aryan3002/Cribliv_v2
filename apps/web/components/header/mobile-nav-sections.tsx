"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";
import type { NavPanel } from "../../lib/nav/types";

/**
 * The mobile-sheet counterpart to NavMenuBar's desktop dropdowns.
 *
 * Below 900px NavMenuBar's floating panels never mount (header.tsx's
 * useDesktopNav gates them out), so this accordion is the only place phone
 * users can reach the Rent / PG / Owners sub-links at all. It renders the
 * exact same NavPanel objects the desktop menu receives — passed in as
 * props, never rebuilt here — so mobile and desktop can never drift apart on
 * what links exist.
 *
 * Deliberately does not reuse NavPanelView: that component's `.nav-panel` is
 * an absolutely-positioned floating grid meant to hang off a hovered trigger
 * in the top bar, which does not make sense inside a scrolling in-page sheet.
 * The data and the accessible-name wiring (role="group" + aria-labelledby)
 * are the same; only the layout differs.
 */
export function MobileNavSections({
  locale,
  rent,
  pg,
  owners,
  onNavigate
}: {
  locale: Locale;
  rent: NavPanel;
  pg: NavPanel;
  owners: NavPanel;
  onNavigate: () => void;
}) {
  const [openId, setOpenId] = useState<NavPanel["id"] | null>(null);

  const sections = [
    { label: t(locale, "navMenuRent"), panel: rent },
    { label: t(locale, "navMenuPg"), panel: pg },
    { label: t(locale, "navMenuOwners"), panel: owners }
  ].filter((section) => section.panel.columns.length > 0);

  // Mirrors NavPanelView's own `if (columns.length === 0) return null`: a
  // caller that has no nav data (e.g. HeaderMenu's safe default) gets a sheet
  // with no accordions at all, rather than three headers over empty panels.
  if (sections.length === 0) return null;

  return (
    <div className="mobile-nav-sections">
      {sections.map(({ label, panel }) => {
        const isOpen = openId === panel.id;
        const triggerId = `mobile-nav-trigger-${panel.id}`;
        const panelId = `mobile-nav-panel-${panel.id}`;

        return (
          <div className="mobile-nav-section" key={panel.id}>
            <button
              type="button"
              id={triggerId}
              className={`mobile-nav-section__trigger${
                isOpen ? " mobile-nav-section__trigger--open" : ""
              }`}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenId(isOpen ? null : panel.id)}
            >
              <span>{label}</span>
              <ChevronDown size={16} className="mobile-nav-section__chevron" aria-hidden="true" />
            </button>

            {isOpen && (
              <div
                id={panelId}
                role="group"
                aria-labelledby={triggerId}
                className="mobile-nav-section__panel"
              >
                {panel.columns.map((column) => (
                  <div className="mobile-nav-section__col" key={column.title}>
                    <p className="mobile-nav-section__col-title">{column.title}</p>
                    {column.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href as Route}
                        className="mobile-nav-section__link"
                        onClick={onNavigate}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
