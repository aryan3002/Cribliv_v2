"use client";

import { useEffect, useState } from "react";
import type { AdminLeadRefundState } from "@cribliv/shared-types";

interface Props {
  secondsRemaining: number | null;
  generatedAt: string;
  /** Where the refund promise stands — lets the "at zero" state read Refunded vs Expired. */
  refundState?: AdminLeadRefundState;
}

const ONE_HOUR = 60 * 60;
const SIX_HOURS = 6 * ONE_HOUR;

/**
 * Ticks a server-computed `seconds_remaining` down live in the browser.
 * The server tells us how many seconds were left as of `generatedAt`; we
 * derive "now" locally every second rather than re-fetching.
 */
function useCountdown(secondsRemaining: number | null, generatedAt: string): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (secondsRemaining == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [secondsRemaining, generatedAt]);

  if (secondsRemaining == null) return null;

  // `generatedAt` should always be a valid ISO timestamp from the server, but
  // guard against an unparseable value producing NaN — fall back to the
  // server-reported value as-is (skip subtracting elapsed time) instead.
  const generatedAtMs = Date.parse(generatedAt);
  const elapsed = Number.isFinite(generatedAtMs) ? (now - generatedAtMs) / 1000 : 0;
  const remaining = secondsRemaining - elapsed;
  return Number.isFinite(remaining) ? Math.max(0, remaining) : secondsRemaining;
}

function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function LeadCountdown({ secondsRemaining, generatedAt, refundState }: Props) {
  const remaining = useCountdown(secondsRemaining, generatedAt);

  // Terminal refund states win over the clock: a lead the owner/team already
  // responded to (or one the sweep already refunded) is resolved regardless
  // of whether `seconds_remaining` has ticked down to 0 — check these first
  // so a late-but-handled lead never mislabels as "Expired".
  if (refundState === "refunded") {
    return <span className="admin-countdown">Refunded</span>;
  }
  if (refundState === "responded") {
    return <span className="admin-countdown admin-countdown--ok">Responded</span>;
  }

  if (remaining == null || !Number.isFinite(remaining)) {
    return <span className="admin-countdown">—</span>;
  }

  if (remaining <= 0) {
    return <span className="admin-countdown admin-countdown--danger">Expired</span>;
  }

  const tone = remaining < ONE_HOUR ? "danger" : remaining < SIX_HOURS ? "warn" : "ok";
  return (
    <span className={`admin-countdown admin-countdown--${tone}`}>{formatRemaining(remaining)}</span>
  );
}
