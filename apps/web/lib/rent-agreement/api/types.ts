export type PlanId = "basic" | "standard" | "premium";
export type Locale = "en" | "hi";

export type WizardStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "generating_pdf"
  | "generated"
  | "expired"
  | "refunded";

export type Provider = "razorpay" | "upi";
export type Party = "owner" | "tenant";

export interface PlanCatalogEntry {
  id: PlanId;
  display_name: string;
  amount_paise: number;
  features: string[];
  active: boolean;
}

export interface StateEntry {
  state_code: string;
  state_name: string;
  formula_summary: string;
}

export interface DraftSummary {
  id: string;
  plan_id: PlanId;
  locale: Locale;
  current_step: number;
  status: WizardStatus;
  stamp_duty_paise: number;
  rent_amount_paise: number | null;
  has_owner_pan: boolean;
  has_tenant_pan: boolean;
  created_at: string;
  updated_at: string;
}

export interface DraftFull extends DraftSummary {
  idempotency_key: string;
  step_validated_at: Record<string, string>;
  payment_order_id: string | null;
  pdf_blob_path: string | null;
  pdf_generated_at: string | null;
  download_count: number;
  max_downloads: number;
  expires_at: string | null;
  e_stamp_reference: string | null;
  e_sign_session_id: string | null;
  e_sign_completed_at: string | null;
  /* all step fields are nullable strings/numbers — declare them as the wizard needs them */
}

export interface StatusResponse {
  status: WizardStatus;
  pdf_ready: boolean;
  queue_position: number | null;
  error: string | null;
}

export interface CheckoutResponse {
  id: string;
  provider_order_id: string;
  amount_paise: number;
  currency: "INR";
  notes: Record<string, unknown>;
  status: "pending_payment" | "paid";
}

export interface DownloadResponse {
  sas_url: string;
  expires_at: string;
  remaining: number;
}

export interface EStampReceipt {
  reference_id: string;
  status: "issued" | "cancelled" | "pending";
  issued_at: string;
}

export interface ESignSession {
  session_id: string;
  status: "initiated" | "verified" | "expired";
  initiated_at: string;
  otp_url: string;
}

export interface ESignVerifyResult {
  session_id: string;
  status: "initiated" | "verified" | "expired";
  signed_at: string | null;
}

export interface BootstrapResponse {
  access_token: string;
  refresh_token: string;
  user: { id: string; role: string };
}
