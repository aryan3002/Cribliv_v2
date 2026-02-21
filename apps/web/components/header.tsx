"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import type { Locale } from "../lib/i18n";
import type { UserRole } from "../auth.config";

export function Header({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: UserRole } | undefined)?.role;
  const phone = (session?.user as { phone?: string } | undefined)?.phone;
  const isLoading = status === "loading";

  return (
    <header className="header">
      <div className="container nav-row">
        <Link href={`/${locale}`} className="logo">
          <span style={{ fontWeight: 700, fontSize: 20 }}>Cribliv</span>
        </Link>
        <nav className="nav-links">
          <Link href={`/${locale}/search?city=noida`}>Search</Link>
          <Link href={`/${locale}/shortlist`}>Shortlist</Link>
          {(role === "owner" || role === "pg_operator") && (
            <Link href={`/${locale}/owner/dashboard`}>My Listings</Link>
          )}
          {role === "admin" && <Link href={`/${locale}/admin`}>Admin</Link>}
          {!session && !isLoading && <Link href={`/${locale}/owner/dashboard`}>Post Property</Link>}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="lang-switch">
            <Link href={`/en`} prefetch={false}>
              EN
            </Link>
            <span>|</span>
            <Link href={`/hi`} prefetch={false}>
              हिंदी
            </Link>
          </div>
          {isLoading ? null : session ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "#555" }}>
                {phone ?? session.user?.name}
                {role && (
                  <span
                    style={{
                      marginLeft: 4,
                      fontSize: 11,
                      background: "#f0f0f0",
                      borderRadius: 4,
                      padding: "1px 5px"
                    }}
                  >
                    {role}
                  </span>
                )}
              </span>
              <button
                onClick={() => void signOut({ callbackUrl: `/${locale}` })}
                style={{
                  background: "#000",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  padding: "6px 14px",
                  fontSize: 13,
                  cursor: "pointer"
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href={`/auth/login`}
              style={{
                background: "#000",
                color: "#fff",
                borderRadius: 6,
                padding: "6px 14px",
                fontSize: 13,
                textDecoration: "none",
                fontWeight: 500
              }}
            >
              Login / Sign up
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
