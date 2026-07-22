import { ApiError, fetchApi, buildSearchQuery, getApiBaseUrl } from "./api";
import type {
  AdminHomeDetail,
  AdminHomesListParams,
  AdminHomesListResponse,
  ListingType,
  VerificationType,
  VerificationResult
} from "@cribliv/shared-types";

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

export async function fetchAdminHomes(
  accessToken: string,
  params: Partial<AdminHomesListParams> = {}
): Promise<AdminHomesListResponse> {
  const qs = buildSearchQuery(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<AdminHomesListResponse>(`/admin/homes${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminHomeDetail(
  accessToken: string,
  listingId: string
): Promise<AdminHomeDetail> {
  return fetchApi<AdminHomeDetail>(`/admin/homes/${listingId}`, {
    headers: authHeaders(accessToken)
  });
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
  // Null when the listing has a city but no resolved locality (e.g. Varanasi).
  locality: string | null;
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
    throw new Error("Analytics endpoint returned no data. Check API server or feature flags");

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
  // GET /admin/analytics/listings returns a BARE array (getListingsByArea →
  // ok(array) → fetchApi unwraps `.data`), NOT a `{ items }` envelope like the
  // paginated list endpoints. Reading `.items` here always yielded [] — the
  // "No city data yet" bug.
  const raw = await fetchApi<Array<{ city: string; locality: string | null; count: number }>>(
    "/admin/analytics/listings",
    { headers: authHeaders(accessToken) }
  );

  return (raw ?? []).map((r) => ({
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
  return fetchApi<{ backfilled: number }>("/admin/ai/backfill-embeddings", {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}

export async function triggerAiRecomputeScores(accessToken: string) {
  return fetchApi<{ recomputed: number }>("/admin/ai/recompute-scores", {
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
  PgAdminListingsResponse,
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
  params: {
    q?: string;
    status?: string;
    city?: string;
    verification?: string;
    sort?: string;
    page?: number;
    page_size?: number;
  } = {}
): Promise<PgAdminListingsResponse> {
  const qs = buildSearchQuery(params);
  return fetchApi<PgAdminListingsResponse>(`/admin/pg/listings${qs ? `?${qs}` : ""}`, {
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

// ── Admin Programmatic SEO city enablement ───────────────────────────────────

export interface SeoCityConfigVm {
  citySlug: string;
  nameEn: string;
  programmaticEnabled: boolean;
  localityCount: number;
  landmarkCount: number;
  metroCount: number;
  indexableCount: number;
  enabledAt: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface SeoCityConfigRaw {
  city_slug: string;
  name_en?: string | null;
  programmatic_enabled: boolean;
  locality_count: number;
  landmark_count: number;
  metro_count: number;
  indexable_count: number;
  enabled_at: string | null;
  notes: string | null;
  updated_at: string | null;
}

function mapSeoCityRow(row: SeoCityConfigRaw): SeoCityConfigVm {
  return {
    citySlug: row.city_slug,
    nameEn: row.name_en ?? titleFromSlug(row.city_slug),
    programmaticEnabled: row.programmatic_enabled,
    localityCount: row.locality_count,
    landmarkCount: row.landmark_count,
    metroCount: row.metro_count,
    indexableCount: row.indexable_count,
    enabledAt: row.enabled_at,
    notes: row.notes,
    updatedAt: row.updated_at
  };
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function listSeoCities(accessToken: string): Promise<SeoCityConfigVm[]> {
  const raw = await fetchApi<{ items?: SeoCityConfigRaw[] }>("/admin/seo/cities", {
    headers: authHeaders(accessToken)
  });
  return (raw.items ?? []).map(mapSeoCityRow);
}

export async function setSeoCityEnabled(
  accessToken: string,
  slug: string,
  enabled: boolean,
  notes?: string
): Promise<SeoCityConfigVm> {
  const body: { programmatic_enabled: boolean; notes?: string } = {
    programmatic_enabled: enabled
  };
  if (notes !== undefined) body.notes = notes;

  const raw = await fetchApi<SeoCityConfigRaw>(`/admin/seo/cities/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body)
  });
  return mapSeoCityRow(raw);
}

