"use client";

/**
 * SessionBanner
 *
 * Shown at the top of the homepage.
 * - Logged out  → simple "Login / Sign up" prompt
 * - Logged in   → phone, role badge, credit balance, role-specific CTAs
 */

import Link from "next/link";
import { useSession } from "next-auth/react";
import type { Locale } from "../lib/i18n";
import type { UserRole } from "../auth.config";

const ROLE_LABEL: Record<string, string> = {
  tenant: "Tenant",
  owner: "Owner",
  pg_operator: "PG Operator",
  admin: "Admin"
};

const ROLE_BG: Record<string, string> = {
  tenant: "#e8f4fd",
  owner: "#e8fdf0",
  pg_operator: "#fdf4e8",
  admin: "#fde8e8"
};

export function SessionBanner({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();

  // Keep a fixed-height placeholder while loading to avoid layout shift
  if (status === "loading") {
    return <div style={{ height: 64, marginBottom: 24 }} />;
  }

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div
        style={{
          background: "#f9f9f9",
          border: "1px solid #e5e7eb",
          borderRadius: 10,
          padding: "16px 20px",
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap"
        }}
      >
        <span style={{ flex: 1, color: "#555", fontSize: 14 }}>
          Find verified rentals — no brokerage, no hidden fees.
        </span>
        <Link
          href="/auth/login"
          style={{
            background: "#000",
            color: "#fff",
            borderRadius: 6,
            padding: "8px 18px",
            fontSize: 14,
            textDecoration: "none",
            fontWeight: 500,
            whiteSpace: "nowrap"
          }}
        >
          Login / Sign up
        </Link>
      </div>
    );
  }

  // ── Logged in ──────────────────────────────────────────────────────────────
  const role = (session.user as { role?: UserRole } | undefined)?.role;
  const phone = (session.user as { phone?: string } | undefined)?.phone;
  const walletBalance = (session as { walletBalance?: number }).walletBalance ?? 0;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        padding: "16px 20px",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap"
      }}
    >
      {/* Identity */}
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{phone}</div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 4,
            alignItems: "center",
            flexWrap: "wrap"
          }}
        >
          <span
            style={{
              background: ROLE_BG[role ?? "tenant"] ?? "#f0f0f0",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 12,
              fontWeight: 500
            }}
          >
            {ROLE_LABEL[role ?? "tenant"] ?? role}
          </span>
          <span
            style={{
              background: "#fff8e1",
              borderRadius: 4,
              padding: "2px 8px",
              fontSize: 12,
              fontWeight: 600,
              color: "#b45309"
            }}
          >
            ✦ {walletBalance} credit{walletBalance !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Role-specific CTAs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {role === "tenant" && (
          <>
            <Link
              href={`/${locale}/search?city=noida`}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "7px 14px",
                fontSize: 13,
                textDecoration: "none",
                color: "#374151"
              }}
            >
              Browse listings
            </Link>
            <Link
              href={`/${locale}/shortlist`}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "7px 14px",
                fontSize: 13,
                textDecoration: "none",
                color: "#374151"
              }}
            >
              My shortlist
            </Link>
            <Link
              href={`/${locale}/become-owner`}
              style={{
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: 6,
                padding: "7px 14px",
                fontSize: 13,
                textDecoration: "none",
                color: "#15803d",
                fontWeight: 500
              }}
              title="Request upgrade to owner or PG operator"
            >
              List your property ↗
            </Link>
          </>
        )}

        {(role === "owner" || role === "pg_operator") && (
          <>
            <Link
              href={`/${locale}/owner/dashboard`}
              style={{
                background: "#000",
                color: "#fff",
                borderRadius: 6,
                padding: "7px 16px",
                fontSize: 13,
                textDecoration: "none",
                fontWeight: 500
              }}
            >
              My dashboard
            </Link>
            <Link
              href={`/${locale}/owner/listings/new`}
              style={{
                border: "1px solid #d1d5db",
                borderRadius: 6,
                padding: "7px 14px",
                fontSize: 13,
                textDecoration: "none",
                color: "#374151"
              }}
            >
              + New listing
            </Link>
          </>
        )}

        {role === "admin" && (
          <Link
            href={`/${locale}/admin`}
            style={{
              background: "#dc2626",
              color: "#fff",
              borderRadius: 6,
              padding: "7px 16px",
              fontSize: 13,
              textDecoration: "none",
              fontWeight: 500
            }}
          >
            Admin panel
          </Link>
        )}
      </div>
    </div>
  );
}
