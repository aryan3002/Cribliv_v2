import { fetchApi } from "./api";
import type { ListingType, VerificationType, VerificationResult } from "@cribliv/shared-types";

export interface AdminListingVm {
  id: string;
  title: string;
  listingType: ListingType;
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
  verificationType: VerificationType;
  result: VerificationResult;
  machineResult?: VerificationResult;
  addressMatchScore?: number;
  livenessScore?: number;
  provider?: string;
  providerReference?: string;
  providerResultCode?: string;
  reviewReason?: string;
  retryable?: boolean;
  threshold: number;
  createdAt: string;
}

export interface AdminLeadVm {
  id: string;
  createdByUserId: string;
  listingId?: string;
  source: "pg_sales_assist" | "property_management";
  status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
  notes?: string;
  metadata: Record<string, unknown>;
  crmSyncStatus: string;
  lastCrmPushAt?: string;
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
  }>("/admin/review/listings?status=pending_review", {
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
      provider: string | null;
      provider_reference: string | null;
      provider_result_code: string | null;
      review_reason: string | null;
      retryable: boolean | null;
      machine_result: "pending" | "pass" | "fail" | "manual_review" | null;
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
      machineResult: row.machine_result ?? undefined,
      addressMatchScore: row.address_match_score ?? undefined,
      livenessScore: row.liveness_score ?? undefined,
      provider: row.provider ?? undefined,
      providerReference: row.provider_reference ?? undefined,
      providerResultCode: row.provider_result_code ?? undefined,
      reviewReason: row.review_reason ?? undefined,
      retryable: row.retryable ?? undefined,
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

export async function fetchAdminLeads(accessToken: string) {
  const response = await fetchApi<{
    items: Array<{
      id: string;
      created_by_user_id: string;
      listing_id: string | null;
      source: "pg_sales_assist" | "property_management";
      status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
      notes: string | null;
      metadata: Record<string, unknown>;
      crm_sync_status: string;
      last_crm_push_at: string | null;
      created_at: string;
    }>;
    total: number;
  }>("/admin/leads", {
    headers: authHeaders(accessToken)
  });

  return {
    items: (response.items ?? []).map((row) => ({
      id: row.id,
      createdByUserId: row.created_by_user_id,
      listingId: row.listing_id ?? undefined,
      source: row.source,
      status: row.status,
      notes: row.notes ?? undefined,
      metadata: row.metadata ?? {},
      crmSyncStatus: row.crm_sync_status,
      lastCrmPushAt: row.last_crm_push_at ?? undefined,
      createdAt: row.created_at
    })),
    total: response.total ?? 0
  };
}

export async function updateAdminLeadStatus(
  accessToken: string,
  leadId: string,
  status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost",
  reason?: string
) {
  const response = await fetchApi<{ lead_id: string; status: string }>(
    `/admin/leads/${leadId}/status`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        status,
        reason
      })
    }
  );

  return {
    leadId: response.lead_id,
    status: response.status
  };
}

/* ── Analytics Types ──────────────────────────────────────────────────── */

export interface AdminAnalyticsOverview {
  totalListings: number;
  activeListings: number;
  totalUsers: number;
  totalLeads: number;
  totalUnlocks: number;
  totalRevenuePaise: number;
}

export interface AdminFunnelMetrics {
  views: number;
  enquiries: number;
  unlocks: number;
  leadsCreated: number;
}

export interface AdminResponseRate {
  avgResponseRate: number;
  totalUnlocks: number;
  responded: number;
}

export interface AdminRevenue {
  totalPaise: number;
  orderCount: number;
}

export interface AdminCityCount {
  city: string;
  locality: string;
  count: number;
}

/* ── User & Role Types ────────────────────────────────────────────────── */

export interface AdminUserVm {
  id: string;
  phone: string;
  role: string;
  fullName?: string;
  createdAt: string;
}

export interface AdminRoleRequestVm {
  id: string;
  userId: string;
  phone: string;
  requestedRole: string;
  status: string;
  createdAt: string;
  decidedAt?: string;
}

/* ── Fraud Types ──────────────────────────────────────────────────────── */

export interface AdminFraudFlagVm {
  id: string;
  flagType: string;
  reportedByUserId: string;
  targetUserId?: string;
  targetListingId?: string;
  resolved: boolean;
  createdAt: string;
}

/* ── Analytics Functions ──────────────────────────────────────────────── */

export async function fetchAdminAnalyticsOverview(
  accessToken: string
): Promise<AdminAnalyticsOverview> {
  const raw = await fetchApi<{
    total_listings: number;
    active_listings: number;
    total_users: number;
    total_leads: number;
    total_unlocks: number;
    total_revenue_paise: number;
  } | null>("/admin/analytics/overview", {
    headers: authHeaders(accessToken)
  });

  if (!raw)
    throw new Error("Analytics endpoint returned no data — check API server or feature flags");

  return {
    totalListings: raw.total_listings ?? 0,
    activeListings: raw.active_listings ?? 0,
    totalUsers: raw.total_users ?? 0,
    totalLeads: raw.total_leads ?? 0,
    totalUnlocks: raw.total_unlocks ?? 0,
    totalRevenuePaise: raw.total_revenue_paise ?? 0
  };
}

