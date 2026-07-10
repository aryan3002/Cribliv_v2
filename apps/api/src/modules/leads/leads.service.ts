import {
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
  ForbiddenException
} from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { logTelemetry } from "../../common/telemetry";

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
    call_deadline_at?: string;
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

      // First 2 leads per owner (lifetime) arrive free/un-blurred — the owner's
      // taste of lead quality. Racing concurrent leads can occasionally grant a
      // 3rd freebie; acceptable at current scale.
      const ownerLeadCount = await this.database.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM leads WHERE owner_user_id = $1::uuid`,
        [params.owner_user_id]
      );
      const accessState = Number(ownerLeadCount.rows[0]?.n ?? 0) < 2 ? "free" : "locked";

      const result = await this.database.query<{ id: string }>(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id,
                            tenant_phone_masked, status, access_state, call_deadline_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'new', $6, $7::timestamptz)
         ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
           contact_unlock_id = COALESCE(EXCLUDED.contact_unlock_id, leads.contact_unlock_id),
           call_deadline_at = COALESCE(EXCLUDED.call_deadline_at, leads.call_deadline_at),
           updated_at = now()
         RETURNING id::text`,
        [
          params.listing_id,
          params.owner_user_id,
          params.tenant_user_id,
          params.contact_unlock_id ?? null,
          params.tenant_phone_masked ?? null,
          accessState,
          params.call_deadline_at ?? null
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

    const flags = readFeatureFlags();

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

    // Full tenant number is exposed ONLY for free/unlocked leads with the flag on.
    const tenantPhoneSelect = flags.ff_callback_leads
      ? `CASE WHEN ld.access_state IN ('free','unlocked') THEN u.phone_e164 ELSE NULL END`
      : `NULL`;

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
      access_state: string;
      call_deadline_at: string | null;
      called_at: string | null;
      called_by: string | null;
      tenant_phone: string | null;
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
         ld.created_at::text,
         ld.access_state,
         ld.call_deadline_at::text,
         ld.called_at::text,
         ld.called_by,
         ${tenantPhoneSelect} AS tenant_phone
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

  /**
   * Contact-unlock / interest count per listing for an owner/operator, optionally
   * windowed. One lead == one tenant who unlocked the listing, so this is the
   * truthful "contact unlocks" metric for the dashboard card (the card used to
   * read listing_events('enquiry'), which an unlock never writes → always 0).
   */
  async getListingLeadCounts(
    ownerUserId: string,
    listingIds: string[],
    since?: Date
  ): Promise<Array<{ listing_id: string; count: number }>> {
    if (!this.database.isEnabled() || !listingIds.length) return [];

    const params: unknown[] = [ownerUserId, listingIds];
    let sinceClause = "";
    if (since) {
      params.push(since.toISOString());
      sinceClause = ` AND created_at >= $${params.length}`;
    }

    const result = await this.database.query<{ listing_id: string; count: number }>(
      `SELECT listing_id::text AS listing_id, count(*)::int AS count
       FROM leads
       WHERE owner_user_id = $1::uuid
         AND listing_id = ANY($2::uuid[])${sinceClause}
       GROUP BY listing_id`,
      params
    );
    return result.rows;
  }

  /**
   * Reveal a lead's real tenant contact to its owner/operator.
   *
   * In V1.5 this is gated behind an operator payment (the PG lead-unlock plan).
   * That flow isn't built yet, so for now reveal is allowed only in NON-production
   * (or with PG_LEAD_DEV_REVEAL=true). In production without that env it returns
   * 402 payment_required — the seam where the paid flow will plug in.
   */
  async openLeadForOperator(
    leadId: string,
    operatorUserId: string
  ): Promise<{ lead_id: string; phone: string | null; tenant_name: string }> {
    const revealAllowed =
      process.env.NODE_ENV !== "production" || process.env.PG_LEAD_DEV_REVEAL === "true";
    if (!revealAllowed) {
      throw new HttpException(
        {
          code: "payment_required",
          message: "payment_required: opening a lead's contact requires an active plan"
        },
        HttpStatus.PAYMENT_REQUIRED
      );
    }

    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const row = await this.database.query<{ phone_e164: string | null; tenant_name: string }>(
      `SELECT u.phone_e164, COALESCE(u.full_name, 'Tenant') AS tenant_name
         FROM leads ld
         LEFT JOIN users u ON u.id = ld.tenant_user_id
        WHERE ld.id = $1::uuid AND ld.owner_user_id = $2::uuid
        LIMIT 1`,
      [leadId, operatorUserId]
    );
    if (!row.rows.length) {
      throw new BadRequestException({ code: "not_found", message: "Lead not found" });
    }

    return {
      lead_id: leadId,
      phone: row.rows[0].phone_e164 ?? null,
      tenant_name: row.rows[0].tenant_name
    };
  }

  /**
   * Paid reveal of a lead's tenant contact (ff_callback_leads).
   * Mirrors the tenant-side wallet debit in ContactsService.unlockContactDb:
   * row lock → idempotent txn insert → balance decrement → state flip, all in
   * one transaction. Free leads return the phone without touching the wallet.
   */
  async unlockLead(leadId: string, ownerUserId: string, idempotencyKey: string) {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Lead unlock is not enabled"
      });
    }
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      const leadResult = await client.query<{
        id: string;
        access_state: string;
        call_deadline_at: string | null;
        deadline_passed: boolean;
        tenant_phone: string | null;
        tenant_name: string;
      }>(
        `SELECT ld.id::text, ld.access_state, ld.call_deadline_at::text,
                (ld.call_deadline_at IS NOT NULL AND ld.call_deadline_at <= now()) AS deadline_passed,
                u.phone_e164 AS tenant_phone,
                COALESCE(u.full_name, 'Tenant') AS tenant_name
         FROM leads ld
         LEFT JOIN users u ON u.id = ld.tenant_user_id
         WHERE ld.id = $1::uuid AND ld.owner_user_id = $2::uuid
         FOR UPDATE OF ld`,
        [leadId, ownerUserId]
      );

      const lead = leadResult.rows[0];
      if (!lead) {
        throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      }

      const balanceRow = async () => {
        const r = await client.query<{ balance_credits: number }>(
          `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid LIMIT 1`,
          [ownerUserId]
        );
        return Number(r.rows[0]?.balance_credits ?? 0);
      };

      // Idempotent success paths: already visible → return without debiting.
      if (lead.access_state === "free" || lead.access_state === "unlocked") {
        const credits = await balanceRow();
        await client.query("COMMIT");
        return {
          lead_id: lead.id,
          access_state: lead.access_state === "free" ? "free" : "unlocked",
          tenant_phone: lead.tenant_phone,
          tenant_name: lead.tenant_name,
          credits_remaining: credits
        };
      }

      if (lead.access_state === "expired" || lead.deadline_passed) {
        throw new HttpException(
          { code: "lead_expired", message: "Lead expired — it can no longer be unlocked" },
          HttpStatus.GONE
        );
      }

      await client.query(
        `INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
         VALUES ($1::uuid, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
        [ownerUserId]
      );
      const walletResult = await client.query<{ balance_credits: number }>(
        `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [ownerUserId]
      );
      if (Number(walletResult.rows[0]?.balance_credits ?? 0) < 1) {
        throw new HttpException(
          { code: "insufficient_credits", message: "Insufficient credits" },
          HttpStatus.PAYMENT_REQUIRED
        );
      }

      // reference_type is 'lead'; reference_id carries the lead id.
      const debit = await client.query<{ id: string }>(
        `INSERT INTO wallet_transactions(
           wallet_user_id, txn_type, credits_delta, reference_type, reference_id, idempotency_key, metadata)
         VALUES ($1::uuid, 'debit_lead_unlock', -1, 'lead', $2::uuid, $3, '{}'::jsonb)
         ON CONFLICT (wallet_user_id, idempotency_key) DO NOTHING
         RETURNING id::text`,
        [ownerUserId, leadId, idempotencyKey]
      );
      const debitInserted = Boolean(debit.rows[0]?.id);
      if (!debitInserted) {
        // The key was already used. If it paid for THIS lead, the lead was
        // flipped in that same transaction and the early idempotent-return
        // path above would have caught it — reaching here means the key
        // belongs to something else (another lead or another flow). Reject,
        // mirroring the tenant-side duplicate_unlock guard.
        const existingTxn = await client.query<{ id: string; reference_id: string | null }>(
          `SELECT id::text, reference_id::text FROM wallet_transactions
           WHERE wallet_user_id = $1::uuid AND idempotency_key = $2
           LIMIT 1`,
          [ownerUserId, idempotencyKey]
        );
        if (existingTxn.rows[0]?.reference_id !== leadId) {
          throw new ConflictException({
            code: "duplicate_unlock",
            message: "Idempotency-Key already used for another unlock"
          });
        }
        // Key matches this lead but the lead is still locked — heal by
        // flipping it using the already-paid transaction.
        await client.query(
          `UPDATE leads SET access_state = 'unlocked', unlocked_at = COALESCE(unlocked_at, now()),
                            unlock_txn_id = COALESCE(unlock_txn_id, $2::uuid), updated_at = now()
           WHERE id = $1::uuid`,
          [leadId, existingTxn.rows[0].id]
        );
      }
      if (debitInserted) {
        await client.query(
          `UPDATE wallets SET balance_credits = balance_credits - 1, updated_at = now()
           WHERE user_id = $1::uuid AND balance_credits >= 1`,
          [ownerUserId]
        );
        await client.query(
          `UPDATE leads SET access_state = 'unlocked', unlocked_at = now(),
                            unlock_txn_id = $2::uuid, updated_at = now()
           WHERE id = $1::uuid`,
          [leadId, debit.rows[0].id]
        );
        await client.query(
          `INSERT INTO lead_events (lead_id, to_status, actor_user_id, notes)
           VALUES ($1::uuid, (SELECT status FROM leads WHERE id = $1::uuid), $2::uuid, 'lead_unlocked')`,
          [leadId, ownerUserId]
        );
      }

      const credits = await balanceRow();
      await client.query("COMMIT");
      logTelemetry("lead.unlocked", {
        lead_id: leadId,
        owner_user_id: ownerUserId,
        debited: debitInserted
      });
      return {
        lead_id: leadId,
        access_state: "unlocked",
        tenant_phone: lead.tenant_phone,
        tenant_name: lead.tenant_name,
        credits_remaining: credits
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
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