// ── City review drill-in data (public SEO endpoints, no auth) ──────────────

export interface SeoLocalityRow {
  slug: string;
  name_en: string;
  name_hi: string;
  lat: number | null;
  lng: number | null;
  listing_count: number;
}

export interface SeoLandmarkRow {
  slug: string;
  name_en: string;
  name_hi: string;
  type: string;
  lat: number | null;
  lng: number | null;
}

export interface SeoMetroRow {
  station_name: string;
  line_name: string;
  lat: number | null;
  lng: number | null;
}

export async function listCityLocalities(citySlug: string): Promise<SeoLocalityRow[]> {
  const raw = await fetchApi<{ items?: SeoLocalityRow[] }>(
    `/seo/localities/${encodeURIComponent(citySlug)}`
  );
  return raw.items ?? [];
}

export async function listCityLandmarks(citySlug: string): Promise<SeoLandmarkRow[]> {
  const raw = await fetchApi<{ items?: SeoLandmarkRow[] }>(
    `/landmarks/${encodeURIComponent(citySlug)}`
  );
  return raw.items ?? [];
}

interface MetroLineRaw {
  line_name: string;
  stations?: Array<{ name: string; lat: number | null; lng: number | null }>;
}

// /map/metro returns { lines: [{ line_name, stations: [{ name, lat, lng }] }] }
// — flatten to one row per station for the review table.
export async function listCityMetro(citySlug: string): Promise<SeoMetroRow[]> {
  const raw = await fetchApi<{ lines?: MetroLineRaw[] }>(
    `/map/metro?city=${encodeURIComponent(citySlug)}`
  );
  return (raw.lines ?? []).flatMap((line) =>
    (line.stations ?? []).map((s) => ({
      station_name: s.name,
      line_name: line.line_name,
      lat: s.lat,
      lng: s.lng
    }))
  );
}

// ── Admin SEO copy control (Feature 1) ─────────────────────────────────────

/** Which source drives a page's copy right now (for the status chips). */
export type SeoCopyProvenance = "override" | "ai" | "template";

export interface SeoCopyStatusRow {
  slug: string;
  en: SeoCopyProvenance;
  hi: SeoCopyProvenance;
}

/** The editable copy fields — mirrors the API GeneratedCopy shape. */
export interface SeoCopyFields {
  h1: string;
  meta_title: string;
  meta_description: string;
  intro_paragraph: string;
  nearby_blurb: string | null;
  faq_items: Array<{ q: string; a: string }>;
}

/** Per-locality copy provenance for every locality in a city. */
export async function fetchSeoCopyStatus(
  accessToken: string,
  citySlug: string
): Promise<SeoCopyStatusRow[]> {
  const raw = await fetchApi<{ items?: SeoCopyStatusRow[] }>(
    `/admin/seo/copy-status?citySlug=${encodeURIComponent(citySlug)}`,
    { headers: authHeaders(accessToken) }
  );
  return raw.items ?? [];
}

/** Force-(re)generate AI copy for one locality, both locales. */
export async function generateSeoCopyOne(
  accessToken: string,
  citySlug: string,
  localitySlug: string
): Promise<{ en: SeoCopyFields | null; hi: SeoCopyFields | null }> {
  return fetchApi("/admin/seo/copy/generate-one", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ citySlug, localitySlug })
  });
}

/** Save a hand-written override for a locality page + locale. */
export async function upsertSeoCopyOverride(
  accessToken: string,
  params: {
    citySlug: string;
    localitySlug: string;
    locale: "en" | "hi";
    copy: SeoCopyFields;
    notes?: string | null;
  }
): Promise<{ page_path: string; locale: string }> {
  return fetchApi("/admin/seo/copy/override", {
    method: "PUT",
    headers: authHeaders(accessToken),
    body: JSON.stringify(params)
  });
}

