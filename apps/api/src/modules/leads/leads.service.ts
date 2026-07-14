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
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { logTelemetry } from "../../common/telemetry";
import {
  debitWalletCredits,
  expireSignupCredits,
  WalletBalanceError
} from "../wallet/wallet-balance";

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

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState?: AppStateService
  ) {}

  async createLead(params: {
    listing_id: string;
    owner_user_id: string;
    tenant_user_id: string;
    contact_unlock_id?: string;
    tenant_phone_masked?: string;
    call_deadline_at?: string;
  }): Promise<{ lead_id: string; created: boolean }> {
    const flags = readFeatureFlags();
    if (!flags.ff_lead_management_enabled) {
      return { lead_id: "", created: false };
    }

    if (!this.database.isEnabled()) {
      if (!this.appState) return { lead_id: "", created: false };
      const callDeadlineAt = params.call_deadline_at
        ? new Date(params.call_deadline_at).getTime()
        : null;
      const { lead, created } = this.appState.createOwnerLead({
        listingId: params.listing_id,
        ownerUserId: params.owner_user_id,
        tenantUserId: params.tenant_user_id,
        contactUnlockId: params.contact_unlock_id,
        tenantPhoneMasked: params.tenant_phone_masked,
        callDeadlineAt: Number.isFinite(callDeadlineAt) ? callDeadlineAt : null
      });
      return { lead_id: lead.id, created };
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
      return (
        this.appState?.listOwnerLeads(
          ownerUserId,
          status as "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost" | undefined,
          page,
          pageSize,
          readFeatureFlags().ff_callback_leads
        ) ?? { items: [], total: 0, page, page_size: pageSize }
      );
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
    let committed = false;
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

      if (lead.access_state === "free") {
        await expireSignupCredits(client, ownerUserId);
        const credits = await balanceRow();
        await client.query("COMMIT");
        committed = true;
        return {
          lead_id: lead.id,
          access_state: "free",
          tenant_phone: lead.tenant_phone,
          tenant_name: lead.tenant_name,
          credits_remaining: credits
        };
      }

      if (lead.access_state === "unlocked") {
        await expireSignupCredits(client, ownerUserId);
        const credits = await balanceRow();
        await client.query("COMMIT");
        committed = true;
        return {
          lead_id: lead.id,
          access_state: "unlocked",
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
      let debit;
      try {
        debit = await debitWalletCredits(client, {
          userId: ownerUserId,
          credits: 1,
          txnType: "debit_lead_unlock",
          referenceType: "lead",
          referenceId: leadId,
          idempotencyKey
        });
      } catch (error) {
        if (error instanceof WalletBalanceError) {
          if (error.code === "idempotency_conflict") {
            throw new ConflictException({
              code: "duplicate_unlock",
              message: "Idempotency-Key already used for another unlock"
            });
          }
          if (error.code === "insufficient_credits" || error.code === "wallet_not_found") {
            throw new HttpException(
              { code: "insufficient_credits", message: "Insufficient credits" },
              HttpStatus.PAYMENT_REQUIRED
            );
          }
        }
        throw error;
      }

      if (debit.status === "insufficient") {
        await client.query("COMMIT");
        committed = true;
        throw new HttpException(
          { code: "insufficient_credits", message: "Insufficient credits" },
          HttpStatus.PAYMENT_REQUIRED
        );
      }

      if (!debit.inserted) {
        // Heal a same-target replay with the transaction that originally paid
        // for this lead. The helper rejects any key used by another flow.
        await client.query(
          `UPDATE leads SET access_state = 'unlocked', unlocked_at = COALESCE(unlocked_at, now()),
                            unlock_txn_id = COALESCE(unlock_txn_id, $2::uuid), updated_at = now()
           WHERE id = $1::uuid`,
          [leadId, debit.transactionId]
        );
      }
      if (debit.inserted) {
        await client.query(
          `UPDATE leads SET access_state = 'unlocked', unlocked_at = now(),
                            unlock_txn_id = $2::uuid, updated_at = now()
           WHERE id = $1::uuid`,
          [leadId, debit.transactionId]
        );
        await client.query(
          `INSERT INTO lead_events (lead_id, to_status, actor_user_id, notes)
           VALUES ($1::uuid, (SELECT status FROM leads WHERE id = $1::uuid), $2::uuid, 'lead_unlocked')`,
          [leadId, ownerUserId]
        );
      }

      await client.query("COMMIT");
      committed = true;
      logTelemetry("lead.unlocked", {
        lead_id: leadId,
        owner_user_id: ownerUserId,
        debited: debit.inserted
      });
      return {
        lead_id: leadId,
        access_state: "unlocked",
        tenant_phone: lead.tenant_phone,
        tenant_name: lead.tenant_name,
        credits_remaining: debit.balanceCredits
      };
    } catch (error) {
      if (!committed) await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Shared claim-a-call helper: stamps the lead and flips the linked
   * contact_unlock to 'responded' so the refund sweep skips it. First claim
   * wins; later calls are no-ops. `client` must be inside a transaction.
   */
  private async markLeadCalled(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> },
    leadId: string,
    contactUnlockId: string | null,
    calledBy: "owner" | "team"
  ): Promise<boolean> {
    // Canonical lock order: contact_unlocks BEFORE leads. The timeout-refund
    // sweep locks contact_unlocks first (FOR UPDATE SKIP LOCKED) then updates
    // leads, so every path that touches both tables must take them in that same
    // order or the two can deadlock (AB-BA). Serialize on the unlock row first;
    // this lock is also what makes the first-claim-wins guard below race-safe.
    if (contactUnlockId) {
      await client.query(`SELECT 1 FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`, [
        contactUnlockId
      ]);
    }

    const stamped = await client.query(
      `UPDATE leads SET called_at = now(), called_by = $2, updated_at = now()
       WHERE id = $1::uuid AND called_at IS NULL`,
      [leadId, calledBy]
    );
    if (!stamped.rowCount) return false;

    if (contactUnlockId) {
      const responded = await client.query(
        `UPDATE contact_unlocks
         SET owner_response_status = 'responded', owner_responded_at = now(), updated_at = now()
         WHERE id = $1::uuid AND owner_response_status = 'pending'`,
        [contactUnlockId]
      );
      if (responded.rowCount) {
        await client.query(
          `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
           VALUES ($1::uuid, $2, 'owner_responded', $3::jsonb)`,
          [
            contactUnlockId,
            calledBy === "team" ? "system" : "owner",
            JSON.stringify({ channel: "call", called_by: calledBy })
          ]
        );
      }
    }
    return true;
  }

  async recordCallClick(leadId: string, ownerUserId: string) {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Call tracking is not enabled"
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
        contact_unlock_id: string | null;
        called_at: string | null;
        tenant_phone: string | null;
      }>(
        // No FOR UPDATE here: markLeadCalled() below locks the contact_unlock
        // first, then the lead (canonical contact_unlocks→leads order). Locking
        // the lead up-front would invert that order and can deadlock the sweep.
        `SELECT ld.id::text, ld.access_state, ld.contact_unlock_id::text,
                ld.called_at::text, u.phone_e164 AS tenant_phone
         FROM leads ld
         LEFT JOIN users u ON u.id = ld.tenant_user_id
         WHERE ld.id = $1::uuid AND ld.owner_user_id = $2::uuid`,
        [leadId, ownerUserId]
      );
      const lead = leadResult.rows[0];
      if (!lead) {
        throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      }
      if (lead.access_state !== "free" && lead.access_state !== "unlocked") {
        throw new ConflictException({
          code: "lead_locked",
          message: "Unlock the lead before calling"
        });
      }

      await this.markLeadCalled(client, leadId, lead.contact_unlock_id, "owner");
      const stamped = await client.query<{ called_at: string }>(
        `SELECT called_at::text FROM leads WHERE id = $1::uuid`,
        [leadId]
      );
      await client.query("COMMIT");
      logTelemetry("lead.call_clicked", { lead_id: leadId, owner_user_id: ownerUserId });
      return {
        lead_id: leadId,
        called_at: stamped.rows[0].called_at,
        tel: `tel:${lead.tenant_phone ?? ""}`
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Leads at risk of breaking the 24h promise: uncalled, < 6h to deadline. */
  async getRescueQueue() {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Callbacks are not enabled"
      });
    }
    if (!this.database.isEnabled()) {
      return { items: [] };
    }
    const result = await this.database.query(
      `SELECT ld.id::text AS lead_id, ld.listing_id::text,
              COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
              ld.owner_user_id::text,
              COALESCE(o.full_name, 'Owner') AS owner_name, o.phone_e164 AS owner_phone,
              COALESCE(t.full_name, 'Tenant') AS tenant_name, t.phone_e164 AS tenant_phone,
              ld.access_state, ld.call_deadline_at::text, ld.created_at::text
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       JOIN users o ON o.id = ld.owner_user_id
       JOIN users t ON t.id = ld.tenant_user_id
       WHERE ld.called_at IS NULL
         AND ld.call_deadline_at IS NOT NULL
         AND ld.call_deadline_at > now()
         AND ld.call_deadline_at <= now() + interval '6 hours'
         AND ld.access_state <> 'expired'
       ORDER BY ld.call_deadline_at ASC
       LIMIT 100`
    );
    return { items: result.rows };
  }

  async teamMarkCalled(leadId: string, adminUserId?: string) {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Callbacks are not enabled"
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
        contact_unlock_id: string | null;
        called_at: string | null;
        status: string;
      }>(
        // No FOR UPDATE here: markLeadCalled() locks the contact_unlock first
        // then the lead (canonical contact_unlocks→leads order). The called_at
        // check below is a fast-path; markLeadCalled()'s guarded UPDATE (under
        // the unlock lock) is the authoritative first-claim-wins gate.
        `SELECT id::text, contact_unlock_id::text, called_at::text, status::text
         FROM leads WHERE id = $1::uuid`,
        [leadId]
      );
      const lead = leadResult.rows[0];
      if (!lead) {
        throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      }
      if (lead.called_at) {
        throw new ConflictException({ code: "already_called", message: "Call already claimed" });
      }
      const claimed = await this.markLeadCalled(client, leadId, lead.contact_unlock_id, "team");
      if (!claimed) {
        throw new ConflictException({ code: "already_called", message: "Call already claimed" });
      }
      await client.query(
        `INSERT INTO lead_events (lead_id, to_status, notes)
         VALUES ($1::uuid, $2::lead_status, 'team_called')`,
        [leadId, lead.status]
      );
      if (adminUserId) {
        await client.query(
          `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, after_state)
           VALUES ($1::uuid, 'lead', $2::uuid, 'mark_team_called', $3::jsonb)`,
          [adminUserId, leadId, JSON.stringify({ called_by: "team" })]
        );
      }
      const stamped = await client.query<{ called_at: string }>(
        `SELECT called_at::text FROM leads WHERE id = $1::uuid`,
        [leadId]
      );
      await client.query("COMMIT");
      logTelemetry("lead.team_called", { lead_id: leadId });
      return { lead_id: leadId, called_at: stamped.rows[0].called_at, called_by: "team" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getLeadStats(ownerUserId: string): Promise<Record<string, number>> {
    if (!this.database.isEnabled()) {
      return (
        this.appState?.getOwnerLeadStats(ownerUserId) ?? {
          new: 0,
          contacted: 0,
          visit_scheduled: 0,
          deal_done: 0,
          lost: 0,
          total: 0
        }
      );
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
      const existing = this.appState?.getOwnerLead(leadId, ownerUserId);
      if (!existing) {
        throw new BadRequestException({ code: "not_found", message: "Lead not found" });
      }

      const allowed = VALID_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(newStatus)) {
        throw new BadRequestException({
          code: "invalid_transition",
          message: `Cannot transition from ${existing.status} to ${newStatus}`
        });
      }

      this.appState?.updateOwnerLeadStatus(
        leadId,
        ownerUserId,
        newStatus as "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost",
        notes
      );
      return { lead_id: leadId, status: newStatus };
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
    const rows = !this.database.isEnabled()
      ? (
          this.appState?.listOwnerLeads(ownerUserId, undefined, 1, Number.MAX_SAFE_INTEGER, false)
            .items ?? []
        ).map((lead) => ({
          id: lead.id,
          listing_title: lead.listing_title,
          tenant_name: lead.tenant_name,
          tenant_phone_masked: lead.tenant_phone_masked,
          status: lead.status,
          created_at: this.formatCsvDate(lead.created_at),
          status_changed_at: this.formatCsvDate(lead.status_changed_at),
          owner_notes: lead.owner_notes
        }))
      : (
          await this.database.query<{
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
          )
        ).rows;

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
    const csvRows = rows.map((r) =>
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

    return [header, ...csvRows].join("\n");
  }

  private formatCsvDate(value: string) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })
      .format(date)
      .replace(",", "");
  }
}
