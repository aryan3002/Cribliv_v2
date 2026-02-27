"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import type { Locale } from "../lib/i18n";
import type { UserRole } from "../auth.config";

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
          <span className="logo-dot" aria-hidden="true" />
          Cribliv
        </Link>

        {/* Navigation Links */}
        <nav
          className={`nav-links${mobileOpen ? " nav-links--open" : ""}`}
          aria-label="Main navigation"
        >
          <Link
            href={`/${locale}/search?city=noida`}
            className="nav-link"
            onClick={() => setMobileOpen(false)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            Search
          </Link>
          <Link
            href={`/${locale}/shortlist`}
            className="nav-link"
            onClick={() => setMobileOpen(false)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
            Shortlist
          </Link>
          {(role === "owner" || role === "pg_operator") && (
            <Link
              href={`/${locale}/owner/dashboard`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              My Listings
            </Link>
          )}
          {role === "admin" && (
            <Link
              href={`/${locale}/admin`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              Admin
            </Link>
          )}
          {!session && !isLoading && (
            <Link
              href={`/${locale}/owner/dashboard`}
              className="nav-link"
              onClick={() => setMobileOpen(false)}
            >
              Post Property
            </Link>
          )}
        </nav>

        {/* Right actions */}
        <div className="nav-actions">
          <div className="lang-switch">
            <Link href="/en" prefetch={false} className={locale === "en" ? "active" : ""}>
              EN
            </Link>
            <span>|</span>
            <Link href="/hi" prefetch={false} className={locale === "hi" ? "active" : ""}>
              हिंदी
            </Link>
          </div>

          {isLoading ? (
            <div className="skeleton skeleton--btn" style={{ width: 80 }} />
          ) : session ? (
            <div className="flex items-center gap-3">
              <span
                className="body-sm text-secondary hide-mobile"
                style={{ maxWidth: 140 }}
                title={phone ?? session.user?.name ?? ""}
              >
                {phone ?? session.user?.name}
                {role && (
                  <span className="badge badge--brand" style={{ marginLeft: 6 }}>
                    {role}
                  </span>
                )}
              </span>
              <button
                onClick={() => void signOut({ callbackUrl: `/${locale}` })}
                className="btn btn--secondary btn--sm"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link href="/auth/login" className="btn btn--primary btn--sm">
              Login / Sign up
            </Link>
          )}

          {/* Mobile hamburger */}
          <button
            className="hamburger"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
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