/** Remove an override (revert to AI copy, else template). */
export async function deleteSeoCopyOverride(
  accessToken: string,
  path: string,
  locale: "en" | "hi"
): Promise<{ page_path: string; locale: string }> {
  const query = new URLSearchParams({ path, locale }).toString();
  return fetchApi(`/admin/seo/copy/override?${query}`, {
    method: "DELETE",
    headers: authHeaders(accessToken)
  });
}

/**
 * Read the currently stored copy for a page + locale (override else AI, else
 * null) — public endpoint, used to prefill / preview the override editor.
 */
export async function fetchSeoCopyForPath(
  path: string,
  locale: "en" | "hi"
): Promise<SeoCopyFields | null> {
  const query = new URLSearchParams({ path, locale }).toString();
  return fetchApi<SeoCopyFields | null>(`/seo/copy?${query}`);
}

/** City-scoped "generate all missing (>= 3 listings)". Returns live counts. */
export async function generateSeoCopyBatchForCity(
  accessToken: string,
  citySlug: string,
  opts?: { limit?: number; force?: boolean }
): Promise<{ generated: number; skipped: number }> {
  return fetchApi("/admin/seo/copy/generate-batch", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ citySlug, ...opts })
  });
}

/**
 * Fetch the built-in template copy for a locality (what the page renders when
 * no AI/override copy exists) via the app's own /api/seo-template route. Used
 * to prefill the override editor. Returns null on failure.
 */
export async function fetchSeoTemplateCopy(
  citySlug: string,
  localitySlug: string,
  locale: "en" | "hi"
): Promise<SeoCopyFields | null> {
  try {
    const query = new URLSearchParams({
      city: citySlug,
      locality: localitySlug,
      locale
    }).toString();
    const res = await fetch(`/api/seo-template?${query}`);
    if (!res.ok) return null;
    const payload = (await res.json().catch(() => null)) as { data?: SeoCopyFields | null } | null;
    return payload?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Ask the Next app to on-demand revalidate the given (already localized) SEO
 * paths so a copy change shows immediately instead of waiting for ISR. This
 * hits the app's own /api/revalidate route (not the API), which re-checks that
 * the caller is an admin. Best-effort — never throws.
 */
export async function revalidateSeoPaths(accessToken: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await fetch("/api/revalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ paths })
    });
  } catch {
    // ISR will catch up within the revalidate window.
  }
}

// ── Search Performance (Slice 2 — Indexing + Measurement) ──────────────────

export interface SearchPerformanceRowVm {
  keyword: string;
  page: string;
  locale: string;
  citySlug: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  capturedAt: string;
  isTarget: boolean;
  isIgnored: boolean;
}

export interface SearchPerformanceResultVm {
  items: SearchPerformanceRowVm[];
  total: number;
  totals: { totalImpressions: number; totalClicks: number; avgPosition: number | null };
}

interface SearchPerformanceRawRow {
  keyword: string;
  page: string;
  locale: string;
  city_slug: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  captured_at: string;
  is_target: boolean;
  is_ignored: boolean;
}

interface SearchPerformanceRawResult {
  items: SearchPerformanceRawRow[];
  total: number;
  totals: { total_impressions: number; total_clicks: number; avg_position: number | null };
}

export interface IndexingQueueRowVm {
  id: string;
  url: string;
  status: "pending" | "submitted" | "failed" | "skipped";
  reason: string | null;
  attempts: number;
  submittedAt: string | null;
  updatedAt: string;
}

interface IndexingQueueRawRow {
  id: string;
  url: string;
  status: "pending" | "submitted" | "failed" | "skipped";
  reason: string | null;
  attempts: number;
  submitted_at: string | null;
  updated_at: string;
}

