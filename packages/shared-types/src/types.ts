export type LangCode = "en" | "hi";

export type UserRole = "tenant" | "owner" | "pg_operator" | "admin";

export type ListingType = "flat_house" | "pg";

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "rejected"
  | "paused"
  | "archived";

export type VerificationStatus = "unverified" | "pending" | "verified" | "failed";

export type VerificationType = "video_liveness" | "electricity_bill_match";

export type VerificationResult = "pending" | "pass" | "fail" | "manual_review";

export type WalletTxnType =
  | "grant_signup"
  | "debit_contact_unlock"
  | "refund_no_response"
  | "admin_adjustment"
  | "purchase_pack"
  | "debit_lead_unlock"
  | "refund_lead_dispute"
  | "expire_signup";

export type UnlockStatus = "active" | "refunded" | "cancelled";

export type CreditPlanAudience = "tenant" | "owner";

export interface CreditPlanDto {
  plan_id: string;
  audience: CreditPlanAudience;
  amount_paise: number;
  credits: number;
  label: string;
  unit_price_paise: number;
  recommended: boolean;
}

export type OwnerResponseStatus = "pending" | "responded" | "timeout_refunded";

export type PgOnboardingPath = "self_serve" | "sales_assist";

export type SalesLeadSource = "pg_sales_assist" | "property_management";

export type SalesLeadStatus = "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";

export interface VerificationProviderInfo {
  provider?: string | null;
  provider_reference?: string | null;
  provider_result_code?: string | null;
  review_reason?: string | null;
  retryable?: boolean | null;
}

export interface VerificationAttemptEvidence extends VerificationProviderInfo {
  id: string;
  verification_type: VerificationType;
  result: VerificationResult;
  machine_result?: VerificationResult | null;
  liveness_score?: number | null;
  address_match_score?: number | null;
  threshold: number;
  created_at: string;
}

export interface SalesLead {
  id: string;
  created_by_user_id: string;
  listing_id?: string | null;
  source: SalesLeadSource;
  status: SalesLeadStatus;
  notes?: string | null;
  metadata: Record<string, unknown>;
  crm_sync_status: string;
  last_crm_push_at?: string | null;
  created_at: string;
}

// ── Geo Search ──────────────────────────────────────────────────────────────

export interface GeoSearchParams {
  lat?: number;
  lng?: number;
  radius_km?: number;
}

// ── Listing Events / Analytics ──────────────────────────────────────────────

export type ListingEventType =
  | "view"
  | "enquiry"
  | "shortlist"
  | "share"
  | "call_click"
  | "search_impression";

// ── Lead Management ─────────────────────────────────────────────────────────

export type LeadStatus = "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";

export type LeadAccessState = "free" | "locked" | "unlocked" | "expired";

export type LeadCalledBy = "owner" | "team";

export type CallbackStatus = "awaiting_call" | "call_claimed" | "refunded";

export interface Lead {
  id: string;
  listing_id: string;
  owner_user_id: string;
  tenant_user_id: string;
  contact_unlock_id?: string | null;
  status: LeadStatus;
  tenant_phone_masked?: string | null;
  owner_notes?: string | null;
  access_state?: LeadAccessState;
  call_deadline_at?: string | null;
  called_at?: string | null;
  called_by?: LeadCalledBy | null;
  unlocked_at?: string | null;
  tenant_confirmed_at?: string | null;
  disputed_at?: string | null;
  status_changed_at: string;
  created_at: string;
}

// ── Fraud Detection ─────────────────────────────────────────────────────────

export type FraudFlagType = "duplicate_listing" | "tenant_report" | "stale" | "broker_detected";

export type FraudSeverity = "low" | "medium" | "high" | "critical";

// ── Featured / Boost ────────────────────────────────────────────────────────

export type BoostType = "featured" | "boost";

export interface ListingBoost {
  id: string;
  listing_id: string;
  boost_type: BoostType;
  starts_at: string;
  expires_at: string;
  is_active: boolean;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccess<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// ── Availability + Notify-when-available waitlist ───────────────────────────

export type AvailabilityAlertStatus = "waiting" | "ready" | "notified" | "cancelled";

export interface AvailabilityAlertResult {
  status: AvailabilityAlertStatus;
  already_on_list: boolean;
}

export interface WaitlistLead {
  id: string;
  phone: string;
  user_id: string | null;
  status: AvailabilityAlertStatus;
  created_at: string;
}
