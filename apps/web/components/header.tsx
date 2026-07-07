"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  FileText,
  Globe,
  Heart,
  LayoutDashboard,
  Newspaper,
  Plus,
  Search,
  UsersRound
} from "lucide-react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { HeaderMenu } from "./header-menu";
import { BrandLockup } from "./brand/brand-lockup";
import { getPgDashboardLinks } from "./pg-operator/dashboard-links";

const pgIcons = [LayoutDashboard, BarChart3, Building2, UsersRound];

export function Header({ locale }: { locale: Locale }) {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();
  const isPgOperatorRoute = pathname?.startsWith(`/${locale}/pg-operator`) ?? false;
  const pgLinks = getPgDashboardLinks(locale);

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

  return (
    <header className={`header${scrolled ? " header--scrolled" : ""}`}>
      <div className="container nav-row">
        {/* ── Left: Logo ───────────────────────────────────────────── */}
        <Link href={`/${locale}`} className="logo" aria-label="Cribliv Home">
          <BrandLockup size="md" priority />
        </Link>

        {/* ── Center: Primary nav (desktop only) ──────────────────── */}
        <nav className="nav-center" aria-label="Primary">
          {isPgOperatorRoute ? (
            pgLinks.map((link, i) => {
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
            })
          ) : (
            <>
              <Link
                href={`/${locale}/search`}
                className={`nav-tab${isActive(`/${locale}/search`) ? " nav-tab--active" : ""}`}
              >
                <Search size={15} aria-hidden="true" />
                <span>{t(locale, "navSearch")}</span>
              </Link>
              <Link
                href={`/${locale}/shortlist`}
                className={`nav-tab${isActive(`/${locale}/shortlist`) ? " nav-tab--active" : ""}`}
              >
                <Heart size={15} aria-hidden="true" />
                <span>{t(locale, "navSaved")}</span>
              </Link>
              <Link
                href={`/${locale}/rent-agreement`}
                className={`nav-tab${isActive(`/${locale}/rent-agreement`) ? " nav-tab--active" : ""}`}
              >
                <FileText size={15} aria-hidden="true" />
                <span>Rent Agreement</span>
              </Link>
              {/* CRIBLIV TIMES — a serif masthead chip so the blog reads as
                  "the newspaper", distinct from the sans nav tabs. */}
              <Link
                href={`/${locale}/blog`}
                className={`nav-times${isActive(`/${locale}/blog`) ? " nav-times--active" : ""}`}
                aria-label="Cribliv Times"
              >
                <Newspaper size={14} aria-hidden="true" />
                <span className="nav-times__word">Cribliv Times</span>
              </Link>
            </>
          )}
        </nav>

        {/* ── Right: Actions ──────────────────────────────────────── */}
        <div className="nav-actions">
          <Link
            href={
              isPgOperatorRoute
                ? `/${locale}/pg-operator/listings/new`
                : `/${locale}/owner/dashboard`
            }
            className="nav-host-link"
            title={isPgOperatorRoute ? "New listing" : t(locale, "navPostProperty")}
          >
            <Plus size={14} aria-hidden="true" />
            <span>{isPgOperatorRoute ? "New listing" : t(locale, "navPostProperty")}</span>
          </Link>

          <Link
            href={locale === "en" ? "/hi" : "/en"}
            prefetch={false}
            className="lang-pill"
            aria-label={locale === "en" ? "Switch to Hindi" : "Switch to English"}
          >
            <Globe size={15} aria-hidden="true" />
            <span className="lang-pill__label">{locale === "en" ? "हिंदी" : "EN"}</span>
          </Link>

          <HeaderMenu locale={locale} />
        </div>
      </div>
    </header>
  );
}
