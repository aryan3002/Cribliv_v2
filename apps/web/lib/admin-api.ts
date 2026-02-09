import { fetchApi } from "./api";

export interface AdminListingVm {
  id: string;
  title: string;
  listingType: "flat_house" | "pg";
  status: string;
  ownerUserId: string;
  verificationStatus: string;
  createdAt: string;
  city?: string;
  monthlyRent?: number;
}

export interface AdminVerificationVm {
  id: string;
  listingId?: string;
  userId: string;
  verificationType: "video_liveness" | "electricity_bill_match";
  result: "pending" | "pass" | "fail" | "manual_review";
  addressMatchScore?: number;
  livenessScore?: number;
  threshold: number;
  createdAt: string;
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`
  };
}

export async function fetchAdminListings(accessToken: string) {
  const response = await fetchApi<{
    items: Array<{
      id: string;
      status: string;
      listing_type: "flat_house" | "pg";
      title: string;
      owner_user_id: string;
      verification_status: string;
      created_at: string;
      city?: string;
      monthly_rent?: number;
    }>;
    total: number;
  }>("/admin/review/listings", {
    headers: authHeaders(accessToken)
  });

  return {
    items: (response.items ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      listingType: row.listing_type,
      status: row.status,
      ownerUserId: row.owner_user_id,
      verificationStatus: row.verification_status,
      createdAt: row.created_at,
      city: row.city,
      monthlyRent: row.monthly_rent
    })),
    total: response.total ?? 0
  };
}

export async function decideAdminListing(
  accessToken: string,
  listingId: string,
  decision: "approve" | "reject" | "pause",
  reason?: string
) {
  const response = await fetchApi<{ listing_id: string; new_status: string }>(
    `/admin/review/listings/${listingId}/decision`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        decision,
        reason
      })
    }
  );

  return {
    listingId: response.listing_id,
    newStatus: response.new_status
  };
}

export async function fetchAdminVerifications(accessToken: string) {
  const response = await fetchApi<{
    items: Array<{
      id: string;
      listing_id: string | null;
      user_id: string;
      verification_type: "video_liveness" | "electricity_bill_match";
      result: "pending" | "pass" | "fail" | "manual_review";
      address_match_score: number | null;
      liveness_score: number | null;
      threshold: number;
      created_at: string;
    }>;
    total: number;
  }>("/admin/review/verifications", {
    headers: authHeaders(accessToken)
  });

  return {
    items: (response.items ?? []).map((row) => ({
      id: row.id,
      listingId: row.listing_id ?? undefined,
      userId: row.user_id,
      verificationType: row.verification_type,
      result: row.result,
      addressMatchScore: row.address_match_score ?? undefined,
      livenessScore: row.liveness_score ?? undefined,
      threshold: row.threshold,
      createdAt: row.created_at
    })),
    total: response.total ?? 0
  };
}

export async function decideAdminVerification(
  accessToken: string,
  attemptId: string,
  decision: "pass" | "fail" | "manual_review",
  reason?: string
) {
  const response = await fetchApi<{ attempt_id: string; new_result: string }>(
    `/admin/review/verifications/${attemptId}/decision`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        decision,
        reason
      })
    }
  );

  return {
    attemptId: response.attempt_id,
    newResult: response.new_result
  };
}
