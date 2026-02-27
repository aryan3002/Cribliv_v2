"use client";

/**
 * /en/tenant/dashboard  — minimal tenant account page.
 *
 * Middleware ensures only `tenant` role can reach here.
 * Shows credit balance and quick-access links.
 */

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import type { Locale } from "../../../../lib/i18n";
import type { UserRole } from "../../../../auth.config";

export default function TenantDashboardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const { data: session } = useSession();

  const role = session?.user?.role;
  const phone = session?.user?.phone;
  const walletBalance = session?.walletBalance ?? 0;

  return (
    <div
      className="container--narrow"
      style={{ paddingTop: "var(--space-12)", paddingBottom: "var(--space-12)" }}
    >
      <h1 style={{ marginBottom: "var(--space-1)" }}>My Account</h1>
      {phone && (
        <p className="text-secondary" style={{ marginBottom: "var(--space-8)" }}>
          {phone}
          {role && (
            <span className="badge badge--brand" style={{ marginLeft: "var(--space-2)" }}>
              {role}
            </span>
          )}
        </p>
      )}

      {/* Credits card */}
      <div
        className="alert alert--warning"
        style={{
          padding: "var(--space-5) var(--space-6)",
          marginBottom: "var(--space-6)",
          borderRadius: "var(--radius-lg)"
        }}
      >
        <div style={{ width: "100%" }}>
          <div className="overline" style={{ marginBottom: "var(--space-1)" }}>
            Available Credits
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 40,
              fontWeight: 700,
              color: "#b45309",
              lineHeight: 1
            }}
          >
            ✦ {walletBalance}
          </div>
          <div className="caption" style={{ marginTop: "var(--space-2)", color: "#78350f" }}>
            Each credit unlocks one owner&apos;s contact details.
            {walletBalance > 0 &&
              ` You have ${walletBalance} unlock${walletBalance !== 1 ? "s" : ""} available.`}
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex flex-col gap-3" style={{ marginBottom: "var(--space-8)" }}>
        {[
          { href: `/${locale}/search?city=noida`, label: "🔍  Browse Properties" },
          { href: `/${locale}/shortlist`, label: "❤️  My Shortlist" },
          { href: `/${locale}`, label: "🏠  Back to Home" }
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href as `/${string}`}
            className="card"
            style={{
              display: "block",
              padding: "var(--space-4) var(--space-5)",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 500
            }}
          >
            {label}
          </Link>
        ))}
      </div>

      <hr className="divider" />
      <button
        onClick={() => void signOut({ callbackUrl: `/${locale}` })}
        className="btn btn--secondary btn--sm"
      >
        Sign out
      </button>
    </div>
  );
}
