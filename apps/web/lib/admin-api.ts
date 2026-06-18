import { fetchApi, buildSearchQuery } from "./api";
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

/* ════════════════════════════════════════════════════════════════════════
 *  v2 Admin Dashboard — new aggregation endpoints
 * ════════════════════════════════════════════════════════════════════════ */

export interface LiveOpsCounters {
  leads_24h: number;
  unlocks_today: number;
  fraud_open: number;
  verifications_pending: number;
  listings_pending_review: number;
  online_voice_sessions: number;
  generated_at: string;
}

export interface OpsSparklines {
  leads: number[];
  unlocks: number[];
  fraud: number[];
}

export interface UnlocksHourlyBucket {
  hour: string;
  count: number;
}

export interface OwnerHealthRow {
  owner_user_id: string;
  phone: string;
  name: string | null;
  listings_active: number;
  listings_paused: number;
  avg_response_minutes: number | null;
  unlocks_60d: number;
  deals_done_60d: number;
  last_login_at: string | null;
  days_since_last_login: number | null;
  report_count: number;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  components: {
    listings: { value: number; weight: number };
    response: { value: number; weight: number };
    deal: { value: number; weight: number };
    freshness: { value: number; weight: number };
    trust: { value: number; weight: number };
  };
}

export type RevenueRange = "7d" | "30d" | "90d";
export type RevenueGroupBy = "day" | "city" | "listing_type";

export interface RevenueAttribution {
  buckets: Array<{ key: string; revenue_paise: number; order_count: number }>;
  total_revenue_paise: number;
  total_orders: number;
  range: RevenueRange;
  group_by: RevenueGroupBy;
}

export interface RevenueCohort {
  cohort_month: string;
  owners_count: number;
  total_revenue_paise: number;
  avg_ltv_paise: number;
  churn_30d_count: number;
}

export type FraudFeedItemKind =
  | "raw_flag"
  | "multi_listing_burst"
  | "multi_report"
  | "inactive_owner";

export interface FraudFeedItem {
  id: string;
  kind: FraudFeedItemKind;
  severity: "low" | "medium" | "high";
  summary: string;
  evidence: Record<string, unknown>;
  related_ids: { listing_ids?: string[]; owner_user_id?: string; phone?: string };
  detected_at: string;
}

