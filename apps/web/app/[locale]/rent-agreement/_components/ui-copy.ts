import type { DraftSummary, PlanId } from "@/lib/rent-agreement/api/types";

export const STEP_TITLES: Record<number, string> = {
  1: "Parties",
  2: "Property",
  3: "Terms",
  4: "Inventory and utilities",
  5: "Clauses and witnesses",
  6: "Signatures",
  7: "Review"
};

export function stepTitle(step: number): string {
  return STEP_TITLES[step] ?? `Step ${step}`;
}

export function planLabel(plan: PlanId): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export function formatRupees(paise: number | null | undefined): string {
  if (typeof paise !== "number") return "Not set";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(paise / 100);
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function draftName(draft: DraftSummary): string {
  const plan = planLabel(draft.plan_id);
  const rent = formatRupees(draft.rent_amount_paise);
  return rent === "Not set" ? `${plan} agreement` : `${plan} agreement, ${rent}/month`;
}
