"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSession, signOut } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  Menu,
  User,
  Heart,
  Search,
  Map,
  Settings,
  Plus,
  LogOut,
  HelpCircle,
  Info,
  LayoutGrid,
  Home,
  BarChart3,
  Building2,
  UsersRound,
  Newspaper,
  ChevronRight,
  Globe
} from "lucide-react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { getPgDashboardLinks } from "./pg-operator/dashboard-links";
import { RoleAvatar } from "./role-avatar";
import { MobileCitySection } from "./header/mobile-city-section";
import { MobileNavSections } from "./header/mobile-nav-sections";
// Type-only, and it must stay that way: lib/nav/nav-model.ts and nav-data.ts
// pull ~46 KB of city prose, FAQs and rent tips, and this component renders
// in the root layout (via Header -> HeaderMenu). The panels arrive as a prop
// that app/[locale]/layout.tsx (a Server Component) builds — see the
// bundle-size note in lib/nav/nav-data.ts and header.tsx's own copy of it.
import type { NavData, NavPanel } from "../lib/nav/types";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return raw;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

interface MenuItem {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  label: string;
  emphasis?: "primary" | "danger";
  external?: boolean;
  // The language-switch row needs an accessible name ("Switch to Hindi")
  // that differs from its short visible label ("हिंदी") — every other item's
  // visible text already doubles as its accessible name, so there was
  // nothing to override before this.
  ariaLabel?: string;
  // Mirrors header.tsx's top-bar language pill, which sets this to false so
  // opening the hamburger doesn't prefetch the whole locale-swapped route.
  // Optional and unused by every other row, so their default Link behaviour
  // is unchanged.
  prefetch?: boolean;
}

const MOBILE_MENU_PORTAL_MQ = "(max-width: 640px)";

const emptyNavPanel = (id: NavPanel["id"]): NavPanel => ({ id, columns: [] });

/**
 * Safe default for `navData`, mirroring header.tsx's own EMPTY_NAV_DATA
 * (duplicated rather than imported: header.tsx imports HeaderMenu, so the
 * reverse import would be a cycle). header-menu.pg-split.test.tsx and every
 * other pre-existing test render `<HeaderMenu locale="en" />` with no nav
 * data at all — a missing prop must degrade to a sheet with no Rent/PG/Owners
 * accordions, never throw.
 */
const EMPTY_NAV_DATA: NavData = {
  rent: emptyNavPanel("rent"),
  pg: emptyNavPanel("pg"),
  owners: emptyNavPanel("owners"),
  times: emptyNavPanel("times"),
  cities: []
};

function useMatchMedia(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => (typeof window === "undefined" ? false : window.matchMedia(query).matches),
    () => false
  );
}