export async function fetchAdminAnalyticsFunnel(
  accessToken: string,
  days = 30
): Promise<AdminFunnelMetrics> {
  const raw = await fetchApi<{
    views: number;
    enquiries: number;
    unlocks: number;
    leads_created: number;
  }>(`/admin/analytics/funnel?days=${days}`, {
    headers: authHeaders(accessToken)
  });

  return {
    views: raw.views ?? 0,
    enquiries: raw.enquiries ?? 0,
    unlocks: raw.unlocks ?? 0,
    leadsCreated: raw.leads_created ?? 0
  };
}

export async function fetchAdminAnalyticsResponseRates(
  accessToken: string
): Promise<AdminResponseRate> {
  const raw = await fetchApi<{
    avg_response_rate: number;
    total_unlocks: number;
    responded: number;
  } | null>("/admin/analytics/response-rates", {
    headers: authHeaders(accessToken)
  });

  if (!raw) return { avgResponseRate: 0, totalUnlocks: 0, responded: 0 };

  return {
    avgResponseRate: raw.avg_response_rate ?? 0,
    totalUnlocks: raw.total_unlocks ?? 0,
    responded: raw.responded ?? 0
  };
}

export async function fetchAdminAnalyticsRevenue(
  accessToken: string,
  days = 30
): Promise<AdminRevenue> {
  const raw = await fetchApi<{
    total_paise: number;
    order_count: number;
  }>(`/admin/analytics/revenue?days=${days}`, {
    headers: authHeaders(accessToken)
  });

  return {
    totalPaise: raw.total_paise ?? 0,
    orderCount: raw.order_count ?? 0
  };
}

export async function fetchAdminAnalyticsByCity(accessToken: string): Promise<AdminCityCount[]> {
  const raw = await fetchApi<{
    items: Array<{ city: string; locality: string; count: number }>;
  }>("/admin/analytics/listings", {
    headers: authHeaders(accessToken)
  });

  return (raw.items ?? []).map((r) => ({
    city: r.city,
    locality: r.locality,
    count: r.count
  }));
}

/* ── User & Role Functions ────────────────────────────────────────────── */

export async function fetchAdminUsers(accessToken: string) {
  const raw = await fetchApi<{
    items: Array<{
      id: string;
      phone: string;
      role: string;
      full_name?: string;
      created_at: string;
    }>;
  }>("/admin/users", {
    headers: authHeaders(accessToken)
  });

  return (raw.items ?? []).map((u) => ({
    id: u.id,
    phone: u.phone,
    role: u.role,
    fullName: u.full_name ?? undefined,
    createdAt: u.created_at
  })) as AdminUserVm[];
}

export async function changeAdminUserRole(accessToken: string, userId: string, role: string) {
  return fetchApi<{ user_id: string; new_role: string }>(`/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ role })
  });
}

export async function createAdminUser(
  accessToken: string,
  phone_e164: string,
  role: string,
  full_name?: string
) {
  return fetchApi<{
    id: string;
    phone: string;
    role: string;
    full_name?: string;
    created_at: string;
    is_new: boolean;
  }>("/admin/users", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ phone_e164, role, full_name: full_name || undefined })
  });
}

export async function fetchAdminRoleRequests(accessToken: string) {
  const raw = await fetchApi<{
    items: Array<{
      id: string;
      user_id: string;
      phone: string;
      requested_role: string;
      status: string;
      created_at: string;
      decided_at?: string;
    }>;
  }>("/admin/role-requests", {
    headers: authHeaders(accessToken)
  });

  return (raw.items ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    phone: r.phone,
    requestedRole: r.requested_role,
    status: r.status,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? undefined
  })) as AdminRoleRequestVm[];
}

export async function decideAdminRoleRequest(
  accessToken: string,
  requestId: string,
  decision: "approve" | "reject"
) {
  return fetchApi<{ request_id: string; status: string }>(
    `/admin/role-requests/${requestId}/decision`,
    {
      method: "PATCH",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ decision })
    }
  );
}

/* ── Fraud Functions ──────────────────────────────────────────────────── */

export async function fetchAdminFraudFlags(accessToken: string) {
  const raw = await fetchApi<{
    items: Array<{
      id: string;
      flag_type: string;
      reported_by_user_id: string;
      target_user_id?: string;
      target_listing_id?: string;
      resolved: boolean;
      created_at: string;
    }>;
  }>("/admin/fraud/flags", {
    headers: authHeaders(accessToken)
  });

  return (raw.items ?? []).map((f) => ({
    id: f.id,
    flagType: f.flag_type,
    reportedByUserId: f.reported_by_user_id,
    targetUserId: f.target_user_id ?? undefined,
    targetListingId: f.target_listing_id ?? undefined,
    resolved: f.resolved,
    createdAt: f.created_at
  })) as AdminFraudFlagVm[];
}

export async function resolveAdminFraudFlag(accessToken: string, flagId: string) {
  return fetchApi<{ flag_id: string; resolved: boolean }>(`/admin/fraud/flags/${flagId}/resolve`, {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}

/* ── System / AI / Wallet Functions ───────────────────────────────────── */

export async function triggerAiBackfill(accessToken: string) {
  return fetchApi<{ message: string }>("/admin/ai/backfill-embeddings", {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}

export async function triggerAiRecomputeScores(accessToken: string) {
  return fetchApi<{ message: string }>("/admin/ai/recompute-scores", {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}

export async function adjustAdminWallet(
  accessToken: string,
  userId: string,
  creditsDelta: number,
  reason: string
) {
  return fetchApi<{ user_id: string; new_balance: number }>("/admin/wallet/adjust", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({
      user_id: userId,
      credits_delta: creditsDelta,
      reason
    })
  });
}
