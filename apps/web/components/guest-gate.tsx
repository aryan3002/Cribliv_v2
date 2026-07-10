"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFlag } from "../lib/feature-flags";
import { t, type Locale } from "../lib/i18n";
import { trackEvent } from "../lib/analytics";

export const GUEST_FREE_CARDS = 6;

export function isCardGated(input: { index: number; isGuest: boolean; flagOn: boolean }): boolean {
  return input.flagOn && input.isGuest && input.index >= GUEST_FREE_CARDS;
}

/**
 * SEO-safe guest gate: children (a server-rendered listing card) stay in the
 * HTML; a CSS blur + signup CTA overlays them for logged-out visitors when
 * ff_guest_gating is on. Blur is friction, not security (spec §5).
 */
export function GuestGate({
  gated,
  locale,
  children
}: {
  gated: boolean;
  locale: Locale;
  children: ReactNode;
}) {
  const flagOn = useFlag("ff_guest_gating");
  if (!gated || !flagOn) return <>{children}</>;

  return (
    <div style={{ position: "relative" }} data-testid="guest-gate">
      <div
        style={{ filter: "blur(7px)", pointerEvents: "none", userSelect: "none" }}
        aria-hidden="true"
      >
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-2)",
          textAlign: "center",
          padding: "var(--space-4)",
          background: "color-mix(in srgb, var(--surface) 55%, transparent)",
          borderRadius: "var(--radius-md)"
        }}
      >
        <p style={{ fontWeight: 700 }}>{t(locale, "gateHeadline")}</p>
        <p className="caption" style={{ color: "var(--text-secondary)" }}>
          {t(locale, "gateSub")}
        </p>
        <Link
          href={`/${locale}/auth/login?tab=signup`}
          className="btn btn--primary btn--sm"
          style={{ textDecoration: "none" }}
          onClick={() => trackEvent("guest_gate_signup_clicked", { surface: "card" })}
        >
          {t(locale, "gateButton")}
        </Link>
      </div>
    </div>
  );
}
