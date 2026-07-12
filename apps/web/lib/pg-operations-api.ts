import type {
  PgManageRequest,
  PgManageRequestState,
  PgManageRequestStatus
} from "@cribliv/shared-types";
import { fetchApi } from "./api";

export type AdminPgManageRequest = PgManageRequest & {
  listing_title: string;
  operator_name: string | null;
  operator_phone: string | null;
};

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function getManageRequest(listingId: string, token?: string) {
  return fetchApi<PgManageRequestState>(`/pg-operator/listings/${listingId}/manage-request`, {
    headers: authHeaders(token)
  });
}

export function requestManage(
  listingId: string,
  body: { reason?: string },
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgManageRequest>(`/pg-operator/listings/${listingId}/manage-request`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function fetchAdminPgManageRequests(status?: PgManageRequestStatus, token?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchApi<{ items: AdminPgManageRequest[] }>(`/admin/pg/manage-requests${query}`, {
    headers: authHeaders(token)
  });
}

export function approveAdminPgManageRequest(
  requestId: string,
  body: { notes?: string },
  token?: string
) {
  return fetchApi<PgManageRequest>(`/admin/pg/manage-requests/${requestId}/approve`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function rejectAdminPgManageRequest(
  requestId: string,
  body: { notes?: string },
  token?: string
) {
  return fetchApi<PgManageRequest>(`/admin/pg/manage-requests/${requestId}/reject`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
