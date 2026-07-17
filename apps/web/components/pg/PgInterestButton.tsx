"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart, Check } from "lucide-react";
import { readAuthSession } from "../../lib/client-auth";
import { expressPgInterest } from "../../lib/pg-public-api";

const SHARING_LABEL: Record<string, string> = {
  single: "Single sharing",
  double: "Double sharing",
  triple: "Triple sharing",
  quad: "Quad sharing",
  dorm: "Dormitory"
};

export function PgInterestButton({
  listingId,
  locale,
  variant = "rail",
  className,
  children,
  sharingOptions,
  onBefore,
  onSuccess
}: {
  listingId: string;
  locale: string;
  variant?: "rail" | "mobile";
  className?: string;
  children?: ReactNode;
  /** Distinct sharing kinds this listing offers — lets the tenant say which
   *  room they want, so the operator's lead carries that preference. */
  sharingOptions?: string[];
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
  // "" = "Any room" (no specific preference). Only shown when >1 sharing exists.
  const [sharing, setSharing] = useState<string>("");
  const showPicker = (sharingOptions?.length ?? 0) >= 2;
  const label = children ?? (state === "loading" ? "Sending..." : "I'm interested");
  const interestClassName = `pg-interest pg-interest--${variant}`;
  const buttonClassName = `btn btn--primary ${variant === "mobile" ? "btn--lg pg-interest__mobile-button" : "btn--lg"} ${className ?? ""}`;

  if (!token) {
    // Return to THIS PG detail page after login, not a generic /pg.
    const returnTo = pathname ?? `/${locale}/pg`;
    return (
      <div className={interestClassName}>
        <Link
          href={`/${locale}/auth/login?from=${encodeURIComponent(returnTo)}` as Route}
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
      const res = await expressPgInterest(listingId, token as string, sharing || undefined);
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
      {showPicker && (
        <label className="pg-interest__sharing">
          <span className="pg-interest__sharing-label">Which room are you interested in?</span>
          <select
            className="pg-interest__sharing-select"
            aria-label="preferred room type"
            value={sharing}
            onChange={(e) => setSharing(e.target.value)}
          >
            <option value="">Any room</option>
            {sharingOptions!.map((opt) => (
              <option key={opt} value={opt}>
                {SHARING_LABEL[opt] ?? opt}
              </option>
            ))}
          </select>
        </label>
      )}
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
