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

export interface PgRentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string | null;
  invoice_number: string | null;
  refund_payment_id: string | null;
  amount_inr: number;
  created_at: string;
}

export interface PgRentPayment {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  direction: PgRentPaymentDirection;
  amount_inr: number;
  /** amount − Σ allocations; only meaningful for confirmed inflows */
  unallocated_inr: number;
  method: PgRentPaymentMethod;
  source: PgRentPaymentSource;
  status: PgRentPaymentStatus;
  claimed_invoice_id: string | null;
  paid_on: string;
  reference: string | null;
  proof_paths: string[];
  note: string | null;
  recorded_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  reversed_at: string | null;
  reversed_reason: string | null;
  receipt_id: string | null;
  allocations: PgRentAllocation[];
  created_at: string;
  updated_at: string;
}

export interface PgRentAllocationTarget {
  invoice_id: string;
  amount_inr: number;
}

export interface PgRentRecordPaymentInput {
  assignment_id: string;
  amount_inr: number;
  method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
  paid_on: string;
  reference?: string | null;
  note?: string | null;
  proof_paths?: string[];
  /** Operator-chosen split; omitted = targeted invoice (if any) then FIFO. */
  allocations?: PgRentAllocationTarget[];
  claimed_invoice_id?: string | null;
}

export interface PgRentClaimInput {
  assignment_id: string;
  invoice_id?: string | null;
  amount_inr: number;
  method: Exclude<PgRentPaymentMethod, "gateway" | "deposit" | "cash">;
  paid_on: string;
  reference?: string | null;
  note?: string | null;
  proof_paths?: string[];
  idempotency_key: string;
}

export interface PgRentConfirmInput {
  amount_inr?: number;
  method?: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
  paid_on?: string;
  allocations?: PgRentAllocationTarget[];
}

export interface PgRentRejectInput {
  reason: string;
}
export interface PgRentReverseInput {
  reason: string;
}

export interface PgRentRefundInput {
  assignment_id: string;
  amount_inr: number;
  method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
  paid_on: string;
  reference?: string | null;
  reason: string;
}

export interface PgRentAllocationsPatchInput {
  allocations: PgRentAllocationTarget[];
}

export interface PgRentBackfillInput {
  assignment_id: string;
  /** rent | adhoc | deposit ("Deposit held") */
  kind: Extract<PgRentInvoiceKind, "rent" | "adhoc" | "deposit">;
  period_start?: string;
  period_end?: string;
  due_date: string;
  /** Fix 1 (final fix wave): "late_fee" excluded — see payment.dto.ts's LINE_KINDS. */
  lines: Array<{ kind: Exclude<PgRentLineKind, "late_fee">; label: string; amount_inr: number }>;
  /** omitted = unpaid backfill invoice */
  payment?: {
    amount_inr: number;
    method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
    paid_on: string;
    reference?: string | null;
  };
}

export interface PgRentManualInvoiceInput {
  assignment_id: string;
  kind: Extract<PgRentInvoiceKind, "adhoc">;
  due_date: string;
  /** Fix 1 (final fix wave): "late_fee" excluded — see payment.dto.ts's LINE_KINDS. */
  lines: Array<{ kind: Exclude<PgRentLineKind, "late_fee">; label: string; amount_inr: number }>;
  tenant_note?: string | null;
}

export interface PgRentBulkResult<T = string> {
  succeeded: T[];
  failed: Array<{ id: string; code: string }>;
}

export interface PgRentReceipt {
  id: string;
  payment_id: string;
  assignment_id: string;
  receipt_number: string;
  amount_inr: number;
  pdf_status: "pending" | "ready" | "failed";
  attempts: number;
  last_error: string | null;
  generated_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  superseded_by: string | null;
  share_expires_at: string | null;
  created_at: string;
}

export interface PgRentReceiptDownload {
  url: string;
  expires_at: string;
}

export interface PgRentSettlementStatement {
  assignment_id: string;
  status: PgRentSettlementStatus;
  deposit_held_inr: number;
  credit_inr: number;
  open_dues_inr: number;
  open_invoices: Array<{
    invoice_id: string;
    invoice_number: string;
    kind: PgRentInvoiceKind;
    balance_inr: number;
  }>;
  deposit_uncollected_inr: number;
  pending_suggestion: {
    invoice_id: string;
    leave_on: string;
    from_inr: number;
    to_inr: number;
  } | null;
  maintenance_prefills: Array<{ request_id: string; label: string; amount_inr: number | null }>;
  /** already-entered deductions when re-settling */
  deductions: Array<{ kind: PgRentLineKind; label: string; amount_inr: number }>;
  net_inr: number;
  to_return_inr: number;
  settlement_invoice_id: string | null;
}