export interface IndexingQueueResultVm {
  items: IndexingQueueRowVm[];
  total: number;
  summary: { countsByStatus: Record<string, number>; submittedToday: number; dailyQuota: number };
}

function mapSearchPerformanceRow(row: SearchPerformanceRawRow): SearchPerformanceRowVm {
  return {
    keyword: row.keyword,
    page: row.page,
    locale: row.locale,
    citySlug: row.city_slug,
    position: row.position,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    capturedAt: row.captured_at,
    isTarget: row.is_target,
    isIgnored: row.is_ignored
  };
}

function mapIndexingQueueRow(row: IndexingQueueRawRow): IndexingQueueRowVm {
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    reason: row.reason,
    attempts: row.attempts,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at
  };
}

interface SearchPerformanceFilterParams {
  citySlug?: string;
  locale?: string;
  quickWins?: boolean;
  limit?: number;
  offset?: number;
}

function searchPerformanceQueryParams(
  params?: SearchPerformanceFilterParams
): Record<string, string> {
  const query: Record<string, string> = {};
  if (params?.citySlug) query.city_slug = params.citySlug;
  if (params?.locale) query.locale = params.locale;
  if (params?.quickWins) query.quick_wins = "true";
  if (params?.limit != null) query.limit = String(params.limit);
  if (params?.offset != null) query.offset = String(params.offset);
  return query;
}

function withSearchQuery(path: string, query: Record<string, string>): string {
  const qs = buildSearchQuery(query);
  return `${path}${qs ? `?${qs}` : ""}`;
}

export async function fetchSearchPerformance(
  accessToken: string,
  params?: SearchPerformanceFilterParams
): Promise<SearchPerformanceResultVm> {
  const raw = await fetchApi<SearchPerformanceRawResult>(
    withSearchQuery("/admin/seo/search-performance", searchPerformanceQueryParams(params)),
    { headers: authHeaders(accessToken) }
  );
  return {
    items: raw.items.map(mapSearchPerformanceRow),
    total: raw.total,
    totals: {
      totalImpressions: raw.totals.total_impressions,
      totalClicks: raw.totals.total_clicks,
      avgPosition: raw.totals.avg_position
    }
  };
}

export function searchPerformanceExportUrl(params?: {
  citySlug?: string;
  locale?: string;
  quickWins?: boolean;
}): string {
  return `${getApiBaseUrl()}${withSearchQuery(
    "/admin/seo/search-performance/export",
    searchPerformanceQueryParams(params)
  )}`;
}

export async function fetchSearchPerformanceCsv(
  accessToken: string,
  params?: { citySlug?: string; locale?: string; quickWins?: boolean }
): Promise<string> {
  const response = await fetch(searchPerformanceExportUrl(params), {
    headers: authHeaders(accessToken)
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

  return response.text();
}

export async function fetchSeoCoverage(
  accessToken: string
): Promise<{ indexedCount: number | null; submittedCount: number | null }> {
  const raw = await fetchApi<{ indexed_count: number | null; submitted_count: number | null }>(
    "/admin/seo/coverage",
    { headers: authHeaders(accessToken) }
  );
  return { indexedCount: raw.indexed_count, submittedCount: raw.submitted_count };
}

export async function fetchIndexingQueue(
  accessToken: string,
  params?: { status?: string; limit?: number; offset?: number }
): Promise<IndexingQueueResultVm> {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.limit != null) query.limit = String(params.limit);
  if (params?.offset != null) query.offset = String(params.offset);

  const raw = await fetchApi<{
    items: IndexingQueueRawRow[];
    total: number;
    summary: {
      counts_by_status: Record<string, number>;
      submitted_today: number;
      daily_quota: number;
    };
  }>(withSearchQuery("/admin/seo/indexing-queue", query), {
    headers: authHeaders(accessToken)
  });

  return {
    items: raw.items.map(mapIndexingQueueRow),
    total: raw.total,
    summary: {
      countsByStatus: raw.summary.counts_by_status,
      submittedToday: raw.summary.submitted_today,
      dailyQuota: raw.summary.daily_quota
    }
  };
}

export async function submitIndexingUrl(
  accessToken: string,
  url: string,
  reason?: string
): Promise<IndexingQueueRowVm> {
  const body: { url: string; reason?: string } = { url };
  if (reason !== undefined) body.reason = reason;

  const raw = await fetchApi<IndexingQueueRawRow>("/admin/seo/indexing-queue", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(body)
  });
  return mapIndexingQueueRow(raw);
}

