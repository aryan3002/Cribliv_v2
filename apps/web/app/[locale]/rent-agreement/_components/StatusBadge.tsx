"use client";
import { statusLabel } from "@/lib/rent-agreement/state/status-machine";
import type { WizardStatus } from "@/lib/rent-agreement/api/types";

export function StatusBadge({ status }: { status: WizardStatus }) {
  return (
    <span className="px-2 py-0.5 text-xs border rounded bg-gray-100">{statusLabel(status)}</span>
  );
}