export type PgRentSettlementStatus = "not_leaving" | "leaving" | "settled" | "nothing_to_settle";

export interface PgRentSettleInput {
  deductions: Array<{
    kind: Extract<PgRentLineKind, "damage" | "cleaning" | "forfeit" | "other">;
    label: string;
    amount_inr: number;
  }>;
  return_now?: {
    amount_inr: number;
    method: Exclude<PgRentPaymentMethod, "gateway" | "deposit">;
    paid_on: string;
    reference?: string | null;
  } | null;
  note?: string | null;
}

export interface PgRentForfeitInput {
  amount_inr: number;
  label?: string;
}

export interface PgRentLineInput {
  kind: Exclude<PgRentLineKind, "rent" | "deposit" | "late_fee">;
  label: string;
  amount_inr: number;
  meta?: Record<string, unknown>;
}

export interface PgRentLinePatchInput {
  label?: string;
  amount_inr?: number;
  meta?: Record<string, unknown>;
}

export interface PgRentExtendDueInput {
  due_date: string;
}
export interface PgRentCancelInvoiceInput {
  reason: string;
}
export interface PgRentIssueDraftInput {
  rent_inr?: number;
  due_date?: string;
}
export interface PgRentApplyFeeInput {
  amount_inr?: number;
}
export interface PgRentWaiveFeeInput {
  reason: string;
}
export interface PgRentEligibilityInput {
  late_fee_eligible: boolean;
}

export type PgRentReminderState = "upcoming" | "due_soon" | "due_today" | "overdue";

export interface PgRentQueueInvoiceRow {
  invoice_id: string;
  invoice_number: string;
  assignment_id: string;
  occupant_name: string;
  occupant_phone_verified: boolean;
  room_number: string;
  bed_label: string;
  kind: PgRentInvoiceKind;
  period_label: string;
  due_date: string;
  balance_inr: number;
  total_inr: number;
  state: PgRentReminderState;
  in_grace: boolean;
  days_overdue: number;
  applied_fee_inr: number | null;
  suggested_fee_inr: number | null;
  last_reminded_at: string | null;
  last_reminded_channel: "whatsapp" | "call" | null;
  /** ₹ × days, the Overdue section sort key */
  urgency: number;
}

export interface PgRentQueueClaimRow {
  payment_id: string;
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  amount_inr: number;
  method: PgRentPaymentMethod;
  paid_on: string;
  reference: string | null;
  proof_count: number;
  claimed_invoice_id: string | null;
  claimed_invoice_number: string | null;
  waiting_since: string;
  waiting_days: number;
}

export type PgRentAttentionKind =
  | "draft_invoice"
  | "set_move_in_date"
  | "notice_ended"
  | "reprorate_suggested"
  | "restore_suggested"
  | "booking_held"
  | "identity_disputed";

export interface PgRentAttentionRow {
  kind: PgRentAttentionKind;
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  invoice_id: string | null;
  /** kind-specific: draft total, suggestion from/to, booking credit, days since notice end */
  amount_inr: number | null;
  secondary_inr: number | null;
  date: string | null;
  days: number | null;
}

export interface PgRentLeavingRow {
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  status: PgRentSettlementStatus;
  leave_on: string | null;
  deposit_held_inr: number;
  to_return_inr: number;
  open_dues_inr: number;
}

export interface PgRentFormerTenantRow {
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  moved_out_on: string;
  balance_inr: number;
  invoice_ids: string[];
}

export interface PgRentQueue {
  as_of: string;
  awaiting_confirmation: PgRentQueueClaimRow[];
  needs_attention: PgRentAttentionRow[];
  leaving: PgRentLeavingRow[];
  overdue: PgRentQueueInvoiceRow[];
  due_today: PgRentQueueInvoiceRow[];
  due_soon: PgRentQueueInvoiceRow[];
  former_tenants: PgRentFormerTenantRow[];
}

export interface PgRentMonthSummary {
  /** `YYYY-MM-01` */
  month: string;
  expected_inr: number;
  collected_inr: number;
  outstanding_inr: number;
  overdue_inr: number;
  overdue_tenants: number;
  awaiting_inr: number;
  awaiting_count: number;
  collection_rate: number;
}