export async function retryIndexingUrl(
  accessToken: string,
  id: string
): Promise<IndexingQueueRowVm> {
  const raw = await fetchApi<IndexingQueueRawRow>(
    `/admin/seo/indexing-queue/${encodeURIComponent(id)}/retry`,
    { method: "POST", headers: authHeaders(accessToken) }
  );
  return mapIndexingQueueRow(raw);
}

// ── Blog review (Task 24) ──────────────────────────────────────────────────
export interface AdminBlogRowVm {
  id: string;
  slug: string;
  title: string;
  status: string;
  categorySlug: string | null;
  citySlug: string | null;
  author: string;
  qualityScore: number | null;
  excerpt: string | null;
  updatedAt: string;
  publishedAt: string | null;
}

interface AdminBlogRawRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  category_slug?: string | null;
  city_slug?: string | null;
  author?: string | null;
  quality_score?: number | string | null;
  excerpt?: string | null;
  updated_at?: string | null;
  published_at?: string | null;
}

function mapAdminBlogRow(r: AdminBlogRawRow): AdminBlogRowVm {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    categorySlug: r.category_slug ?? null,
    citySlug: r.city_slug ?? null,
    author: r.author ?? "",
    qualityScore: r.quality_score != null ? Number(r.quality_score) : null,
    excerpt: r.excerpt ?? null,
    updatedAt: r.updated_at ?? "",
    publishedAt: r.published_at ?? null
  };
}

export async function fetchAdminBlogPosts(
  accessToken: string,
  status?: string
): Promise<AdminBlogRowVm[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetchApi<{ items: AdminBlogRawRow[] }>(`/admin/blog${qs}`, {
    headers: authHeaders(accessToken)
  });
  return (res.items ?? []).map(mapAdminBlogRow);
}

