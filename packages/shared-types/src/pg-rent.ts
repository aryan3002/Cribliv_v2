// Wire contracts for the PG rent module. Every amount is a whole-rupee integer
// with an `_inr` suffix (spec D2). The one exception is `electricity_unit_rate_inr`,
// a per-unit rate carried as a two-place decimal (spec §4.2, §19 #49).

export type PgRentCycleMode = "calendar_month" | "anniversary";
export type PgRentBillingTiming = "advance" | "arrears";
export type PgRentProrationMode = "actual_days" | "flat_30";
export type PgRentLateFeeKind = "flat" | "per_day" | "percent";
export type PgRentInvoiceKind = "rent" | "deposit" | "adhoc" | "settlement";
export type PgRentInvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";
export type PgRentInvoiceSource = "auto" | "manual" | "backfill";
export type PgRentRentSource = "assignment" | "room_type" | "listing" | "none";
export type PgRentLineKind =
  | "rent"
  | "deposit"
  | "late_fee"
  | "electricity"
  | "meals"
  | "maintenance"
  | "damage"
  | "cleaning"
  | "forfeit"
  | "other"
  | "discount"
  | "adjustment";
export type PgRentLineSource = "system" | "operator" | "default_item" | "expense_split";
export type PgRentPaymentDirection = "inflow" | "outflow";
export type PgRentPaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "cheque"
  | "card"
  | "gateway"
  | "deposit"
  | "other";
export type PgRentPaymentSource =
  | "operator"
  | "tenant_claim"
  | "gateway"
  | "backfill"
  | "deposit_release";
export type PgRentPaymentStatus = "pending_confirmation" | "confirmed" | "rejected" | "reversed";
export type PgRentPauseReason = "owner" | "transfer";
export type PgRentActorRole = "tenant" | "pg_operator" | "admin" | "system";

export interface PgRentBankDetails {
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
}

export interface PgRentDefaultLineItem {
  key: string;
  kind: Exclude<PgRentLineKind, "rent" | "deposit" | "late_fee">;
  label: string;
  amount_inr: number;
}

export interface PgRentSettings {
  pg_property_id: string;
  paused_at: string | null;
  pause_reason: PgRentPauseReason | null;
  enabled_on: string;
  billing_starts_on: string;
  cycle_mode: PgRentCycleMode;
  billing_timing: PgRentBillingTiming;
  due_day: number;
  proration_mode: PgRentProrationMode;
  prorate_move_out: boolean;
  invoice_lead_days: number;
  reminder_offsets_days: number[];
  late_fee_enabled: boolean;
  late_fee_grace_days: number;
  late_fee_kind: PgRentLateFeeKind;
  late_fee_amount_inr: number;
  late_fee_percent_bp: number;
  late_fee_cap_inr: number | null;
  late_fee_auto_apply: boolean;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  bank_details: PgRentBankDetails | null;
  whatsapp_phone_e164: string | null;
  msg_reminder: string | null;
  msg_overdue: string | null;
  msg_tenant_paid: string | null;
  msg_receipt_share: string | null;
  receipt_prefix: string;
  receipt_business_name: string | null;
  receipt_address: string | null;
  receipt_footer: string | null;
  receipt_logo_path: string | null;
  default_line_items: PgRentDefaultLineItem[];
  electricity_unit_rate_inr: number | null;
  /** Optimistic-concurrency token for PATCH. */
  updated_at: string;
  created_at: string;
}

/** Fields the owner may set on enable and patch. Everything optional; server defaults apply. */
export interface PgRentSettingsInput {
  cycle_mode?: PgRentCycleMode;
  billing_timing?: PgRentBillingTiming;
  due_day?: number;
  proration_mode?: PgRentProrationMode;
  prorate_move_out?: boolean;
  invoice_lead_days?: number;
  reminder_offsets_days?: number[];
  late_fee_enabled?: boolean;
  late_fee_grace_days?: number;
  late_fee_kind?: PgRentLateFeeKind;
  late_fee_amount_inr?: number;
  late_fee_percent_bp?: number;
  late_fee_cap_inr?: number | null;
  late_fee_auto_apply?: boolean;
  upi_vpa?: string | null;
  upi_payee_name?: string | null;
  bank_details?: PgRentBankDetails | null;
  whatsapp_phone_e164?: string | null;
  msg_reminder?: string | null;
  msg_overdue?: string | null;
  msg_tenant_paid?: string | null;
  msg_receipt_share?: string | null;
  receipt_prefix?: string;
  receipt_business_name?: string | null;
  receipt_address?: string | null;
  receipt_footer?: string | null;
  receipt_logo_path?: string | null;
  default_line_items?: PgRentDefaultLineItem[];
  electricity_unit_rate_inr?: number | null;
}

