// Return shapes for the admin rent-agreement analytics dashboard.
// All counts are integers; *_paise fields are integer paise.

export interface RentAgreementSummary {
  total_sessions: number;
  drafts_started: number;
  drafts_completed: number;
  drafts_abandoned: number;
  conversion_rate: number; // completed / started, 0 when started = 0
  total_revenue_paise: number;
  arpu_paise: number; // revenue / completed, 0 when none
  avg_completion_ms: number | null; // median(pdf_generated_at - created_at)
  by_plan: Array<{ plan_id: string; count: number; revenue_paise: number }>;
  by_state: Array<{ state_code: string; count: number }>;
  by_locale: Array<{ locale: string; count: number }>;
  by_payment_status: Array<{ status: string; count: number }>;
  e_sign_completed: number;
  e_stamp_issued: number;
}

export interface RentAgreementFunnelStep {
  step: number;
  label: string;
  agreements_reached: number;
  advanced: number;
  blocked_events: number;
  reverted_events: number;
  drop_rate: number; // (reached[n] - reached[n+1]) / reached[n], clamped 0..1
  top_errors: Array<{ code: string; count: number }>;
}

export interface RentAgreementTimePoint {
  date: string; // YYYY-MM-DD
  drafts_started: number;
  drafts_completed: number;
  revenue_paise: number;
}

export interface RentAgreementOperational {
  pdf_jobs: { pending: number; processing: number; failed: number; done: number };
  expiring_soon: number; // status='generated' AND expires_at within 7d
  total_downloads: number;
  at_download_limit: number; // download_count >= max_downloads
}

export interface ListAgreementsParams {
  status?: string;
  plan_id?: string;
  state_code?: string;
  search?: string; // ILIKE on owner/tenant name/phone/email
  date_from?: string;
  date_to?: string;
  page?: number; // default 1
  limit?: number; // default 20, clamped to 100
}

export interface AgreementListItem {
  id: string;
  status: string;
  plan_id: string;
  locale: string;
  current_step: number;
  owner_full_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  tenant_full_name: string | null;
  tenant_phone: string | null;
  tenant_email: string | null;
  property_full_address: string | null;
  state_code: string | null;
  city: string | null;
  rent_amount_paise: number | null;
  stamp_duty_paise: number;
  download_count: number;
  pdf_ready: boolean;
  created_at: string;
  updated_at: string;
  payment_order_id: string | null;
  payment_amount_paise: number | null;
  payment_status: string | null;
  payment_provider: string | null;
  creator_phone: string | null;
  creator_name: string | null;
}

export interface AgreementStepAuditEntry {
  step: number;
  outcome: string;
  error_codes: string[];
  created_at: string;
}

export interface AgreementDetail extends AgreementListItem {
  step_validated_at: Record<string, string>;
  e_stamp_reference: string | null;
  e_sign_session_id: string | null;
  e_sign_completed_at: string | null;
  expires_at: string | null;
  pdf_generated_at: string | null;
  step_audit: AgreementStepAuditEntry[];
}

export interface AdminDownloadLink {
  sas_url: string;
  expires_at: string;
}
