"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Search, Heart, Globe, Plus } from "lucide-react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import { HeaderMenu } from "./header-menu";
import { BrandLockup } from "./brand/brand-lockup";

export function Header({ locale }: { locale: Locale }) {
  const [scrolled, setScrolled] = useState(false);
  const pathname = usePathname();

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
        </nav>

        {/* ── Right: Actions ──────────────────────────────────────── */}
        <div className="nav-actions">
          <Link
            href={`/${locale}/owner/dashboard`}
            className="nav-host-link"
            title={t(locale, "navPostProperty")}
          >
            <Plus size={14} aria-hidden="true" />
            <span>{t(locale, "navPostProperty")}</span>
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
