import type {
  PgBed,
  PgBedStatus,
  PgLayoutDraft,
  PgLayoutPutInput,
  PgLayoutRoomCountInput,
  PgManageRequest,
  PgManageRequestState,
  PgManageRequestStatus,
  PgManagedPropertyDetail,
  PgManagedPropertySummary,
  PgOccupancySummary,
  PgRoom
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

export type PgOccupancyFilters = {
  floor?: number;
  status?: PgBedStatus;
  available_from?: string;
};

function occupancyQuery(filters: PgOccupancyFilters = {}): string {
  const query = new URLSearchParams();
  if (filters.floor !== undefined) query.set("floor", String(filters.floor));
  if (filters.status) query.set("status", filters.status);
  if (filters.available_from) query.set("available_from", filters.available_from);
  const value = query.toString();
  return value ? `?${value}` : "";
}

export function listManagedProperties(token?: string) {
  return fetchApi<{ items: PgManagedPropertySummary[] }>("/pg-operator/properties", {
    headers: authHeaders(token)
  });
}

export function getManagedProperty(propertyId: string, token?: string) {
  return fetchApi<PgManagedPropertyDetail | null>(`/pg-operator/properties/${propertyId}`, {
    headers: authHeaders(token)
  });
}

export function getPropertyLayout(propertyId: string, token?: string) {
  return fetchApi<PgRoom[]>(`/pg-operator/properties/${propertyId}/layout`, {
    headers: authHeaders(token)
  });
}

export function generateLayoutDraft(
  propertyId: string,
  roomCounts: PgLayoutRoomCountInput[],
  token?: string
) {
  return fetchApi<PgLayoutDraft>(`/pg-operator/properties/${propertyId}/layout/generate`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ room_counts: roomCounts })
  });
}

export function savePropertyLayout(propertyId: string, input: PgLayoutPutInput, token?: string) {
  return fetchApi<PgRoom[]>(`/pg-operator/properties/${propertyId}/layout`, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getOccupancySummary(
  propertyId: string,
  token?: string,
  filters: PgOccupancyFilters = {}
) {
  return fetchApi<PgOccupancySummary>(
    `/pg-operator/properties/${propertyId}/occupancy${occupancyQuery(filters)}`,
    { headers: authHeaders(token) }
  );
}

export function updateBedStatus(
  propertyId: string,
  bedId: string,
  status: Extract<PgBedStatus, "blocked" | "vacant" | "inactive">,
  token?: string
) {
  return fetchApi<PgBed>(`/pg-operator/properties/${propertyId}/beds/${bedId}/status`, {
    method: "PATCH",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export function relistBed(propertyId: string, bedId: string, token?: string) {
  return fetchApi<PgBed>(`/pg-operator/properties/${propertyId}/beds/${bedId}/relist`, {
    method: "POST",
    headers: authHeaders(token)
  });
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
