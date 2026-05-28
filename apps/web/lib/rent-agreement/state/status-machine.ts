import type { WizardStatus } from "../api/types";

const TERMINAL: ReadonlySet<WizardStatus> = new Set(["generated", "expired", "refunded"]);
const POLLING_ACTIVE: ReadonlySet<WizardStatus> = new Set([
  "pending_payment",
  "paid",
  "generating_pdf"
]);

export function isTerminal(s: WizardStatus): boolean {
  return TERMINAL.has(s);
}

export function shouldPoll(s: WizardStatus): boolean {
  return POLLING_ACTIVE.has(s);
}

const LABELS: Record<WizardStatus, string> = {
  draft: "Draft",
  pending_payment: "Awaiting payment",
  paid: "Payment received",
  generating_pdf: "Generating PDF",
  generated: "Ready to download",
  expired: "Expired",
  refunded: "Refunded"
};

export function statusLabel(s: WizardStatus): string {
  return LABELS[s];
}
