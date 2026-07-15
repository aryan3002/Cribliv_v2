import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  AdminHomeActivityItem,
  AdminHomeDetail,
  AdminHomeListItem,
  AdminHomePhoto,
  AdminHomeRecentLead,
  AdminHomeVerificationAttempt,
  AdminHomeSort,
  AdminHomesListParams,
  AdminHomesListResponse,
  AdminHomeStatusFilter
} from "@cribliv/shared-types";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { toBlobUrl } from "../../common/photo-url";
import { computeOwnerHealth } from "./owner-health.calculator";

interface HomeSqlRow {
  id: string;
  title: string;
  city_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
  monthly_rent: number | string;
  owner_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  status: "active" | "paused" | "archived";
  cover_photo_path: string | null;
  views_30d: number | string;
  leads_30d: number | string;
  open_leads: number | string;
  conversion_rate: number | string;
  updated_at: string;
  total: number | string;
}

interface SummarySqlRow {
  total: number | string;
  active_homes: number | string;
  views_30d: number | string;
  leads_30d: number | string;
  needs_attention: number | string;
}

interface CitySqlRow {
  slug: string;
  name: string;
  count: number | string;
}

interface BaseCte {
  sql: string;
  values: unknown[];
}

interface HomeDetailSqlRow {
  id: string;
  title_en: string | null;
  title_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
  status: "active" | "paused" | "archived";
  verification_status: "verified";
  monthly_rent: number | string;
  security_deposit: number | string | null;
  available_from: string | null;
  furnishing: string | null;
  bhk: number | string | null;
  bathrooms: number | string | null;
  area_sqft: number | string | null;
  preferred_tenant: string | null;
  whatsapp_available: boolean;
  amenities: unknown;
  rules: unknown;
  created_at: string;
  updated_at: string;
  last_owner_activity_at: string | null;
  address_line1: string | null;
  landmark: string | null;
  pincode: string | null;
  lat: number | string | null;
  lng: number | string | null;
  masked_address: string | null;
  locality_name: string | null;
  city_slug: string | null;
  city_name: string | null;
  owner_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  owner_whatsapp_opt_in: boolean;
  owner_preferred_language: string | null;
  owner_role: string;
  owner_is_blocked: boolean;
  owner_member_since: string | null;
  owner_last_login_at: string | null;
  report_count: number | string | null;
}

interface OwnerAggregateSqlRow {
  active_homes: number | string;
  paused_homes: number | string;
  archived_homes: number | string;
  report_count: number | string;
  leads_30d: number | string;
  called_rate_30d: number | string;
  refund_rate_30d: number | string;
  median_response_minutes_30d: number | string | null;
  health_avg_response_minutes: number | string | null;
  health_unlocks_60d: number | string;
  health_deals_60d: number | string;
  health_listings_active: number | string;
  health_listings_paused: number | string;
}

interface PhotoSqlRow {
  id: string;
  blob_path: string | null;
  is_cover: boolean;
  sort_order: number | string;
  moderation_status: string;
}

interface MetricsSqlRow {
  views: number | string;
  leads: number | string;
  open_leads: number | string;
  conversion_rate: number | string;
}

interface LeadSummarySqlRow {
  new_count: number | string;
  contacted_count: number | string;
  visit_scheduled_count: number | string;
  deal_done_count: number | string;
  lost_count: number | string;
  free_count: number | string;
  locked_count: number | string;
  unlocked_count: number | string;
  expired_count: number | string;
  called: number | string;
  uncalled: number | string;
  refunded: number | string;
  open: number | string;
  median_response_minutes: number | string | null;
}

interface RecentLeadSqlRow {
  lead_id: string;
  seeker_name: string | null;
  access_state: "free" | "locked" | "unlocked" | "expired";
  status: "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";
  called_at: string | null;
  called_by: "owner" | "team" | null;
  response_deadline_at: string | null;
  refund_state: "pending" | "responded" | "refunded";
  created_at: string;
}

interface VerificationAttemptSqlRow {
  attempt_id: string;
  kind: "video_liveness" | "electricity_bill_match";
  result: "pending" | "pass" | "fail" | "manual_review";
  liveness_score: number | string | null;
  address_match_score: number | string | null;
  threshold: number | string;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

interface ActivitySqlRow {
  id: string;
  at: string;
  kind: "listing" | "admin" | "verification" | "lead";
  label: string;
  detail: string | null;
  actor_id: string | null;
}

const eligibleStatuses = new Set(["active", "paused", "archived"]);
const statusSql: Record<Exclude<AdminHomeStatusFilter, "all">, string> = {
  active: "active",
  paused: "paused",
  archived: "archived"
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const openStatuses = new Set(["new", "contacted", "visit_scheduled"]);

function numberValue(value: number | string | null | undefined): number {
  return Number(value ?? 0) || 0;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  return value == null ? null : numberValue(value);
}

@Injectable()
export class AdminHomesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService
  ) {}