export async function fetchAdminLiveOps(accessToken: string) {
  return fetchApi<LiveOpsCounters>("/admin/ops/live", {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminOpsSparklines(accessToken: string) {
  return fetchApi<OpsSparklines>("/admin/ops/sparklines", {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminUnlocksHourly(accessToken: string) {
  return fetchApi<{ buckets: UnlocksHourlyBucket[] }>("/admin/ops/unlocks-hourly", {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminOwnerHealth(
  accessToken: string,
  opts: { limit?: number; offset?: number; sort?: string } = {}
) {
  const params = new URLSearchParams();
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  if (opts.sort) params.set("sort", opts.sort);
  const qs = params.toString();
  return fetchApi<{ items: OwnerHealthRow[]; total: number }>(
    `/admin/owners/health${qs ? `?${qs}` : ""}`,
    { headers: authHeaders(accessToken) }
  );
}

export async function fetchAdminRevenueAttribution(
  accessToken: string,
  opts: { range?: RevenueRange; group_by?: RevenueGroupBy } = {}
) {
  const params = new URLSearchParams();
  if (opts.range) params.set("range", opts.range);
  if (opts.group_by) params.set("group_by", opts.group_by);
  const qs = params.toString();
  return fetchApi<RevenueAttribution>(`/admin/revenue/attribution${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminRevenueCohorts(accessToken: string, months = 6) {
  return fetchApi<{ cohorts: RevenueCohort[] }>(`/admin/revenue/cohorts?months=${months}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminFraudFeed(accessToken: string, limit = 50) {
  return fetchApi<{ items: FraudFeedItem[]; total: number }>(`/admin/fraud/feed?limit=${limit}`, {
    headers: authHeaders(accessToken)
  });
}

/* ── Rent Agreement Analytics ─────────────────────────────────────────────
 * View-models for the admin Rent Agreements tab. The API returns snake_case;
 * these helpers map to camelCase and apply zero/empty defaults so the UI never
 * has to null-check. The summary/detail/download-link endpoints return null when
 * the feature flag is off or a record is missing.
 */

export interface RaSummaryVm {
  totalSessions: number;
  draftsStarted: number;
  draftsCompleted: number;
  draftsAbandoned: number;
  conversionRate: number;
  totalRevenuePaise: number;
  arpuPaise: number;
  avgCompletionMs: number | null;
  byPlan: Array<{ planId: string; count: number; revenuePaise: number }>;
  byState: Array<{ stateCode: string; count: number }>;
  byLocale: Array<{ locale: string; count: number }>;
  byPaymentStatus: Array<{ status: string; count: number }>;
  eSignCompleted: number;
  eStampIssued: number;
}

export interface RaFunnelStepVm {
  step: number;
  label: string;
  agreementsReached: number;
  advanced: number;
  blockedEvents: number;
  revertedEvents: number;
  dropRate: number;
  topErrors: Array<{ code: string; count: number }>;
}

export interface RaTimePointVm {
  date: string;
  draftsStarted: number;
  draftsCompleted: number;
  revenuePaise: number;
}

export interface RaOperationalVm {
  pdfJobs: { pending: number; processing: number; failed: number; done: number };
  expiringSoon: number;
  totalDownloads: number;
  atDownloadLimit: number;
}

export interface RaListItemVm {
  id: string;
  status: string;
  planId: string;
  locale: string;
  currentStep: number;
  ownerFullName: string | null;
  ownerPhone: string | null;
  ownerEmail: string | null;
  tenantFullName: string | null;
  tenantPhone: string | null;
  tenantEmail: string | null;
  propertyFullAddress: string | null;
  stateCode: string | null;
  city: string | null;
  rentAmountPaise: number | null;
  stampDutyPaise: number;
  downloadCount: number;
  pdfReady: boolean;
  createdAt: string;
  updatedAt: string;
  paymentOrderId: string | null;
  paymentAmountPaise: number | null;
  paymentStatus: string | null;
  paymentProvider: string | null;
  creatorPhone: string | null;
  creatorName: string | null;
}

export interface RaStepAuditVm {
  step: number;
  outcome: string;
  errorCodes: string[];
  createdAt: string;
}

export interface RaDetailVm extends RaListItemVm {
  stepValidatedAt: Record<string, string>;
  eStampReference: string | null;
  eSignSessionId: string | null;
  eSignCompletedAt: string | null;
  expiresAt: string | null;
  pdfGeneratedAt: string | null;
  stepAudit: RaStepAuditVm[];
}

export interface RaDownloadLinkVm {
  sasUrl: string;
  expiresAt: string;
}

export interface RaListParams {
  status?: string;
  planId?: string;
  stateCode?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

type RaListItemRaw = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function mapRaRow(r: RaListItemRaw): RaListItemVm {
  return {
    id: String(r.id),
    status: String(r.status ?? ""),
    planId: String(r.plan_id ?? ""),
    locale: String(r.locale ?? ""),
    currentStep: num(r.current_step),
    ownerFullName: (r.owner_full_name as string | null) ?? null,
    ownerPhone: (r.owner_phone as string | null) ?? null,
    ownerEmail: (r.owner_email as string | null) ?? null,
    tenantFullName: (r.tenant_full_name as string | null) ?? null,
    tenantPhone: (r.tenant_phone as string | null) ?? null,
    tenantEmail: (r.tenant_email as string | null) ?? null,
    propertyFullAddress: (r.property_full_address as string | null) ?? null,
    stateCode: (r.state_code as string | null) ?? null,
    city: (r.city as string | null) ?? null,
    rentAmountPaise: r.rent_amount_paise == null ? null : num(r.rent_amount_paise),
    stampDutyPaise: num(r.stamp_duty_paise),
    downloadCount: num(r.download_count),
    pdfReady: Boolean(r.pdf_ready),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
    paymentOrderId: (r.payment_order_id as string | null) ?? null,
    paymentAmountPaise: r.payment_amount_paise == null ? null : num(r.payment_amount_paise),
    paymentStatus: (r.payment_status as string | null) ?? null,
    paymentProvider: (r.payment_provider as string | null) ?? null,
    creatorPhone: (r.creator_phone as string | null) ?? null,
    creatorName: (r.creator_name as string | null) ?? null
  };
}

export async function fetchRentAgreementSummary(
  accessToken: string,
  days = 30
): Promise<RaSummaryVm | null> {
  const raw = await fetchApi<Record<string, unknown> | null>(
    `/admin/rent-agreements/summary?days=${days}`,
    { headers: authHeaders(accessToken) }
  );
  if (!raw) return null;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    totalSessions: num(raw.total_sessions),
    draftsStarted: num(raw.drafts_started),
    draftsCompleted: num(raw.drafts_completed),
    draftsAbandoned: num(raw.drafts_abandoned),
    conversionRate: num(raw.conversion_rate),
    totalRevenuePaise: num(raw.total_revenue_paise),
    arpuPaise: num(raw.arpu_paise),
    avgCompletionMs: typeof raw.avg_completion_ms === "number" ? raw.avg_completion_ms : null,
    byPlan: arr<{ plan_id: string; count: number; revenue_paise: number }>(raw.by_plan).map(
      (p) => ({ planId: p.plan_id, count: num(p.count), revenuePaise: num(p.revenue_paise) })
    ),
    byState: arr<{ state_code: string; count: number }>(raw.by_state).map((s) => ({
      stateCode: s.state_code,
      count: num(s.count)
    })),
    byLocale: arr<{ locale: string; count: number }>(raw.by_locale).map((l) => ({
      locale: l.locale,
      count: num(l.count)
    })),
    byPaymentStatus: arr<{ status: string; count: number }>(raw.by_payment_status).map((s) => ({
      status: s.status,
      count: num(s.count)
    })),
    eSignCompleted: num(raw.e_sign_completed),
    eStampIssued: num(raw.e_stamp_issued)
  };
}

export async function fetchRentAgreementFunnel(
  accessToken: string,
  days = 30
): Promise<RaFunnelStepVm[]> {
  const raw = await fetchApi<Array<Record<string, unknown>> | null>(
    `/admin/rent-agreements/funnel?days=${days}`,
    { headers: authHeaders(accessToken) }
  );
  if (!Array.isArray(raw)) return [];
  return raw.map((s) => ({
    step: num(s.step),
    label: String(s.label ?? ""),
    agreementsReached: num(s.agreements_reached),
    advanced: num(s.advanced),
    blockedEvents: num(s.blocked_events),
    revertedEvents: num(s.reverted_events),
    dropRate: num(s.drop_rate),
    topErrors: Array.isArray(s.top_errors)
      ? (s.top_errors as Array<{ code: string; count: number }>).map((e) => ({
          code: e.code,
          count: num(e.count)
        }))
      : []
  }));
}

export async function fetchRentAgreementTimeSeries(
  accessToken: string,
  days = 30
): Promise<RaTimePointVm[]> {
  const raw = await fetchApi<Array<Record<string, unknown>> | null>(
    `/admin/rent-agreements/timeseries?days=${days}`,
    { headers: authHeaders(accessToken) }
  );
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => ({
    date: String(p.date ?? ""),
    draftsStarted: num(p.drafts_started),
    draftsCompleted: num(p.drafts_completed),
    revenuePaise: num(p.revenue_paise)
  }));
}

export async function fetchRentAgreementOperational(accessToken: string): Promise<RaOperationalVm> {
  const raw = await fetchApi<Record<string, unknown> | null>(`/admin/rent-agreements/operational`, {
    headers: authHeaders(accessToken)
  });
  const jobs = (raw?.pdf_jobs as Record<string, unknown> | undefined) ?? {};
  return {
    pdfJobs: {
      pending: num(jobs.pending),
      processing: num(jobs.processing),
      failed: num(jobs.failed),
      done: num(jobs.done)
    },
    expiringSoon: num(raw?.expiring_soon),
    totalDownloads: num(raw?.total_downloads),
    atDownloadLimit: num(raw?.at_download_limit)
  };
}

export async function fetchRentAgreements(
  accessToken: string,
  params: RaListParams
): Promise<{ items: RaListItemVm[]; total: number }> {
  const query = buildSearchQuery({
    status: params.status,
    plan_id: params.planId,
    state_code: params.stateCode,
    search: params.search,
    date_from: params.dateFrom,
    date_to: params.dateTo,
    page: params.page,
    limit: params.limit
  });
  const raw = await fetchApi<{ items: RaListItemRaw[]; total: number } | null>(
    `/admin/rent-agreements/list${query ? `?${query}` : ""}`,
    { headers: authHeaders(accessToken) }
  );
  if (!raw) return { items: [], total: 0 };
  return { items: (raw.items ?? []).map(mapRaRow), total: num(raw.total) };
}

export async function fetchRentAgreementDetail(
  accessToken: string,
  id: string
): Promise<RaDetailVm | null> {
  const raw = await fetchApi<Record<string, unknown> | null>(`/admin/rent-agreements/${id}`, {
    headers: authHeaders(accessToken)
  });
  if (!raw) return null;
  return {
    ...mapRaRow(raw),
    stepValidatedAt: (raw.step_validated_at as Record<string, string>) ?? {},
    eStampReference: (raw.e_stamp_reference as string | null) ?? null,
    eSignSessionId: (raw.e_sign_session_id as string | null) ?? null,
    eSignCompletedAt: (raw.e_sign_completed_at as string | null) ?? null,
    expiresAt: (raw.expires_at as string | null) ?? null,
    pdfGeneratedAt: (raw.pdf_generated_at as string | null) ?? null,
    stepAudit: Array.isArray(raw.step_audit)
      ? (raw.step_audit as Array<Record<string, unknown>>).map((a) => ({
          step: num(a.step),
          outcome: String(a.outcome ?? ""),
          errorCodes: Array.isArray(a.error_codes) ? (a.error_codes as string[]) : [],
          createdAt: String(a.created_at ?? "")
        }))
      : []
  };
}

export async function fetchRentAgreementDownloadLink(
  accessToken: string,
  id: string
): Promise<RaDownloadLinkVm | null> {
  const raw = await fetchApi<{ sas_url: string; expires_at: string } | null>(
    `/admin/rent-agreements/${id}/download-link`,
    { headers: authHeaders(accessToken) }
  );
  if (!raw) return null;
  return { sasUrl: raw.sas_url, expiresAt: raw.expires_at };
}

// ── PG listing-process analytics (admin) ─────────────────────────────────────
// Mirrors the backend PgFunnelAnalytics shape (apps/api .../pg-funnel.service.ts).
export interface PgListingAnalytics {
  range_days: number;
  funnel: {
    wizard_started: number;
    step_completed_by_step: Record<string, number>;
    submitted: number;
    published: number;
    abandoned: number;
  };
  conversion: number;
  publish_conversion: number;
  median_time_to_publish_sec: number | null;
  by_source: { manual: number; voice: number };
  quality: {
    geocode_rate: number;
    avg_photos: number;
    missing_field_heatmap: Array<{ field: string; count: number }>;
  };
  voice: { sessions: number; completion_rate: number; fallback_rate: number };
  score_health: {
    active_pg: number;
    with_score: number;
    without_score: number;
    avg_composite: number | null;
    distribution: Array<{ bucket: string; count: number }>;
  };
}

export async function getAdminPgAnalytics(
  accessToken: string,
  days = 30
): Promise<PgListingAnalytics> {
  return fetchApi<PgListingAnalytics>(`/admin/pg/listing-analytics?days=${days}`, {
    headers: authHeaders(accessToken)
  });
}

// ── PG property admin (Tasks 9–13) ────────────────────────────────────────────

import type {
  PgAdminOverview,
  PgAdminListingListItem,
  PgAdminListingDetail,
  PgAdminListingAnalytics,
  PgAdminPropertyPatch,
  PgAdminListingFull,
  PgAdminDetailsPatch,
  PgAdminRoomInput
} from "@cribliv/shared-types";

export async function fetchAdminPgOverview(
  accessToken: string,
  days = 30
): Promise<PgAdminOverview> {
  return fetchApi<PgAdminOverview>(`/admin/pg/overview?days=${days}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminPgListings(
  accessToken: string,
  params: { q?: string; status?: string; city?: string; page?: number; pageSize?: number } = {}
): Promise<PgAdminListingListItem[]> {
  const qs = buildSearchQuery(params);
  return fetchApi<PgAdminListingListItem[]>(`/admin/pg/listings${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminPgListing(
  accessToken: string,
  listingId: string
): Promise<PgAdminListingDetail> {
  return fetchApi<PgAdminListingDetail>(`/admin/pg/listings/${listingId}`, {
    headers: authHeaders(accessToken)
  });
}

// Full content read model (pg_details + room_types + photos + property) backing
// the Details/Rooms/Photos/Location tabs. One fetch, shared across tabs.
export async function fetchAdminPgListingFull(
  accessToken: string,
  listingId: string
): Promise<PgAdminListingFull> {
  return fetchApi<PgAdminListingFull>(`/admin/pg/listings/${listingId}/full`, {
    headers: authHeaders(accessToken)
  });
}

// Edit the listing's pg_details (Details tab). Partial — only provided keys change.
export async function updateAdminPgDetails(
  accessToken: string,
  listingId: string,
  patch: PgAdminDetailsPatch
): Promise<{ id: string }> {
  return fetchApi<{ id: string }>(`/admin/pg/listings/${listingId}/details`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(patch)
  });
}

// ── Admin photo management (Photos tab) ───────────────────────────────────────
function adminIdemKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
      return crypto.randomUUID();
  } catch {}
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export async function presignAdminPgPhotos(
  accessToken: string,
  listingId: string,
  files: Array<{ clientUploadId: string; contentType: string; sizeBytes: number }>
): Promise<{ uploads: Array<{ clientUploadId: string; uploadUrl: string; blobPath: string }> }> {
  return fetchApi(`/admin/pg/listings/${listingId}/photos/presign`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Idempotency-Key": adminIdemKey() },
    body: JSON.stringify({ files })
  });
}

export async function commitAdminPgPhotos(
  accessToken: string,
  listingId: string,
  photos: Array<{ clientUploadId: string; blobPath: string; isCover: boolean; sortOrder: number }>
): Promise<{ committed: number }> {
  return fetchApi(`/admin/pg/listings/${listingId}/photos/commit`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Idempotency-Key": adminIdemKey() },
    body: JSON.stringify({ photos })
  });
}

export async function reorderAdminPgPhotos(
  accessToken: string,
  listingId: string,
  items: Array<{ id: string; sort_order: number; is_cover: boolean }>
): Promise<{ items: Array<{ id: string; sort_order: number; is_cover: boolean }> }> {
  return fetchApi(`/admin/pg/listings/${listingId}/photos`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ items })
  });
}

export async function deleteAdminPgPhoto(
  accessToken: string,
  listingId: string,
  photoId: string
): Promise<{ deleted: boolean }> {
  return fetchApi(`/admin/pg/listings/${listingId}/photos/${photoId}`, {
    method: "DELETE",
    headers: authHeaders(accessToken)
  });
}

// Direct-to-Azure upload (PUT to the SAS URL) with small retry, mirroring the
// operator wizard's putToAzure.
export async function putToAzureBlob(uploadUrl: string, file: File): Promise<void> {
  const contentType = file.type || "image/jpeg";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": contentType },
        body: file
      });
      if (res.ok) return;
      const retriable = [408, 429, 500, 502, 503, 504].includes(res.status);
      if (!retriable || attempt === 3) throw new Error(`Photo upload failed (HTTP ${res.status})`);
    } catch (e) {
      if (attempt === 3) throw e instanceof Error ? e : new Error("Photo upload failed");
    }
  }
}

// Replace the listing's room-type set (Rooms tab). Reprojects starting rent.
export async function replaceAdminPgRooms(
  accessToken: string,
  listingId: string,
  rooms: PgAdminRoomInput[]
): Promise<{ id: string; starting_rent_paise: number }> {
  return fetchApi<{ id: string; starting_rent_paise: number }>(
    `/admin/pg/listings/${listingId}/rooms`,
    {
      method: "PUT",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ rooms })
    }
  );
}

