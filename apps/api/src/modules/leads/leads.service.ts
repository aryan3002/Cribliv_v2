import { Inject, Injectable, Logger, BadRequestException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

const VALID_TRANSITIONS: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["visit_scheduled", "lost"],
  visit_scheduled: ["deal_done", "lost"],
  deal_done: [],
  lost: ["new"]
};

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createLead(params: {
    listing_id: string;
    owner_user_id: string;
    tenant_user_id: string;
    contact_unlock_id?: string;
    tenant_phone_masked?: string;
  }): Promise<{ lead_id: string; created: boolean }> {
    const flags = readFeatureFlags();
    if (!flags.ff_lead_management_enabled || !this.database.isEnabled()) {
      return { lead_id: "", created: false };
    }

    try {
      // Check 7-day dedup window
      const existing = await this.database.query<{ id: string }>(
        `SELECT id::text FROM leads
         WHERE listing_id = $1::uuid AND tenant_user_id = $2::uuid
           AND created_at > now() - interval '7 days'
         LIMIT 1`,
        [params.listing_id, params.tenant_user_id]
      );

      if (existing.rows.length > 0) {
        return { lead_id: existing.rows[0].id, created: false };
      }

      const result = await this.database.query<{ id: string }>(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id, tenant_phone_masked, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'new')
         ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
           contact_unlock_id = COALESCE(EXCLUDED.contact_unlock_id, leads.contact_unlock_id),
           updated_at = now()
         RETURNING id::text`,
        [
          params.listing_id,
          params.owner_user_id,
          params.tenant_user_id,
          params.contact_unlock_id ?? null,
          params.tenant_phone_masked ?? null
        ]
      );

      const leadId = result.rows[0].id;

      await this.database.query(
        `INSERT INTO lead_events (lead_id, to_status, actor_user_id)
         VALUES ($1::uuid, 'new', $2::uuid)`,
        [leadId, params.tenant_user_id]
      );

      return { lead_id: leadId, created: true };
    } catch (error) {
      this.logger.error("Failed to create lead", error);
      return { lead_id: "", created: false };
    }
  }

  async getOwnerLeads(
    ownerUserId: string,
    status?: string,
    page = 1,
    pageSize = 20
  ): Promise<{ items: any[]; total: number; page: number; page_size: number }> {
    if (!this.database.isEnabled()) {
      return { items: [], total: 0, page, page_size: pageSize };
    }

    const params: unknown[] = [ownerUserId];
    let statusClause = "";
    if (status) {
      params.push(status);
      statusClause = `AND ld.status = $${params.length}::lead_status`;
    }

    const offset = (page - 1) * pageSize;

    const countResult = await this.database.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM leads ld WHERE ld.owner_user_id = $1::uuid ${statusClause}`,
      params
    );

    const result = await this.database.query<{
      id: string;
      listing_id: string;
      listing_title: string;
      tenant_user_id: string;
      tenant_name: string;
      tenant_phone_masked: string | null;
      status: string;
      status_changed_at: string;
      owner_notes: string | null;
      created_at: string;
    }>(
      `SELECT
         ld.id::text,
         ld.listing_id::text,
         COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
         ld.tenant_user_id::text,
         COALESCE(u.full_name, 'Tenant') AS tenant_name,
         ld.tenant_phone_masked,
         ld.status::text,
         ld.status_changed_at::text,
         ld.owner_notes,
         ld.created_at::text
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       LEFT JOIN users u ON u.id = ld.tenant_user_id
       WHERE ld.owner_user_id = $1::uuid ${statusClause}
       ORDER BY ld.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    return {
      items: result.rows,
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      page_size: pageSize
    };
  }

  async getLeadStats(ownerUserId: string): Promise<Record<string, number>> {
    if (!this.database.isEnabled()) {
      return { new: 0, contacted: 0, visit_scheduled: 0, deal_done: 0, lost: 0, total: 0 };
    }

    const result = await this.database.query<{ status: string; count: number }>(
      `SELECT status::text, count(*)::int AS count
       FROM leads
       WHERE owner_user_id = $1::uuid
       GROUP BY status`,
      [ownerUserId]
    );

    const stats: Record<string, number> = {
      new: 0,
      contacted: 0,
      visit_scheduled: 0,
      deal_done: 0,
      lost: 0,
      total: 0
    };
    for (const row of result.rows) {
      stats[row.status] = row.count;
      stats.total += row.count;
    }
    return stats;
  }

  async updateLeadStatus(
    leadId: string,
    ownerUserId: string,
    newStatus: string,
    notes?: string
  ): Promise<{ lead_id: string; status: string }> {
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const existing = await this.database.query<{ id: string; status: string }>(
      `SELECT id::text, status::text FROM leads
       WHERE id = $1::uuid AND owner_user_id = $2::uuid
       LIMIT 1`,
      [leadId, ownerUserId]
    );

    if (!existing.rows.length) {
      throw new BadRequestException({ code: "not_found", message: "Lead not found" });
    }

    const currentStatus = existing.rows[0].status;
    const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestException({
        code: "invalid_transition",
        message: `Cannot transition from ${currentStatus} to ${newStatus}`
      });
    }

    await this.database.query(
      `UPDATE leads
       SET status = $2::lead_status,
           owner_notes = COALESCE($3, owner_notes),
           status_changed_at = now(),
           updated_at = now()
       WHERE id = $1::uuid`,
      [leadId, newStatus, notes ?? null]
    );

    await this.database.query(
      `INSERT INTO lead_events (lead_id, from_status, to_status, actor_user_id, notes)
       VALUES ($1::uuid, $2::lead_status, $3::lead_status, $4::uuid, $5)`,
      [leadId, currentStatus, newStatus, ownerUserId, notes ?? null]
    );

    return { lead_id: leadId, status: newStatus };
  }

  async exportLeadsCsv(ownerUserId: string): Promise<string> {
    if (!this.database.isEnabled()) {
      return "lead_id,listing_title,tenant_name,tenant_phone_masked,status,created_at,status_changed_at,owner_notes\n";
    }

    const result = await this.database.query<{
      id: string;
      listing_title: string;
      tenant_name: string;
      tenant_phone_masked: string | null;
      status: string;
      created_at: string;
      status_changed_at: string;
      owner_notes: string | null;
    }>(
      `SELECT
         ld.id::text,
         COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
         COALESCE(u.full_name, 'Tenant')             AS tenant_name,
         ld.tenant_phone_masked,
         ld.status::text,
         to_char(ld.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')      AS created_at,
         to_char(ld.status_changed_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS status_changed_at,
         ld.owner_notes
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       LEFT JOIN users u ON u.id = ld.tenant_user_id
       WHERE ld.owner_user_id = $1::uuid
       ORDER BY ld.created_at DESC`,
      [ownerUserId]
    );

    const escape = (v: string | null | undefined) => {
      if (v == null) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header =
      "lead_id,listing_title,tenant_name,tenant_phone_masked,status,created_at,status_changed_at,owner_notes";
    const rows = result.rows.map((r) =>
      [
        r.id,
        r.listing_title,
        r.tenant_name,
        r.tenant_phone_masked ?? "",
        r.status,
        r.created_at,
        r.status_changed_at,
        r.owner_notes ?? ""
      ]
        .map(escape)
        .join(",")
    );

    return [header, ...rows].join("\n");
  }
}
