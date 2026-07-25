"use client";

import Link from "next/link";
import type { Route } from "next";
import { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  BarChart3,
  Building2,
  Globe,
  LayoutDashboard,
  Map,
  Newspaper,
  Plus,
  UsersRound
} from "lucide-react";
import type { Locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";
import { HeaderMenu } from "../header-menu";
import { BrandLockup } from "../brand/brand-lockup";
import { getPgDashboardLinks } from "../pg-operator/dashboard-links";
import { CityChip } from "./city-chip";
import { NavMenuBar, type NavMenuItem } from "./nav-menu-bar";
import { SavedIcon } from "./saved-icon";
import { SearchPill } from "./search-pill";
// Type-only, and it must stay that way: lib/nav/nav-model.ts and nav-data.ts
// pull ~46 KB of city prose, FAQs and rent tips, and this component renders in
// the root layout. The panels arrive as a prop that app/[locale]/layout.tsx
// (a Server Component) builds — see lib/nav/nav-data.ts.
import type { NavData, NavPanel } from "../../lib/nav/types";

const pgIcons = [LayoutDashboard, BarChart3, Building2, UsersRound];

/**
 * The viewport at which `.nav-center` becomes visible (globals.css hides it
 * below this). Exported so the test asserts against the real constant rather
 * than a hard-coded copy, same as nav-menu-bar.tsx's timing constants.
 */
export const DESKTOP_MEDIA_QUERY = "(min-width: 900px)";

const emptyPanel = (id: NavPanel["id"]): NavPanel => ({ id, columns: [] });

/**
 * Safe default for `navData`. The header's pre-existing regression suites
 * render `<Header locale="en" />` with no panels, and every route that is not
 * under `app/[locale]` (e.g. a future top-level page) would too — a missing
 * prop must degrade to a nav with no panels, never throw.
 */
const EMPTY_NAV_DATA: NavData = {
  rent: emptyPanel("rent"),
  pg: emptyPanel("pg"),
  owners: emptyPanel("owners"),
  times: emptyPanel("times"),
  cities: []
};

/**
 * True at >= 900px, where the centre nav is actually visible.
 *
 * Below that breakpoint the panels must not mount at all. `.nav-center` is
 * `display: none` there, so a trigger cannot be hovered and a panel could not
 * open anyway — but the panel data would still be handed to NavMenuBar, and a
 * single stray CSS change would start mounting hundreds of invisible links on
 * phones. Gating it here makes the rule explicit and testable instead of an
 * emergent property of a stylesheet.
 *
 * Starts `true` so the server markup and the first client render agree; the
 * effect corrects it on mount. Nothing visible moves either way, because CSS
 * has already hidden the row on those viewports.
 */
function useDesktopNav(): boolean {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  return isDesktop;
}

export function Header({
  locale,
  navData = EMPTY_NAV_DATA
}: {
  locale: Locale;
  navData?: NavData;
}) {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  const role = session?.user?.role;
  const isPgOperatorRoute = pathname?.startsWith(`/${locale}/pg-operator`) ?? false;
  const pgLinks = getPgDashboardLinks(locale);
  const desktopNav = useDesktopNav();

  // Role-aware "Post Property" target. Only owners / pg-operators can reach the
  // listing flow; sending anyone else (tenants, admins, guests) to an owner-only
  // route just dead-ends them at /403. Route non-hosts to the become-owner funnel
  // instead so the "+" always leads somewhere actionable.
  const isPgOperatorHost = role === "pg_operator" || isPgOperatorRoute;
  const hostLinkHref = (
    isPgOperatorHost
      ? `/${locale}/pg-operator/listings/new`
      : role === "owner"
        ? `/${locale}/owner/dashboard`
        : `/${locale}/become-owner`
  ) as Route;
  const hostLinkLabel = isPgOperatorHost ? "New listing" : t(locale, "navPostProperty");
  // Short label for the compact mobile pill so the action stays obvious
  // without the full "Post Property" width.
  const hostLinkShort = isPgOperatorHost
    ? locale === "en"
      ? "New"
      : "नया"
    : locale === "en"
      ? "List"
      : "पोस्ट";

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const isActive = (href: string) => {
    if (!pathname) return false;
    if (href === `/${locale}`) return pathname === `/${locale}` || pathname === "/";
    return pathname.startsWith(href);
  };

  // Compact left cluster (spec §1): once the homepage has scrolled — and on
  // every inner page, which always has a search or a place to summarise — the
  // city chip and the हिंदी pill yield their space to the search pill. The
  // PG-operator workspace is excluded: it brings its own chrome and has no
  // public search to summarise, so its bar is left exactly as it was.
  const compact = !isPgOperatorRoute && (scrolled || !isActive(`/${locale}`));

  const menuItems: NavMenuItem[] = [
    {
      id: "rent",
      label: t(locale, "navMenuRent"),
      // Panel-less below 900px, where it degrades to a plain link to the
      // section's own landing page rather than a dead trigger.
      panel: desktopNav ? navData.rent : null,
      href: `/${locale}/search`
    },
    {
      id: "pg",
      label: t(locale, "navMenuPg"),
      panel: desktopNav ? navData.pg : null,
      href: `/${locale}/pg`
    },
    {
      // CRIBLMAP — the live rent-intelligence map. Panel-less by design: it is
      // a destination, not a category. Matches the chip pair's other half
      // (Cribliv Times below): same hairline box, sans in brand blue, plus
      // the live-inventory dot that .nav-chip__dot in globals.css expects.
      id: "map",
      label: (
        <>
          <Map size={15} aria-hidden="true" />
          <span>CriblMap</span>
          <span className="nav-chip__dot" aria-hidden="true" />
        </>
      ),
      panel: null,
      href: `/${locale}/map`,
      className: `nav-chip nav-chip--map${isActive(`/${locale}/map`) ? " nav-chip--active" : ""}`
    },
    {
      // CRIBLIV TIMES — the serif masthead chip. Panel-less in this slice;
      // slice 3 gives it a desks + latest-posts panel.
      id: "times",
      label: (
        <>
          <Newspaper size={14} aria-hidden="true" />
          <span className="nav-times__word">Cribliv Times</span>
        </>
      ),
      panel: null,
      href: `/${locale}/blog`,
      className: `nav-chip nav-chip--times${isActive(`/${locale}/blog`) ? " nav-chip--active" : ""}`
    },
    {
      id: "owners",
      label: t(locale, "navMenuOwners"),
      panel: desktopNav ? navData.owners : null,
      href: `/${locale}/become-owner`
    }
  ];

  return (
    <header className={`header${scrolled ? " header--scrolled" : ""}`}>
      <div className="container nav-row">
        {/* ── Left: Logo, then city chip or search pill ────────────── */}
        <Link href={`/${locale}`} className="logo" aria-label="Cribliv Home">
          <BrandLockup size="md" priority />
        </Link>

        {!isPgOperatorRoute && (
          <>
            {/* Always mounted, self-hiding: keeping it in the tree is what lets
                it drop its own popover when the page scrolls it away. */}
            <CityChip locale={locale} links={navData.cities} hidden={compact} />
            {compact && (
              /* SearchPill calls useSearchParams(), which in Next 14 opts every
                 statically rendered route out of prerendering unless it sits
                 under a Suspense boundary — and this header is in the root
                 layout, so that would be the whole site. Same reason
                 app/[locale]/layout.tsx wraps PageviewTracker. */
              <Suspense fallback={null}>
                <SearchPill locale={locale} />
              </Suspense>
            )}
          </>
        )}

        <span className="nav-spacer" />

        {/* ── Center: Primary nav (desktop only) ──────────────────── */}
        {isPgOperatorRoute ? (
          <nav className="nav-center" aria-label="Primary">
            {pgLinks.map((link, i) => {
              const Icon = pgIcons[i] ?? LayoutDashboard;
              const active =
                link.label === "Dashboard"
                  ? pathname === `/${locale}/pg-operator/dashboard`
                  : link.label === "Listings"
                    ? pathname?.startsWith(`/${locale}/pg-operator/listings`)
                    : false;
              return (
                <Link
                  key={link.href}
                  href={link.href as any}
                  className={`nav-tab${active ? " nav-tab--active" : ""}`}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>
        ) : (
          /* NavMenuBar owns the .nav-center element itself, so the landmark
             the operator branch gets from a single <nav class="nav-center">
             needs a wrapper here. .nav-primary carries no styling of its own
             beyond passing the flex layout through. */
          <nav className="nav-primary" aria-label="Primary">
            <NavMenuBar items={menuItems} />
          </nav>
        )}

        <span className="nav-spacer" />

        {/* ── Right: Actions ──────────────────────────────────────── */}
        <div className="nav-actions">
          {!isPgOperatorRoute && <SavedIcon locale={locale} />}

          <Link href={hostLinkHref} className="nav-host-link" title={hostLinkLabel}>
            <Plus size={14} aria-hidden="true" />
            <span className="nav-host-link__full">{hostLinkLabel}</span>
            <span className="nav-host-link__short">{hostLinkShort}</span>
          </Link>

          {!compact && (
            <Link
              href={locale === "en" ? "/hi" : "/en"}
              prefetch={false}
              className="lang-pill"
              aria-label={locale === "en" ? "Switch to Hindi" : "Switch to English"}
            >
              <Globe size={15} aria-hidden="true" />
              <span className="lang-pill__label">{locale === "en" ? "हिंदी" : "EN"}</span>
            </Link>
          )}

          <HeaderMenu locale={locale} navData={navData} />
        </div>
      </div>
    </header>
  );
}
