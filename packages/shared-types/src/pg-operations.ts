export type PgManageRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface PgManageRequest {
  id: string;
  listing_id: string;
  pg_property_id: string | null;
  operator_user_id: string;
  status: PgManageRequestStatus;
  requested_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  payment_order_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PgManageRequestState {
  status: "none" | PgManageRequestStatus;
  request?: PgManageRequest;
  managed_property_id?: string;
  layout_status?: string;
}
