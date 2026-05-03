import { fetchApi } from "./api";
import type { ListingStatus, VerificationStatus, ListingType } from "@cribliv/shared-types";

export type { ListingStatus, VerificationStatus, ListingType };

export interface OwnerListingVm {
  id: string;
  title: string;
  city?: string;
  locality?: string;
  listingType: ListingType;
  monthlyRent?: number;
  status: ListingStatus;
  verificationStatus: VerificationStatus;
  createdAt?: string;
  coverImage?: string;
  photos?: string[];
}

export interface OwnerListingDraftInput {
  title: string;
  description?: string;
  listingType: ListingType;
  rent?: number;
  deposit?: number;
  location: {
    city: string;
    locality?: string;
    addressLine1?: string;
    landmark?: string;
    pincode?: string;
    maskedAddress?: string;
  };
  propertyFields?: {
    bhk?: number;
    bathrooms?: number;
    areaSqft?: number;
    furnishing?: "unfurnished" | "semi_furnished" | "fully_furnished";
    preferredTenant?: "any" | "family" | "bachelor" | "female" | "male";
  };
  pgFields?: {
    totalBeds?: number;
    occupancyType?: "male" | "female" | "co_living";
    roomSharingOptions?: string[];
    foodIncluded?: boolean;
    curfewTime?: string;
    attachedBathroom?: boolean;
  };
}

export type ConfidenceTier = "high" | "medium" | "low";

export interface OwnerDraftPayloadSnakeCase {
  listing_type?: "flat_house" | "pg";
  title?: string;
  description?: string;
  rent?: number;
  deposit?: number;
  location?: {
    city?: string;
    locality?: string;
    address_line1?: string;
    masked_address?: string;
  };
  property_fields?: {
    bhk?: number;
    bathrooms?: number;
    area_sqft?: number;
    furnishing?: "unfurnished" | "semi_furnished" | "fully_furnished";
  };
  pg_fields?: {
    total_beds?: number;
    room_sharing_options?: string[];
    food_included?: boolean;
    attached_bathroom?: boolean;
  };
}

export interface OwnerListingCaptureExtractResponse {
  transcript_echo: string;
  draft_suggestion: Partial<OwnerDraftPayloadSnakeCase>;
  field_confidence_tier: Record<string, ConfidenceTier>;
  confirm_fields: string[];
  missing_required_fields: string[];
  critical_warnings: string[];
}

export interface PresignedUpload {
  clientUploadId: string;
  uploadUrl: string;
  blobPath: string;
  expiresAt: string;
}

export interface VerificationAttemptVm {
  id: string;
  verificationType: "video_liveness" | "electricity_bill_match";
  result: "pending" | "pass" | "fail" | "manual_review";
  machineResult?: "pending" | "pass" | "fail" | "manual_review" | null;
  livenessScore: number | null;
  addressMatchScore: number | null;
  provider?: string | null;
  providerReference?: string | null;
  providerResultCode?: string | null;
  reviewReason?: string | null;
  retryable?: boolean;
  threshold: number;
  createdAt: string;
}

export interface VerificationStatusVm {
  overallStatus: VerificationStatus;
  attempts: VerificationAttemptVm[];
}

interface OwnerListingApiRow {
  id?: string;
  title?: string;
  city?: string;
  locality?: string | null;
  listingType?: ListingType;
  listing_type?: ListingType;
  monthlyRent?: number;
  monthly_rent?: number;
  status?: ListingStatus;
  verificationStatus?: VerificationStatus;
  verification_status?: VerificationStatus;
  createdAt?: number | string;
  created_at?: string;
  coverImage?: string | null;
  cover_image?: string | null;
  cover_image_url?: string | null;
  cover_photo_url?: string | null;
  coverPhotoUrl?: string | null;
  photos?: Array<string | { url?: string; src?: string } | null> | null;
  images?: Array<string | { url?: string; src?: string } | null> | null;
  photo_urls?: Array<string | null> | null;
}

function pickFirstString(...values: Array<string | null | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return undefined;
}

function normalizePhotoList(
  raw:
    | OwnerListingApiRow["photos"]
    | OwnerListingApiRow["images"]
    | OwnerListingApiRow["photo_urls"]
): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const urls = raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") return entry.url ?? entry.src ?? null;
      return null;
    })
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  return urls.length > 0 ? urls : undefined;
}

