import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AppStateService } from "../../common/app-state.service";
import { ok } from "../../common/response";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";

@Controller("admin")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get("review/listings")
  async listingQueue(@Query("status") status?: string): Promise<any> {
    if (this.database.isEnabled()) {
      const params: unknown[] = [];
      const statusClause = status ? "WHERE l.status = $1::listing_status" : "";
      if (status) {
        params.push(status);
      }

      const items = await this.database.query<{
        id: string;
        status: string;
        listing_type: string;
        title: string;
        owner_user_id: string;
        city: string | null;
        monthly_rent: number;
        verification_status: string;
        created_at: string;
      }>(
        `
        SELECT
          l.id::text,
          l.status::text,
          l.listing_type::text,
          COALESCE(NULLIF(l.title_en, ''), NULLIF(l.title_hi, ''), 'Listing') AS title,
          l.owner_user_id::text,
          c.slug AS city,
          l.monthly_rent,
          l.verification_status::text,
          l.created_at::text
        FROM listings l
        LEFT JOIN listing_locations ll ON ll.listing_id = l.id
        LEFT JOIN cities c ON c.id = ll.city_id
        ${statusClause}
        ORDER BY l.created_at DESC
        `,
        params
      );

      return ok({
        items: items.rows,
        total: items.rowCount ?? 0
      });
    }

    const items = [...this.appState.listings.values()].filter(
      (l) => !status || l.status === status
    );
    return ok({ items, total: items.length });
  }

  @Post("review/listings/:listing_id/decision")
  async listingDecision(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { decision: "approve" | "reject" | "pause"; reason?: string }
  ) {
    if (this.database.isEnabled()) {
      if ((body.decision === "reject" || body.decision === "pause") && !body.reason) {
        throw new BadRequestException({ code: "reason_required", message: "Reason is required" });
      }

      const newStatus =
        body.decision === "approve" ? "active" : body.decision === "reject" ? "rejected" : "paused";
      const updated = await this.database.query<{ id: string; status: string }>(
        `
        UPDATE listings
        SET status = $2::listing_status, updated_at = now()
        WHERE id = $1::uuid
        RETURNING id::text, status::text
        `,
        [listingId, newStatus]
      );

      if (!updated.rowCount || !updated.rows[0]) {
        throw new BadRequestException({ code: "not_found", message: "Listing not found" });
      }

      await this.database.query(
        `
        INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
        VALUES ($1::uuid, 'listing', $2::uuid, $3::admin_action_type, $4, null, $5::jsonb)
        `,
        [
          req.user.id,
          listingId,
          body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : "pause",
          body.reason ?? null,
          JSON.stringify({ status: newStatus })
        ]
      );

      logTelemetry("admin.listing_decision", {
        listing_id: updated.rows[0].id,
        decision: body.decision,
        admin_user_id: req.user.id
      });

      return ok({ listing_id: updated.rows[0].id, new_status: updated.rows[0].status });
    }

    const listing = this.appState.listings.get(listingId);
    if (!listing) {
      throw new BadRequestException({ code: "not_found", message: "Listing not found" });
    }

    if ((body.decision === "reject" || body.decision === "pause") && !body.reason) {
      throw new BadRequestException({ code: "reason_required", message: "Reason is required" });
    }

    listing.status =
      body.decision === "approve" ? "active" : body.decision === "reject" ? "rejected" : "paused";

    this.appState.adminActions.push({
      admin_id: req.user.id,
      target_type: "listing",
      target_id: listingId,
      action: `listing_${body.decision}`,
      reason: body.reason ?? null,
      created_at: new Date().toISOString()
    });

    logTelemetry("admin.listing_decision", {
      mode: "in_memory",
      listing_id: listing.id,
      decision: body.decision,
      admin_user_id: req.user.id
    });

    return ok({ listing_id: listing.id, new_status: listing.status });
  }

  @Get("review/verifications")
  async verificationQueue(@Query("result") result?: string) {
    if (this.database.isEnabled()) {
      const params: unknown[] = [];
      const filter = result ? "WHERE va.result = $1::verification_result" : "";
      if (result) {
        params.push(result);
      }

      const items = await this.database.query<{
        id: string;
        listing_id: string | null;
        user_id: string;
        verification_type: string;
        result: string;
        address_match_score: number | null;
        liveness_score: number | null;
        threshold: number;
        created_at: string;
        provider: string | null;
        provider_reference: string | null;
        provider_result_code: string | null;
        review_reason: string | null;
        retryable: boolean | null;
        machine_result: string | null;
      }>(
        `
        SELECT
          va.id::text,
          va.listing_id::text,
          va.user_id::text,
          va.verification_type::text,
          va.result::text,
          va.address_match_score,
          va.liveness_score,
          va.threshold,
          va.created_at::text,
          vpl.provider,
          vpl.provider_reference,
          vpl.provider_result_code,
          vpl.review_reason,
          vpl.retryable,
          vpl.result::text AS machine_result
        FROM verification_attempts va
        LEFT JOIN LATERAL (
          SELECT provider, provider_reference, provider_result_code, review_reason, retryable, result
          FROM verification_provider_logs
          WHERE attempt_id = va.id
          ORDER BY created_at DESC
          LIMIT 1
        ) vpl ON true
        ${filter}
        ORDER BY va.created_at DESC
        `,
        params
      );

      return ok({ items: items.rows, total: items.rowCount ?? 0 });
    }

    const items = this.appState.verificationAttempts
      .filter((a) => !result || a.result === result)
      .map((attempt) => ({
        ...attempt,
        machine_result: attempt.machine_result ?? attempt.result
      }));
    return ok({ items, total: items.length });
  }

  @Post("review/verifications/:attempt_id/decision")
  async verificationDecision(
    @Req() req: { user: { id: string } },
    @Param("attempt_id") attemptId: string,
    @Body() body: { decision: "pass" | "fail" | "manual_review"; reason?: string }
  ) {
    if (this.database.isEnabled()) {
      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        const attempt = await client.query<{ listing_id: string | null }>(
          `
          UPDATE verification_attempts
          SET result = $2::verification_result,
              reviewed_by = $3::uuid,
              reviewed_at = now(),
              failure_reason = COALESCE($4, failure_reason),
              updated_at = now()
          WHERE id = $1::uuid
          RETURNING listing_id::text
          `,
          [attemptId, body.decision, req.user.id, body.reason ?? null]
        );

        if (!attempt.rowCount) {
          throw new BadRequestException({ code: "not_found", message: "Attempt not found" });
        }

        const listingId = attempt.rows[0].listing_id;
        if (listingId) {
          const currentStatus = await client.query<{ verification_status: string }>(
            `
            SELECT verification_status::text
            FROM listings
            WHERE id = $1::uuid
            LIMIT 1
            `,
            [listingId]
          );
          const listingStatus =
            body.decision === "pass" ? "verified" : body.decision === "fail" ? "failed" : "pending";
          await client.query(
            `
            UPDATE listings
            SET verification_status = $2::verification_status, updated_at = now()
            WHERE id = $1::uuid
            `,
            [listingId, listingStatus]
          );
          logTelemetry("verification.final_status_transition", {
            listing_id: listingId,
            previous_status: currentStatus.rows[0]?.verification_status ?? null,
            new_status: listingStatus,
            source: "admin_verification_decision",
            admin_user_id: req.user.id
          });
        }

        await client.query(
          `
          INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
          VALUES ($1::uuid, 'verification_attempt', $2::uuid, $3::admin_action_type, $4, null, $5::jsonb)
          `,
          [
            req.user.id,
            attemptId,
            body.decision === "manual_review"
              ? "manual_review"
              : body.decision === "pass"
                ? "approve"
                : "reject",
            body.reason ?? null,
            JSON.stringify({ result: body.decision })
          ]
        );

        await client.query("COMMIT");
        logTelemetry("admin.verification_decision", {
          attempt_id: attemptId,
          decision: body.decision,
          admin_user_id: req.user.id
        });
        return ok({ attempt_id: attemptId, new_result: body.decision });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    const attempt = this.appState.verificationAttempts.find((a) => a.id === attemptId);
    if (!attempt) {
      throw new BadRequestException({ code: "not_found", message: "Attempt not found" });
    }

    attempt.result = body.decision;
    const listingId =
      typeof attempt.listing_id === "string"
        ? attempt.listing_id
        : (attempt.listing_id as string | undefined);
    if (listingId) {
      const listing = this.appState.listings.get(listingId);
      if (listing) {
        const previous = listing.verificationStatus;
        listing.verificationStatus =
          body.decision === "pass" ? "verified" : body.decision === "fail" ? "failed" : "pending";
        logTelemetry("verification.final_status_transition", {
          mode: "in_memory",
          listing_id: listingId,
          previous_status: previous,
          new_status: listing.verificationStatus,
          source: "admin_verification_decision",
          admin_user_id: req.user.id
        });
      }
    }
    this.appState.adminActions.push({
      admin_id: req.user.id,
      target_type: "verification_attempt",
      target_id: attemptId,
      action: `verification_${body.decision}`,
      reason: body.reason ?? null,
      created_at: new Date().toISOString()
    });

    logTelemetry("admin.verification_decision", {
      mode: "in_memory",
      attempt_id: attemptId,
      decision: body.decision,
      admin_user_id: req.user.id
    });

    return ok({ attempt_id: attemptId, new_result: body.decision });
  }

  @Get("leads")
  async leads(@Query("status") status?: string) {
    if (this.database.isEnabled()) {
      const params: unknown[] = [];
      const statusClause = status ? "WHERE sl.status = $1::sales_lead_status" : "";
      if (status) {
        params.push(status);
      }

      const result = await this.database.query<{
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
      }>(
        `
        SELECT
          sl.id::text,
          sl.created_by_user_id::text,
          sl.listing_id::text,
          sl.source::text,
          sl.status::text,
          sl.notes,
          sl.metadata,
          sl.crm_sync_status,
          sl.last_crm_push_at::text,
          sl.created_at::text
        FROM sales_leads sl
        ${statusClause}
        ORDER BY sl.created_at DESC
        `,
        params
      );

      return ok({ items: result.rows, total: result.rowCount ?? 0 });
    }

    const items = this.appState
      .listSalesLeads()
      .filter((lead) => !status || lead.status === status)
      .map((lead) => ({
        id: lead.id,
        created_by_user_id: lead.createdByUserId,
        listing_id: lead.listingId ?? null,
        source: lead.source,
        status: lead.status,
        notes: lead.notes ?? null,
        metadata: lead.metadata,
        crm_sync_status: "pending",
        last_crm_push_at: null,
        created_at: new Date(lead.createdAt).toISOString()
      }));

    return ok({ items, total: items.length });
  }

  @Post("leads/:lead_id/status")
  async updateLeadStatus(
    @Req() req: { user: { id: string } },
    @Param("lead_id") leadId: string,
    @Body()
    body: {
      status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
      reason?: string;
    }
  ) {
    if (this.database.isEnabled()) {
      const updated = await this.database.query<{ id: string; status: string }>(
        `
        UPDATE sales_leads
        SET status = $2::sales_lead_status, updated_at = now()
        WHERE id = $1::uuid
        RETURNING id::text, status::text
        `,
        [leadId, body.status]
      );

      if (!updated.rowCount || !updated.rows[0]) {
        throw new BadRequestException({ code: "not_found", message: "Lead not found" });
      }

      await this.database.query(
        `
        INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
        VALUES ($1::uuid, 'sales_lead', $2::uuid, 'update_lead'::admin_action_type, $3, null, $4::jsonb)
        `,
        [req.user.id, leadId, body.reason ?? null, JSON.stringify({ status: body.status })]
      );

      logTelemetry("admin.lead_status_updated", {
        lead_id: updated.rows[0].id,
        status: updated.rows[0].status,
        admin_user_id: req.user.id
      });

      return ok({ lead_id: updated.rows[0].id, status: updated.rows[0].status });
    }

    const updated = this.appState.updateSalesLeadStatus(leadId, body.status);
    if (!updated) {
      throw new BadRequestException({ code: "not_found", message: "Lead not found" });
    }

    this.appState.adminActions.push({
      admin_id: req.user.id,
      target_type: "sales_lead",
      target_id: leadId,
      action: "lead_status_update",
      reason: body.reason ?? null,
      created_at: new Date().toISOString()
    });

    logTelemetry("admin.lead_status_updated", {
      mode: "in_memory",
      lead_id: updated.id,
      status: updated.status,
      admin_user_id: req.user.id
    });

    return ok({ lead_id: updated.id, status: updated.status });
  }

  @Post("wallet/adjust")
  async adjustWallet(
    @Req() req: { user: { id: string } },
    @Body() body: { user_id: string; credits_delta: number; reason: string }
  ) {
    if (this.database.isEnabled()) {
      if (!body.credits_delta || !body.reason) {
        throw new BadRequestException({
          code: "invalid_delta",
          message: "credits_delta and reason are required"
        });
      }

      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        await client.query(
          `
          INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
          VALUES ($1::uuid, 0, 0)
          ON CONFLICT (user_id) DO NOTHING
          `,
          [body.user_id]
        );

        const txn = await client.query<{ id: string }>(
          `
          INSERT INTO wallet_transactions(
            wallet_user_id,
            txn_type,
            credits_delta,
            reference_type,
            reference_id,
            metadata
          )
          VALUES ($1::uuid, 'admin_adjustment', $2, 'admin', $3::uuid, $4::jsonb)
          RETURNING id::text
          `,
          [body.user_id, body.credits_delta, req.user.id, JSON.stringify({ reason: body.reason })]
        );

        const wallet = await client.query<{ balance_credits: number }>(
          `
          UPDATE wallets
          SET balance_credits = balance_credits + $2,
              updated_at = now()
          WHERE user_id = $1::uuid
          RETURNING balance_credits
          `,
          [body.user_id, body.credits_delta]
        );

        await client.query(
          `
          INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
          VALUES ($1::uuid, 'wallet', $2::uuid, 'adjust_wallet', $3, null, $4::jsonb)
          `,
          [
            req.user.id,
            body.user_id,
            body.reason,
            JSON.stringify({ credits_delta: body.credits_delta })
          ]
        );

        await client.query("COMMIT");
        return ok({
          transaction_id: txn.rows[0].id,
          balance_credits: Number(wallet.rows[0]?.balance_credits ?? 0)
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    if (!body.credits_delta || !body.reason) {
      throw new BadRequestException({
        code: "invalid_delta",
        message: "credits_delta and reason are required"
      });
    }

    const txn = this.appState.addWalletTxn({
      userId: body.user_id,
      type: "admin_adjustment",
      creditsDelta: body.credits_delta,
      referenceId: req.user.id
    });

    return ok({
      transaction_id: txn.id,
      balance_credits: this.appState.getWalletBalance(body.user_id)
    });
  }
}
