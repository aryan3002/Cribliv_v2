/**
 * WhatsApp message templates.
 *
 * Each template corresponds to a pre-approved Meta WABA template.
 * Template names follow the format: {event}_{language}
 *
 * The `bodyParams` are positional parameters ({{1}}, {{2}}, …) that
 * Meta substitutes into the approved template body.
 *
 * NOTE: Before going live, each template must be submitted and
 * approved in the Meta Business Manager. The mock provider
 * logs templates locally for dev testing.
 */

export type NotificationType =
  | "owner.contact_unlocked"
  | "owner.listing_approved"
  | "owner.listing_rejected"
  | "owner.listing_paused"
  | "owner.listing_submitted"
  | "owner.lead_nudge"
  | "tenant.contact_unlocked"
  | "tenant.alert_zone_match"
  | "operator.pg_notice_served"
  | "operator.pg_move_out_requested"
  | "tenant.pg_move_out_requested";

export interface NotificationTemplate {
  type: NotificationType;
  /** Meta-approved template name */
  templateName: string;
  /** BCP-47 language code for the template */
  languageCode: string;
  /** Human-readable description (internal documentation) */
  description: string;
  /** Build the positional body parameters from the event payload */
  buildBodyParams: (payload: Record<string, unknown>) => string[];
  /** Channels this type dispatches on. Defaults to whatsapp-only. */
  channels: ("whatsapp" | "sms")[];
  /** Build the SMS body text (required when 'sms' is in channels). */
  buildSmsBody?: (payload: Record<string, unknown>) => string;
}

// ---------------------------------------------------------------------------
// Hindi templates (primary language for Indian market)
// ---------------------------------------------------------------------------

export const TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  "owner.contact_unlocked": {
    type: "owner.contact_unlocked",
    templateName: "owner_contact_unlocked_hi",
    languageCode: "hi",
    description:
      "Sent to owner when a tenant unlocks their contact. Params: listing_title, tenant_name (or 'एक किरायेदार')",
    buildBodyParams: (payload) => [
      String(payload.listing_title ?? "आपकी प्रॉपर्टी"),
      String(payload.tenant_name ?? "एक किरायेदार"),
      String(payload.response_deadline ?? "12 घंटे")
    ],
    channels: ["whatsapp", "sms"],
    buildSmsBody: (payload) =>
      `New Cribliv lead: ${String(payload.tenant_name ?? "a seeker")} wants a callback for ${String(payload.listing_title ?? "your listing")}. Call within ${String(payload.response_deadline ?? "24 hours")} or the lead expires. cribliv.com`
  },

  "owner.listing_approved": {
    type: "owner.listing_approved",
    templateName: "listing_approved_hi",
    languageCode: "hi",
    description: "Sent to owner when admin approves their listing. Params: listing_title, city",
    buildBodyParams: (payload) => [
      String(payload.listing_title ?? "आपकी प्रॉपर्टी"),
      String(payload.city ?? "")
    ],
    channels: ["whatsapp"]
  },

  "owner.listing_rejected": {
    type: "owner.listing_rejected",
    templateName: "listing_rejected_hi",
    languageCode: "hi",
    description: "Sent to owner when admin rejects their listing. Params: listing_title, reason",
    buildBodyParams: (payload) => [
      String(payload.listing_title ?? "आपकी प्रॉपर्टी"),
      String(payload.reason ?? "गुणवत्ता मानक पूरे नहीं हुए")
    ],
    channels: ["whatsapp"]
  },

  "owner.listing_paused": {
    type: "owner.listing_paused",
    templateName: "listing_paused_hi",
    languageCode: "hi",
    description: "Sent to owner when admin pauses their listing. Params: listing_title, reason",
    buildBodyParams: (payload) => [
      String(payload.listing_title ?? "आपकी प्रॉपर्टी"),
      String(payload.reason ?? "समीक्षा के लिए रोकी गई")
    ],
    channels: ["whatsapp"]
  },

  "owner.listing_submitted": {
    type: "owner.listing_submitted",
    templateName: "listing_submitted_hi",
    languageCode: "hi",
    description: "Confirmation to owner after listing submission. Params: listing_title",
    buildBodyParams: (payload) => [String(payload.listing_title ?? "आपकी प्रॉपर्टी")],
    channels: ["whatsapp"]
  },

  "tenant.contact_unlocked": {
    type: "tenant.contact_unlocked",
    templateName: "tenant_contact_unlocked_hi",
    languageCode: "hi",
    description:
      "Sent to tenant confirming they unlocked owner contact. Params: listing_title, owner_phone",
    buildBodyParams: (payload) => [
      String(payload.listing_title ?? "प्रॉपर्टी"),
      String(payload.owner_phone ?? "")
    ],
    channels: ["whatsapp"]
  },

  "tenant.alert_zone_match": {
    type: "tenant.alert_zone_match",
    templateName: "tenant_alert_zone_match_hi",
    languageCode: "hi",
    description:
      "Sent to tenant when new listings match their alert zone. Params: listing_title, bhk_text, rent, zone_label",
    buildBodyParams: (payload) => [
      String(payload.listing_title ?? "नई प्रॉपर्टी"),
      String(payload.bhk_text ?? ""),
      String(payload.rent ?? ""),
      String(payload.zone_label ?? "आपका अलर्ट ज़ोन")
    ],
    channels: ["whatsapp"]
  },

  "owner.lead_nudge": {
    type: "owner.lead_nudge",
    templateName: "owner_lead_nudge_hi",
    languageCode: "hi",
    description:
      "Admin nudge to an owner with an uncalled lead. Params: tenant_name, listing_title, hours_left",
    buildBodyParams: (payload) => [
      String(payload.tenant_name ?? "एक किरायेदार"),
      String(payload.listing_title ?? "आपकी प्रॉपर्टी"),
      String(payload.hours_left ?? "24 घंटे")
    ],
    channels: ["whatsapp", "sms"],
    buildSmsBody: (payload) =>
      `Reminder: your Cribliv lead ${String(payload.tenant_name ?? "a seeker")} for ${String(payload.listing_title ?? "your listing")} is still uncalled — ${String(payload.hours_left ?? "24 घंटे")} left before refund. Call now. cribliv.com`
  },

  "operator.pg_notice_served": {
    type: "operator.pg_notice_served",
    templateName: "operator_pg_notice_served_hi",
    languageCode: "hi",
    description:
      "Sent to a PG operator when an occupant serves notice. Params: occupant_name, notice_end_date",
    buildBodyParams: (payload) => [
      String(payload.occupant_name ?? "एक निवासी"),
      String(payload.notice_end_date ?? "")
    ],
    channels: ["whatsapp"]
  },

  "operator.pg_move_out_requested": {
    type: "operator.pg_move_out_requested",
    templateName: "operator_pg_move_out_requested_hi",
    languageCode: "hi",
    description: "Sent to a PG operator when an occupant requests move-out. Params: occupant_name",
    buildBodyParams: (payload) => [String(payload.occupant_name ?? "एक निवासी")],
    channels: ["whatsapp"]
  },

  "tenant.pg_move_out_requested": {
    type: "tenant.pg_move_out_requested",
    templateName: "tenant_pg_move_out_requested_hi",
    languageCode: "hi",
    description: "Sent to a tenant when the PG operator requests move-out. Params: property_name",
    buildBodyParams: (payload) => [String(payload.property_name ?? "आपकी PG प्रॉपर्टी")],
    channels: ["whatsapp"]
  }
};