  async listHomes(params: AdminHomesListParams): Promise<AdminHomesListResponse> {
    if (!this.database.isEnabled()) {
      return this.listHomesInMemory(params);
    }

    const pageBase = this.baseCte(params, {
      includeStatus: true,
      includeCity: true,
      includeSearch: true
    });
    const limitIndex = pageBase.values.length + 1;
    const offsetIndex = limitIndex + 1;
    const pageResult = await this.database.query<HomeSqlRow>(
      `${pageBase.sql},
       event_agg AS (
         SELECT le.listing_id,
                count(*) FILTER (WHERE le.event_type = 'view')::int AS views_30d
         FROM listing_events le
         JOIN base b ON b.id = le.listing_id
         WHERE le.created_at >= now() - interval '30 days'
         GROUP BY le.listing_id
       ),
       lead_agg AS (
         SELECT ld.listing_id,
                count(*) FILTER (WHERE ld.created_at >= now() - interval '30 days')::int AS leads_30d,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                )::int AS open_leads,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                    AND ld.called_at IS NULL
                )::int AS uncalled_open_leads
         FROM leads ld
         JOIN base b ON b.id = ld.listing_id
         GROUP BY ld.listing_id
       )
       SELECT b.id::text AS id,
              COALESCE(NULLIF(b.title_en, ''), NULLIF(b.title_hi, ''), 'Listing') AS title,
              b.city_slug, b.city_name, b.locality_name,
              b.monthly_rent,
              b.owner_user_id::text AS owner_id,
              b.owner_name, b.owner_phone,
              b.status::text AS status,
              photo.blob_path AS cover_photo_path,
              COALESCE(event_agg.views_30d, 0)::int AS views_30d,
              COALESCE(lead_agg.leads_30d, 0)::int AS leads_30d,
              COALESCE(lead_agg.open_leads, 0)::int AS open_leads,
              CASE
                WHEN COALESCE(event_agg.views_30d, 0) = 0 THEN 0
                ELSE ROUND(
                  COALESCE(lead_agg.leads_30d, 0)::numeric / event_agg.views_30d::numeric,
                  4
                )
              END AS conversion_rate,
              b.updated_at::text AS updated_at,
              count(*) OVER ()::int AS total
       FROM base b
       LEFT JOIN event_agg ON event_agg.listing_id = b.id
       LEFT JOIN lead_agg ON lead_agg.listing_id = b.id
       LEFT JOIN LATERAL (
         SELECT p.blob_path
         FROM listing_photos p
         WHERE p.listing_id = b.id
         ORDER BY p.is_cover DESC, p.sort_order ASC, p.created_at ASC
         LIMIT 1
       ) photo ON true
       ORDER BY ${this.orderBy(params.sort)}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...pageBase.values, params.page_size, (params.page - 1) * params.page_size]
    );

    const summaryBase = this.baseCte(params, {
      includeStatus: false,
      includeCity: true,
      includeSearch: true
    });
    const selectedStatus = this.selectedStatusClause(params.status, "b.status");
    const summaryResult = await this.database.query<SummarySqlRow>(
      `${summaryBase.sql},
       filtered AS (
         SELECT * FROM base b
         ${selectedStatus}
       ),
       event_agg AS (
         SELECT le.listing_id,
                count(*) FILTER (WHERE le.event_type = 'view')::int AS views_30d
         FROM listing_events le
         JOIN filtered f ON f.id = le.listing_id
         WHERE le.created_at >= now() - interval '30 days'
         GROUP BY le.listing_id
       ),
       lead_agg AS (
         SELECT ld.listing_id,
                count(*) FILTER (WHERE ld.created_at >= now() - interval '30 days')::int AS leads_30d,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                )::int AS open_leads,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                    AND ld.called_at IS NULL
                )::int AS uncalled_open_leads
         FROM leads ld
         JOIN filtered f ON f.id = ld.listing_id
         GROUP BY ld.listing_id
       )
       SELECT
         count(*)::int AS total,
         (SELECT count(*)::int FROM base WHERE status = 'active') AS active_homes,
         COALESCE(sum(COALESCE(event_agg.views_30d, 0)), 0)::int AS views_30d,
         COALESCE(sum(COALESCE(lead_agg.leads_30d, 0)), 0)::int AS leads_30d,
         count(*) FILTER (WHERE COALESCE(lead_agg.uncalled_open_leads, 0) > 0)::int AS needs_attention
       FROM filtered f
       LEFT JOIN event_agg ON event_agg.listing_id = f.id
       LEFT JOIN lead_agg ON lead_agg.listing_id = f.id`,
      summaryBase.values
    );

    const cityBase = this.baseCte(params, {
      includeStatus: true,
      includeCity: false,
      includeSearch: true
    });
    const citiesResult = await this.database.query<CitySqlRow>(
      `${cityBase.sql}
       SELECT city_slug AS slug, city_name AS name, count(*)::int AS count
       FROM base
       WHERE city_slug IS NOT NULL
       GROUP BY city_slug, city_name
       ORDER BY city_name ASC, city_slug ASC`,
      cityBase.values
    );

    const summary = summaryResult.rows[0];
    return {
      items: pageResult.rows.map((row) => this.mapSqlRow(row)),
      total: numberValue(summary?.total),
      page: params.page,
      page_size: params.page_size,
      filters: {
        status: params.status,
        city: params.city ?? null,
        q: params.q ?? null,
        sort: params.sort
      },
      available_cities: citiesResult.rows.map((city) => ({
        slug: city.slug,
        name: city.name,
        count: numberValue(city.count)
      })),
      summary: {
        active_homes: numberValue(summary?.active_homes),
        views_30d: numberValue(summary?.views_30d),
        leads_30d: numberValue(summary?.leads_30d),
        needs_attention: numberValue(summary?.needs_attention)
      }
    };
  }

  async getHome(listingId: string): Promise<AdminHomeDetail> {
    if (!this.database.isEnabled()) {
      return this.getHomeInMemory(listingId);
    }
    if (!UUID_RE.test(listingId)) {
      this.throwHomeNotFound();
    }

    const main = await this.database.query<HomeDetailSqlRow>(
      `SELECT l.id::text AS id,
              l.title_en,
              l.title_hi,
              l.description_en,
              l.description_hi,
              l.status::text AS status,
              l.verification_status::text AS verification_status,
              l.monthly_rent,
              l.security_deposit,
              l.available_from::text,
              l.furnishing::text,
              l.bhk,
              l.bathrooms,
              l.area_sqft,
              l.preferred_tenant::text,
              l.whatsapp_available,
              l.amenities,
              l.rules,
              l.created_at::text,
              l.updated_at::text,
              l.last_owner_activity_at::text,
              ll.address_line1,
              ll.landmark,
              ll.pincode,
              ll.lat,
              ll.lng,
              ll.masked_address,
              loc.name_en AS locality_name,
              c.slug AS city_slug,
              c.name_en AS city_name,
              u.id::text AS owner_id,
              u.full_name AS owner_name,
              u.phone_e164 AS owner_phone,
              u.whatsapp_opt_in AS owner_whatsapp_opt_in,
              u.preferred_language::text AS owner_preferred_language,
              u.role::text AS owner_role,
              u.is_blocked AS owner_is_blocked,
              u.created_at::text AS owner_member_since,
              u.last_login_at::text AS owner_last_login_at,
              l.report_count
       FROM listings l
       JOIN users u ON u.id = l.owner_user_id
       LEFT JOIN listing_locations ll ON ll.listing_id = l.id
       LEFT JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       WHERE l.id = $1::uuid
         AND l.listing_type = 'flat_house'
         AND l.verification_status = 'verified'
         AND l.status IN ('active', 'paused', 'archived')
       LIMIT 1`,
      [listingId]
    );
    const row = main.rows[0];
    if (!row) {
      this.throwHomeNotFound();
    }

    const [ownerAggregate, photos, metrics, leadSummary, recentLeads, attempts, activity] =
      await Promise.all([
        this.loadOwnerAggregate(row.owner_id),
        this.loadPhotos(listingId),
        this.loadMetrics(listingId),
        this.loadLeadSummary(listingId),
        this.loadRecentLeads(listingId),
        this.loadVerificationAttempts(listingId),
        this.loadActivity(listingId)
      ]);
    const health = computeOwnerHealth({
      listings_active: numberValue(ownerAggregate.health_listings_active),
      listings_paused: numberValue(ownerAggregate.health_listings_paused),
      avg_response_minutes: nullableNumber(ownerAggregate.health_avg_response_minutes),
      unlocks_60d: numberValue(ownerAggregate.health_unlocks_60d),
      deals_done_60d: numberValue(ownerAggregate.health_deals_60d),
      days_since_last_login: this.daysSince(row.owner_last_login_at),
      report_count: numberValue(ownerAggregate.report_count ?? row.report_count)
    });

    return {
      listing: {
        id: row.id,
        title_en: row.title_en,
        title_hi: row.title_hi,
        description_en: row.description_en,
        description_hi: row.description_hi,
        status: row.status,
        verification_status: "verified",
        monthly_rent: numberValue(row.monthly_rent),
        security_deposit: nullableNumber(row.security_deposit),
        available_from: row.available_from,
        furnishing: row.furnishing,
        bhk: nullableNumber(row.bhk),
        bathrooms: nullableNumber(row.bathrooms),
        area_sqft: nullableNumber(row.area_sqft),
        preferred_tenant: row.preferred_tenant,
        whatsapp_available: Boolean(row.whatsapp_available),
        amenities: this.stringArray(row.amenities),
        rules: this.recordValue(row.rules),
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_owner_activity_at: row.last_owner_activity_at
      },
      location:
        row.address_line1 || row.locality_name || row.city_slug
          ? {
              address_line1: row.address_line1,
              landmark: row.landmark,
              pincode: row.pincode,
              lat: nullableNumber(row.lat),
              lng: nullableNumber(row.lng),
              masked_address: row.masked_address,
              locality_name: row.locality_name,
              city_slug: row.city_slug,
              city_name: row.city_name
            }
          : null,
      photos,
      owner: {
        id: row.owner_id,
        name: row.owner_name,
        phone: row.owner_phone,
        whatsapp_opt_in: Boolean(row.owner_whatsapp_opt_in),
        preferred_language: row.owner_preferred_language,
        role: row.owner_role,
        is_blocked: Boolean(row.owner_is_blocked),
        member_since: row.owner_member_since,
        last_login_at: row.owner_last_login_at,
        active_homes: numberValue(ownerAggregate.active_homes),
        paused_homes: numberValue(ownerAggregate.paused_homes),
        archived_homes: numberValue(ownerAggregate.archived_homes),
        report_count: numberValue(ownerAggregate.report_count ?? row.report_count),
        lead_health: {
          health_score: health.score,
          health_grade: health.grade,
          leads_30d: numberValue(ownerAggregate.leads_30d),
          called_rate_30d: numberValue(ownerAggregate.called_rate_30d),
          refund_rate_30d: numberValue(ownerAggregate.refund_rate_30d),
          median_response_minutes_30d: nullableNumber(ownerAggregate.median_response_minutes_30d)
        }
      },
      metrics_30d: {
        views: numberValue(metrics.views),
        leads: numberValue(metrics.leads),
        open_leads: numberValue(metrics.open_leads),
        conversion_rate: numberValue(metrics.conversion_rate)
      },
      lead_summary: this.mapLeadSummary(leadSummary),
      recent_leads: recentLeads.map((lead) => this.mapRecentLead(lead)),
      verification_status: "verified",
      verified_at: attempts.find((attempt) => attempt.result === "pass")?.created_at ?? null,
      verification_attempts: attempts.map((attempt) => this.mapVerificationAttempt(attempt)),
      activity: activity.map((item) => this.mapActivity(item)),
      public_path: `/en/listing/${row.id}`
    };
  }

  private async loadOwnerAggregate(ownerId: string): Promise<OwnerAggregateSqlRow> {
    const result = await this.database.query<OwnerAggregateSqlRow>(
      `WITH portfolio AS (
         SELECT count(*) FILTER (WHERE status = 'active')::int AS active_homes,
                count(*) FILTER (WHERE status = 'paused')::int AS paused_homes,
                count(*) FILTER (WHERE status = 'archived')::int AS archived_homes,
                COALESCE(sum(report_count), 0)::int AS report_count
         FROM listings
         WHERE owner_user_id = $1::uuid
           AND listing_type = 'flat_house'
           AND status IN ('active', 'paused', 'archived')
       ),
       leads_30d AS (
         SELECT ld.id,
                ld.called_at,
                ld.created_at,
                cu.id AS unlock_id,
                cu.unlock_status
         FROM leads ld
         LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
         WHERE ld.owner_user_id = $1::uuid
           AND ld.created_at >= now() - interval '30 days'
       ),
       health_listing_agg AS (
         SELECT count(*) FILTER (WHERE status = 'active')::int AS listings_active,
                count(*) FILTER (WHERE status = 'paused')::int AS listings_paused,
                COALESCE(sum(report_count), 0)::int AS report_count
         FROM listings
         WHERE owner_user_id = $1::uuid
       ),
       health_unlock_agg AS (
         SELECT count(cu.id)::int AS unlocks_60d,
                AVG(EXTRACT(EPOCH FROM (cu.owner_responded_at - cu.created_at)) / 60.0)
                  FILTER (WHERE cu.owner_responded_at IS NOT NULL) AS avg_response_minutes
         FROM contact_unlocks cu
         JOIN listings l ON l.id = cu.listing_id
         WHERE cu.created_at >= now() - interval '60 days'
           AND l.owner_user_id = $1::uuid
       ),
       health_deal_agg AS (
         SELECT count(*) FILTER (WHERE status = 'deal_done')::int AS deals_done_60d
         FROM leads
         WHERE owner_user_id = $1::uuid
           AND created_at >= now() - interval '60 days'
       )
       SELECT COALESCE((SELECT active_homes FROM portfolio), 0)::int AS active_homes,
              COALESCE((SELECT paused_homes FROM portfolio), 0)::int AS paused_homes,
              COALESCE((SELECT archived_homes FROM portfolio), 0)::int AS archived_homes,
              COALESCE((SELECT report_count FROM health_listing_agg), 0)::int AS report_count,
              (SELECT count(*)::int FROM leads_30d) AS leads_30d,
              COALESCE(
                (SELECT count(*) FILTER (WHERE called_at IS NOT NULL)::numeric / NULLIF(count(*), 0)
                 FROM leads_30d),
                0
              ) AS called_rate_30d,
              COALESCE(
                (SELECT count(*) FILTER (WHERE unlock_status = 'refunded')::numeric /
                        NULLIF(count(unlock_id), 0)
                 FROM leads_30d),
                0
              ) AS refund_rate_30d,
              (SELECT percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (called_at - created_at)) / 60.0
               )
               FROM leads_30d
               WHERE called_at IS NOT NULL) AS median_response_minutes_30d,
              (SELECT avg_response_minutes FROM health_unlock_agg)
                AS health_avg_response_minutes,
              COALESCE((SELECT unlocks_60d FROM health_unlock_agg), 0)::int
                AS health_unlocks_60d,
              COALESCE((SELECT deals_done_60d FROM health_deal_agg), 0)::int
                AS health_deals_60d,
              COALESCE((SELECT listings_active FROM health_listing_agg), 0)::int
                AS health_listings_active,
              COALESCE((SELECT listings_paused FROM health_listing_agg), 0)::int
                AS health_listings_paused`,
      [ownerId]
    );
    return (
      result.rows[0] ?? {
        active_homes: 0,
        paused_homes: 0,
        archived_homes: 0,
        report_count: 0,
        leads_30d: 0,
        called_rate_30d: 0,
        refund_rate_30d: 0,
        median_response_minutes_30d: null,
        health_avg_response_minutes: null,
        health_unlocks_60d: 0,
        health_deals_60d: 0,
        health_listings_active: 0,
        health_listings_paused: 0
      }
    );
  }

  private async loadPhotos(listingId: string): Promise<AdminHomePhoto[]> {
    const result = await this.database.query<PhotoSqlRow>(
      `SELECT p.id::text AS id,
              p.blob_path,
              p.is_cover,
              p.sort_order,
              p.moderation_status::text AS moderation_status
       FROM listing_photos p
       WHERE p.listing_id = $1::uuid
         AND p.moderation_status <> 'rejected'
       ORDER BY p.is_cover DESC, p.sort_order ASC, p.created_at ASC`,
      [listingId]
    );
    return result.rows.map((photo) => ({
      id: photo.id,
      url: toBlobUrl(photo.blob_path),
      is_cover: Boolean(photo.is_cover),
      sort_order: numberValue(photo.sort_order),
      moderation_status: photo.moderation_status
    }));
  }

  private async loadMetrics(listingId: string): Promise<MetricsSqlRow> {
    const result = await this.database.query<MetricsSqlRow>(
      `SELECT
         (SELECT count(*)::int
          FROM listing_events
          WHERE listing_id = $1::uuid
            AND event_type = 'view'
            AND created_at >= now() - interval '30 days') AS views,
         (SELECT count(*)::int
          FROM leads
          WHERE listing_id = $1::uuid
            AND created_at >= now() - interval '30 days') AS leads,
         (SELECT count(*)::int
          FROM leads
          WHERE listing_id = $1::uuid
            AND status IN ('new', 'contacted', 'visit_scheduled')
            AND access_state <> 'expired') AS open_leads,
         CASE
           WHEN (SELECT count(*) FROM listing_events
                 WHERE listing_id = $1::uuid
                   AND event_type = 'view'
                   AND created_at >= now() - interval '30 days') = 0 THEN 0
           ELSE (SELECT count(*)::numeric FROM leads
                 WHERE listing_id = $1::uuid
                   AND created_at >= now() - interval '30 days') /
                (SELECT count(*)::numeric FROM listing_events
                 WHERE listing_id = $1::uuid
                   AND event_type = 'view'
                   AND created_at >= now() - interval '30 days')
         END AS conversion_rate`,
      [listingId]
    );
    return result.rows[0] ?? { views: 0, leads: 0, open_leads: 0, conversion_rate: 0 };
  }

  private async loadLeadSummary(listingId: string): Promise<LeadSummarySqlRow> {
    const result = await this.database.query<LeadSummarySqlRow>(
      `WITH recent AS (
         SELECT ld.status,
                ld.access_state,
                ld.called_at,
                ld.created_at,
                cu.unlock_status
         FROM leads ld
         LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
         WHERE ld.listing_id = $1::uuid
           AND ld.created_at >= now() - interval '30 days'
       ),
       lifetime AS (
         SELECT status, access_state, called_at
         FROM leads
         WHERE listing_id = $1::uuid
       )
       SELECT count(*) FILTER (WHERE status = 'new')::int AS new_count,
              count(*) FILTER (WHERE status = 'contacted')::int AS contacted_count,
              count(*) FILTER (WHERE status = 'visit_scheduled')::int AS visit_scheduled_count,
              count(*) FILTER (WHERE status = 'deal_done')::int AS deal_done_count,
              count(*) FILTER (WHERE status = 'lost')::int AS lost_count,
              count(*) FILTER (WHERE access_state = 'free')::int AS free_count,
              count(*) FILTER (WHERE access_state = 'locked')::int AS locked_count,
              count(*) FILTER (WHERE access_state = 'unlocked')::int AS unlocked_count,
              count(*) FILTER (WHERE access_state = 'expired')::int AS expired_count,
              count(*) FILTER (WHERE called_at IS NOT NULL)::int AS called,
              (SELECT count(*)::int FROM lifetime
               WHERE status IN ('new', 'contacted', 'visit_scheduled')
                 AND access_state <> 'expired'
                 AND called_at IS NULL) AS uncalled,
              count(*) FILTER (WHERE unlock_status = 'refunded')::int AS refunded,
              (SELECT count(*)::int FROM lifetime
               WHERE status IN ('new', 'contacted', 'visit_scheduled')
                 AND access_state <> 'expired') AS open,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY EXTRACT(EPOCH FROM (called_at - created_at)) / 60.0
              ) FILTER (WHERE called_at IS NOT NULL) AS median_response_minutes
       FROM recent`,
      [listingId]
    );
    return (
      result.rows[0] ?? {
        new_count: 0,
        contacted_count: 0,
        visit_scheduled_count: 0,
        deal_done_count: 0,
        lost_count: 0,
        free_count: 0,
        locked_count: 0,
        unlocked_count: 0,
        expired_count: 0,
        called: 0,
        uncalled: 0,
        refunded: 0,
        open: 0,
        median_response_minutes: null
      }
    );
  }

  private async loadRecentLeads(listingId: string): Promise<RecentLeadSqlRow[]> {
    const result = await this.database.query<RecentLeadSqlRow>(
      `SELECT ld.id::text AS lead_id,
              COALESCE(seeker.full_name, 'Seeker') AS seeker_name,
              ld.access_state,
              ld.status::text AS status,
              ld.called_at::text,
              ld.called_by,
              COALESCE(ld.call_deadline_at, cu.response_deadline_at)::text
                AS response_deadline_at,
              CASE
                WHEN cu.unlock_status = 'refunded' THEN 'refunded'
                WHEN cu.owner_response_status = 'responded' THEN 'responded'
                ELSE 'pending'
              END AS refund_state,
              ld.created_at::text
       FROM leads ld
       JOIN users seeker ON seeker.id = ld.tenant_user_id
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
       WHERE ld.listing_id = $1::uuid
       ORDER BY ld.created_at DESC
       LIMIT 10`,
      [listingId]
    );
    return result.rows;
  }

  private async loadVerificationAttempts(listingId: string): Promise<VerificationAttemptSqlRow[]> {
    const result = await this.database.query<VerificationAttemptSqlRow>(
      `SELECT va.id::text AS attempt_id,
              va.verification_type::text AS kind,
              va.result::text AS result,
              va.liveness_score,
              va.address_match_score,
              va.threshold,
              vpl.provider,
              vpl.provider_result_code,
              COALESCE(vpl.review_reason, va.failure_reason) AS review_reason,
              CASE
                WHEN jsonb_typeof(va.artifact_paths) = 'array'
                  THEN jsonb_array_length(va.artifact_paths) > 0
                ELSE false
              END AS artifact_available,
              va.reviewed_by::text,
              va.reviewed_at::text,
              va.created_at::text
       FROM verification_attempts va
       LEFT JOIN LATERAL (
         SELECT provider, provider_result_code, review_reason
         FROM verification_provider_logs
         WHERE attempt_id = va.id
         ORDER BY created_at DESC
         LIMIT 1
       ) vpl ON true
       WHERE va.listing_id = $1::uuid
       ORDER BY va.created_at DESC`,
      [listingId]
    );
    return result.rows;
  }

  private async loadActivity(listingId: string): Promise<ActivitySqlRow[]> {
    const result = await this.database.query<ActivitySqlRow>(
      `SELECT id, at, kind, label, detail, actor_id
       FROM (
         SELECT 'listing:' || l.id::text || ':created' AS id,
                l.created_at::text AS at,
                'listing'::text AS kind,
                'Listing created'::text AS label,
                NULL::text AS detail,
                l.owner_user_id::text AS actor_id
         FROM listings l
         WHERE l.id = $1::uuid
         UNION ALL
         SELECT 'listing:' || l.id::text || ':updated' AS id,
                l.updated_at::text AS at,
                'listing'::text AS kind,
                'Listing updated'::text AS label,
                NULL::text AS detail,
                l.owner_user_id::text AS actor_id
         FROM listings l
         WHERE l.id = $1::uuid
         UNION ALL
         SELECT 'admin:' || aa.id::text AS id,
                aa.created_at::text AS at,
                'admin'::text AS kind,
                aa.action::text AS label,
                aa.reason AS detail,
                aa.admin_user_id::text AS actor_id
         FROM admin_actions aa
         WHERE aa.target_type = 'listing'
           AND aa.target_id = $1::uuid
         UNION ALL
         SELECT 'verification:' || va.id::text AS id,
                va.created_at::text AS at,
                'verification'::text AS kind,
                ('Verification ' || va.result::text) AS label,
                va.failure_reason AS detail,
                va.user_id::text AS actor_id
         FROM verification_attempts va
         WHERE va.listing_id = $1::uuid
         UNION ALL
         SELECT 'admin:' || aa.id::text AS id,
                aa.created_at::text AS at,
                'admin'::text AS kind,
                aa.action::text AS label,
                aa.reason AS detail,
                aa.admin_user_id::text AS actor_id
         FROM admin_actions aa
         JOIN verification_attempts va ON va.id = aa.target_id
         WHERE aa.target_type = 'verification_attempt'
           AND va.listing_id = $1::uuid
         UNION ALL
         SELECT 'admin:' || aa.id::text AS id,
                aa.created_at::text AS at,
                'admin'::text AS kind,
                aa.action::text AS label,
                aa.reason AS detail,
                aa.admin_user_id::text AS actor_id
         FROM admin_actions aa
         JOIN leads ld ON ld.id = aa.target_id
         WHERE aa.target_type = 'lead'
           AND ld.listing_id = $1::uuid
         UNION ALL
         SELECT 'lead:' || ld.id::text AS id,
                ld.created_at::text AS at,
                'lead'::text AS kind,
                'Lead created'::text AS label,
                ld.status::text AS detail,
                ld.tenant_user_id::text AS actor_id
         FROM leads ld
         WHERE ld.listing_id = $1::uuid
         UNION ALL
         SELECT 'lead-event:' || le.id::text AS id,
                le.created_at::text AS at,
                'lead'::text AS kind,
                ('Lead status ' || le.to_status::text) AS label,
                le.notes AS detail,
                le.actor_user_id::text AS actor_id
         FROM lead_events le
         JOIN leads ld ON ld.id = le.lead_id
         WHERE ld.listing_id = $1::uuid
       ) activity
       ORDER BY at DESC, id DESC
       LIMIT 100`,
      [listingId]
    );
    return result.rows;
  }

  private getHomeInMemory(listingId: string): AdminHomeDetail {
    const listing = this.appState.listings.get(listingId);
    if (
      !listing ||
      listing.listingType !== "flat_house" ||
      listing.verificationStatus !== "verified" ||
      !eligibleStatuses.has(listing.status)
    ) {
      this.throwHomeNotFound();
    }

    const owner = this.appState.users.get(listing.ownerUserId);
    const listingExtra = listing as unknown as Record<string, unknown>;
    const now = Date.now();
    const cutoff = now - 30 * 86_400_000;
    const allLeads = [...this.appState.leads.values()].filter(
      (lead) => lead.listingId === listing.id
    );
    const recentLeadRecords = allLeads.filter((lead) => lead.createdAt >= cutoff);
    const openLeadRecords = allLeads.filter((lead) => this.isOpenLead(lead));
    const ownerLeads = [...this.appState.leads.values()].filter(
      (lead) => lead.ownerUserId === listing.ownerUserId
    );
    const ownerRecentLeads = ownerLeads.filter((lead) => lead.createdAt >= cutoff);
    const attempts = this.appState.verificationAttempts
      .filter((attempt) => attempt.listing_id === listing.id)
      .map((attempt) => this.mapInMemoryVerificationAttempt(attempt))
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
    const attemptIds = new Set(attempts.map((attempt) => attempt.attempt_id));
    const leadIds = new Set(allLeads.map((lead) => lead.id));
    const ownerPortfolio = [...this.appState.listings.values()].filter(
      (home) =>
        home.ownerUserId === listing.ownerUserId &&
        home.listingType === "flat_house" &&
        eligibleStatuses.has(home.status)
    );
    const activity = [
      {
        id: `listing:${listing.id}:created`,
        at: new Date(listing.createdAt).toISOString(),
        kind: "listing" as const,
        label: "Listing created",
        detail: null,
        actor_id: listing.ownerUserId
      },
      {
        id: `listing:${listing.id}:updated`,
        at: new Date(this.inMemoryUpdatedAt(listing)).toISOString(),
        kind: "listing" as const,
        label: "Listing updated",
        detail: null,
        actor_id: listing.ownerUserId
      },
      ...attempts.map((attempt) => ({
        id: `verification:${attempt.attempt_id}`,
        at: attempt.created_at,
        kind: "verification" as const,
        label: `Verification ${attempt.result}`,
        detail: attempt.review_reason,
        actor_id: null
      })),
      ...this.appState.adminActions
        .filter(
          (action) =>
            (action.target_type === "listing" && action.target_id === listing.id) ||
            (action.target_type === "verification_attempt" &&
              typeof action.target_id === "string" &&
              attemptIds.has(action.target_id)) ||
            (action.target_type === "lead" &&
              typeof action.target_id === "string" &&
              leadIds.has(action.target_id))
        )
        .map((action) => ({
          id: `admin:${String(action.id)}`,
          at: this.inMemoryTimestamp(action.created_at),
          kind: "admin" as const,
          label: String(action.action ?? "Admin action"),
          detail: this.inMemoryString(action.reason),
          actor_id: this.inMemoryString(action.admin_user_id ?? action.admin_id)
        })),
      ...allLeads.map((lead) => ({
        id: `lead:${lead.id}`,
        at: new Date(lead.createdAt).toISOString(),
        kind: "lead" as const,
        label: "Lead created",
        detail: lead.status,
        actor_id: lead.tenantUserId
      }))
    ]
      .sort((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id))
      .slice(0, 100);

    return {
      listing: {
        id: listing.id,
        title_en: listing.title,
        title_hi: this.inMemoryString(listingExtra.titleHi),
        description_en: this.inMemoryString(listingExtra.description),
        description_hi: this.inMemoryString(listingExtra.descriptionHi),
        status: listing.status as AdminHomeDetail["listing"]["status"],
        verification_status: "verified",
        monthly_rent: listing.monthlyRent,
        security_deposit: nullableNumber(listingExtra.securityDeposit as number),
        available_from: this.inMemoryString(listingExtra.availableFrom),
        furnishing: listing.furnishing ?? null,
        bhk: nullableNumber(listingExtra.bhk as number),
        bathrooms: nullableNumber(listingExtra.bathrooms as number),
        area_sqft: nullableNumber(listingExtra.areaSqft as number),
        preferred_tenant: this.inMemoryString(listingExtra.preferredTenant),
        whatsapp_available: Boolean(listingExtra.whatsappAvailable),
        amenities: listing.amenities ?? [],
        rules: this.recordValue(listingExtra.rules),
        created_at: new Date(listing.createdAt).toISOString(),
        updated_at: new Date(this.inMemoryUpdatedAt(listing)).toISOString(),
        last_owner_activity_at: null
      },
      location:
        listing.city || listing.locality
          ? {
              address_line1: null,
              landmark: null,
              pincode: null,
              lat: null,
              lng: null,
              masked_address: null,
              locality_name: listing.locality ?? null,
              city_slug: listing.city || null,
              city_name: listing.city || null
            }
          : null,
      photos: [],
      owner: {
        id: listing.ownerUserId,
        name: owner?.full_name ?? null,
        phone: owner?.phone ?? null,
        whatsapp_opt_in: Boolean(owner?.whatsapp_opt_in),
        preferred_language: owner?.preferred_language ?? null,
        role: owner?.role ?? "owner",
        is_blocked: Boolean((owner as Record<string, unknown> | undefined)?.is_blocked),
        member_since: null,
        last_login_at: null,
        active_homes: ownerPortfolio.filter((home) => home.status === "active").length,
        paused_homes: ownerPortfolio.filter((home) => home.status === "paused").length,
        archived_homes: ownerPortfolio.filter((home) => home.status === "archived").length,
        report_count: 0,
        lead_health: {
          health_score: null,
          health_grade: null,
          leads_30d: ownerRecentLeads.length,
          called_rate_30d: this.ratio(
            ownerRecentLeads.filter((lead) => lead.calledAt != null).length,
            ownerRecentLeads.length
          ),
          refund_rate_30d: this.ratio(
            ownerRecentLeads.filter((lead) => this.isRefundedInMemory(lead)).length,
            ownerRecentLeads.filter((lead) => Boolean(lead.contactUnlockId)).length
          ),
          median_response_minutes_30d: this.medianResponseMinutes(ownerRecentLeads)
        }
      },
      metrics_30d: {
        views: 0,
        leads: recentLeadRecords.length,
        open_leads: openLeadRecords.length,
        conversion_rate: 0
      },
      lead_summary: this.inMemoryLeadSummary(recentLeadRecords, openLeadRecords),
      recent_leads: [...allLeads]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, 10)
        .map((lead) => this.mapInMemoryRecentLead(lead)),
      verification_status: "verified",
      verified_at: attempts.find((attempt) => attempt.result === "pass")?.created_at ?? null,
      verification_attempts: attempts,
      activity,
      public_path: `/en/listing/${listing.id}`
    };
  }

  private mapLeadSummary(row: LeadSummarySqlRow): AdminHomeDetail["lead_summary"] {
    return {
      by_status: {
        new: numberValue(row.new_count),
        contacted: numberValue(row.contacted_count),
        visit_scheduled: numberValue(row.visit_scheduled_count),
        deal_done: numberValue(row.deal_done_count),
        lost: numberValue(row.lost_count)
      },
      by_access_state: {
        free: numberValue(row.free_count),
        locked: numberValue(row.locked_count),
        unlocked: numberValue(row.unlocked_count),
        expired: numberValue(row.expired_count)
      },
      called: numberValue(row.called),
      uncalled: numberValue(row.uncalled),
      refunded: numberValue(row.refunded),
      open: numberValue(row.open),
      median_response_minutes: nullableNumber(row.median_response_minutes)
    };
  }

  private inMemoryLeadSummary(
    recentLeads: Array<{
      status: "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";
      accessState: "free" | "locked" | "unlocked" | "expired";
      calledAt?: number | null;
      createdAt: number;
      contactUnlockId?: string;
    }>,
    openLeads: Array<{
      calledAt?: number | null;
    }>
  ): AdminHomeDetail["lead_summary"] {
    return {
      by_status: {
        new: recentLeads.filter((lead) => lead.status === "new").length,
        contacted: recentLeads.filter((lead) => lead.status === "contacted").length,
        visit_scheduled: recentLeads.filter((lead) => lead.status === "visit_scheduled").length,
        deal_done: recentLeads.filter((lead) => lead.status === "deal_done").length,
        lost: recentLeads.filter((lead) => lead.status === "lost").length
      },
      by_access_state: {
        free: recentLeads.filter((lead) => lead.accessState === "free").length,
        locked: recentLeads.filter((lead) => lead.accessState === "locked").length,
        unlocked: recentLeads.filter((lead) => lead.accessState === "unlocked").length,
        expired: recentLeads.filter((lead) => lead.accessState === "expired").length
      },
      called: recentLeads.filter((lead) => lead.calledAt != null).length,
      uncalled: openLeads.filter((lead) => lead.calledAt == null).length,
      refunded: recentLeads.filter((lead) => this.isRefundedInMemory(lead)).length,
      open: openLeads.length,
      median_response_minutes: this.medianResponseMinutes(recentLeads)
    };
  }

  private mapRecentLead(row: RecentLeadSqlRow): AdminHomeRecentLead {
    return {
      lead_id: row.lead_id,
      seeker_name: row.seeker_name ?? "Seeker",
      access_state: row.access_state,
      status: row.status,
      called_at: row.called_at,
      called_by: row.called_by,
      response_deadline_at: row.response_deadline_at,
      refund_state: row.refund_state,
      created_at: row.created_at
    };
  }

  private mapInMemoryRecentLead(lead: {
    id: string;
    tenantUserId: string;
    accessState: "free" | "locked" | "unlocked" | "expired";
    status: "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";
    calledAt?: number | null;
    calledBy?: "owner" | "team" | null;
    callDeadlineAt?: number | null;
    contactUnlockId?: string;
    createdAt: number;
  }): AdminHomeRecentLead {
    const unlock = lead.contactUnlockId
      ? this.appState.unlocks.get(lead.contactUnlockId)
      : undefined;
    const seeker = this.appState.users.get(lead.tenantUserId);
    return {
      lead_id: lead.id,
      seeker_name: seeker?.full_name ?? "Seeker",
      access_state: lead.accessState,
      status: lead.status,
      called_at: lead.calledAt ? new Date(lead.calledAt).toISOString() : null,
      called_by: lead.calledBy ?? null,
      response_deadline_at: lead.callDeadlineAt
        ? new Date(lead.callDeadlineAt).toISOString()
        : unlock?.responseDeadlineAt
          ? new Date(unlock.responseDeadlineAt).toISOString()
          : null,
      refund_state:
        unlock?.unlockStatus === "refunded"
          ? "refunded"
          : unlock?.ownerResponseStatus === "responded"
            ? "responded"
            : "pending",
      created_at: new Date(lead.createdAt).toISOString()
    };
  }

  private mapVerificationAttempt(attempt: VerificationAttemptSqlRow): AdminHomeVerificationAttempt {
    return {
      attempt_id: attempt.attempt_id,
      kind: attempt.kind,
      result: attempt.result,
      liveness_score: nullableNumber(attempt.liveness_score),
      address_match_score: nullableNumber(attempt.address_match_score),
      threshold: numberValue(attempt.threshold),
      provider: attempt.provider,
      provider_result_code: attempt.provider_result_code,
      review_reason: attempt.review_reason,
      artifact_available: Boolean(attempt.artifact_available),
      reviewed_by: attempt.reviewed_by,
      reviewed_at: attempt.reviewed_at,
      created_at: attempt.created_at
    };
  }

  private mapInMemoryVerificationAttempt(
    attempt: Record<string, unknown>
  ): AdminHomeVerificationAttempt {
    return {
      attempt_id: String(attempt.id),
      kind: (attempt.verification_type ?? "video_liveness") as AdminHomeVerificationAttempt["kind"],
      result: (attempt.result ?? "pending") as AdminHomeVerificationAttempt["result"],
      liveness_score: nullableNumber(attempt.liveness_score as number | string | null),
      address_match_score: nullableNumber(attempt.address_match_score as number | string | null),
      threshold: numberValue(attempt.threshold as number | string | null),
      provider: this.inMemoryString(attempt.provider),
      provider_result_code: this.inMemoryString(attempt.provider_result_code),
      review_reason: this.inMemoryString(attempt.review_reason ?? attempt.failure_reason),
      artifact_available:
        Array.isArray(attempt.artifact_paths) && attempt.artifact_paths.length > 0,
      reviewed_by: this.inMemoryString(attempt.reviewed_by),
      reviewed_at: this.inMemoryString(attempt.reviewed_at),
      created_at: this.inMemoryTimestamp(attempt.created_at)
    };
  }

  private mapActivity(item: ActivitySqlRow): AdminHomeActivityItem {
    return {
      id: item.id,
      at: item.at,
      kind: item.kind,
      label: item.label,
      detail: item.detail,
      actor_id: item.actor_id
    };
  }

  private isOpenLead(lead: { status: string; accessState: string }): boolean {
    return openStatuses.has(lead.status) && lead.accessState !== "expired";
  }

  private isRefundedInMemory(lead: { contactUnlockId?: string }): boolean {
    return Boolean(
      lead.contactUnlockId &&
      this.appState.unlocks.get(lead.contactUnlockId)?.unlockStatus === "refunded"
    );
  }

  private medianResponseMinutes(
    leads: Array<{ createdAt: number; calledAt?: number | null }>
  ): number | null {
    const minutes = leads
      .filter((lead): lead is { createdAt: number; calledAt: number } => lead.calledAt != null)
      .map((lead) => (lead.calledAt - lead.createdAt) / 60_000)
      .sort((left, right) => left - right);
    if (minutes.length === 0) return null;
    const middle = Math.floor(minutes.length / 2);
    return minutes.length % 2 === 0 ? (minutes[middle - 1] + minutes[middle]) / 2 : minutes[middle];
  }

  private daysSince(value: string | null): number | null {
    return value ? Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000) : null;
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private inMemoryString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
  }

  private inMemoryTimestamp(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return new Date(value).toISOString();
    return new Date(0).toISOString();
  }

  private throwHomeNotFound(): never {
    throw new NotFoundException({
      code: "home_not_found",
      message: "Verified home not found"
    });
  }

  private baseCte(
    params: AdminHomesListParams,
    options: { includeStatus: boolean; includeCity: boolean; includeSearch: boolean }
  ): BaseCte {
    const values: unknown[] = [];
    const where = [
      "l.listing_type = 'flat_house'",
      "l.verification_status = 'verified'",
      "l.status IN ('active', 'paused', 'archived')"
    ];

    if (options.includeStatus && params.status !== "all") {
      where.push(`l.status = '${statusSql[params.status]}'`);
    }
    if (options.includeCity && params.city) {
      values.push(params.city);
      where.push(`c.slug = $${values.length}`);
    }
    if (options.includeSearch && params.q) {
      values.push(`%${params.q}%`);
      const index = values.length;
      where.push(`(
        l.title_en ILIKE $${index}
        OR l.title_hi ILIKE $${index}
        OR l.id::text ILIKE $${index}
        OR u.full_name ILIKE $${index}
        OR u.phone_e164 ILIKE $${index}
        OR ll.address_line1 ILIKE $${index}
        OR c.slug ILIKE $${index}
        OR c.name_en ILIKE $${index}
        OR loc.slug ILIKE $${index}
        OR loc.name_en ILIKE $${index}
      )`);
    }

    return {
      sql: `WITH base AS (
        SELECT l.id, l.title_en, l.title_hi, l.monthly_rent, l.status, l.updated_at,
               l.owner_user_id, ll.address_line1, c.slug AS city_slug, c.name_en AS city_name,
               loc.name_en AS locality_name, u.full_name AS owner_name, u.phone_e164 AS owner_phone
        FROM listings l
        JOIN users u ON u.id = l.owner_user_id
        LEFT JOIN listing_locations ll ON ll.listing_id = l.id
        LEFT JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        WHERE ${where.join("\n          AND ")}
      )`,
      values
    };
  }

  private selectedStatusClause(status: AdminHomeStatusFilter, column: string): string {
    if (status === "all") return "";
    return `WHERE ${column} = '${statusSql[status]}'`;
  }

  private orderBy(sort: AdminHomeSort): string {
    const fallback = "b.updated_at DESC, b.id DESC";
    switch (sort) {
      case "views":
        return `COALESCE(event_agg.views_30d, 0) DESC, ${fallback}`;
      case "conversion":
        return `CASE
                  WHEN COALESCE(event_agg.views_30d, 0) = 0 THEN 0
                  ELSE COALESCE(lead_agg.leads_30d, 0)::numeric / event_agg.views_30d::numeric
                END DESC, ${fallback}`;
      case "updated":
        return fallback;
      case "rent_desc":
        return `b.monthly_rent DESC, ${fallback}`;
      case "rent_asc":
        return `b.monthly_rent ASC, ${fallback}`;
      case "leads":
      default:
        return `COALESCE(lead_agg.leads_30d, 0) DESC, ${fallback}`;
    }
  }

  private mapSqlRow(row: HomeSqlRow): AdminHomeListItem {
    return {
      id: row.id,
      title: row.title,
      city_slug: row.city_slug,
      city_name: row.city_name,
      locality_name: row.locality_name,
      monthly_rent: numberValue(row.monthly_rent),
      owner_id: row.owner_id,
      owner_name: row.owner_name,
      owner_phone_masked: this.maskPhone(row.owner_phone),
      status: row.status,
      cover_photo_url: toBlobUrl(row.cover_photo_path),
      views_30d: numberValue(row.views_30d),
      leads_30d: numberValue(row.leads_30d),
      open_leads: numberValue(row.open_leads),
      conversion_rate: numberValue(row.conversion_rate),
      updated_at: row.updated_at,
      public_path: `/en/listing/${row.id}`
    };
  }

  private listHomesInMemory(params: AdminHomesListParams): AdminHomesListResponse {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    const rows = [...this.appState.listings.values()]
      .filter(
        (listing) =>
          listing.listingType === "flat_house" &&
          listing.verificationStatus === "verified" &&
          eligibleStatuses.has(listing.status)
      )
      .map((listing) => {
        const owner = this.appState.users.get(listing.ownerUserId);
        const listingLeads = [...this.appState.leads.values()].filter(
          (lead) => lead.listingId === listing.id
        );
        const views_30d = 0;
        const leads_30d = listingLeads.filter((lead) => lead.createdAt >= cutoff).length;
        const openLeads = listingLeads.filter(
          (lead) =>
            ["new", "contacted", "visit_scheduled"].includes(lead.status) &&
            lead.accessState !== "expired"
        );
        const open_leads = openLeads.length;
        const uncalled_open_leads = openLeads.filter((lead) => lead.calledAt == null).length;
        const updatedAt = this.inMemoryUpdatedAt(listing);

        return {
          id: listing.id,
          title: listing.title,
          city_slug: listing.city || null,
          city_name: listing.city || null,
          locality_name: listing.locality ?? null,
          monthly_rent: listing.monthlyRent,
          owner_id: listing.ownerUserId,
          owner_name: owner?.full_name ?? null,
          owner_phone_masked: this.maskPhone(owner?.phone),
          status: listing.status as AdminHomeListItem["status"],
          cover_photo_url: null,
          views_30d,
          leads_30d,
          open_leads,
          uncalled_open_leads,
          conversion_rate: this.ratio(leads_30d, views_30d),
          updated_at: new Date(updatedAt).toISOString(),
          public_path: `/en/listing/${listing.id}`,
          search: [
            listing.title,
            listing.id,
            owner?.full_name,
            owner?.phone,
            listing.locality,
            listing.city
          ]
            .filter((value): value is string => Boolean(value))
            .join(" ")
            .toLowerCase()
        };
      });

    const matchesSearch = (row: (typeof rows)[number]) =>
      !params.q || row.search.includes(params.q.toLowerCase());
    const matchesCity = (row: (typeof rows)[number]) =>
      !params.city || row.city_slug === params.city;
    const matchesStatus = (row: (typeof rows)[number]) =>
      params.status === "all" || row.status === params.status;

    const summaryRows = rows.filter((row) => matchesCity(row) && matchesSearch(row));
    const filteredRows = summaryRows.filter(matchesStatus);
    const availableCityRows = rows.filter((row) => matchesStatus(row) && matchesSearch(row));
    const sortedRows = [...filteredRows].sort((left, right) =>
      this.compareRows(left, right, params.sort)
    );
    const offset = (params.page - 1) * params.page_size;

    const availableCities = new Map<string, { slug: string; name: string; count: number }>();
    for (const row of availableCityRows) {
      if (!row.city_slug) continue;
      const existing = availableCities.get(row.city_slug);
      if (existing) existing.count += 1;
      else {
        availableCities.set(row.city_slug, {
          slug: row.city_slug,
          name: row.city_name ?? row.city_slug,
          count: 1
        });
      }
    }

    return {
      items: sortedRows
        .slice(offset, offset + params.page_size)
        .map(({ search: _search, uncalled_open_leads: _uncalledOpenLeads, ...row }) => row),
      total: filteredRows.length,
      page: params.page,
      page_size: params.page_size,
      filters: {
        status: params.status,
        city: params.city ?? null,
        q: params.q ?? null,
        sort: params.sort
      },
      available_cities: [...availableCities.values()].sort(
        (left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug)
      ),
      summary: {
        active_homes: summaryRows.filter((row) => row.status === "active").length,
        views_30d: filteredRows.reduce((total, row) => total + row.views_30d, 0),
        leads_30d: filteredRows.reduce((total, row) => total + row.leads_30d, 0),
        needs_attention: filteredRows.filter((row) => row.uncalled_open_leads > 0).length
      }
    };
  }

  private compareRows(
    left: AdminHomeListItem & { search: string },
    right: AdminHomeListItem & { search: string },
    sort: AdminHomeSort
  ): number {
    const fallback =
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime() ||
      right.id.localeCompare(left.id);
    switch (sort) {
      case "views":
        return right.views_30d - left.views_30d || fallback;
      case "conversion":
        return right.conversion_rate - left.conversion_rate || fallback;
      case "updated":
        return fallback;
      case "rent_desc":
        return right.monthly_rent - left.monthly_rent || fallback;
      case "rent_asc":
        return left.monthly_rent - right.monthly_rent || fallback;
      case "leads":
      default:
        return right.leads_30d - left.leads_30d || fallback;
    }
  }

  private inMemoryUpdatedAt(listing: { createdAt: number }): number {
    const updatedAt = (listing as { updatedAt?: number }).updatedAt;
    return typeof updatedAt === "number" ? updatedAt : listing.createdAt;
  }

  private maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    if (phone.length <= 4) return "X".repeat(phone.length);
    return `${"X".repeat(phone.length - 4)}${phone.slice(-4)}`;
  }

  private ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10_000) / 10_000;
  }
}
