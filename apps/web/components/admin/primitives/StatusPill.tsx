"use client";

import type { ReactNode } from "react";

export type PillTone = "brand" | "trust" | "warn" | "danger" | "muted";

const STATUS_TO_TONE: Record<string, PillTone> = {
  // listing statuses
  active: "trust",
  pending_review: "warn",
  draft: "muted",
  rejected: "danger",
  paused: "muted",
  archived: "muted",
  // verification
  pass: "trust",
  fail: "danger",
  pending: "warn",
  manual_review: "warn",
  // leads
  new: "brand",
  contacted: "warn",
  qualified: "brand",
  closed_won: "trust",
  closed_lost: "danger",
  // generic severity
  high: "danger",
  medium: "warn",
  low: "muted",
  // verification statuses
  unverified: "muted",
  verified: "trust"
};

interface Props {
  status: string;
  label?: ReactNode;
  tone?: PillTone;
  noDot?: boolean;
}

export function StatusPill({ status, label, tone, noDot }: Props) {
  const t = tone ?? STATUS_TO_TONE[status] ?? "muted";
  const display = label ?? humanize(status);
  return (
    <span className={`admin-pill${noDot ? " admin-pill--no-dot" : ""}`} data-tone={t}>
      {display}
    </span>
  );
}

function humanize(s: string): string {
  return s.replace(/_/g, " ");
}