async function blogPostAction(
  accessToken: string,
  id: string,
  action: "approve" | "publish" | "archive"
): Promise<AdminBlogRowVm> {
  const raw = await fetchApi<AdminBlogRawRow>(`/admin/blog/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: authHeaders(accessToken)
  });
  return mapAdminBlogRow(raw);
}

export interface BlogConversionRow {
  slug: string;
  title: string | null;
  clicks: number;
  unlocks: number;
}

// Per-post content -> revenue: referral clicks + actual contact-unlocks.
// Returns [] on any DB that predates migration 0050 (handled server-side).
export async function fetchBlogConversion(accessToken: string): Promise<BlogConversionRow[]> {
  const res = await fetchApi<{ items: BlogConversionRow[] }>("/admin/blog/conversion", {
    headers: authHeaders(accessToken)
  });
  return (res.items ?? []).map((r) => ({
    slug: r.slug,
    title: r.title ?? null,
    clicks: Number(r.clicks) || 0,
    unlocks: Number(r.unlocks) || 0
  }));
}

export const approveBlogPost = (accessToken: string, id: string) =>
  blogPostAction(accessToken, id, "approve");
export const publishBlogPost = (accessToken: string, id: string) =>
  blogPostAction(accessToken, id, "publish");
export const archiveBlogPost = (accessToken: string, id: string) =>
  blogPostAction(accessToken, id, "archive");

export interface GenerateBlogInput {
  target_keyword: string;
  city_slug?: string;
  category_slug?: string;
}

// Kicks off a synchronous data-grounded generation run on the API (Azure OpenAI).
// Returns the created draft (status 'draft' if it cleared the quality gate,
// else 'needs_attention'). The call blocks for the generation duration (~15-25s),
// so callers should show a busy state.
export async function generateBlogNow(
  accessToken: string,
  input: GenerateBlogInput
): Promise<AdminBlogRowVm> {
  const raw = await fetchApi<AdminBlogRawRow>("/admin/blog/generate-now", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input)
  });
  return mapAdminBlogRow(raw);
}

export interface QualityCheckVm {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  value?: number | string | null;
  threshold?: number | string | null;
}

export interface AdminBlogFullVm {
  id: string;
  slug: string;
  title: string;
  status: string;
  categorySlug: string | null;
  citySlug: string | null;
  author: string;
  excerpt: string | null;
  bodyEn: string;
  bodyHi: string;
  faqItems: Array<{ q: string; a: string }>;
  sources: Array<{ label: string; asof?: string | null }>;
  dataAsof: string | null;
  qualityScore: number | null;
  qualityPassed: boolean;
  qualityChecks: QualityCheckVm[];
  updatedAt: string;
  publishedAt: string | null;
}

// Full post (incl. body + quality breakdown) for the admin preview — GET
// /admin/blog/:id returns any status, so drafts can be read before publishing.
export async function fetchAdminBlogPost(
  accessToken: string,
  id: string
): Promise<AdminBlogFullVm> {
  const res = await fetchApi<{ post: Record<string, unknown> }>(
    `/admin/blog/${encodeURIComponent(id)}`,
    { headers: authHeaders(accessToken) }
  );
  const p = res.post ?? {};
  const qb = (p.quality_breakdown ?? {}) as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  return {
    id: s(p.id),
    slug: s(p.slug),
    title: s(p.title),
    status: s(p.status),
    categorySlug: (p.category_slug as string | null) ?? null,
    citySlug: (p.city_slug as string | null) ?? null,
    author: s(p.author),
    excerpt: (p.excerpt as string | null) ?? null,
    bodyEn: s(p.body_en),
    bodyHi: s(p.body_hi),
    faqItems: Array.isArray(p.faq_items) ? (p.faq_items as Array<{ q: string; a: string }>) : [],
    sources: Array.isArray(p.sources)
      ? (p.sources as Array<{ label: string; asof?: string | null }>)
      : [],
    dataAsof: (p.data_asof as string | null) ?? null,
    qualityScore: p.quality_score != null ? Number(p.quality_score) : null,
    qualityPassed: Boolean(qb.passed),
    qualityChecks: Array.isArray(qb.checks) ? (qb.checks as QualityCheckVm[]) : [],
    updatedAt: s(p.updated_at),
    publishedAt: (p.published_at as string | null) ?? null
  };
}

export interface BlogPatch {
  title?: string;
  excerpt?: string | null;
  meta_description?: string | null;
  body_en?: string | null;
  faq_items?: Array<{ q: string; a: string }>;
}

// Saves manual edits to a draft (partial — only provided fields change).
export async function updateBlogPost(
  accessToken: string,
  id: string,
  patch: BlogPatch
): Promise<void> {
  await fetchApi(`/admin/blog/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(patch)
  });
}

// LLM-assisted edit: applies an instruction to one field and returns the
// proposed revised text (does NOT save — the caller drops it into the editable
// field, then Save persists it). Blocks for the LLM duration on body targets.
export async function reviseBlogPost(
  accessToken: string,
  id: string,
  input: { instruction: string; target: "body" | "title" | "excerpt" }
): Promise<string> {
  const res = await fetchApi<{ target: string; revised: string }>(
    `/admin/blog/${encodeURIComponent(id)}/revise`,
    { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) }
  );
  return res.revised;
}

export interface PlanTopicsResult {
  created: number;
  bySource: Record<string, number>;
}

