import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { computeOwnerHealth } from "../admin/owner-health.calculator";
import { refundUnlock } from "../contacts/refund-unlock";
import { NotificationService } from "../notifications/notification.service";
import type {
  AdminLeadAnalytics,
  AdminLeadBoardFilter,
  AdminLeadBoardResponse,
  AdminLeadBoardRow,
  AdminLeadCounters,
  AdminLeadEngagementFunnel,
  AdminLeadFunnel,
  AdminLeadOwnerDetail,
  AdminLeadOwnerFunnel,
  AdminLeadOwnerRollupRow,
  AdminLeadRates,
  AdminLeadTimelineEvent,
  AdminLeadTimelineResponse,
  AdminLeadTrendPoint
} from "@cribliv/shared-types";

export interface BoardParams {
  filter?: AdminLeadBoardFilter;
  ownerId?: string;
  state?: string;
  status?: string;
  q?: string;
  range?: string; // interval string for the 'all' filter, e.g. '30 days'
  page?: number;
  pageSize?: number;
}

interface BoardSqlRow {
  lead_id: string;
  listing_id: string;
  listing_title: string;
  city: string | null;
  owner_user_id: string;
  owner_name: string;
  owner_phone: string;
  owner_role: "owner" | "pg_operator";
  seeker_user_id: string;
  seeker_name: string;
  seeker_phone: string;
  access_state: AdminLeadBoardRow["access_state"];
  status: AdminLeadBoardRow["status"];
  called_at: string | null;
  called_by: AdminLeadBoardRow["called_by"];
  response_deadline_at: string | null;
  seconds_remaining: number | null;
  owner_response_status: string | null;
  unlock_status: string | null;
  source: string | null;
  created_at: string;
}

/** Row shape of the per-owner health CTE in {@link AdminLeadOpsService.ownerHealthByIds} — mirrors the inputs `computeOwnerHealth` expects. */
interface OwnerHealthCteRow {
  owner_user_id: string;
  listings_active: number;
  listings_paused: number;
  avg_response_minutes: number | null;
  unlocks_60d: number;
  deals_done_60d: number;
  days_since_last_login: number | null;
  report_count: number;
}

/** Row shape of the analytics `rates` query — `median_response_minutes` is nullable when no lead was ever called in range. */
interface RatesSqlRow {
  median_response_minutes: number | string | null;
  called_within_24h_rate: number | string;
  team_rescue_rate: number | string;
  dispute_rate: number | string;
}

/** Row shape of the analytics per-owner rollup query (before the refund-rate + health merge). */
interface OwnerRollupSqlRow {
  owner_user_id: string;
  name: string;
  role: "owner" | "pg_operator";
  leads: number;
  called: number;
  median_response_minutes: number | string | null;
}

/** Row shape of the per-owner refunded-unlocks companion query. */
interface OwnerRefundSqlRow {
  owner_user_id: string;
  unlocks: number;
  refunded: number;
}

/** Row shape of the owner header lookup in {@link AdminLeadOpsService.getOwnerDetail}. */
interface OwnerHeaderSqlRow {
  full_name: string | null;
  phone_e164: string | null;
  role: "owner" | "pg_operator";
}

/** Row shape of the per-owner status-count funnel query (same grouping as LeadsService.getLeadStats). */
interface OwnerFunnelSqlRow {
  status: string;
  count: number | string;
}

