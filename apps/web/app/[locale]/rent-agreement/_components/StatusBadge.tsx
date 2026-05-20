"use client";
import { statusLabel } from "@/lib/rent-agreement/state/status-machine";
import type { WizardStatus } from "@/lib/rent-agreement/api/types";

export function StatusBadge({ status }: { status: WizardStatus }) {
  return <span className={`ra-status ra-status--${status}`}>{statusLabel(status)}</span>;
}
