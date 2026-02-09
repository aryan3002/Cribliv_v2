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
  | "purchase_pack";

export type UnlockStatus = "active" | "refunded" | "cancelled";

export type OwnerResponseStatus = "pending" | "responded" | "timeout_refunded";

export type PgOnboardingPath = "self_serve" | "sales_assist";

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
