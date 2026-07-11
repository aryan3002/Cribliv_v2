"use client";

import { useState } from "react";
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
  onBefore,
  onSuccess
}: {
  listingId: string;
  locale: string;
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

  if (!token) {
    // Return to THIS PG detail page after login, not a generic /pg.
    const returnTo = pathname ?? `/${locale}/pg`;
    return (
      <div className="pg-interest">
        <Link
          href={`/${locale}/auth/login?return=${encodeURIComponent(returnTo)}` as Route}
          className="btn btn--primary btn--lg"
        >
          <Heart size={16} aria-hidden="true" /> Log in to show interest
        </Link>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="pg-interest pg-interest--done" role="status">
        <Check size={18} aria-hidden="true" />
        <span>The PG owner has your interest. They&apos;ll reach out.</span>
      </div>
    );
  }

  if (state === "self") {
    return (
      <div className="pg-interest" role="status">
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
    <div className="pg-interest">
      <button
        type="button"
        className="btn btn--primary btn--lg"
        onClick={onClick}
        disabled={state === "loading"}
      >
        <Heart size={16} aria-hidden="true" /> {state === "loading" ? "Sending…" : "I'm interested"}
      </button>
      {state === "error" && (
        <p className="body-sm" style={{ color: "var(--danger)", marginTop: 8 }}>
          Couldn&apos;t send your interest. Please try again.
        </p>
      )}
    </div>
  );
}
