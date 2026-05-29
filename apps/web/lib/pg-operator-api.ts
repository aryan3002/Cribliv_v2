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

// Optional V1.x: sales-assist lead. Endpoint may not exist; will be verified in Task 14.
export function submitSalesAssistLead(
  body: { total_beds: number; city: string; phone: string; notes?: string },
  token?: string
) {
  return fetchApi<{ ok: true; lead_id: string }>("/pg-operator/sales-assist-lead", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