function mapOwnerListingRow(row: OwnerListingApiRow): OwnerListingVm {
  const createdAtValue = row.created_at ?? row.createdAt;
  const createdAtIso =
    typeof createdAtValue === "number"
      ? new Date(createdAtValue).toISOString()
      : typeof createdAtValue === "string"
        ? new Date(createdAtValue).toISOString()
        : undefined;

  const photos =
    normalizePhotoList(row.photos) ??
    normalizePhotoList(row.images) ??
    normalizePhotoList(row.photo_urls);

  const coverImage =
    pickFirstString(
      row.coverImage,
      row.cover_image,
      row.cover_image_url,
      row.cover_photo_url,
      row.coverPhotoUrl
    ) ?? photos?.[0];

  return {
    id: row.id ?? "",
    title: row.title ?? "Listing",
    city: row.city,
    locality: row.locality ?? undefined,
    listingType: row.listingType ?? row.listing_type ?? "flat_house",
    monthlyRent: row.monthlyRent ?? row.monthly_rent,
    status: row.status ?? "draft",
    verificationStatus: row.verificationStatus ?? row.verification_status ?? "unverified",
    createdAt: createdAtIso,
    coverImage,
    photos
  };
}

function buildOwnerPayload(input: OwnerListingDraftInput) {
  return {
    listing_type: input.listingType,
    title: input.title,
    description: input.description,
    rent: input.rent,
    deposit: input.deposit,
    location: {
      city: input.location.city,
      locality: input.location.locality,
      address_line1: input.location.addressLine1,
      landmark: input.location.landmark,
      pincode: input.location.pincode,
      masked_address: input.location.maskedAddress
    },
    property_fields: input.propertyFields
      ? {
          bhk: input.propertyFields.bhk,
          bathrooms: input.propertyFields.bathrooms,
          area_sqft: input.propertyFields.areaSqft,
          furnishing: input.propertyFields.furnishing,
          preferred_tenant: input.propertyFields.preferredTenant
        }
      : undefined,
    pg_fields: input.pgFields
      ? {
          total_beds: input.pgFields.totalBeds,
          occupancy_type: input.pgFields.occupancyType,
          room_sharing_options: input.pgFields.roomSharingOptions,
          food_included: input.pgFields.foodIncluded,
          curfew_time: input.pgFields.curfewTime,
          attached_bathroom: input.pgFields.attachedBathroom
        }
      : undefined
  };
}

function authHeaders(accessToken: string, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...(extra ?? {})
  };
}