export function HeaderMenu({
  locale,
  navData = EMPTY_NAV_DATA
}: {
  locale: Locale;
  navData?: NavData;
}) {
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const phone = session?.user?.phone;
  const isLoading = status === "loading";
  const isLoggedIn = !!session;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const portalRootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const portalMenuToBody = useMatchMedia(MOBILE_MENU_PORTAL_MQ);
  const isPgOperatorRoute = pathname?.startsWith(`/${locale}/pg-operator`) ?? false;
  const pgSectionIcons = [
    <Home key="home" size={16} aria-hidden="true" />,
    <BarChart3 key="insights" size={16} aria-hidden="true" />,
    <Building2 key="listings" size={16} aria-hidden="true" />,
    <UsersRound key="leads" size={16} aria-hidden="true" />
  ];

  // Close on outside pointerdown (portal menu is outside triggerRef subtree)
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (portalRootRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile sheet is open (matches CSS sheet breakpoint)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (open && window.matchMedia(MOBILE_MENU_PORTAL_MQ).matches) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Build the contextual menu sections
  const primary: MenuItem[] = isLoggedIn
    ? []
    : [
        {
          href: "/auth/login",
          icon: <User size={16} aria-hidden="true" />,
          label: t(locale, "navLoginSignup"),
          emphasis: "primary"
        }
      ];

  const account: MenuItem[] = isLoggedIn
    ? [
        {
          href: `/${locale}/settings`,
          icon: <Settings size={16} aria-hidden="true" />,
          label: t(locale, "menuAccountSettings")
        },
        {
          href: `/${locale}/shortlist`,
          icon: <Heart size={16} aria-hidden="true" />,
          label: t(locale, "menuMySaved")
        },
        ...(role === "tenant"
          ? [
              {
                href: `/${locale}/tenant/pg-residence`,
                icon: <Home size={16} aria-hidden="true" />,
                label: t(locale, "menuMyStay")
              } as MenuItem
            ]
          : []),
        ...(role === "owner"
          ? [
              {
                href: `/${locale}/owner/dashboard`,
                icon: <Home size={16} aria-hidden="true" />,
                label: t(locale, "menuMyListings")
              } as MenuItem
            ]
          : []),
        ...(role === "pg_operator"
          ? [
              ...(isPgOperatorRoute
                ? getPgDashboardLinks(locale).map(
                    (link, i) =>
                      ({
                        href: link.href,
                        icon: pgSectionIcons[i] ?? <Home size={16} aria-hidden="true" />,
                        label: link.label
                      }) as MenuItem
                  )
                : [
                    {
                      href: `/${locale}/pg-operator/dashboard`,
                      icon: <Home size={16} aria-hidden="true" />,
                      label: t(locale, "menuPgDashboard")
                    } as MenuItem
                  ]),
              {
                href: `/${locale}/pg-operator/listings/new`,
                icon: <Plus size={16} aria-hidden="true" />,
                label: t(locale, "menuPgNewListing")
              } as MenuItem
            ]
          : []),
        ...(role === "admin"
          ? [
              {
                href: `/${locale}/admin`,
                icon: <LayoutGrid size={16} aria-hidden="true" />,
                label: t(locale, "menuAdmin")
              } as MenuItem
            ]
          : [])
      ]
    : [];

  const explore: MenuItem[] = [
    {
      href: `/${locale}/search`,
      icon: <Search size={16} aria-hidden="true" />,
      label: t(locale, "menuSearchRentals")
    },
    {
      href: `/${locale}/map`,
      icon: <Map size={16} aria-hidden="true" />,
      label: t(locale, "menuMap")
    },
    {
      href: `/${locale}/blog`,
      icon: <Newspaper size={16} aria-hidden="true" />,
      label: "Cribliv Times"
    },
    {
      href: `/${locale}/become-owner`,
      icon: <Plus size={16} aria-hidden="true" />,
      label: t(locale, "menuBecomeOwner")
    },
    {
      href: `/${locale}/how-it-works`,
      icon: <Info size={16} aria-hidden="true" />,
      label: t(locale, "menuHowItWorks")
    },
    {
      href: `/${locale}/faq`,
      icon: <HelpCircle size={16} aria-hidden="true" />,
      label: t(locale, "menuHelpFaq")
    }
  ];

  // The top-bar language pill (header.tsx ~line 250) hides whenever `compact`
  // is true — every scrolled or inner page, including all programmatic SEO
  // pages — with no other way to switch language. This mirrors that pill's
  // target, wording and icon exactly so the switch stays reachable everywhere
  // the hamburger is. Lives in the footer/utility area, not the nav
  // accordions above: it is a site-wide preference, not a navigation link.
  const languageItem: MenuItem = {
    href: locale === "en" ? "/hi" : "/en",
    prefetch: false,
    icon: <Globe size={16} aria-hidden="true" />,
    label: locale === "en" ? "हिंदी" : "EN",
    ariaLabel: locale === "en" ? "Switch to Hindi" : "Switch to English"
  };

  const footer: MenuItem[] = [
    languageItem,
    ...(isLoggedIn
      ? [
          {
            onClick: () => void signOut({ callbackUrl: `/${locale}` }),
            icon: <LogOut size={16} aria-hidden="true" />,
            label: t(locale, "menuSignOut"),
            emphasis: "danger"
          } as MenuItem
        ]
      : [])
  ];

  function renderMenuItem(item: MenuItem) {
    const className = `menu-item${
      item.emphasis === "primary" ? " menu-item--primary" : ""
    }${item.emphasis === "danger" ? " menu-item--danger" : ""}`;

    const inner = (
      <>
        <span className="menu-item__icon">{item.icon}</span>
        <span className="menu-item__label">{item.label}</span>
        <ChevronRight size={14} className="menu-item__chev" aria-hidden="true" />
      </>
    );

    if (item.href) {
      return (
        <Link
          key={item.label}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          href={item.href as any}
          prefetch={item.prefetch}
          className={className}
          aria-label={item.ariaLabel}
          onClick={() => setOpen(false)}
        >
          {inner}
        </Link>
      );
    }

    return (
      <button
        key={item.label}
        type="button"
        className={className}
        onClick={() => {
          item.onClick?.();
          setOpen(false);
        }}
      >
        {inner}
      </button>
    );
  }

  const menuOverlay = open && (
    <>
      <div className="menu-popover-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="menu-popover" role="menu">
        {isLoggedIn && (
          <div className="menu-header">
            <RoleAvatar role={role} size="menu" className="menu-header__avatar" />
            <div className="menu-header__text">
              <span className="menu-header__name">
                {phone ? formatPhone(phone) : session?.user?.name || "Account"}
              </span>
              {role && <span className="menu-header__role">{role}</span>}
            </div>
          </div>
        )}

        {primary.length > 0 && <div className="menu-section">{primary.map(renderMenuItem)}</div>}

        {account.length > 0 && <div className="menu-section">{account.map(renderMenuItem)}</div>}

        <div className="menu-divider" role="separator" />

        {/* Mobile counterpart to the desktop city chip (header/city-chip.tsx),
            which CSS hides below 640px (globals.css) with no on-screen twin —
            unlike the Saved heart and language pill, both already reachable
            elsewhere in this sheet. Placed above the Rent/PG/Owners
            accordions below, mirroring the desktop bar's own ordering: the
            city chip sits leftmost, before every nav menu. Renders nothing
            when navData is the empty default (see EMPTY_NAV_DATA above). */}
        <MobileCitySection
          locale={locale}
          cities={navData.cities}
          onNavigate={() => setOpen(false)}
        />

        {/* Below 900px NavMenuBar's desktop panels never mount (header.tsx's
            useDesktopNav), so this is the only place phone users can reach
            the Rent / PG / Owners sub-links — same NavPanel data as desktop,
            passed down as props rather than rebuilt here. Renders nothing
            when navData is the empty default (see EMPTY_NAV_DATA above). */}
        <MobileNavSections
          locale={locale}
          rent={navData.rent}
          pg={navData.pg}
          owners={navData.owners}
          onNavigate={() => setOpen(false)}
        />

        <div className="menu-section">{explore.map(renderMenuItem)}</div>

        {footer.length > 0 && (
          <>
            <div className="menu-divider" role="separator" />
            <div className="menu-section">{footer.map(renderMenuItem)}</div>
          </>
        )}
      </div>
    </>
  );

  return (
    <div className="header-menu" ref={triggerRef}>
      <button
        type="button"
        className={`profile-pill${open ? " profile-pill--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t(locale, "menuOpen")}
      >
        <Menu size={16} className="profile-pill__hamburger" aria-hidden="true" />
        {isLoading ? (
          <span className="profile-pill__avatar" aria-hidden="true">
            <span className="profile-pill__avatar-loading" />
          </span>
        ) : isLoggedIn ? (
          <RoleAvatar role={role} size="compact" className="profile-pill__avatar" />
        ) : (
          <span className="profile-pill__avatar" aria-hidden="true">
            <User size={14} />
          </span>
        )}
      </button>

      {menuOverlay &&
        (portalMenuToBody
          ? createPortal(
              <div
                className="header-menu-portal-root"
                ref={portalRootRef}
                data-header-menu-portal=""
              >
                {menuOverlay}
              </div>,
              document.body
            )
          : menuOverlay)}
    </div>
  );
}