// Runs the topic planner: proposes briefs from GSC quick-wins, content gaps,
// live-listing data trends, and evergreen seeds. Creates briefs only — call
// generateNextBlogBrief to turn them into drafts.
export async function planBlogTopics(
  accessToken: string,
  input: { citySlugs?: string[]; maxBriefs?: number } = {}
): Promise<PlanTopicsResult> {
  const body: { city_slugs?: string[]; max_briefs?: number } = {};
  if (input.citySlugs?.length) body.city_slugs = input.citySlugs;
  if (input.maxBriefs != null) body.max_briefs = input.maxBriefs;
  const raw = await fetchApi<{ created?: number; bySource?: Record<string, number> }>(
    "/admin/blog/plan",
    { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(body) }
  );
  return { created: raw.created ?? 0, bySource: raw.bySource ?? {} };
}

export interface GenerateNextResult {
  post: AdminBlogRowVm | null;
  remaining: number;
}

// Drains one pending brief into a draft (the autonomous path). Returns the
// created post + how many briefs remain pending, or post=null when the queue
// of briefs is empty. Blocks for the generation duration, like generateBlogNow.
export async function generateNextBlogBrief(accessToken: string): Promise<GenerateNextResult> {
  const raw = await fetchApi<{ post: AdminBlogRawRow | null; remaining?: number }>(
    "/admin/blog/generate-next",
    { method: "POST", headers: authHeaders(accessToken) }
  );
  return {
    post: raw.post ? mapAdminBlogRow(raw.post) : null,
    remaining: raw.remaining ?? 0
  };
}

// ── Admin Lead Center (Slice 4) ─────────────────────────────────────────────

import type {
  AdminLeadBoardResponse,
  AdminLeadBoardFilter,
  AdminLeadBoardSort,
  AdminLeadAnalytics,
  AdminLeadOwnerDetail,
  AdminLeadTimelineResponse
} from "@cribliv/shared-types";

