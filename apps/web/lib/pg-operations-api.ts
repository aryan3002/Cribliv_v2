import type {
  PgBed,
  PgBedAssignment,
  PgBedAssignmentListFilters,
  PgBedAssignmentOccupantInput,
  PgBedStatus,
  PgLayoutDraft,
  PgLayoutPutInput,
  PgLayoutRoomCountInput,
  PgMaintenanceComment,
  PgMaintenanceCommentInput,
  PgMaintenanceCategory,
  PgMaintenanceCompletePhotoInput,
  PgMaintenanceCreateInput,
  PgMaintenanceAnalytics,
  PgMaintenanceInternalNoteInput,
  PgMaintenanceInternalNoteResponse,
  PgMaintenancePresignFileInput,
  PgMaintenancePresignResponse,
  PgMaintenanceQueueFilters,
  PgMaintenanceQueuePage,
  PgMaintenanceResolutionInput,
  PgMaintenanceRequest,
  PgMaintenanceStatus,
  PgManageRequest,
  PgManageRequestState,
  PgManageRequestStatus,
  PgManagedPropertyDetail,
  PgManagedPropertySummary,
  PgOccupancySummary,
  PgOperatorBedDetail,
  PgRoom,
  PgServeNoticeInput,
  PgTenantResidence
} from "@cribliv/shared-types";
import { fetchApi } from "./api";

export type AdminPgManageRequest = PgManageRequest & {
  listing_title: string;
  operator_name: string | null;
  operator_phone: string | null;
};

export type MaintenancePhotoUploadFile = {
  clientUploadId: string;
  contentType: string;
  sizeBytes: number;
};

export type MaintenancePhotoCompleteInput = {
  clientUploadId: string;
  blobPath: string;
};

export type MaintenancePhotoUploadTarget = {
  clientUploadId: string;
  uploadUrl: string;
  blobPath: string;
  expiresAt: string;
};

export type MaintenancePhotoPresignResult = {
  uploads: MaintenancePhotoUploadTarget[];
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

function assignmentQuery(filters: PgBedAssignmentListFilters = {}): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.bed_id) query.set("bed_id", filters.bed_id);
  if (filters.tenant_user_id) query.set("tenant_user_id", filters.tenant_user_id);
  const value = query.toString();
  return value ? `?${value}` : "";
}

function maintenanceQuery(filters: PgMaintenanceQueueFilters = {}): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.priority) query.set("priority", filters.priority);
  if (filters.sla_state) query.set("sla_state", filters.sla_state);
  if (filters.category_slug) query.set("category_slug", filters.category_slug);
  if (filters.location_kind) query.set("location_kind", filters.location_kind);
  if (filters.common_area) query.set("common_area", filters.common_area);
  if (filters.floor !== undefined) query.set("floor", String(filters.floor));
  if (filters.tenant_query) query.set("tenant_query", filters.tenant_query);
  if (filters.include_closed !== undefined) {
    query.set("include_closed", String(filters.include_closed));
  }
  if (filters.limit !== undefined) query.set("limit", String(filters.limit));
  if (filters.cursor) query.set("cursor", filters.cursor);
  const value = query.toString();
  return value ? `?${value}` : "";
}

function toPresignFiles(files: MaintenancePhotoUploadFile[]): PgMaintenancePresignFileInput[] {
  return files.map((file) => ({
    client_upload_id: file.clientUploadId,
    content_type: file.contentType,
    size_bytes: file.sizeBytes
  }));
}

function toCompletePhotos(
  photos: MaintenancePhotoCompleteInput[]
): PgMaintenanceCompletePhotoInput[] {
  return photos.map((photo) => ({
    client_upload_id: photo.clientUploadId,
    blob_path: photo.blobPath
  }));
}

function fromPresignResponse(
  response: PgMaintenancePresignResponse
): MaintenancePhotoPresignResult {
  return {
    uploads: response.uploads.map((upload) => ({
      clientUploadId: upload.client_upload_id,
      uploadUrl: upload.upload_url,
      blobPath: upload.blob_path,
      expiresAt: upload.expires_at
    }))
  };
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

export function getPropertyInventory(propertyId: string, token?: string) {
  return fetchApi<PgRoom[]>(`/pg-operator/properties/${propertyId}/inventory`, {
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

export function listAssignments(
  propertyId: string,
  token?: string,
  filters: PgBedAssignmentListFilters = {}
) {
  return fetchApi<PgBedAssignment[]>(
    `/pg-operator/properties/${propertyId}/assignments${assignmentQuery(filters)}`,
    { headers: authHeaders(token) }
  );
}

export function getOperatorBedDetail(propertyId: string, bedId: string, token?: string) {
  return fetchApi<PgOperatorBedDetail>(`/pg-operator/properties/${propertyId}/beds/${bedId}`, {
    headers: authHeaders(token)
  });
}

export function listPropertyMaintenance(
  propertyId: string,
  token?: string,
  filters: PgMaintenanceQueueFilters = {}
) {
  return fetchApi<PgMaintenanceQueuePage>(
    `/pg-operator/properties/${propertyId}/maintenance${maintenanceQuery(filters)}`,
    { headers: authHeaders(token) }
  );
}

export function fetchMaintenanceCategories(token?: string) {
  return fetchApi<PgMaintenanceCategory[]>("/pg-operator/maintenance/categories", {
    headers: authHeaders(token)
  });
}

export function getMaintenanceTicket(propertyId: string, requestId: string, token?: string) {
  return fetchApi<PgMaintenanceRequest>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}`,
    { headers: authHeaders(token) }
  );
}

export function resolveMaintenanceTicket(
  propertyId: string,
  requestId: string,
  body: PgMaintenanceResolutionInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceRequest>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}/resolve`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    }
  );
}

export function addMaintenanceInternalNote(
  propertyId: string,
  requestId: string,
  body: PgMaintenanceInternalNoteInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceInternalNoteResponse>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}/internal-notes`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    }
  );
}

export function fetchMaintenanceAnalytics(propertyId: string, token?: string) {
  return fetchApi<PgMaintenanceAnalytics>(
    `/pg-operator/properties/${propertyId}/maintenance/analytics`,
    { headers: authHeaders(token) }
  );
}

export function listBedMaintenance(propertyId: string, bedId: string, token?: string) {
  return fetchApi<PgMaintenanceRequest[]>(
    `/pg-operator/properties/${propertyId}/beds/${bedId}/maintenance`,
    { headers: authHeaders(token) }
  );
}

export function updateMaintenanceStatus(
  propertyId: string,
  requestId: string,
  status: PgMaintenanceStatus,
  token?: string
) {
  return fetchApi<PgMaintenanceRequest>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}`,
    {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }
  );
}