export interface PgRentEnableInput extends PgRentSettingsInput {
  /** Rent-period floor. Defaults to today (IST). */
  billing_starts_on?: string;
}

export interface PgRentPatchSettingsInput extends PgRentSettingsInput {
  /** Must equal the current `updated_at` or the PATCH is refused with 409. */
  updated_at: string;
}

export interface PgRentResumeInput {
  billing_starts_on?: string;
}

export type PgRentPreviewSkipReason = "no_rent" | "no_move_in" | "nothing_in_window";

export interface PgRentPreviewPeriod {
  period_start: string;
  period_end: string;
  due_date: string;
  amount_inr: number;
  prorated: boolean;
  /** True when rent resolves only from the listing or not at all (issued as draft). */
  draft: boolean;
}

export interface PgRentPreviewTenant {
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  first_period: PgRentPreviewPeriod | null;
  skip_reason: PgRentPreviewSkipReason | null;
  deposit_inr: number | null;
  /** True when the deposit invoice would be issued (move-in on/after `enabled_on`, none exists yet). */
  deposit_will_invoice: boolean;
}

export interface PgRentEnablePreview {
  billing_starts_on: string;
  tenants: PgRentPreviewTenant[];
  counts: {
    invoices: number;
    drafts: number;
    deposits: number;
    no_rent: number;
    no_move_in: number;
  };
}

export interface PgRentInvoiceLine {
  id: string;
  kind: PgRentLineKind;
  label: string;
  amount_inr: number;
  meta: Record<string, unknown>;
  source: PgRentLineSource;
  expense_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface PgRentInvoice {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  bed_id: string | null;
  room_id: string | null;
  room_number: string;
  bed_label: string;
  kind: PgRentInvoiceKind;
  invoice_number: string;
  period_start: string | null;
  period_end: string | null;
  billing_month: string;
  due_date: string;
  status: PgRentInvoiceStatus;
  source: PgRentInvoiceSource;
  total_inr: number;
  amount_paid_inr: number;
  balance_inr: number;
  rent_snapshot_inr: number | null;
  rent_source: PgRentRentSource | null;
  proration_factor: number | null;
  late_fee_eligible: boolean;
  suggested_late_fee_inr: number | null;
  late_fee_waived_at: string | null;
  /** Owner-tap suggestion after notice / move-out (spec §5.8); null when none. */
  reprorate_suggestion: {
    leave_on: string;
    from_inr: number;
    to_inr: number;
    mode: "reprorate" | "restore";
  } | null;
  pay_token_expires_at: string | null;
  tenant_note: string | null;
  internal_note: string | null;
  issued_at: string | null;
  paid_at: string | null;
  settled_on: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  lines: PgRentInvoiceLine[];
  created_at: string;
  updated_at: string;
}

export interface PgRentInvoiceListFilters {
  status?: PgRentInvoiceStatus;
  kind?: PgRentInvoiceKind;
  assignment_id?: string;
  /** `YYYY-MM-01` */
  billing_month?: string;
}

export interface PgRentEvent {
  id: string;
  entity_type: "invoice" | "payment" | "expense" | "settings" | "assignment" | "receipt";
  entity_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_role: PgRentActorRole;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PgRentGenerateResult {
  invoices_created: number;
  drafts_created: number;
  deposits_created: number;
  skipped: Array<{ assignment_id: string; reason: PgRentPreviewSkipReason }>;
}

export interface PgRentTenantOverridesInput {
  rent_due_day?: number | null;
  late_fee_exempt?: boolean;
  late_fee_override_inr?: number | null;
  default_item_excludes?: string[];
  /** Only accepted while the assignment's move_in_date is null. */
  move_in_date?: string;
  /** "Change rent from next cycle": writes pg_bed_assignments.monthly_rent_paise. */
  monthly_rent_inr?: number;
}