export interface AdminLeadBoardParams {
  filter?: AdminLeadBoardFilter;
  owner_id?: string;
  listing_id?: string;
  state?: string;
  status?: string;
  q?: string;
  range?: string;
  sort?: AdminLeadBoardSort;
  page?: number;
  page_size?: number;
}
export async function fetchAdminLeadBoard(accessToken: string, params: AdminLeadBoardParams = {}) {
  const qs = buildSearchQuery(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<AdminLeadBoardResponse>(`/admin/leads/board${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
export async function fetchAdminLeadAnalytics(accessToken: string, range = "30 days") {
  const qs = buildSearchQuery({ range });
  return fetchApi<AdminLeadAnalytics>(`/admin/leads/analytics${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
export async function fetchAdminLeadByOwner(
  accessToken: string,
  ownerId: string,
  range = "30 days"
) {
  const qs = buildSearchQuery({ range });
  return fetchApi<AdminLeadOwnerDetail>(`/admin/leads/by-owner/${ownerId}${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
export async function fetchAdminLeadTimeline(accessToken: string, leadId: string) {
  return fetchApi<AdminLeadTimelineResponse>(`/admin/leads/${leadId}/timeline`, {
    headers: authHeaders(accessToken)
  });
}
export async function markAdminLeadTeamCalled(accessToken: string, leadId: string) {
  return fetchApi<{ lead_id: string; called_at: string; called_by: string }>(
    `/admin/leads/${leadId}/team-called`,
    { method: "POST", headers: authHeaders(accessToken) }
  );
}
export async function nudgeAdminLeadOwner(accessToken: string, leadId: string) {
  return fetchApi<{ lead_id: string; nudged: boolean }>(`/admin/leads/${leadId}/nudge-owner`, {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}
export async function refundAdminLead(accessToken: string, leadId: string, reason: string) {
  return fetchApi<{ lead_id: string; refunded: boolean; refund_txn_id: string | null }>(
    `/admin/leads/${leadId}/refund`,
    { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ reason }) }
  );
}

// ── Admin TOTP enrollment (Task 11) ─────────────────────────────────────────

export async function fetchAdminTotpStatus(accessToken: string): Promise<{ enrolled: boolean }> {
  return fetchApi<{ enrolled: boolean }>("/auth/admin/totp/status", {
    headers: authHeaders(accessToken)
  });
}

export async function startAdminTotpEnroll(
  accessToken: string
): Promise<{ otpauth_uri: string; qr_data_url: string }> {
  return fetchApi<{ otpauth_uri: string; qr_data_url: string }>("/auth/admin/totp/enroll/start", {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}

export async function verifyAdminTotpEnroll(
  accessToken: string,
  totpCode: string
): Promise<{ enabled: boolean }> {
  return fetchApi<{ enabled: boolean }>("/auth/admin/totp/enroll/verify", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ totp_code: totpCode })
  });
}

export async function resetAdminTotp(accessToken: string): Promise<{ reset: boolean }> {
  return fetchApi<{ reset: boolean }>("/auth/admin/totp/reset", {
    method: "POST",
    headers: authHeaders(accessToken)
  });
}

// ── Admin review detail VMs + fetchers (Task 6) ─────────────────────────────
// These payloads are large; VMs keep the server's snake_case field names
// verbatim (no camelCase mapping layer) to avoid duplicating the shape.

export interface AdminReviewOwnerVm {
  id: string;
  name: string | null;
  phone: string | null;
  whatsapp_opt_in: boolean;
  preferred_language: string | null;
  role: string;
  is_blocked: boolean;
  member_since: string | null;
  active_listings: number;
  report_count: number;
}

export interface AdminListingPhotoVm {
  url: string | null;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface AdminReviewEvidenceVm {
  attempt_id: string;
  kind: string;
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  created_at: string;
}

export interface AdminListingDetailVm {
  listing: {
    id: string;
    listing_type: "flat_house" | "pg";
    title_en: string | null;
    title_hi: string | null;
    description_en: string | null;
    description_hi: string | null;
    status: string;
    verification_status: string;
    monthly_rent: number | null;
    security_deposit: number | null;
    available_from: string | null;
    furnishing: string | null;
    bhk: number | null;
    bathrooms: number | null;
    area_sqft: number | null;
    preferred_tenant: string | null;
    whatsapp_available: boolean;
    amenities: string[];
    rules: Record<string, unknown>;
    created_at: string;
  };
  location: {
    address_line1?: string | null;
    landmark?: string | null;
    pincode?: string | null;
    lat?: number | null;
    lng?: number | null;
    masked_address?: string | null;
    locality_name?: string | null;
    city_slug?: string | null;
    city_name?: string | null;
  } | null;
  owner: AdminReviewOwnerVm;
  photos: AdminListingPhotoVm[];
  pg: { details: Record<string, unknown> | null; rooms: Record<string, unknown>[] } | null;
  verification: AdminReviewEvidenceVm[];
}

export interface AdminVerificationDetailVm {
  attempt_id: string;
  kind: string;
  result: string;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_reference: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  retryable: boolean | null;
  artifact_available: boolean;
  created_at: string;
  listing: { id: string | null; title: string | null; address: string | null };
  owner: {
    id: string;
    name: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
    member_since: string | null;
  };
}

export async function fetchAdminListingDetail(accessToken: string, listingId: string) {
  return fetchApi<AdminListingDetailVm>(`/admin/review/listings/${listingId}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminVerificationDetail(accessToken: string, attemptId: string) {
  return fetchApi<AdminVerificationDetailVm>(`/admin/review/verifications/${attemptId}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchVerificationArtifactLink(
  accessToken: string,
  attemptId: string,
  kind: "video_liveness" | "electricity_bill"
) {
  const res = await fetchApi<{ url: string; expires_at: string } | null>(
    `/admin/review/verifications/${attemptId}/artifact-link?kind=${kind}`,
    { headers: authHeaders(accessToken) }
  );
  return res ? { url: res.url, expiresAt: res.expires_at } : null;
}
