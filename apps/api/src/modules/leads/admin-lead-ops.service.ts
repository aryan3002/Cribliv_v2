import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
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
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

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
    const range = p.range ?? "30 days";
    const page = Math.max(1, p.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, p.pageSize ?? 50));
    const params: unknown[] = [];
    const where: string[] = [this.filterClause(filter, params, range)];

    if (p.ownerId) {
      params.push(p.ownerId);
      where.push(`ld.owner_user_id = $${params.length}::uuid`);
    }
    if (p.state) {
      params.push(p.state);
      where.push(`ld.access_state = $${params.length}`);
    }
    if (p.status) {
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
        health_score: null, // wired in the analytics slice
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

    return { rows, total: countResult.rows[0]?.n ?? 0, generated_at: generatedAt, counters };
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
}
