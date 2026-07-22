import { ApiError, fetchApi, getApiBaseUrl } from "./api";
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
  /**
   * Independent of `status`; mirrors the `listings.is_available` DB column.
   * Absent should be treated as `true` (a listing is available unless flagged
   * otherwise). Flats/houses only — see `setListingAvailability`.
   */
  is_available?: boolean;
  /** Count of seekers who asked to be notified when this listing becomes available again. */
  waitlist_count?: number;
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
    lat?: number;
    lng?: number;
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
  amenities?: string[];
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

/**
 * Persisted listing photo, as returned by GET /owner/listings/:id under the
 * `photoItems` field. The frontend uses these in edit mode to drive the
 * drag-to-reorder grid and call the reorder endpoint.
 */
export interface ListingPhotoItem {
  id: string;
  url: string;
  blobPath: string;
  sortOrder: number;
  isCover: boolean;
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

export type VerificationArtifactKind = "video_liveness" | "electricity_bill";
export type VerificationArtifactUploadErrorKind =
  | "unsupported"
  | "too_large"
  | "network"
  | "expired"
  | "unauthorized"
  | "complete_failed";

export class VerificationArtifactUploadError extends Error {
  readonly kind: VerificationArtifactUploadErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(
    kind: VerificationArtifactUploadErrorKind,
    message: string,
    input: { status?: number; code?: string } = {}
  ) {
    super(message);
    this.name = "VerificationArtifactUploadError";
    this.kind = kind;
    this.status = input.status;
    this.code = input.code;
  }
}

function createVerificationUploadAbortError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Verification artifact upload aborted", "AbortError");
  }

  const error = new Error("Verification artifact upload aborted");
  error.name = "AbortError";
  return error;
}

export function isVerificationUploadAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

function throwIfVerificationUploadAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createVerificationUploadAbortError();
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
  is_available?: boolean;
  waitlist_count?: number;
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
    photos,
    is_available: row.is_available ?? true,
    waitlist_count: row.waitlist_count ?? 0
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
      lat: input.location.lat,
      lng: input.location.lng,
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
      : undefined,
    amenities: input.amenities
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

