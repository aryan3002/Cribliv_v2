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
  AdminLeadBoardFilter,
  AdminLeadBoardResponse,
  AdminLeadBoardRow,
  AdminLeadCounters,
  AdminLeadTimelineEvent,
  AdminLeadTimelineResponse
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY_COUNTERS: AdminLeadCounters = {
  in_flight: 0,
  uncalled: 0,
  expiring_6h: 0,
  expired_today: 0,
  refunded_today: 0
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
      const leadRes = await client.query<{ id: string; contact_unlock_id: string | null }>(
        `SELECT id::text, contact_unlock_id::text FROM leads WHERE id = $1::uuid FOR UPDATE`,
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
}
