"use client";

/**
 * /en/tenant/dashboard  — minimal tenant account page.
 *
 * Middleware ensures only `tenant` role can reach here.
 * Shows credit balance and quick-access links.
 */

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { Search as SearchIcon, Heart, Home as HomeIcon, Building2 } from "lucide-react";
import Link from "next/link";
import type { PgTenantResidence } from "@cribliv/shared-types";
import type { Locale } from "../../../../lib/i18n";
import { getTenantResidence } from "../../../../lib/pg-operations-api";
import type { UserRole } from "../../../../auth.config";
import { PromotionalCreditExpiry } from "../../../../components/promotional-credit-expiry";

export default function TenantDashboardPage({ params }: { params: { locale: string } }) {
  const locale = params.locale as Locale;
  const { data: session } = useSession();

  const role = session?.user?.role;
  const phone = session?.user?.phone;
  const walletBalance = session?.walletBalance ?? 0;
  const token = session?.accessToken;
  const promotionalCredits = session?.promotionalCredits;
  const [residence, setResidence] = useState<PgTenantResidence | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!token || role !== "tenant") {
      setResidence(null);
      return;
    }

    getTenantResidence(token, { server: false })
      .then((value) => {
        if (!cancelled) setResidence(value);
      })
      .catch(() => {
        if (!cancelled) setResidence(null);
      });

    return () => {
      cancelled = true;
    };
  }, [role, token]);

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
          <PromotionalCreditExpiry
            remaining={promotionalCredits?.remaining ?? 0}
            expiresAt={promotionalCredits?.expiresAt ?? null}
            locale={locale}
          />
        </div>
      </div>

      {residence && (
        <Link
          href={`/${locale}/tenant/pg-residence` as `/${string}`}
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)",
            padding: "var(--space-4) var(--space-5)",
            marginBottom: "var(--space-6)",
            textDecoration: "none"
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <Building2 size={18} aria-hidden="true" />
            <span>
              <strong style={{ display: "block", fontSize: 15 }}>PG residence</strong>
              <span className="caption">
                {residence.property_name} · Room {residence.room_number}, Bed {residence.bed_label}
              </span>
            </span>
          </span>
          <span className="badge badge--brand">Open</span>
        </Link>
      )}

      {/* Quick links */}
      <div className="flex flex-col gap-3" style={{ marginBottom: "var(--space-8)" }}>
        {[
          { href: `/${locale}/search?city=noida`, label: "Browse Properties", icon: SearchIcon },
          { href: `/${locale}/shortlist`, label: "Saved", icon: Heart },
          { href: `/${locale}`, label: "Back to Home", icon: HomeIcon }
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href as `/${string}`}
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-3)",
              padding: "var(--space-4) var(--space-5)",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 500
            }}
          >
            <Icon size={18} /> {label}
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
