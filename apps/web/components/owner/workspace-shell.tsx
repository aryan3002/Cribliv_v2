"use client";

import type { Route } from "next";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Building2,
  Globe2,
  LayoutDashboard,
  Plus,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type { Locale } from "../../lib/i18n";
import { t } from "../../lib/i18n";
import { BrandLockup } from "../brand/brand-lockup";
import "./owner-workspace.css";

const OWNER_NAV = [
  { key: "ownerOverview", href: (l: string) => `/${l}/owner/dashboard`, Icon: LayoutDashboard },
  { key: "ownerListings", href: (l: string) => `/${l}/owner/listings`, Icon: Building2 },
  { key: "ownerAdd", href: (l: string) => `/${l}/owner/listings/new`, Icon: Plus },
  { key: "ownerLeads", href: (l: string) => `/${l}/owner/leads`, Icon: UsersRound },
  { key: "ownerVerify", href: (l: string) => `/${l}/owner/verification`, Icon: ShieldCheck }
] as const;

type OwnerNavItem = (typeof OWNER_NAV)[number];
type IconComponent = ComponentType<{
  size?: number;
  "aria-hidden"?: boolean;
  strokeWidth?: number;
}>;

function normalizePath(path: string | null): string {
  if (!path) return "";
  return path.endsWith("/") && path !== "/" ? path.slice(0, -1) : path;
}

function isCurrentDestination(pathname: string | null, href: string) {
  const current = normalizePath(pathname);
  const target = normalizePath(href);

  if (!current) return false;
  if (target.endsWith("/owner/listings/new")) return current === target;
  if (target.endsWith("/owner/listings")) {
    return (
      current === target ||
      (current.startsWith(`${target}/`) && !current.startsWith(`${target}/new`))
    );
  }
  return current === target || current.startsWith(`${target}/`);
}

function formatAccountLabel(session: ReturnType<typeof useSession>["data"]) {
  const name = session?.user?.name?.trim();
  if (name) return name;
  const phone = session?.user?.phone?.trim();
  if (phone) return phone;
  return "Owner";
}

function OwnerNavLink({
  item,
  locale,
  pathname,
  compact = false
}: {
  item: OwnerNavItem;
  locale: Locale;
  pathname: string | null;
  compact?: boolean;
}) {
  const href = item.href(locale);
  const active = isCurrentDestination(pathname, href);
  const Icon = item.Icon as IconComponent;

  return (
    <Link
      href={href as Route}
      className={`ows-nav__link${active ? " ows-nav__link--active" : ""}${
        compact ? " ows-nav__link--compact" : ""
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={compact ? 20 : 18} strokeWidth={2.2} aria-hidden />
      <span>{t(locale, item.key)}</span>
    </Link>
  );
}

function OwnerNav({
  locale,
  pathname,
  compact = false
}: {
  locale: Locale;
  pathname: string | null;
  compact?: boolean;
}) {
  return (
    <>
      {OWNER_NAV.map((item) => (
        <OwnerNavLink
          key={item.key}
          item={item}
          locale={locale}
          pathname={pathname}
          compact={compact}
        />
      ))}
    </>
  );
}

function currentOwnerItem(locale: Locale, pathname: string | null) {
  return (
    OWNER_NAV.find((item) => isCurrentDestination(pathname, item.href(locale))) ?? OWNER_NAV[0]
  );
}

function alternateLocaleHref(
  locale: Locale,
  pathname: string | null,
  searchParams: URLSearchParams | null
) {
  const nextLocale = locale === "en" ? "hi" : "en";
  const current = pathname || `/${locale}/owner/dashboard`;
  const localized = current.replace(/^\/(en|hi)(?=\/|$)/, `/${nextLocale}`);
  const query = searchParams?.toString();
  return query ? `${localized}?${query}` : localized;
}

export function OwnerWorkspaceShell(props: { locale: Locale; children: ReactNode }): JSX.Element {
  const { locale, children } = props;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const accountLabel = formatAccountLabel(session);
  const isFocusFlow = /\/owner\/listings\/new(\/|$)/.test(pathname ?? "");
  const currentItem = currentOwnerItem(locale, pathname);
  const currentTitle = t(locale, currentItem.key);
  const languageHref = alternateLocaleHref(locale, pathname, searchParams);

  return (
    <div
      className="ows"
      data-focus-flow={isFocusFlow ? "true" : "false"}
      data-testid="owner-workspace-shell"
    >
      <header className="ows__desktop-nav">
        <Link href={`/${locale}/owner/dashboard`} className="ows__brand">
          <BrandLockup size="sm" />
          <span className="ows__brand-suffix">Owner</span>
        </Link>
        <nav className="ows-nav" aria-label="Owner workspace navigation">
          <OwnerNav locale={locale} pathname={pathname} />
        </nav>
        <div className="ows__desktop-actions">
          <Link
            href={languageHref as Route}
            className="ows__language"
            aria-label={t(locale, "ownerLanguageSwitchLabel")}
          >
            <Globe2 size={17} aria-hidden />
            <span>{t(locale, "ownerLanguageSwitch")}</span>
          </Link>
          <details className="ows-account">
            <summary>
              <UserRound size={18} aria-hidden />
              <span>{accountLabel}</span>
            </summary>
            <Link href={`/${locale}/settings`}>
              <Settings size={16} aria-hidden />
              <span>{t(locale, "menuAccountSettings")}</span>
            </Link>
          </details>
        </div>
      </header>

      <header className="ows__mobile-header">
        <Link href={`/${locale}/owner/dashboard`} className="ows__mobile-title">
          {/* Mark only — the page title sits beside it, so a full lockup would
              not fit on a phone. */}
          <Image src="/cribliv-logo-new.svg" alt="Cribliv" width={30} height={30} />
          <span>{currentTitle}</span>
        </Link>
        <Link
          href={`/${locale}/settings`}
          className="ows__mobile-account"
          aria-label={t(locale, "menuAccountSettings")}
        >
          <UserRound size={20} aria-hidden />
        </Link>
      </header>

      <main id="main-content" className="ows__content">
        {children}
      </main>

      {!isFocusFlow && (
        <nav className="ows__mobile-nav ows-nav" aria-label="Owner mobile navigation">
          <OwnerNav locale={locale} pathname={pathname} compact />
        </nav>
      )}
    </div>
  );
}
