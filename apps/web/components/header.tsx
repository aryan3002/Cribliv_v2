"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import {
  Search,
  Heart,
  Home,
  LayoutGrid,
  Plus,
  Globe,
  Menu,
  X,
  LogOut,
  User,
  Settings
} from "lucide-react";
import type { Locale } from "../lib/i18n";
import { t } from "../lib/i18n";
import type { UserRole } from "../auth.config";

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(-10);
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export function Header({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const phone = session?.user?.phone;
  const isLoading = status === "loading";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile menu on route change / resize
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <header className={`header${scrolled ? " header--scrolled" : ""}`}>
      <div className="container nav-row">
        {/* Logo */}
        <Link href={`/${locale}`} className="logo" aria-label="Cribliv Home">
          <Image src="/cribliv.png" alt="" width={40} height={36} priority className="logo-img" />
          <Image
            src="/criblivFont.png"
            alt="Cribliv"
            width={90}
            height={30}
            priority
            className="logo-font"
          />
        </Link>

        {/* Navigation Links */}
        <nav
          className={`nav-links${mobileOpen ? " nav-links--open" : ""}`}
          aria-label="Main navigation"
        >
          <Link
            href={`/${locale}/search`}
            className="nav-link"
            onClick={() => setMobileOpen(false)}
          >
            <Search size={16} aria-hidden="true" />
            {t(locale, "navSearch")}
          </Link>
          <Link
            href={`/${locale}/shortlist`}
            className="nav-link"
            onClick={() => setMobileOpen(false)}
          >
            <Heart size={16} aria-hidden="true" />
            {t(locale, "navShortlist")}
          </Link>
          {(role === "owner" || role === "pg_operator") && (
            <Link
              href={`/${locale}/owner/dashboard`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <Home size={16} aria-hidden="true" />
              {t(locale, "navMyListings")}
            </Link>
          )}
          {role === "admin" && (
            <Link
              href={`/${locale}/admin`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <LayoutGrid size={16} aria-hidden="true" />
              {t(locale, "navAdmin")}
            </Link>
          )}
          {!session && !isLoading && (
            <Link
              href={`/${locale}/owner/dashboard`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <Plus size={16} aria-hidden="true" />
              {t(locale, "navPostProperty")}
            </Link>
          )}
        </nav>

        {/* Right actions */}
        <div className="nav-actions">
          <Link
            href={locale === "en" ? "/hi" : "/en"}
            prefetch={false}
            className="btn btn--secondary btn--sm"
            style={{
              gap: "var(--space-1)",
              fontSize: 13,
              minHeight: 32,
              padding: "0 var(--space-3)"
            }}
          >
            <Globe size={14} aria-hidden="true" />
            {locale === "en" ? "हिंदी" : "EN"}
          </Link>

          {isLoading ? (
            <div className="skeleton skeleton--btn" style={{ width: 80 }} />
          ) : session ? (
            <div className="flex items-center gap-3">
              <Link
                href={`/${locale}/settings`}
                className="body-sm text-secondary hide-mobile"
                style={{
                  maxWidth: 160,
                  textDecoration: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 4
                }}
                title="Account Settings"
              >
                <User size={14} aria-hidden="true" />
                {phone ? formatPhone(phone) : session.user?.name}
                {role && (
                  <span className="badge badge--brand" style={{ marginLeft: 4 }}>
                    {role}
                  </span>
                )}
              </Link>
              <Link
                href={`/${locale}/settings`}
                className="btn btn--secondary btn--sm"
                title="Settings"
              >
                <Settings size={14} aria-hidden="true" />
              </Link>
              <button
                onClick={() => void signOut({ callbackUrl: `/${locale}` })}
                className="btn btn--secondary btn--sm"
              >
                <LogOut size={14} aria-hidden="true" />
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/auth/login" className="btn btn--primary btn--sm">
              {t(locale, "navLoginSignup")}
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            className="hamburger"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
    </header>
  );
}
