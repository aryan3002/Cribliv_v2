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

  const role = (session?.user as { role?: UserRole } | undefined)?.role;
  const phone = (session?.user as { phone?: string } | undefined)?.phone;
  const walletBalance = (session as { walletBalance?: number } | null)?.walletBalance ?? 0;

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "48px auto",
        padding: "0 16px",
        fontFamily: "sans-serif"
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>My Account</h1>
      {phone && (
        <p style={{ color: "#6b7280", marginBottom: 32, fontSize: 15 }}>
          {phone}
          {role && (
            <span
              style={{
                marginLeft: 8,
                background: "#e8f4fd",
                borderRadius: 4,
                padding: "2px 8px",
                fontSize: 12,
                fontWeight: 500
              }}
            >
              {role}
            </span>
          )}
        </p>
      )}

      {/* Credits card */}
      <div
        style={{
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 10,
          padding: "20px 24px",
          marginBottom: 24
        }}
      >
        <div style={{ fontSize: 13, color: "#92400e", marginBottom: 4 }}>Available Credits</div>
        <div style={{ fontSize: 40, fontWeight: 700, color: "#b45309", lineHeight: 1 }}>
          ✦ {walletBalance}
        </div>
        <div style={{ fontSize: 12, color: "#78350f", marginTop: 6 }}>
          Each credit unlocks one owner&apos;s contact details.
          {walletBalance > 0 &&
            ` You have ${walletBalance} unlock${walletBalance !== 1 ? "s" : ""} available.`}
        </div>
      </div>

      {/* Quick links */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 32
        }}
      >
        {[
          { href: `/${locale}/search?city=noida`, label: "🔍  Browse Properties" },
          { href: `/${locale}/shortlist`, label: "❤️  My Shortlist" },
          { href: `/${locale}`, label: "🏠  Back to Home" }
        ].map(({ href, label }) => (
          <Link
            key={href}
            href={href as `/${string}`}
            style={{
              display: "block",
              padding: "14px 18px",
              border: "1px solid #e5e7eb",
              borderRadius: 8,
              textDecoration: "none",
              color: "#111827",
              fontSize: 15,
              fontWeight: 500
            }}
          >
            {label}
          </Link>
        ))}
      </div>

      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 20 }}>
        <button
          onClick={() => void signOut({ callbackUrl: `/${locale}` })}
          style={{
            background: "none",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
            color: "#6b7280"
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