export async function fetchAdminPgListingAnalytics(
  accessToken: string,
  listingId: string,
  days = 30
): Promise<PgAdminListingAnalytics> {
  return fetchApi<PgAdminListingAnalytics>(
    `/admin/pg/listings/${listingId}/analytics?days=${days}`,
    { headers: authHeaders(accessToken) }
  );
}

// Locality/geocoding/name/status edits target the shared pg_property.
export async function updateAdminPgProperty(
  accessToken: string,
  propertyId: string,
  patch: PgAdminPropertyPatch
): Promise<{ id: string }> {
  return fetchApi<{ id: string }>(`/admin/pg/properties/${propertyId}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(patch)
  });
}

export async function setAdminPgOverride(
  accessToken: string,
  listingId: string,
  body: { scope: "global" | "listing"; operator_id: string; reason?: string }
): Promise<PgAdminListingDetail> {
  return fetchApi<PgAdminListingDetail>(`/admin/pg/listings/${listingId}/override`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body)
  });
}

export async function clearAdminPgOverride(
  accessToken: string,
  listingId: string,
  body: { scope: "global" | "listing"; operator_id: string; reason?: string }
): Promise<PgAdminListingDetail> {
  return fetchApi<PgAdminListingDetail>(`/admin/pg/listings/${listingId}/override`, {
    method: "DELETE",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body)
  });
}
