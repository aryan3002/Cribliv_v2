"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart, Check } from "lucide-react";
import { readAuthSession } from "../../lib/client-auth";
import { expressPgInterest } from "../../lib/pg-public-api";

export function PgInterestButton({
  listingId,
  locale,
  variant = "rail",
  className,
  children,
  onBefore,
  onSuccess
}: {
  listingId: string;
  locale: string;
  variant?: "rail" | "mobile";
  className?: string;
  children?: ReactNode;
  onBefore?: () => void;
  onSuccess?: () => void;
}) {
  const pathname = usePathname();
  const { data: nextAuthSession } = useSession();
  const stored = readAuthSession();
  const token =
    stored?.access_token ??
    (nextAuthSession as { accessToken?: string } | null)?.accessToken ??
    null;

  const [state, setState] = useState<"idle" | "loading" | "done" | "self" | "error">("idle");
  const label = children ?? (state === "loading" ? "Sending..." : "I'm interested");
  const interestClassName = `pg-interest pg-interest--${variant}`;
  const buttonClassName = `btn btn--primary ${variant === "mobile" ? "btn--lg pg-interest__mobile-button" : "btn--lg"} ${className ?? ""}`;

  if (!token) {
    // Return to THIS PG detail page after login, not a generic /pg.
    const returnTo = pathname ?? `/${locale}/pg`;
    return (
      <div className={interestClassName}>
        <Link
          href={`/${locale}/auth/login?return=${encodeURIComponent(returnTo)}` as Route}
          className={buttonClassName}
        >
          <Heart size={16} aria-hidden="true" /> {children ?? "Log in to show interest"}
        </Link>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className={`${interestClassName} pg-interest--done`} role="status">
        <Check size={18} aria-hidden="true" />
        <span>The PG owner has your interest. They&apos;ll reach out.</span>
      </div>
    );
  }

  if (state === "self") {
    return (
      <div className={interestClassName} role="status">
        <span className="body-sm text-secondary">This is your own listing.</span>
      </div>
    );
  }

  async function onClick() {
    onBefore?.();
    setState("loading");
    try {
      const res = await expressPgInterest(listingId, token as string);
      if (res.interested === false) {
        // Operator viewing their own listing — no lead, neutral message.
        setState("self");
      } else if (!res.lead_id) {
        // The lead wasn't actually recorded (e.g. lead management disabled) —
        // don't claim success.
        setState("error");
      } else {
        setState("done");
        onSuccess?.();
      }
    } catch {
      setState("error");
    }
  }

  return (
    <div className={interestClassName}>
      <button
        type="button"
        className={buttonClassName}
        onClick={onClick}
        disabled={state === "loading"}
      >
        <Heart size={16} aria-hidden="true" /> {label}
      </button>
      {state === "error" && (
        <p className="body-sm" style={{ color: "var(--danger)", marginTop: 8 }}>
          Couldn&apos;t send your interest. Please try again.
        </p>
      )}
    </div>
  );
}