export function addMaintenanceComment(
  propertyId: string,
  requestId: string,
  body: PgMaintenanceCommentInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceComment>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}/comments`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body)
    }
  );
}

export async function presignMaintenancePhotos(
  propertyId: string,
  requestId: string,
  files: MaintenancePhotoUploadFile[],
  token: string | undefined,
  idempotencyKey: string
) {
  const response = await fetchApi<PgMaintenancePresignResponse>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}/photos/presign`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ files: toPresignFiles(files) })
    }
  );
  return fromPresignResponse(response);
}

export function completeMaintenancePhotos(
  propertyId: string,
  requestId: string,
  photos: MaintenancePhotoCompleteInput[],
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceRequest>(
    `/pg-operator/properties/${propertyId}/maintenance/${requestId}/photos/complete`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ photos: toCompletePhotos(photos) })
    }
  );
}

export function reserveBed(
  propertyId: string,
  bedId: string,
  body: PgBedAssignmentOccupantInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgBedAssignment>(`/pg-operator/properties/${propertyId}/beds/${bedId}/reserve`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function moveInBed(
  propertyId: string,
  bedId: string,
  body: PgBedAssignmentOccupantInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgBedAssignment>(`/pg-operator/properties/${propertyId}/beds/${bedId}/move-in`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function operatorMoveOutRequest(propertyId: string, assignmentId: string, token?: string) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/operator-move-out-request`,
    { method: "POST", headers: authHeaders(token) }
  );
}

export function confirmAssignmentMoveOut(propertyId: string, assignmentId: string, token?: string) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/confirm-move-out`,
    { method: "POST", headers: authHeaders(token) }
  );
}

export function moveOutAssignmentNow(propertyId: string, assignmentId: string, token?: string) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/move-out-now`,
    { method: "POST", headers: authHeaders(token) }
  );
}

export function cancelAssignmentMoveOut(propertyId: string, assignmentId: string, token?: string) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/cancel-move-out`,
    { method: "POST", headers: authHeaders(token) }
  );
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

export function getTenantResidence(token?: string, opts: { server?: boolean } = { server: true }) {
  return fetchApi<PgTenantResidence | null>(
    "/tenant/pg-residence",
    { headers: authHeaders(token) },
    opts
  );
}

export function listResidenceMaintenance(token?: string) {
  return fetchApi<PgMaintenanceRequest[]>("/tenant/pg-residence/maintenance", {
    headers: authHeaders(token)
  });
}

export function createResidenceMaintenance(
  body: PgMaintenanceCreateInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceRequest>("/tenant/pg-residence/maintenance", {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function addResidenceMaintenanceComment(
  requestId: string,
  body: PgMaintenanceCommentInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceComment>(`/tenant/pg-residence/maintenance/${requestId}/comments`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function reopenResidenceMaintenance(
  requestId: string,
  body: PgMaintenanceCommentInput,
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceRequest>(`/tenant/pg-residence/maintenance/${requestId}/reopen`, {
    method: "POST",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export async function presignResidenceMaintenancePhotos(
  requestId: string,
  files: MaintenancePhotoUploadFile[],
  token: string | undefined,
  idempotencyKey: string
) {
  const response = await fetchApi<PgMaintenancePresignResponse>(
    `/tenant/pg-residence/maintenance/${requestId}/photos/presign`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ files: toPresignFiles(files) })
    }
  );
  return fromPresignResponse(response);
}

export function completeResidenceMaintenancePhotos(
  requestId: string,
  photos: MaintenancePhotoCompleteInput[],
  token: string | undefined,
  idempotencyKey: string
) {
  return fetchApi<PgMaintenanceRequest>(
    `/tenant/pg-residence/maintenance/${requestId}/photos/complete`,
    {
      method: "POST",
      headers: {
        ...authHeaders(token),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({ photos: toCompletePhotos(photos) })
    }
  );
}

export function serveTenantNotice(token?: string, body: Partial<PgServeNoticeInput> = {}) {
  return fetchApi<PgTenantResidence>("/tenant/pg-residence/notice", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function requestTenantMoveOut(token?: string) {
  return fetchApi<PgTenantResidence>("/tenant/pg-residence/move-out-request", {
    method: "POST",
    headers: authHeaders(token)
  });
}

export function acceptTenantOperatorMoveOut(requestId: string, token?: string) {
  return fetchApi<PgTenantResidence>(`/tenant/pg-residence/operator-move-out/${requestId}/accept`, {
    method: "POST",
    headers: authHeaders(token)
  });
}

export function rejectTenantOperatorMoveOut(requestId: string, token?: string) {
  return fetchApi<PgTenantResidence>(`/tenant/pg-residence/operator-move-out/${requestId}/reject`, {
    method: "POST",
    headers: authHeaders(token)
  });
}
