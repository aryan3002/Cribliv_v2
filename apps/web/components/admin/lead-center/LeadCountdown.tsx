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
  return Math.max(0, secondsRemaining - (now - Date.parse(generatedAt)) / 1000);
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

  if (remaining == null) {
    return <span className="admin-countdown">—</span>;
  }

  if (remaining <= 0) {
    const refunded = refundState === "refunded";
    return (
      <span className={`admin-countdown${refunded ? "" : " admin-countdown--danger"}`}>
        {refunded ? "Refunded" : "Expired"}
      </span>
    );
  }

  const tone = remaining < ONE_HOUR ? "danger" : remaining < SIX_HOURS ? "warn" : "ok";
  return (
    <span className={`admin-countdown admin-countdown--${tone}`}>{formatRemaining(remaining)}</span>
  );
}
