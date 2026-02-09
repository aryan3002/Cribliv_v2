import { fetchApi } from "./api";

export type ListingStatus =
  | "draft"
  | "pending_review"
  | "active"
  | "rejected"
  | "paused"
  | "archived";

export type VerificationStatus = "unverified" | "pending" | "verified" | "failed";
export type ListingType = "flat_house" | "pg";

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
  livenessScore: number | null;
  addressMatchScore: number | null;
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
}

function mapOwnerListingRow(row: OwnerListingApiRow): OwnerListingVm {
  const createdAtValue = row.created_at ?? row.createdAt;
  const createdAtIso =
    typeof createdAtValue === "number"
      ? new Date(createdAtValue).toISOString()
      : typeof createdAtValue === "string"
        ? new Date(createdAtValue).toISOString()
        : undefined;

  return {
    id: row.id ?? "",
    title: row.title ?? "Listing",
    city: row.city,
    locality: row.locality ?? undefined,
    listingType: row.listingType ?? row.listing_type ?? "flat_house",
    monthlyRent: row.monthlyRent ?? row.monthly_rent,
    status: row.status ?? "draft",
    verificationStatus: row.verificationStatus ?? row.verification_status ?? "unverified",
    createdAt: createdAtIso
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
    result: response.result
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
    result: response.result
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
      threshold: Number(attempt.threshold ?? 85),
      createdAt: attempt.created_at
    }))
  };
}