/** Row shape of getOwnerDetail's single-owner refund-rate companion query (same join as OwnerRefundSqlRow, pre-filtered to one owner so no owner_user_id column is selected). */
interface OwnerRefundTotalsSqlRow {
  unlocks: number | string;
  refunded: number | string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ANALYTICS_RANGES = ["7 days", "30 days", "90 days"];

const EMPTY_COUNTERS: AdminLeadCounters = {
  in_flight: 0,
  uncalled: 0,
  expiring_6h: 0,
  expired_today: 0,
  refunded_today: 0
};

const EMPTY_FUNNEL: AdminLeadFunnel = {
  callbacks_requested: 0,
  leads_created: 0,
  leads_unlocked: 0,
  leads_called: 0,
  deals_done: 0,
  leads_refunded: 0,
  leads_disputed: 0
};

const EMPTY_ENGAGEMENT: AdminLeadEngagementFunnel = {
  searches: 0,
  listing_views: 0,
  signups: 0,
  callbacks_requested: 0,
  calls_made: 0
};

const EMPTY_RATES: AdminLeadRates = {
  median_response_minutes: null,
  called_within_24h_rate: 0,
  team_rescue_rate: 0,
  refund_rate: 0,
  dispute_rate: 0
};

const EMPTY_OWNER_FUNNEL: AdminLeadOwnerFunnel = {
  new: 0,
  contacted: 0,
  visit_scheduled: 0,
  deal_done: 0,
  lost: 0,
  total: 0
};

function maskPhone(phone: string | null): string {
  if (!phone || phone.length < 4) return "XXXX";
  return phone.slice(0, -4).replace(/./g, "X") + phone.slice(-4);
}

function refundState(
  ownerResponseStatus: string | null,
  unlockStatus: string | null
): AdminLeadBoardRow["refund_state"] {
  if (unlockStatus === "refunded") return "refunded";
  if (ownerResponseStatus === "responded") return "responded";
  return "pending";
}

@Injectable()
export class AdminLeadOpsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NotificationService) private readonly notifications: NotificationService
  ) {}

  private ensureEnabled() {
    if (!readFeatureFlags().ff_admin_lead_center) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Lead Center is not enabled"
      });
    }
  }

  /** Builds the filter WHERE fragment + pushes any params it needs. */
  private filterClause(filter: AdminLeadBoardFilter, params: unknown[], range: string): string {
    switch (filter) {
      case "expiring_6h":
        return `ld.called_at IS NULL AND ld.access_state <> 'expired'
                AND ld.call_deadline_at > now() AND ld.call_deadline_at <= now() + interval '6 hours'`;
      case "called":
        return `ld.called_at IS NOT NULL`;
      case "expired_today":
        return `ld.access_state = 'expired' AND ld.updated_at >= date_trunc('day', now())`;
      case "refunded_today":
        return `cu.unlock_status = 'refunded' AND cu.updated_at >= date_trunc('day', now())`;
      case "all":
        params.push(range);
        return `ld.created_at >= now() - ($${params.length})::interval`;
      case "needs_call":
      default:
        return `ld.called_at IS NULL AND ld.access_state <> 'expired'`;
    }
  }

  async getBoard(p: BoardParams): Promise<AdminLeadBoardResponse> {
    this.ensureEnabled();
    const generatedAt = new Date().toISOString();
    if (!this.database.isEnabled()) {
      return { rows: [], total: 0, generated_at: generatedAt, counters: { ...EMPTY_COUNTERS } };
    }

    const filter = p.filter ?? "needs_call";
    const range = ["7 days", "30 days", "90 days"].includes(p.range ?? "")
      ? (p.range as string)
      : "30 days";
    const page = Number.isFinite(p.page) ? Math.max(1, Math.floor(p.page as number)) : 1;
    const pageSize = Number.isFinite(p.pageSize)
      ? Math.min(100, Math.max(1, Math.floor(p.pageSize as number)))
      : 50;
    const params: unknown[] = [];
    const where: string[] = [this.filterClause(filter, params, range)];

    if (p.ownerId && UUID_RE.test(p.ownerId)) {
      params.push(p.ownerId);
      where.push(`ld.owner_user_id = $${params.length}::uuid`);
    }
    if (p.state) {
      params.push(p.state);
      where.push(`ld.access_state = $${params.length}`);
    }
    if (
      p.status &&
      ["new", "contacted", "visit_scheduled", "deal_done", "lost"].includes(p.status)
    ) {
      params.push(p.status);
      where.push(`ld.status = $${params.length}::lead_status`);
    }
    if (p.q) {
      params.push(`%${p.q}%`);
      const i = params.length;
      where.push(
        `(o.full_name ILIKE $${i} OR t.full_name ILIKE $${i} OR o.phone_e164 ILIKE $${i}
          OR t.phone_e164 ILIKE $${i} OR l.title_en ILIKE $${i})`
      );
    }
    const whereSql = where.join(" AND ");

    // Page of rows.
    params.push(pageSize);
    const limitIdx = params.length;
    params.push((page - 1) * pageSize);
    const offsetIdx = params.length;
    const rowsResult = await this.database.query<BoardSqlRow>(
      `SELECT ld.id::text AS lead_id, ld.listing_id::text,
              COALESCE(NULLIF(l.title_en,''), NULLIF(l.title_hi,''), 'Listing') AS listing_title,
              l.city_slug AS city,
              ld.owner_user_id::text, COALESCE(o.full_name,'Owner') AS owner_name,
              o.phone_e164 AS owner_phone, o.role::text AS owner_role,
              ld.tenant_user_id::text AS seeker_user_id,
              COALESCE(t.full_name,'Seeker') AS seeker_name, t.phone_e164 AS seeker_phone,
              ld.access_state, ld.status::text AS status,
              ld.called_at::text, ld.called_by,
              ld.call_deadline_at::text AS response_deadline_at,
              GREATEST(0, EXTRACT(EPOCH FROM (ld.call_deadline_at - now())))::int AS seconds_remaining,
              cu.owner_response_status, cu.unlock_status, cu.source, ld.created_at::text
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       JOIN users o ON o.id = ld.owner_user_id
       JOIN users t ON t.id = ld.tenant_user_id
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
       WHERE ${whereSql}
       ORDER BY (ld.call_deadline_at IS NULL), ld.call_deadline_at ASC, ld.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    // Total for the same filter (drop the LIMIT/OFFSET params).
    const countParams = params.slice(0, limitIdx - 1);
    const countResult = await this.database.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       JOIN users o ON o.id = ld.owner_user_id
       JOIN users t ON t.id = ld.tenant_user_id
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
       WHERE ${whereSql}`,
      countParams
    );

    const counters = await this.getCounters();

    const rows: AdminLeadBoardRow[] = rowsResult.rows.map((r) => ({
      lead_id: r.lead_id,
      listing_id: r.listing_id,
      listing_title: r.listing_title,
      city: r.city,
      owner: {
        user_id: r.owner_user_id,
        name: r.owner_name,
        phone_masked: maskPhone(r.owner_phone),
        role: r.owner_role,
        health_score: null,
        health_grade: null
      },
      seeker: { user_id: r.seeker_user_id, name: r.seeker_name, phone_e164: r.seeker_phone },
      access_state: r.access_state,
      status: r.status,
      called_at: r.called_at,
      called_by: r.called_by,
      response_deadline_at: r.response_deadline_at,
      seconds_remaining: r.seconds_remaining,
      refund_state: refundState(r.owner_response_status, r.unlock_status),
      source: r.source,
      created_at: r.created_at
    }));

    // Fill in each row's owner health score/grade from the analytics slice's
    // pure calculator, scoped to just the owners on this page.
    const ownerHealth = await this.ownerHealthByIds([...new Set(rows.map((r) => r.owner.user_id))]);
    rows.forEach((r) => {
      const h = ownerHealth.get(r.owner.user_id);
      r.owner.health_score = h?.score ?? null;
      r.owner.health_grade = h?.grade ?? null;
    });

    return { rows, total: countResult.rows[0]?.n ?? 0, generated_at: generatedAt, counters };
  }

  /**
   * Owner health score/grade for a bounded set of owner ids. Reuses the same
   * per-owner input CTE and pure calculator as
   * AdminOwnerHealthService.listOwners (apps/api/src/modules/admin/admin-owner-health.service.ts),
   * but scoped to just the requested owners — this runs once per board page
   * (a handful of owners), not once per admin session over the whole owners
   * table, so every aggregate sub-query is also filtered by the id array
   * rather than grouping over all listings/contact_unlocks/leads first and
   * discarding the rest at the join.
   */
  async ownerHealthByIds(
    ids: string[]
  ): Promise<Map<string, { score: number; grade: "A" | "B" | "C" | "D" | "F" }>> {
    const out = new Map<string, { score: number; grade: "A" | "B" | "C" | "D" | "F" }>();
    if (!ids.length || !this.database.isEnabled()) return out;

    const result = await this.database.query<OwnerHealthCteRow>(
      `WITH owners AS (
         SELECT u.id, u.last_login_at
         FROM users u
         WHERE u.id = ANY($1::uuid[]) AND u.role IN ('owner', 'pg_operator')
       ),
       listing_agg AS (
         SELECT owner_user_id,
                count(*) FILTER (WHERE status = 'active')::int AS listings_active,
                count(*) FILTER (WHERE status = 'paused')::int AS listings_paused,
                COALESCE(sum(report_count)::int, 0) AS report_count
         FROM listings
         WHERE owner_user_id = ANY($1::uuid[])
         GROUP BY owner_user_id
       ),
       unlock_agg AS (
         SELECT l.owner_user_id,
                count(cu.id)::int AS unlocks_60d,
                AVG(EXTRACT(EPOCH FROM (cu.owner_responded_at - cu.created_at)) / 60.0)
                  FILTER (WHERE cu.owner_responded_at IS NOT NULL) AS avg_response_minutes
         FROM contact_unlocks cu
         JOIN listings l ON l.id = cu.listing_id
         WHERE cu.created_at >= now() - interval '60 days'
           AND l.owner_user_id = ANY($1::uuid[])
         GROUP BY l.owner_user_id
       ),
       deal_agg AS (
         SELECT owner_user_id,
                count(*) FILTER (WHERE status = 'deal_done')::int AS deals_done_60d
         FROM leads
         WHERE created_at >= now() - interval '60 days'
           AND owner_user_id = ANY($1::uuid[])
         GROUP BY owner_user_id
       )
       SELECT o.id::text AS owner_user_id,
              COALESCE(la.listings_active, 0) AS listings_active,
              COALESCE(la.listings_paused, 0) AS listings_paused,
              ua.avg_response_minutes,
              COALESCE(ua.unlocks_60d, 0) AS unlocks_60d,
              COALESCE(da.deals_done_60d, 0) AS deals_done_60d,
              CASE WHEN o.last_login_at IS NULL THEN NULL
                   ELSE EXTRACT(DAY FROM now() - o.last_login_at)::int
              END AS days_since_last_login,
              COALESCE(la.report_count, 0) AS report_count
       FROM owners o
       LEFT JOIN listing_agg la ON la.owner_user_id = o.id
       LEFT JOIN unlock_agg ua ON ua.owner_user_id = o.id
       LEFT JOIN deal_agg da ON da.owner_user_id = o.id`,
      [ids]
    );

    for (const r of result.rows) {
      const h = computeOwnerHealth({
        listings_active: Number(r.listings_active ?? 0),
        listings_paused: Number(r.listings_paused ?? 0),
        avg_response_minutes:
          r.avg_response_minutes === null ? null : Number(r.avg_response_minutes),
        unlocks_60d: Number(r.unlocks_60d ?? 0),
        deals_done_60d: Number(r.deals_done_60d ?? 0),
        days_since_last_login:
          r.days_since_last_login === null ? null : Number(r.days_since_last_login),
        report_count: Number(r.report_count ?? 0)
      });
      out.set(r.owner_user_id, { score: h.score, grade: h.grade });
    }
    return out;
  }

  private async getCounters(): Promise<AdminLeadCounters> {
    const result = await this.database.query<AdminLeadCounters>(
      `SELECT
         count(*) FILTER (WHERE ld.called_at IS NULL AND ld.access_state <> 'expired')::int AS in_flight,
         count(*) FILTER (WHERE ld.called_at IS NULL)::int AS uncalled,
         count(*) FILTER (WHERE ld.called_at IS NULL AND ld.access_state <> 'expired'
                            AND ld.call_deadline_at > now()
                            AND ld.call_deadline_at <= now() + interval '6 hours')::int AS expiring_6h,
         count(*) FILTER (WHERE ld.access_state = 'expired'
                            AND ld.updated_at >= date_trunc('day', now()))::int AS expired_today,
         count(*) FILTER (WHERE cu.unlock_status = 'refunded'
                            AND cu.updated_at >= date_trunc('day', now()))::int AS refunded_today
       FROM leads ld
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id`
    );
    return result.rows[0] ?? { ...EMPTY_COUNTERS };
  }

  async getTimeline(leadId: string): Promise<AdminLeadTimelineResponse> {
    this.ensureEnabled();
    if (!this.database.isEnabled()) {
      return { lead_id: leadId, events: [] };
    }
    const result = await this.database.query<AdminLeadTimelineEvent>(
      `SELECT at, source, kind, actor, detail FROM (
         SELECT le.created_at::text AS at, 'lead' AS source,
                COALESCE(NULLIF(le.notes,''), le.to_status::text) AS kind,
                le.actor_user_id::text AS actor, le.to_status::text AS detail
         FROM lead_events le WHERE le.lead_id = $1::uuid
         UNION ALL
         SELECT ce.event_ts::text, 'contact', ce.event_type::text,
                ce.actor_role::text, ce.metadata::text
         FROM contact_events ce
         JOIN leads ld ON ld.contact_unlock_id = ce.contact_unlock_id
         WHERE ld.id = $1::uuid
         UNION ALL
         SELECT aa.created_at::text, 'admin', aa.action::text,
                aa.admin_user_id::text, aa.reason
         FROM admin_actions aa
         WHERE aa.target_type = 'lead' AND aa.target_id = $1::uuid
       ) t
       ORDER BY at ASC`,
      [leadId]
    );
    return { lead_id: leadId, events: result.rows };
  }

  /**
   * Admin manual refund of a lead's linked contact unlock. Guards the unlock
   * to 'active' + 'pending' before delegating to the shared refundUnlock
   * routine (same routine the timeout sweep uses) — the 409 on an already-
   * responded owner is what makes refundUnlock's hardcoded
   * owner_response_status='timeout_refunded' correct here: this method never
   * lets refundUnlock run on a lead the owner actually answered.
   */
  async refundLead(
    leadId: string,
    adminUserId: string,
    reason: string
  ): Promise<{ lead_id: string; refunded: boolean; refund_txn_id: string | null }> {
    this.ensureEnabled();
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      // No FOR UPDATE on the lead here: the contact_unlock is locked below
      // (FOR UPDATE) before refundUnlock touches the lead, keeping the canonical
      // contact_unlocks→leads order. Locking the lead first would invert it and
      // can deadlock the timeout-refund sweep. contact_unlock_id is immutable.
      const leadRes = await client.query<{ id: string; contact_unlock_id: string | null }>(
        `SELECT id::text, contact_unlock_id::text FROM leads WHERE id = $1::uuid`,
        [leadId]
      );
      const lead = leadRes.rows[0];
      if (!lead) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      if (!lead.contact_unlock_id) {
        throw new ConflictException({
          code: "no_unlock",
          message: "Lead has no linked callback to refund"
        });
      }
      // Lock the unlock row and guard state before refunding.
      const cu = await client.query<{ owner_response_status: string; unlock_status: string }>(
        `SELECT owner_response_status, unlock_status FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`,
        [lead.contact_unlock_id]
      );
      const row = cu.rows[0];
      if (!row) throw new NotFoundException({ code: "not_found", message: "Callback not found" });
      if (row.unlock_status !== "active") {
        throw new ConflictException({
          code: "already_refunded",
          message: "Callback already resolved"
        });
      }
      if (row.owner_response_status !== "pending") {
        throw new ConflictException({
          code: "already_responded",
          message: "Owner already responded — not refundable"
        });
      }
      const result = await refundUnlock(client, lead.contact_unlock_id, {
        txnType: "refund_admin",
        actorRole: "admin",
        expireLockedLead: true,
        metadata: { reason, admin_user_id: adminUserId }
      });
      await client.query(
        `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, after_state)
         VALUES ($1::uuid, 'lead', $2::uuid, 'lead_manual_refund', $3, $4::jsonb)`,
        [adminUserId, leadId, reason, JSON.stringify({ refund_txn_id: result.refundTxnId })]
      );
      await client.query("COMMIT");
      return { lead_id: leadId, refunded: result.refunded, refund_txn_id: result.refundTxnId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Admin WhatsApp-nudges an owner about an uncalled lead. Rate-limited to
   * once per lead per 3h via a lead_events marker (notes='admin_nudged_owner').
   */
  async nudgeOwner(leadId: string, adminUserId: string) {
    this.ensureEnabled();
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      const info = await client.query<{
        owner_user_id: string;
        tenant_name: string;
        listing_title: string;
        hours_left: number | null;
        recently_nudged: boolean;
      }>(
        `SELECT ld.owner_user_id::text,
                COALESCE(t.full_name, 'एक किरायेदार') AS tenant_name,
                COALESCE(NULLIF(l.title_en, ''), 'आपकी प्रॉपर्टी') AS listing_title,
                CASE WHEN ld.call_deadline_at IS NULL THEN NULL
                     ELSE GREATEST(0, ROUND(EXTRACT(EPOCH FROM (ld.call_deadline_at - now())) / 3600))::int
                END AS hours_left,
                EXISTS (
                  SELECT 1 FROM lead_events le
                  WHERE le.lead_id = ld.id AND le.notes = 'admin_nudged_owner'
                    AND le.created_at > now() - interval '3 hours'
                ) AS recently_nudged
         FROM leads ld
         JOIN users t ON t.id = ld.tenant_user_id
         JOIN listings l ON l.id = ld.listing_id
         WHERE ld.id = $1::uuid
         FOR UPDATE OF ld`,
        [leadId]
      );
      const row = info.rows[0];
      if (!row) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      if (row.recently_nudged) {
        await client.query("COMMIT");
        return { lead_id: leadId, nudged: false };
      }
      const sent = await this.notifications.send({
        type: "owner.lead_nudge",
        recipientUserId: row.owner_user_id,
        payload: {
          tenant_name: row.tenant_name,
          listing_title: row.listing_title,
          hours_left: `${row.hours_left ?? 24} घंटे`
        },
        mode: "immediate"
      });
      if (!sent) {
        await client.query("COMMIT"); // nothing written — no marker burned, so it can be retried
        return { lead_id: leadId, nudged: false };
      }
      await client.query(
        `INSERT INTO lead_events (lead_id, to_status, actor_user_id, notes)
         SELECT $1::uuid, status, $2::uuid, 'admin_nudged_owner' FROM leads WHERE id = $1::uuid`,
        [leadId, adminUserId]
      );
      await client.query(
        `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action)
         VALUES ($2::uuid, 'lead', $1::uuid, 'nudge_owner')`,
        [leadId, adminUserId]
      );
      await client.query("COMMIT");
      return { lead_id: leadId, nudged: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Admin analytics: lead funnel, seeker-engagement funnel, response/refund/
   * dispute rates, a daily trend, and a per-owner rollup. The five range-
   * scoped queries run in parallel; the owner-health merge runs after, since
   * it needs the distinct owner ids the rollup query returns (reuses
   * {@link ownerHealthByIds}, same as getBoard's per-row health fields).
   */
  async getAnalytics(range: string): Promise<AdminLeadAnalytics> {
    this.ensureEnabled();
    const generatedAt = new Date().toISOString();
    const safeRange = ANALYTICS_RANGES.includes(range) ? range : "30 days";

    if (!this.database.isEnabled()) {
      return {
        range: safeRange,
        generated_at: generatedAt,
        funnel: { ...EMPTY_FUNNEL },
        engagement: { ...EMPTY_ENGAGEMENT },
        rates: { ...EMPTY_RATES },
        trend: [],
        by_owner: []
      };
    }

    const [
      funnelResult,
      engagementResult,
      ratesResult,
      refundRateResult,
      trendResult,
      byOwnerResult,
      ownerRefundResult
    ] = await Promise.all([
      this.database.query<AdminLeadFunnel>(
        `SELECT
           (SELECT count(*) FROM contact_unlocks WHERE created_at >= now() - $1::interval)::int AS callbacks_requested,
           (SELECT count(*) FROM leads WHERE created_at >= now() - $1::interval)::int AS leads_created,
           (SELECT count(*) FROM leads WHERE unlocked_at IS NOT NULL AND unlocked_at >= now() - $1::interval)::int AS leads_unlocked,
           (SELECT count(*) FROM leads WHERE called_at IS NOT NULL AND called_at >= now() - $1::interval)::int AS leads_called,
           (SELECT count(*) FROM leads WHERE status='deal_done' AND status_changed_at >= now() - $1::interval)::int AS deals_done,
           (SELECT count(*) FROM contact_unlocks WHERE unlock_status='refunded' AND updated_at >= now() - $1::interval)::int AS leads_refunded,
           (SELECT count(*) FROM leads WHERE disputed_at IS NOT NULL AND disputed_at >= now() - $1::interval)::int AS leads_disputed`,
        [safeRange]
      ),
      this.database.query<AdminLeadEngagementFunnel>(
        `SELECT
           (SELECT count(*) FROM pg_search_events WHERE created_at >= now() - $1::interval)::int AS searches,
           (SELECT count(*) FROM listing_events WHERE event_type='view' AND created_at >= now() - $1::interval)::int AS listing_views,
           (SELECT count(*) FROM users WHERE created_at >= now() - $1::interval)::int AS signups,
           (SELECT count(*) FROM contact_unlocks WHERE created_at >= now() - $1::interval)::int AS callbacks_requested,
           (SELECT count(*) FROM leads WHERE called_at IS NOT NULL AND called_at >= now() - $1::interval)::int AS calls_made`,
        [safeRange]
      ),
      this.database.query<RatesSqlRow>(
        `SELECT
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (called_at - created_at))/60)
             FILTER (WHERE called_at IS NOT NULL) AS median_response_minutes,
           COALESCE(avg(CASE WHEN called_at IS NOT NULL THEN 1 ELSE 0 END)
             FILTER (WHERE call_deadline_at IS NOT NULL), 0)::float AS called_within_24h_rate,
           COALESCE(avg(CASE WHEN called_by='team' THEN 1 ELSE 0 END) FILTER (WHERE called_at IS NOT NULL), 0)::float AS team_rescue_rate,
           COALESCE(avg(CASE WHEN disputed_at IS NOT NULL THEN 1 ELSE 0 END) FILTER (WHERE called_at IS NOT NULL), 0)::float AS dispute_rate
         FROM leads WHERE created_at >= now() - $1::interval`,
        [safeRange]
      ),
      this.database.query<{ refund_rate: number | string }>(
        `SELECT COALESCE(avg(CASE WHEN unlock_status='refunded' THEN 1 ELSE 0 END),0)::float AS refund_rate
         FROM contact_unlocks WHERE created_at >= now() - $1::interval`,
        [safeRange]
      ),
      this.database.query<AdminLeadTrendPoint>(
        `SELECT to_char(d::date,'YYYY-MM-DD') AS day,
           (SELECT count(*) FROM contact_unlocks c WHERE c.created_at::date = d::date)::int AS callbacks,
           (SELECT count(*) FROM leads l WHERE l.unlocked_at::date = d::date)::int AS unlocked,
           (SELECT count(*) FROM leads l WHERE l.called_at::date = d::date)::int AS called,
           (SELECT count(*) FROM contact_unlocks c WHERE c.unlock_status='refunded' AND c.updated_at::date = d::date)::int AS refunded
         FROM generate_series(now() - $1::interval, now(), interval '1 day') d
         ORDER BY day ASC`,
        [safeRange]
      ),
      this.database.query<OwnerRollupSqlRow>(
        `SELECT ld.owner_user_id::text AS owner_user_id,
                COALESCE(o.full_name,'Owner') AS name, o.role::text AS role,
                count(*)::int AS leads,
                count(*) FILTER (WHERE ld.called_at IS NOT NULL)::int AS called,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ld.called_at - ld.created_at))/60)
                  FILTER (WHERE ld.called_at IS NOT NULL) AS median_response_minutes
         FROM leads ld JOIN users o ON o.id = ld.owner_user_id
         WHERE ld.created_at >= now() - $1::interval
         GROUP BY ld.owner_user_id, o.full_name, o.role
         ORDER BY leads DESC LIMIT 100`,
        [safeRange]
      ),
      // Companion query for by_owner refund_rate: refunded unlocks / unlocks,
      // scoped through the same in-range leads as the rollup above (a contact
      // unlock has no owner_user_id of its own — only leads do).
      this.database.query<OwnerRefundSqlRow>(
        `SELECT ld.owner_user_id::text AS owner_user_id,
                count(cu.id)::int AS unlocks,
                count(*) FILTER (WHERE cu.unlock_status='refunded')::int AS refunded
         FROM leads ld
         JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
         WHERE ld.created_at >= now() - $1::interval
         GROUP BY ld.owner_user_id`,
        [safeRange]
      )
    ]);

    const ratesRow = ratesResult.rows[0];
    const rates: AdminLeadRates = {
      median_response_minutes:
        ratesRow?.median_response_minutes == null ? null : Number(ratesRow.median_response_minutes),
      called_within_24h_rate: Number(ratesRow?.called_within_24h_rate ?? 0),
      team_rescue_rate: Number(ratesRow?.team_rescue_rate ?? 0),
      refund_rate: Number(refundRateResult.rows[0]?.refund_rate ?? 0),
      dispute_rate: Number(ratesRow?.dispute_rate ?? 0)
    };

    const ownerRefundRate = new Map<string, number>();
    for (const r of ownerRefundResult.rows) {
      const unlocks = Number(r.unlocks ?? 0);
      const refunded = Number(r.refunded ?? 0);
      ownerRefundRate.set(r.owner_user_id, unlocks > 0 ? refunded / unlocks : 0);
    }

    const ownerIds = byOwnerResult.rows.map((r) => r.owner_user_id);
    const health = await this.ownerHealthByIds(ownerIds);

    const by_owner: AdminLeadOwnerRollupRow[] = byOwnerResult.rows.map((r) => {
      const leads = Number(r.leads ?? 0);
      const called = Number(r.called ?? 0);
      const h = health.get(r.owner_user_id);
      return {
        owner_user_id: r.owner_user_id,
        name: r.name,
        role: r.role,
        leads,
        called,
        called_rate: leads > 0 ? called / leads : 0,
        median_response_minutes:
          r.median_response_minutes == null ? null : Number(r.median_response_minutes),
        refund_rate: ownerRefundRate.get(r.owner_user_id) ?? 0,
        health_score: h?.score ?? null,
        health_grade: h?.grade ?? null
      };
    });

    return {
      range: safeRange,
      generated_at: generatedAt,
      funnel: funnelResult.rows[0] ?? { ...EMPTY_FUNNEL },
      engagement: engagementResult.rows[0] ?? { ...EMPTY_ENGAGEMENT },
      rates,
      trend: trendResult.rows,
      by_owner
    };
  }

  /**
   * Admin per-owner lead drill-down: owner header (name/role/masked phone +
   * health via ownerHealthByIds), a per-owner status funnel (the same
   * grouped-count shape as LeadsService.getLeadStats), owner-scoped rates
   * (getAnalytics's rates query plus its refund-rate companion query, both
   * with an owner_user_id filter added), and up to 100 in-flight
   * (needs_call) leads for this owner via getBoard, which already attaches
   * per-row health. 404s when the owner id doesn't resolve to a user row —
   * including when the DB is disabled, since there's no in-memory owner
   * store to confirm existence against (same "no AppStateService fallback"
   * convention getAnalytics already established for this file).
   */
  async getOwnerDetail(ownerId: string, range: string): Promise<AdminLeadOwnerDetail> {
    this.ensureEnabled();
    const safeRange = ANALYTICS_RANGES.includes(range) ? range : "30 days";

    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const ownerResult = await this.database.query<OwnerHeaderSqlRow>(
      `SELECT full_name, phone_e164, role::text AS role FROM users
       WHERE id = $1::uuid AND role IN ('owner', 'pg_operator')`,
      [ownerId]
    );
    const ownerRow = ownerResult.rows[0];
    if (!ownerRow) {
      throw new NotFoundException({ code: "not_found", message: "Owner not found" });
    }

    const [funnelResult, ratesResult, refundResult, health, board] = await Promise.all([
      this.database.query<OwnerFunnelSqlRow>(
        `SELECT status::text, count(*)::int AS count
         FROM leads WHERE owner_user_id = $1::uuid GROUP BY status`,
        [ownerId]
      ),
      this.database.query<RatesSqlRow>(
        `SELECT
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (called_at - created_at))/60)
             FILTER (WHERE called_at IS NOT NULL) AS median_response_minutes,
           COALESCE(avg(CASE WHEN called_at IS NOT NULL THEN 1 ELSE 0 END)
             FILTER (WHERE call_deadline_at IS NOT NULL), 0)::float AS called_within_24h_rate,
           COALESCE(avg(CASE WHEN called_by='team' THEN 1 ELSE 0 END) FILTER (WHERE called_at IS NOT NULL), 0)::float AS team_rescue_rate,
           COALESCE(avg(CASE WHEN disputed_at IS NOT NULL THEN 1 ELSE 0 END) FILTER (WHERE called_at IS NOT NULL), 0)::float AS dispute_rate
         FROM leads WHERE created_at >= now() - $1::interval AND owner_user_id = $2::uuid`,
        [safeRange, ownerId]
      ),
      // Owner-scoped refund-rate companion — same join as getAnalytics's
      // by_owner rollup (contact_unlocks has no owner_user_id of its own,
      // only leads does), just pre-filtered to this one owner.
      this.database.query<OwnerRefundTotalsSqlRow>(
        `SELECT count(cu.id)::int AS unlocks,
                count(*) FILTER (WHERE cu.unlock_status='refunded')::int AS refunded
         FROM leads ld
         JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
         WHERE ld.created_at >= now() - $1::interval AND ld.owner_user_id = $2::uuid`,
        [safeRange, ownerId]
      ),
      this.ownerHealthByIds([ownerId]),
      this.getBoard({ filter: "needs_call", ownerId, pageSize: 100 })
    ]);

    const funnel: AdminLeadOwnerFunnel = { ...EMPTY_OWNER_FUNNEL };
    for (const row of funnelResult.rows) {
      const count = Number(row.count ?? 0);
      switch (row.status) {
        case "new":
          funnel.new = count;
          break;
        case "contacted":
          funnel.contacted = count;
          break;
        case "visit_scheduled":
          funnel.visit_scheduled = count;
          break;
        case "deal_done":
          funnel.deal_done = count;
          break;
        case "lost":
          funnel.lost = count;
          break;
      }
      funnel.total += count;
    }

    const ratesRow = ratesResult.rows[0];
    const refundRow = refundResult.rows[0];
    const unlocks = Number(refundRow?.unlocks ?? 0);
    const refunded = Number(refundRow?.refunded ?? 0);
    const rates: AdminLeadRates = {
      median_response_minutes:
        ratesRow?.median_response_minutes == null ? null : Number(ratesRow.median_response_minutes),
      called_within_24h_rate: Number(ratesRow?.called_within_24h_rate ?? 0),
      team_rescue_rate: Number(ratesRow?.team_rescue_rate ?? 0),
      refund_rate: unlocks > 0 ? refunded / unlocks : 0,
      dispute_rate: Number(ratesRow?.dispute_rate ?? 0)
    };

    const h = health.get(ownerId.toLowerCase());

    return {
      owner_user_id: ownerId,
      name: ownerRow.full_name ?? "Owner",
      role: ownerRow.role,
      phone_masked: maskPhone(ownerRow.phone_e164),
      health_score: h?.score ?? null,
      health_grade: h?.grade ?? null,
      funnel,
      rates,
      in_flight: board.rows
    };
  }
}