export interface PgRentPortfolioRow {
  property_id: string;
  display_name: string;
  enabled: boolean;
  paused: boolean;
  summary: PgRentMonthSummary | null;
  queue_counts: { awaiting: number; attention: number; overdue: number; leaving: number } | null;
}

export type PgRentTemplateKey = "reminder" | "overdue" | "tenant_paid" | "receipt_share";

export interface PgRentMergeFields {
  tenant_name: string;
  owner_name: string;
  property_name: string;
  room: string;
  bed: string;
  period: string;
  amount: string;
  balance: string;
  due_date: string;
  due_phrase: string;
  days_overdue: string;
  late_fee: string;
  invoice_no: string;
  pay_link: string;
  upi_id: string;
  receipt_link: string;
  utr: string;
}

export interface PgRentRenderedMessage {
  key: PgRentTemplateKey;
  text: string;
  /** merge fields the template used that are not known (left literal) */
  unknown_fields: string[];
  truncated: boolean;
  wa_me_url: string | null;
  recipient_e164: string | null;
}

export interface PgRentInvoiceMessages {
  invoice_id: string;
  pay_link: string;
  reminder: PgRentRenderedMessage;
  overdue: PgRentRenderedMessage;
  receipt_share: PgRentRenderedMessage | null;
  warnings: string[];
}

export interface PgRentTemplatePreviewInput {
  key: PgRentTemplateKey;
  text: string;
  invoice_id?: string;
}

export type PgRentPayInstruction =
  | {
      mode: "upi_intent";
      upi_uri: string;
      qr_svg: string;
      payee_name: string;
      vpa: string;
      bank: PgRentBankDetails | null;
    }
  | { mode: "bank_details"; bank: PgRentBankDetails }
  | { mode: "manual" };

export interface PgRentPublicPayPage {
  state: "payable" | "paid" | "expired";
  property_name: string;
  tenant_first_name: string;
  period_label: string;
  room_number: string;
  bed_label: string;
  invoice_number: string;
  balance_inr: number;
  total_inr: number;
  due_date: string;
  instruction: PgRentPayInstruction | null;
  /** same payee, no `am` — for "Pay a different amount" (spec §7.7) */
  instruction_open_amount: PgRentPayInstruction | null;
  /** owner's WhatsApp for "Notify owner" — digits only, for wa.me */
  owner_wa_digits: string | null;
  notify_text: string | null;
}

export type PgRentHeroState =
  | "due"
  | "overdue"
  | "partially_paid"
  | "awaiting"
  | "paid"
  | "nothing_due"
  | "leaving"
  | "settled"
  | "not_enabled";

export interface PgRentTenantHero {
  state: PgRentHeroState;
  invoice: PgRentTenantInvoice | null;
  more_open_count: number;
  more_open_inr: number;
  pending_claim: PgRentPayment | null;
  credit_inr: number;
  last_receipt: PgRentReceipt | null;
  next_invoice_expected_on: string | null;
  settlement: PgRentSettlementStatement | null;
}

export interface PgRentTenantInvoice extends Omit<
  PgRentInvoice,
  | "internal_note"
  | "rent_snapshot_inr"
  | "rent_source"
  | "suggested_late_fee_inr"
  | "reprorate_suggestion"
> {
  pay_link: string | null;
  instruction: PgRentPayInstruction | null;
  /** tenant-visible change log (spec §4.10) */
  changes: PgRentEvent[];
}

export interface PgRentTenantResidence {
  assignment_id: string;
  property_id: string;
  property_name: string;
  room_number: string;
  bed_label: string;
  assignment_status: string;
  identity_disputed: boolean;
  enabled: boolean;
  payee: { name: string | null; vpa: string | null; bank: PgRentBankDetails | null } | null;
  owner_wa_digits: string | null;
  hero: PgRentTenantHero;
  deposit: { held_inr: number; paid_on: string | null; uncollected_inr: number } | null;
}

export interface PgRentTenantSummary {
  residences: PgRentTenantResidence[];
}

export interface PgRentTenantHistory {
  assignment_id: string;
  invoices: PgRentTenantInvoice[];
  payments: PgRentPayment[];
  receipts: PgRentReceipt[];
}

export interface PgRentIdentityDisputeInput {
  assignment_id: string;
}
