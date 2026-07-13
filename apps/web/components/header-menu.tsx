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
  ChevronRight
} from "lucide-react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { getPgDashboardLinks } from "./pg-operator/dashboard-links";

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
}

const MOBILE_MENU_PORTAL_MQ = "(max-width: 640px)";

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

export function HeaderMenu({ locale }: { locale: Locale }) {
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

  const footer: MenuItem[] = isLoggedIn
    ? [
        {
          onClick: () => void signOut({ callbackUrl: `/${locale}` }),
          icon: <LogOut size={16} aria-hidden="true" />,
          label: t(locale, "menuSignOut"),
          emphasis: "danger"
        }
      ]
    : [];

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
          className={className}
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

  const initial = phone
    ? phone.replace(/\D/g, "").slice(-2, -1) || "U"
    : session?.user?.name?.charAt(0)?.toUpperCase() || "U";

  const menuOverlay = open && (
    <>
      <div className="menu-popover-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="menu-popover" role="menu">
        {isLoggedIn && (
          <div className="menu-header">
            <div className="menu-header__avatar">{initial}</div>
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
        <span className="profile-pill__avatar" aria-hidden="true">
          {isLoading ? (
            <span className="profile-pill__avatar-loading" />
          ) : isLoggedIn ? (
            initial
          ) : (
            <User size={14} />
          )}
        </span>
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