export function makeIdempotencyKey(prefix: string) {
  const randomPart =
    typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${randomPart}`;
}

export async function listOwnerListings(accessToken: string, status?: ListingStatus) {
  const query = status ? `?status=${status}` : "";
  const response = await fetchApi<{ items: OwnerListingApiRow[]; total: number }>(
    `/owner/listings${query}`,
    {
      headers: authHeaders(accessToken)
    }
  );

  return {
    items: (response.items ?? []).map(mapOwnerListingRow),
    total: response.total ?? 0
  };
}

export async function createOwnerListing(accessToken: string, input: OwnerListingDraftInput) {
  const response = await fetchApi<{ listing_id: string; status: ListingStatus }>(
    "/owner/listings",
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(buildOwnerPayload(input))
    }
  );

  return {
    listingId: response.listing_id,
    status: response.status
  };
}

export async function updateOwnerListing(
  accessToken: string,
  listingId: string,
  input: OwnerListingDraftInput
) {
  const response = await fetchApi<{ listing_id: string; status: ListingStatus }>(
    `/owner/listings/${listingId}`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify(buildOwnerPayload(input))
    }
  );

  return {
    listingId: response.listing_id,
    status: response.status
  };
}

export async function submitOwnerListing(accessToken: string, listingId: string) {
  const response = await fetchApi<{ listing_id: string; status: ListingStatus }>(
    `/owner/listings/${listingId}/submit`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ agree_terms: true })
    }
  );

  return {
    listingId: response.listing_id,
    status: response.status
  };
}

export async function segmentPgPath(accessToken: string, totalBeds: number) {
  const response = await fetchApi<{ path: "self_serve" | "sales_assist"; next_step: string }>(
    "/pg/segment",
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ total_beds: totalBeds })
    }
  );

  return {
    path: response.path,
    nextStep: response.next_step
  };
}

export async function createSalesLead(
  accessToken: string,
  input: {
    source: "pg_sales_assist" | "property_management";
    listingId?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
    idempotencyKey?: string;
  }
) {
  const response = await fetchApi<{
    id: string;
    status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
    source: "pg_sales_assist" | "property_management";
    listing_id: string | null;
    created_at: string;
  }>("/sales/leads", {
    method: "POST",
    headers: authHeaders(
      accessToken,
      input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined
    ),
    body: JSON.stringify({
      source: input.source,
      listing_id: input.listingId,
      notes: input.notes,
      metadata: input.metadata ?? {}
    })
  });

  return {
    id: response.id,
    status: response.status,
    source: response.source,
    listingId: response.listing_id,
    createdAt: response.created_at
  };
}

export async function extractOwnerListingFromAudio(
  accessToken: string,
  input: {
    audio: Blob;
    locale?: "hi-IN" | "en-IN";
    listingTypeHint?: "flat_house" | "pg";
    fileName?: string;
  }
) {
  const formData = new FormData();
  formData.append("audio", input.audio, input.fileName ?? "listing-capture.webm");
  if (input.locale) {
    formData.append("locale", input.locale);
  }
  if (input.listingTypeHint) {
    formData.append("listing_type_hint", input.listingTypeHint);
  }

  return fetchApi<OwnerListingCaptureExtractResponse>("/owner/listings/capture/extract", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: formData
  });
}

export async function presignListingPhotos(
  accessToken: string,
  listingId: string,
  files: Array<{ clientUploadId: string; contentType: string; sizeBytes: number }>,
  idempotencyKey: string
) {
  const response = await fetchApi<{
    uploads: Array<{
      client_upload_id: string;
      upload_url: string;
      blob_path: string;
      expires_at: string;
    }>;
  }>(`/owner/listings/${listingId}/photos/presign`, {
    method: "POST",
    headers: authHeaders(accessToken, { "Idempotency-Key": idempotencyKey }),
    body: JSON.stringify({
      files: files.map((file) => ({
        client_upload_id: file.clientUploadId,
        content_type: file.contentType,
        size_bytes: file.sizeBytes
      }))
    })
  });

  const mappedUploads: PresignedUpload[] = (response.uploads ?? []).map((upload) => ({
    clientUploadId: upload.client_upload_id,
    uploadUrl: upload.upload_url,
    blobPath: upload.blob_path,
    expiresAt: upload.expires_at
  }));

  return { uploads: mappedUploads };
}

export async function completeListingPhotos(
  accessToken: string,
  listingId: string,
  files: Array<{ clientUploadId: string; blobPath: string; isCover?: boolean; sortOrder?: number }>,
  idempotencyKey: string
) {
  const response = await fetchApi<{ photo_ids: string[]; accepted_count: number }>(
    `/owner/listings/${listingId}/photos/complete`,
    {
      method: "POST",
      headers: authHeaders(accessToken, { "Idempotency-Key": idempotencyKey }),
      body: JSON.stringify({
        files: files.map((file) => ({
          client_upload_id: file.clientUploadId,
          blob_path: file.blobPath,
          is_cover: Boolean(file.isCover ?? false),
          sort_order: file.sortOrder ?? 0
        }))
      })
    }
  );

  return {
    photoIds: response.photo_ids ?? [],
    acceptedCount: response.accepted_count ?? 0
  };
}

export async function submitVideoVerification(
  accessToken: string,
  body: { listingId: string; artifactBlobPath: string; vendorReference?: string }
) {
  const response = await fetchApi<{
    attempt_id: string;
    result: "pending" | "pass" | "fail" | "manual_review";
    machine_result?: "pending" | "pass" | "fail" | "manual_review";
    provider?: string;
    provider_reference?: string | null;
    provider_result_code?: string;
    review_reason?: string | null;
    retryable?: boolean;
  }>("/owner/verification/video", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      listing_id: body.listingId,
      artifact_blob_path: body.artifactBlobPath,
      vendor_reference: body.vendorReference
    })
  });

  return {
    attemptId: response.attempt_id,
    result: response.result,
    machineResult: response.machine_result ?? response.result,
    provider: response.provider,
    providerReference: response.provider_reference ?? null,
    providerResultCode: response.provider_result_code,
    reviewReason: response.review_reason ?? null,
    retryable: Boolean(response.retryable)
  };
}

export async function submitElectricityVerification(
  accessToken: string,
  body: {
    listingId: string;
    consumerId: string;
    addressText: string;
    billArtifactBlobPath?: string;
  }
) {
  const response = await fetchApi<{
    attempt_id: string;
    address_match_score: number;
    result: "pending" | "pass" | "fail" | "manual_review";
    machine_result?: "pending" | "pass" | "fail" | "manual_review";
    provider?: string;
    provider_reference?: string | null;
    provider_result_code?: string;
    review_reason?: string | null;
    retryable?: boolean;
  }>("/owner/verification/electricity", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      listing_id: body.listingId,
      consumer_id: body.consumerId,
      address_text: body.addressText,
      bill_artifact_blob_path: body.billArtifactBlobPath
    })
  });

  return {
    attemptId: response.attempt_id,
    addressMatchScore: response.address_match_score,
    result: response.result,
    machineResult: response.machine_result ?? response.result,
    provider: response.provider,
    providerReference: response.provider_reference ?? null,
    providerResultCode: response.provider_result_code,
    reviewReason: response.review_reason ?? null,
    retryable: Boolean(response.retryable)
  };
}

export async function fetchVerificationStatus(
  accessToken: string,
  listingId: string
): Promise<VerificationStatusVm> {
  const response = await fetchApi<{
    overall_status: VerificationStatus;
    attempts: Array<{
      id: string;
      verification_type: "video_liveness" | "electricity_bill_match";
      liveness_score: number | null;
      address_match_score: number | null;
      threshold: number;
      result: "pending" | "pass" | "fail" | "manual_review";
      created_at: string;
      provider?: string | null;
      provider_reference?: string | null;
      provider_result_code?: string | null;
      review_reason?: string | null;
      retryable?: boolean | null;
      machine_result?: "pending" | "pass" | "fail" | "manual_review" | null;
    }>;
  }>(`/owner/verification/status?listing_id=${encodeURIComponent(listingId)}`, {
    headers: authHeaders(accessToken)
  });

  return {
    overallStatus: response.overall_status,
    attempts: (response.attempts ?? []).map((attempt) => ({
      id: attempt.id,
      verificationType: attempt.verification_type,
      result: attempt.result,
      livenessScore: attempt.liveness_score,
      addressMatchScore: attempt.address_match_score,
      provider: attempt.provider ?? null,
      providerReference: attempt.provider_reference ?? null,
      providerResultCode: attempt.provider_result_code ?? null,
      reviewReason: attempt.review_reason ?? null,
      retryable: Boolean(attempt.retryable),
      machineResult: attempt.machine_result ?? null,
      threshold: Number(attempt.threshold ?? 85),
      createdAt: attempt.created_at
    }))
  };
}

// ── Role upgrade request ────────────────────────────────────────────────────

export interface RoleRequestResult {
  /** null when role is granted immediately (in-memory / dev mode) */
  request_id: string | null;
  /** "granted" = role set immediately (dev); "pending" = awaiting admin (prod); "already_granted" = idempotent */
  status: "granted" | "already_granted" | "pending";
  requested_role: "owner" | "pg_operator";
  /** The role the user now has (set when status = "granted" or "already_granted") */
  role?: string;
}

/**
 * POST /users/me/role-request
 * A tenant requests to be upgraded to owner or pg_operator.
 * Admin must approve via the admin panel.
 */
export async function requestRoleUpgrade(
  accessToken: string,
  requestedRole: "owner" | "pg_operator"
): Promise<RoleRequestResult> {
  return fetchApi<RoleRequestResult>("/users/me/role-request", {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ requested_role: requestedRole })
  });
}

/* ─── AI listing content generation ─────────────────────────────── */

export interface GenerateListingContentInput {
  listing_type: "flat_house" | "pg";
  monthly_rent?: number;
  deposit?: number;
  furnishing?: string;
  city?: string;
  locality?: string;
  bedrooms?: number;
  bathrooms?: number;
  area_sqft?: number;
  amenities?: string[];
  preferred_tenant?: string;
  beds?: number;
  sharing_type?: string;
  meals_included?: boolean;
  attached_bathroom?: boolean;
}

export async function generateListingContent(
  accessToken: string,
  input: GenerateListingContentInput
): Promise<{ title: string; description: string }> {
  return fetchApi<{ title: string; description: string }>("/owner/listings/generate-content", {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

// ── Leads ──────────────────────────────────────────────────────────────────

export type LeadStatus = "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";

export interface LeadVm {
  id: string;
  listingId: string;
  listingTitle: string;
  tenantName: string;
  tenantPhoneMasked: string | null;
  status: LeadStatus;
  statusChangedAt: string;
  ownerNotes: string | null;
  createdAt: string;
}

export interface LeadStats {
  new: number;
  contacted: number;
  visit_scheduled: number;
  deal_done: number;
  lost: number;
  total: number;
}

function mapLeadRow(row: Record<string, unknown>): LeadVm {
  return {
    id: String(row.id ?? ""),
    listingId: String(row.listing_id ?? ""),
    listingTitle: String(row.listing_title ?? "Listing"),
    tenantName: String(row.tenant_name ?? "Tenant"),
    tenantPhoneMasked: row.tenant_phone_masked ? String(row.tenant_phone_masked) : null,
    status: (row.status as LeadStatus) ?? "new",
    statusChangedAt: String(row.status_changed_at ?? row.created_at ?? ""),
    ownerNotes: row.owner_notes ? String(row.owner_notes) : null,
    createdAt: String(row.created_at ?? "")
  };
}

export async function fetchOwnerLeads(
  accessToken: string,
  opts?: { status?: LeadStatus; page?: number; pageSize?: number }
): Promise<{ items: LeadVm[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.page) params.set("page", String(opts.page));
  if (opts?.pageSize) params.set("page_size", String(opts.pageSize));
  const qs = params.toString();
  const result = await fetchApi<{
    items: Record<string, unknown>[];
    total: number;
    page: number;
    page_size: number;
  }>(`/owner/leads${qs ? "?" + qs : ""}`, { headers: authHeaders(accessToken) });
  return {
    items: (result.items ?? []).map(mapLeadRow),
    total: result.total ?? 0,
    page: result.page ?? 1,
    pageSize: result.page_size ?? 20
  };
}

export async function fetchLeadStats(accessToken: string): Promise<LeadStats> {
  return fetchApi<LeadStats>("/owner/leads/stats", { headers: authHeaders(accessToken) });
}

export async function updateLeadStatus(
  accessToken: string,
  leadId: string,
  status: LeadStatus,
  notes?: string
): Promise<{ leadId: string; status: LeadStatus }> {
  const result = await fetchApi<{ lead_id: string; status: string }>(
    `/owner/leads/${leadId}/status`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ status, notes })
    }
  );
  return { leadId: result.lead_id, status: result.status as LeadStatus };
}

// ── Boost ───────────────────────────────────────────────────────────────────

export interface BoostPlan {
  planId: string;
  boostType: "featured" | "boost";
  durationHours: number;
  amountPaise: number;
  label: string;
}

export interface BoostOrderResult {
  orderId: string;
  razorpayOrderId?: string;
  amountPaise: number;
  boostType: string;
  planLabel: string;
}

export async function fetchBoostPlans(accessToken: string): Promise<BoostPlan[]> {
  const result = await fetchApi<
    Array<{
      plan_id: string;
      boost_type: "featured" | "boost";
      duration_hours: number;
      amount_paise: number;
      label: string;
    }>
  >("/owner/boost/plans", { headers: authHeaders(accessToken) });
  return (result ?? []).map((p) => ({
    planId: p.plan_id,
    boostType: p.boost_type,
    durationHours: p.duration_hours,
    amountPaise: p.amount_paise,
    label: p.label
  }));
}

export async function createBoostOrder(
  accessToken: string,
  listingId: string,
  planId: string
): Promise<BoostOrderResult> {
  const result = await fetchApi<{
    order_id: string;
    razorpay_order_id?: string;
    amount_paise: number;
    boost_type: string;
    plan_label: string;
  }>(`/owner/listings/${listingId}/boost`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ plan_id: planId })
  });
  return {
    orderId: result.order_id,
    razorpayOrderId: result.razorpay_order_id,
    amountPaise: result.amount_paise,
    boostType: result.boost_type,
    planLabel: result.plan_label
  };
}

export async function fetchBoostStatus(
  accessToken: string,
  listingId: string
): Promise<{ hasBoost: boolean; boostType?: string; expiresAt?: string }> {
  const result = await fetchApi<{ has_boost: boolean; boost_type?: string; expires_at?: string }>(
    `/owner/listings/${listingId}/boost`,
    { headers: authHeaders(accessToken) }
  );
  return {
    hasBoost: result.has_boost,
    boostType: result.boost_type,
    expiresAt: result.expires_at
  };
}

// ── Availability ─────────────────────────────────────────────────────────────

export async function toggleListingAvailability(
  accessToken: string,
  listingId: string,
  available: boolean
): Promise<{ listingId: string; status: "active" | "paused" }> {
  const result = await fetchApi<{ listing_id: string; status: string }>(
    `/owner/listings/${listingId}/availability`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ available })
    }
  );
  return { listingId: result.listing_id, status: result.status as "active" | "paused" };
}
