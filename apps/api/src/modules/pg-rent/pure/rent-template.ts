import type { PgRentMergeFields, PgRentTemplateKey } from "@cribliv/shared-types";

export const MAX_TEMPLATE_CHARS = 600;
export const MAX_MERGED_CHARS = 900;

export const MERGE_FIELD_NAMES = [
  "tenant_name",
  "owner_name",
  "property_name",
  "room",
  "bed",
  "period",
  "amount",
  "balance",
  "due_date",
  "due_phrase",
  "days_overdue",
  "late_fee",
  "invoice_no",
  "pay_link",
  "upi_id",
  "receipt_link",
  "utr"
] as const satisfies ReadonlyArray<keyof PgRentMergeFields>;

/** Spec §7.4 defaults. Owners edit these; a null column means "use this". */
export const DEFAULT_TEMPLATES: Record<"en" | "hi", Record<PgRentTemplateKey, string>> = {
  en: {
    reminder:
      "Hi {tenant_name}, rent of {amount} for {period} (Room {room}, Bed {bed}) is {due_phrase}. Pay here: {pay_link} — {owner_name}, {property_name}",
    overdue:
      "Hi {tenant_name}, rent of {balance} for {period} (Room {room}, Bed {bed}) is {due_phrase}{late_fee_clause}. Pay here: {pay_link} — {owner_name}, {property_name}",
    tenant_paid:
      "Hi {owner_name}, I've paid {amount} for {period} rent, Room {room}/Bed {bed}. UTR: {utr} — {tenant_name}",
    receipt_share:
      "Hi {tenant_name}, here is your receipt for {amount} ({period}): {receipt_link} — {owner_name}, {property_name}"
  },
  hi: {
    reminder:
      "नमस्ते {tenant_name}, {period} का किराया {amount} (कमरा {room}, बेड {bed}) {due_phrase}। यहाँ भुगतान करें: {pay_link} — {owner_name}, {property_name}",
    overdue:
      "नमस्ते {tenant_name}, {period} का किराया {balance} (कमरा {room}, बेड {bed}) {due_phrase}{late_fee_clause}। यहाँ भुगतान करें: {pay_link} — {owner_name}, {property_name}",
    tenant_paid:
      "नमस्ते {owner_name}, मैंने {period} का किराया {amount} चुका दिया है, कमरा {room}/बेड {bed}। UTR: {utr} — {tenant_name}",
    receipt_share:
      "नमस्ते {tenant_name}, {amount} ({period}) की रसीद: {receipt_link} — {owner_name}, {property_name}"
  }
};

export function formatInrGrouped(inr: number): string {
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(inr)}`;
}

const FIELD_RE = /\{([a-z_]+)\}/g;

/**
 * Spec §7.4: known fields merge; unknown fields stay literal and are reported;
 * `{late_fee_clause}` is a derived helper (", including ₹300 late fee" or "")
 * so the overdue default reads naturally. Output capped at 900 chars.
 */
export function mergeTemplate(
  template: string,
  fields: PgRentMergeFields
): { text: string; unknownFields: string[]; truncated: boolean } {
  const unknown: string[] = [];
  const derived: Record<string, string> = {
    late_fee_clause:
      fields.late_fee && fields.late_fee !== "₹0" ? `, including ${fields.late_fee} late fee` : ""
  };
  let text = template.replace(FIELD_RE, (whole, name: string) => {
    if (name in derived) return derived[name];
    if ((MERGE_FIELD_NAMES as readonly string[]).includes(name))
      return fields[name as keyof PgRentMergeFields] ?? "";
    if (!unknown.includes(name)) unknown.push(name);
    return whole;
  });
  let truncated = false;
  if (text.length > MAX_MERGED_CHARS) {
    text = `${text.slice(0, MAX_MERGED_CHARS - 1)}…`;
    truncated = true;
  }
  return { text, unknownFields: unknown, truncated };
}
