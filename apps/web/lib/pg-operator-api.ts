// PG Operator REST adapter — thin wrappers over the canonical `fetchApi`.
// Convention:
//   - Read endpoints + simple POSTs (no Idempotency-Key required) → positional `(body?, token?)`
//   - Mutating endpoints with Idempotency-Key → object-arg `({ idempotencyKey, payload|input, token? })`
// `fetchApi` already unwraps the backend `{ data, meta }` envelope; do NOT add an unwrap here.

import { fetchApi } from "./api";
import type {
  PgDashboardData,
  PgSegmentationResult,
  PgProperty,
  PgListingPayload
} from "@cribliv/shared-types";

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getMe(token?: string) {
  return fetchApi<{ operator: { id: string; role: string }; properties: PgProperty[] }>(
    "/pg-operator/me",
    { headers: authHeaders(token) }
  );
}

export function segment(
  body: { total_beds: number; property_count?: number; has_existing_listings?: boolean },
  token?: string
) {
  return fetchApi<PgSegmentationResult>("/pg-operator/segment", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function getOnboardingState(token?: string) {
  return fetchApi<{ state: "needs_property" | "ready_to_list"; property_count: number }>(
    "/pg-operator/onboarding-state",
    { headers: authHeaders(token) }
  );
}

export function getDashboard(token?: string) {
  return fetchApi<PgDashboardData>("/pg-operator/dashboard", { headers: authHeaders(token) });
}

/**
 * Reveal a lead's real tenant contact. Dev-revealed for now; in V1.5 this is
 * gated behind the operator-pays plan (the API returns 402 payment_required).
 */
export function openPgLead(leadId: string, token?: string) {
  return fetchApi<{ lead_id: string; phone: string | null; tenant_name: string }>(
    `/pg-operator/leads/${leadId}/open`,
    { method: "POST", headers: authHeaders(token) }
  );
}

export function createPgListing(args: {
  idempotencyKey: string;
  payload: PgListingPayload;
  token?: string;
}) {
  return fetchApi<{ listing_id: string; status: string }>("/pg-operator/listings", {
    method: "POST",
    headers: {
      ...authHeaders(args.token),
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey
    },
    body: JSON.stringify(args.payload)
  });
}

export interface PgListingDetail {
  id: string;
  status: string;
  title: string | null;
  monthly_rent: number | null;
  created_at: string | null;
  city_slug: string | null;
  locality_slug: string | null;
  pg_details: {
    total_beds: number | null;
    gender_policy: string | null;
    tenant_type: string | null;
    security_deposit_paise: number | null;
    notice_period_days: number | null;
    lock_in_months: number | null;
    electricity_mode: string | null;
    rent_due_day: number | null;
    price_negotiable: boolean;
    payment_modes: string[];
    meals: Record<string, unknown> | null;
    amenities: Record<string, unknown>;
    house_rules: Record<string, unknown>;
  };
  room_types: Array<{
    sharing: string;
    ac: boolean;
    bathroom_kind: string | null;
    furnishing: string | null;
    monthly_rent_paise: number;
    vacancy_count: number;
    available_from: string | null;
  }>;
  photos: Array<{ blob_path: string; is_cover: boolean }>;
}

export function getPgListingDetail(id: string, token?: string) {
  return fetchApi<PgListingDetail>(`/pg-operator/listings/${id}`, {
    headers: authHeaders(token)
  });
}

/** Submit a draft listing for admin review (draft → pending_review). */
export function submitPgListing(id: string, token?: string) {
  return fetchApi<{ listing_id: string; status: string }>(`/pg-operator/listings/${id}/submit`, {
    method: "POST",
    headers: authHeaders(token)
  });
}

export interface PgPropertyCreateInput {
  display_name: string;
  city_slug: string;
  locality_slug?: string;
  internal_code?: string;
  total_floors?: number;
  metadata?: Record<string, unknown>;
}

export function createPgProperty(args: {
  idempotencyKey: string;
  input: PgPropertyCreateInput;
  token?: string;
}) {
  return fetchApi<PgProperty>("/pg-operator/properties", {
    method: "POST",
    headers: {
      ...authHeaders(args.token),
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey
    },
    body: JSON.stringify(args.input)
  });
}

// Sales-assist lead for large PGs routed off the self-serve wizard. Posts to the
// canonical sales endpoint (POST /sales/leads, source=pg_sales_assist); the
// bed/city/phone the form collects ride along in `metadata` for sales follow-up.
// (Previously POSTed to a non-existent /pg-operator/sales-assist-lead route → 404.)
export function submitSalesAssistLead(
  body: { total_beds: number; city: string; phone: string; notes?: string },
  token?: string
) {
  return fetchApi<{ id: string; status: string; source: string }>("/sales/leads", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "pg_sales_assist",
      notes: body.notes,
      metadata: { total_beds: body.total_beds, city: body.city, phone: body.phone }
    })
  });
}
