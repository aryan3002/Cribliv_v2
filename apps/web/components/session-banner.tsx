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

export function SessionBanner({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();

  // Keep a fixed-height placeholder while loading to avoid layout shift
  if (status === "loading") {
    return (
      <div
        className="skeleton-block"
        style={{ height: 64, marginBottom: "var(--space-6)", borderRadius: "var(--radius-lg)" }}
      />
    );
  }

  // ── Not logged in ──────────────────────────────────────────────────────────
  if (!session) {
    return (
      <div
        className="card flex items-center gap-4"
        style={{
          padding: "var(--space-4) var(--space-5)",
          marginBottom: "var(--space-6)",
          flexWrap: "wrap"
        }}
      >
        <span className="text-secondary" style={{ flex: 1, fontSize: 14 }}>
          Find verified rentals — no brokerage, no hidden fees.
        </span>
        <Link href="/auth/login" className="btn btn--primary btn--sm">
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
      className="card flex items-center gap-4"
      style={{
        padding: "var(--space-4) var(--space-5)",
        marginBottom: "var(--space-6)",
        flexWrap: "wrap"
      }}
    >
      {/* Identity */}
      <div style={{ flex: 1, minWidth: 120 }}>
        <div style={{ fontWeight: 600, fontSize: 15 }}>{phone}</div>
        <div className="flex items-center gap-2" style={{ marginTop: "var(--space-1)" }}>
          <span
            className={`badge ${role === "owner" ? "badge--verified" : role === "admin" ? "badge--failed" : role === "pg_operator" ? "badge--pg" : "badge--brand"}`}
          >
            {ROLE_LABEL[role ?? "tenant"] ?? role}
          </span>
          <span className="badge badge--pending">
            ✦ {walletBalance} credit{walletBalance !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Role-specific CTAs */}
      <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
        {role === "tenant" && (
          <>
            <Link href={`/${locale}/search?city=noida`} className="btn btn--secondary btn--sm">
              Browse listings
            </Link>
            <Link href={`/${locale}/shortlist`} className="btn btn--secondary btn--sm">
              My saved
            </Link>
            <Link
              href={`/${locale}/become-owner`}
              className="btn btn--ghost btn--sm"
              title="Request upgrade to owner or PG operator"
            >
              List your property ↗
            </Link>
          </>
        )}

        {(role === "owner" || role === "pg_operator") && (
          <>
            <Link href={`/${locale}/owner/dashboard`} className="btn btn--primary btn--sm">
              My dashboard
            </Link>
            <Link href={`/${locale}/owner/listings/new`} className="btn btn--secondary btn--sm">
              + New listing
            </Link>
          </>
        )}

        {role === "admin" && (
          <Link href={`/${locale}/admin`} className="btn btn--danger btn--sm">
            Admin panel
          </Link>
        )}
      </div>
    </div>
  );
}