export async function getOwnerListing(accessToken: string, listingId: string) {
  return fetchApi<any>(`/owner/listings/${listingId}`, {
    headers: authHeaders(accessToken)
  });
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

/**
 * Persist a new ordering of an existing listing's photos. The caller MUST
 * include every photo for the listing in `items` (the server validates that
 * every photo_id belongs to the listing, and that exactly one item is the
 * cover). `sortOrder` values must be unique within the request.
 */
export async function reorderListingPhotos(
  accessToken: string,
  listingId: string,
  items: Array<{ photoId: string; sortOrder: number; isCover: boolean }>,
  idempotencyKey: string
) {
  const response = await fetchApi<{
    updated_count: number;
    items: Array<{ id: string; sort_order: number; is_cover: boolean }>;
  }>(`/owner/listings/${listingId}/photos/reorder`, {
    method: "PATCH",
    headers: authHeaders(accessToken, { "Idempotency-Key": idempotencyKey }),
    body: JSON.stringify({
      items: items.map((item) => ({
        photo_id: item.photoId,
        sort_order: item.sortOrder,
        is_cover: item.isCover
      }))
    })
  });

  return {
    updatedCount: response.updated_count ?? 0,
    items: (response.items ?? []).map((item) => ({
      id: item.id,
      sortOrder: Number(item.sort_order),
      isCover: Boolean(item.is_cover)
    }))
  };
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

function verificationArtifactUploadUrl(uploadUrl: string) {
  if (/^https?:\/\//i.test(uploadUrl)) return uploadUrl;
  const base = getApiBaseUrl().replace(/\/+$/, "");
  return `${base}/${uploadUrl.replace(/^\/+/, "")}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function objectValue(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function parseVerificationUploadErrorCode(responseText?: string) {
  if (!responseText) return undefined;

  try {
    const payload = objectValue(JSON.parse(responseText));
    if (!payload) return undefined;

    const errorPayload = objectValue(payload.error);
    const messagePayload = objectValue(payload.message);
    const detailsPayload = objectValue(payload.details);

    return (
      stringValue(errorPayload?.code) ??
      stringValue(payload.code) ??
      stringValue(messagePayload?.code) ??
      stringValue(detailsPayload?.code)
    );
  } catch {
    return undefined;
  }
}

function verificationUploadErrorKindFromCode(
  code?: string
): VerificationArtifactUploadErrorKind | null {
  switch (code) {
    case "invalid_content_type":
    case "invalid_file_signature":
    case "invalid_artifact_kind":
      return "unsupported";
    case "invalid_file_size":
      return "too_large";
    case "upload_token_expired":
    case "upload_token_not_found":
    case "upload_token_consumed":
    case "upload_token_invalid":
    case "already_consumed":
      return "expired";
    default:
      return null;
  }
}

function verificationUploadErrorKind(
  status: number,
  code?: string
): VerificationArtifactUploadErrorKind {
  const codeKind = verificationUploadErrorKindFromCode(code);
  if (codeKind) return codeKind;
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413) return "too_large";
  if (status === 409) return "expired";
  if (status === 415) return "unsupported";
  return "complete_failed";
}

function multipartVerificationUpload(input: {
  accessToken: string;
  uploadUrl: string;
  uploadToken: string;
  file: File;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}) {
  return new Promise<void>((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(createVerificationUploadAbortError());
      return;
    }

    const formData = new FormData();
    formData.append("upload_token", input.uploadToken);
    formData.append("file", input.file, input.file.name);

    const request = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => {
      input.signal?.removeEventListener("abort", abortRequest);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const abortRequest = () => request.abort();

    input.signal?.addEventListener("abort", abortRequest, { once: true });

    request.open("POST", verificationArtifactUploadUrl(input.uploadUrl));
    request.setRequestHeader("Authorization", `Bearer ${input.accessToken}`);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      input.onProgress?.(percent);
    };
    request.onerror = () => {
      rejectOnce(
        new VerificationArtifactUploadError("network", "Verification artifact upload interrupted")
      );
    };
    request.onabort = () => {
      rejectOnce(
        input.signal?.aborted
          ? createVerificationUploadAbortError()
          : new VerificationArtifactUploadError(
              "network",
              "Verification artifact upload interrupted"
            )
      );
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        input.onProgress?.(100);
        resolveOnce();
        return;
      }
      const code = parseVerificationUploadErrorCode(request.responseText);
      rejectOnce(
        new VerificationArtifactUploadError(
          verificationUploadErrorKind(request.status, code),
          "Verification artifact upload failed",
          { status: request.status, code }
        )
      );
    };
    request.send(formData);
  });
}

function verificationArtifactKindFromApiError(
  error: ApiError
): VerificationArtifactUploadErrorKind {
  const codeKind = verificationUploadErrorKindFromCode(error.code);
  if (codeKind) return codeKind;
  if (error.status === 401 || error.status === 403) return "unauthorized";
  if (error.status === 413) return "too_large";
  if (error.status === 409) return "expired";
  if (error.status === 415) return "unsupported";
  return "complete_failed";
}

function verificationArtifactErrorKind(error: unknown): VerificationArtifactUploadErrorKind {
  if (error instanceof VerificationArtifactUploadError) return error.kind;
  if (error instanceof ApiError) return verificationArtifactKindFromApiError(error);
  const message =
    error instanceof Error ? error.message.toLowerCase() : typeof error === "string" ? error : "";
  if (message.includes("failed to fetch") || message.includes("network")) return "network";
  return "complete_failed";
}

export function friendlyVerificationArtifactUploadError(
  error: unknown,
  locale: "en" | "hi" = "en"
) {
  const kind = verificationArtifactErrorKind(error);
  const copy: Record<VerificationArtifactUploadErrorKind, { en: string; hi: string }> = {
    unsupported: {
      en: "Choose a supported verification file.",
      hi: "समर्थित वेरिफिकेशन फ़ाइल चुनें।"
    },
    too_large: {
      en: "This file is too large. Choose a smaller file.",
      hi: "यह फ़ाइल बहुत बड़ी है। छोटी फ़ाइल चुनें।"
    },
    network: {
      en: "The upload was interrupted. Check your connection, then retry.",
      hi: "अपलोड रुक गया। अपना इंटरनेट जांचें, फिर दोबारा कोशिश करें।"
    },
    expired: {
      en: "The upload expired. Select the file again, then retry.",
      hi: "अपलोड की समय-सीमा खत्म हो गई। फ़ाइल फिर से चुनें, फिर कोशिश करें।"
    },
    unauthorized: {
      en: "Your session expired. Sign in again, then retry.",
      hi: "आपका सेशन खत्म हो गया है। फिर से साइन इन करें और कोशिश करें।"
    },
    complete_failed: {
      en: "We couldn't complete the upload. The file is still selected, so you can retry.",
      hi: "हम अपलोड पूरा नहीं कर सके। फ़ाइल चुनी हुई है, इसलिए आप दोबारा कोशिश कर सकते हैं।"
    }
  };
  return copy[kind][locale];
}

export async function uploadVerificationArtifact(
  accessToken: string,
  input: {
    listingId: string;
    kind: VerificationArtifactKind;
    file: File;
    onProgress?: (percent: number) => void;
    signal?: AbortSignal;
  }
): Promise<{ blobPath: string }> {
  throwIfVerificationUploadAborted(input.signal);

  const presignRequest: RequestInit = {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      listing_id: input.listingId,
      kind: input.kind,
      content_type: input.file.type || "application/octet-stream",
      size_bytes: input.file.size,
      file_name: input.file.name || "verification-artifact"
    })
  };
  if (input.signal) presignRequest.signal = input.signal;

  const presign = await fetchApi<{
    upload_token: string;
    upload_url: string;
    blob_path: string;
    expires_at: string;
  }>("/owner/verification/artifacts/presign", presignRequest);

  throwIfVerificationUploadAborted(input.signal);

  await multipartVerificationUpload({
    accessToken,
    uploadUrl: presign.upload_url,
    uploadToken: presign.upload_token,
    file: input.file,
    onProgress: input.onProgress,
    signal: input.signal
  });

  throwIfVerificationUploadAborted(input.signal);

  const completeRequest: RequestInit = {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      listing_id: input.listingId,
      upload_token: presign.upload_token,
      blob_path: presign.blob_path
    })
  };
  if (input.signal) completeRequest.signal = input.signal;

  const complete = await fetchApi<{ blob_path: string }>(
    "/owner/verification/artifacts/complete",
    completeRequest
  );

  return { blobPath: complete.blob_path ?? presign.blob_path };
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
  accessState: "free" | "locked" | "unlocked" | "expired";
  callDeadlineAt: string | null;
  calledAt: string | null;
  tenantPhone: string | null;
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
    createdAt: String(row.created_at ?? ""),
    accessState: (row.access_state as "free" | "locked" | "unlocked" | "expired") ?? "locked",
    callDeadlineAt: row.call_deadline_at ? String(row.call_deadline_at) : null,
    calledAt: row.called_at ? String(row.called_at) : null,
    tenantPhone: row.tenant_phone ? String(row.tenant_phone) : null
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

export async function exportOwnerLeadsCsv(accessToken: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/owner/leads/export`, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const errorPayload = payload?.error ?? payload ?? {};
    throw new ApiError(errorPayload?.message ?? `Request failed with status ${response.status}`, {
      status: response.status,
      code: errorPayload?.code,
      details: errorPayload?.details
    });
  }

  return response.blob();
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

export async function unlockLead(
  accessToken: string,
  leadId: string,
  idempotencyKey: string
): Promise<{
  leadId: string;
  accessState: string;
  tenantPhone: string | null;
  tenantName: string;
  creditsRemaining: number;
}> {
  const result = await fetchApi<{
    lead_id: string;
    access_state: string;
    tenant_phone: string | null;
    tenant_name: string;
    credits_remaining: number;
  }>(`/owner/leads/${leadId}/unlock`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Idempotency-Key": idempotencyKey }
  });
  return {
    leadId: result.lead_id,
    accessState: result.access_state,
    tenantPhone: result.tenant_phone,
    tenantName: result.tenant_name,
    creditsRemaining: result.credits_remaining
  };
}

export async function recordLeadCallClick(
  accessToken: string,
  leadId: string
): Promise<{ leadId: string; calledAt: string; tel: string }> {
  const result = await fetchApi<{ lead_id: string; called_at: string; tel: string }>(
    `/owner/leads/${leadId}/call-click`,
    { method: "POST", headers: authHeaders(accessToken) }
  );
  return { leadId: result.lead_id, calledAt: result.called_at, tel: result.tel };
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

export async function setListingAvailability(
  accessToken: string,
  listingId: string,
  available: boolean
): Promise<{ listing_id: string; is_available: boolean }> {
  const result = await fetchApi<{ listing_id: string; is_available: boolean }>(
    `/owner/listings/${listingId}/availability-status`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ available })
    }
  );
  return { listing_id: result.listing_id, is_available: result.is_available };
}

export async function toggleListingAvailability(
  accessToken: string,
  listingId: string,
  available: boolean
): Promise<{ listingId: string; status: "active" | "paused" }> {
  const result = await fetchApi<{ listing_id: string; status: string }>(
    `/owner/listings/${listingId}/visibility`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ available })
    }
  );
  return { listingId: result.listing_id, status: result.status as "active" | "paused" };
}
