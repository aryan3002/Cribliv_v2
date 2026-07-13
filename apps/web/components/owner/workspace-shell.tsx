"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Building2,
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
      href={href}
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

export function OwnerWorkspaceShell(props: { locale: Locale; children: ReactNode }): JSX.Element {
  const { locale, children } = props;
  const pathname = usePathname();
  const { data: session } = useSession();
  const accountLabel = formatAccountLabel(session);
  const isFocusFlow = /\/owner\/listings\/new(\/|$)/.test(pathname ?? "");

  return (
    <div
      className="ows"
      data-focus-flow={isFocusFlow ? "true" : "false"}
      data-testid="owner-workspace-shell"
    >
      <header className="ows__desktop-nav">
        <Link href={`/${locale}/owner/dashboard`} className="ows__brand">
          <span className="ows__brand-mark">C</span>
          <span>Owner Workspace</span>
        </Link>
        <nav className="ows-nav" aria-label="Owner workspace navigation">
          <OwnerNav locale={locale} pathname={pathname} />
        </nav>
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
      </header>

      <header className="ows__mobile-header">
        <Link href={`/${locale}/owner/dashboard`} className="ows__mobile-title">
          <span className="ows__brand-mark">C</span>
          <span>Owner</span>
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
