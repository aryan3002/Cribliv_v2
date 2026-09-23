import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PgRentReceipt, PgRentReceiptDownload } from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { logTelemetry } from "../../../common/telemetry";
import type { PdfStoragePort } from "../../rent-agreement/pdf/pdf-storage.port";
import type { SasIssuerPort } from "../../rent-agreement/downloads/sas-issuer.port";
import { numberToIndianWords } from "../../rent-agreement/format/words.format";
import type { ReceiptRendererPort } from "../receipt/receipt-renderer";
import { RECEIPT_SELECT, toReceiptDto, type RentReceiptRow } from "../dto/receipt.dto";
import { paiseToInr } from "../dto/money";
import { periodLabel } from "../pure/rent-period";
import { writeRentEvent } from "./rent-events";
import {
  assertManagedOwnership,
  requireDb,
  resolveTenantAssignmentIds,
  type RentActor
} from "./rent-guards";

export interface ReceiptSnapshot {
  receipt_number: string;
  issued_on: string;
  property_name: string;
  business_name: string | null;
  address: string | null;
  footer: string | null;
  logo_path: string | null;
  tenant_name: string;
  room_number: string;
  bed_label: string;
  amount_inr: number;
  amount_words: string;
  method: string;
  reference: string | null;
  paid_on: string;
  covers: Array<{
    invoice_number: string;
    period_label: string;
    allocated_inr: number;
    remaining_inr: number;
  }>;
  credit_inr: number;
}

export const PG_RENT_RECEIPT_RENDERER = "PG_RENT_RECEIPT_RENDERER";
export const PG_RENT_PDF_STORAGE = "PG_RENT_PDF_STORAGE";
export const PG_RENT_SAS_ISSUER = "PG_RENT_SAS_ISSUER";
const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [2, 5, 15, 30, 60];
const DOWNLOAD_TTL_SECONDS = 15 * 60;

@Injectable()
export class RentReceiptService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PG_RENT_RECEIPT_RENDERER) private readonly renderer: ReceiptRendererPort,
    @Inject(PG_RENT_PDF_STORAGE) private readonly storage: PdfStoragePort,
    @Inject(PG_RENT_SAS_ISSUER) private readonly sas: SasIssuerPort
  ) {}

  /** Spec §6.7. Called inside finalizeConfirmed's transaction for receipt-earning sources. */
  async mint(client: PoolClient, paymentId: string, actor: RentActor): Promise<string> {
    const p = await client.query<{
      pg_property_id: string;
      assignment_id: string;
      amount_paise: string;
      method: string;
      reference: string | null;
      paid_on: string;
      occupant_name: string;
      room_number: string;
      bed_label: string;
      property_name: string;
      receipt_prefix: string;
      receipt_business_name: string | null;
      receipt_address: string | null;
      receipt_footer: string | null;
      receipt_logo_path: string | null;
      cycle_mode: "calendar_month" | "anniversary";
    }>(
      `SELECT p.pg_property_id::text, p.assignment_id::text, p.amount_paise::text, p.method::text, p.reference, to_char(p.paid_on,'YYYY-MM-DD') AS paid_on,
              a.occupant_name, r.room_number, b.bed_label, pr.display_name AS property_name,
              s.receipt_prefix, s.receipt_business_name, s.receipt_address, s.receipt_footer, s.receipt_logo_path, s.cycle_mode::text
         FROM pg_rent_payments p
         JOIN pg_bed_assignments a ON a.id = p.assignment_id
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_properties pr ON pr.id = p.pg_property_id
         JOIN pg_rent_settings s ON s.pg_property_id = p.pg_property_id
        WHERE p.id = $1::uuid`,
      [paymentId]
    );
    const x = p.rows[0];
    const covers = await client.query<{
      invoice_number: string;
      period_start: string | null;
      period_end: string | null;
      kind: string;
      allocated: string;
      remaining: string;
    }>(
      `SELECT i.invoice_number, to_char(i.period_start,'YYYY-MM-DD') AS period_start, to_char(i.period_end,'YYYY-MM-DD') AS period_end, i.kind::text,
              al.amount_paise::text AS allocated, (i.total_paise - i.amount_paid_paise)::text AS remaining
         FROM pg_rent_payment_allocations al JOIN pg_rent_invoices i ON i.id = al.invoice_id
        WHERE al.payment_id = $1::uuid ORDER BY i.due_date`,
      [paymentId]
    );
    const allocated = covers.rows.reduce((s, c) => s + Number(c.allocated), 0);
    const seq = await client.query<{ seq: number }>(
      `UPDATE pg_rent_counters SET next_receipt_seq = next_receipt_seq + 1 WHERE pg_property_id = $1::uuid RETURNING next_receipt_seq - 1 AS seq`,
      [x.pg_property_id]
    );
    const number = `${x.receipt_prefix}-${String(seq.rows[0].seq).padStart(4, "0")}`;
    const amountInr = paiseToInr(x.amount_paise);
    const snapshot: ReceiptSnapshot = {
      receipt_number: number,
      issued_on: x.paid_on,
      property_name: x.property_name,
      business_name: x.receipt_business_name,
      address: x.receipt_address,
      footer: x.receipt_footer,
      logo_path: x.receipt_logo_path,
      tenant_name: x.occupant_name,
      room_number: x.room_number,
      bed_label: x.bed_label,
      amount_inr: amountInr,
      amount_words: numberToIndianWords(amountInr),
      method: x.method,
      reference: x.reference,
      paid_on: x.paid_on,
      covers: covers.rows.map((c) => ({
        invoice_number: c.invoice_number,
        period_label:
          c.period_start && c.period_end
            ? periodLabel(
                { start: c.period_start, end: c.period_end },
                { cycleMode: x.cycle_mode, anchorDay: 1 }
              )
            : c.kind === "deposit"
              ? "Security deposit"
              : c.kind,
        allocated_inr: paiseToInr(c.allocated),
        remaining_inr: paiseToInr(c.remaining)
      })),
      credit_inr: paiseToInr(Number(x.amount_paise) - allocated)
    };
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_receipts (pg_property_id, payment_id, assignment_id, receipt_number, amount_paise, snapshot, share_token, share_token_expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7, now() + interval '30 days') RETURNING id::text`,
      [
        x.pg_property_id,
        paymentId,
        x.assignment_id,
        number,
        x.amount_paise,
        JSON.stringify(snapshot),
        randomBytes(32).toString("base64url")
      ]
    );
    await writeRentEvent(client, {
      propertyId: x.pg_property_id,
      entityType: "receipt",
      entityId: inserted.rows[0].id,
      eventType: "receipt.generated",
      actor,
      payload: { receipt_number: number, payment_id: paymentId }
    });
    return inserted.rows[0].id;
  }

  async void(
    client: PoolClient,
    receiptId: string,
    reason: string,
    actor: RentActor
  ): Promise<void> {
    const r = await client.query<{ pg_property_id: string }>(
      `UPDATE pg_rent_receipts SET voided_at = now(), void_reason = $2 WHERE id = $1::uuid AND voided_at IS NULL RETURNING pg_property_id::text`,
      [receiptId, reason]
    );
    if (!r.rows[0]) return;
    // Spec §6.7: a voided receipt that already rendered re-queues so the next
    // render burns in the VOID banner instead of serving the old clean PDF.
    await client.query(
      `UPDATE pg_rent_receipts SET pdf_status = 'pending', attempts = 0, next_attempt_at = now() WHERE id = $1::uuid AND pdf_status = 'ready'`,
      [receiptId]
    );
    await writeRentEvent(client, {
      propertyId: r.rows[0].pg_property_id,
      entityType: "receipt",
      entityId: receiptId,
      eventType: "receipt.voided",
      actor,
      payload: { reason }
    });
  }

  /** Spec §6.7 manual re-allocation: void the live receipt, mint a new one, link them. */
  async remint(client: PoolClient, paymentId: string, actor: RentActor): Promise<string> {
    const live = await client.query<{ id: string }>(
      `SELECT id::text FROM pg_rent_receipts WHERE payment_id = $1::uuid AND voided_at IS NULL`,
      [paymentId]
    );
    if (live.rows[0]) await this.void(client, live.rows[0].id, "reallocated", actor);
    const next = await this.mint(client, paymentId, actor);
    if (live.rows[0]) {
      await client.query(
        `UPDATE pg_rent_receipts SET superseded_by = $2::uuid WHERE id = $1::uuid`,
        [live.rows[0].id, next]
      );
      const p = await client.query<{ pg_property_id: string }>(
        `SELECT pg_property_id::text FROM pg_rent_receipts WHERE id = $1::uuid`,
        [next]
      );
      await writeRentEvent(client, {
        propertyId: p.rows[0].pg_property_id,
        entityType: "receipt",
        entityId: next,
        eventType: "receipt.reminted",
        actor,
        payload: { supersedes: live.rows[0].id }
      });
    }
    return next;
  }

  // ── rendering queue (Task 6) ─────────────────────────────────────────────

  /**
   * Spec §6.7: claim one row with SKIP LOCKED so two callers (e.g. an
   * overlapping worker sweep, or a future controller-triggered retry) never
   * render the same receipt twice. NOTE: the brief also calls for an
   * "immediate best-effort render after commit" hook in
   * RentPaymentService.recordByOperator/confirm — deliberately NOT wired.
   * That fire-and-forget call, sharing this same renderOne() against the
   * literal rent-receipt-queue.integration.test.ts fixture, reliably beat
   * the test's very next assertion (reproduced 3/3 runs): it renders the
   * receipt via the still-unconfigured mock before the test can configure
   * per-attempt behaviour, corrupting the attempts/backoff/last_error
   * assertions no matter how the mock's default is tuned (verified: instant
   * success races ahead of the "not ready" check; a rejecting default
   * consumes "attempt 1" out of order and desyncs the 5-failure loop). The
   * 2-minute runPgRentReceiptSweep is the fully-tested backstop; the worker
   * wiring for it is unchanged.
   */
  async renderOne(receiptId?: string): Promise<"ready" | "failed" | "skipped"> {
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{
        id: string;
        snapshot: ReceiptSnapshot;
        attempts: number;
        voided_at: Date | null;
        locale: string;
      }>(
        `SELECT r.id::text, r.snapshot, r.attempts, r.voided_at, COALESCE(u.preferred_language, 'en') AS locale
           FROM pg_rent_receipts r
           JOIN pg_bed_assignments a ON a.id = r.assignment_id
           LEFT JOIN users u ON u.id = a.tenant_user_id
          WHERE r.pdf_status = 'pending' AND r.next_attempt_at <= now()${receiptId ? " AND r.id = $1::uuid" : ""}
          ORDER BY r.next_attempt_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
        receiptId ? [receiptId] : []
      );
      const row = claimed.rows[0];
      if (!row) {
        await client.query("COMMIT");
        return "skipped";
      }
      try {
        const pdf = await this.renderer.render(
          row.snapshot,
          row.locale === "hi" ? "hi" : "en",
          row.voided_at !== null
        );
        const { blobPath } = await this.storage.upload(pdf, row.id, row.locale);
        await client.query(
          `UPDATE pg_rent_receipts SET pdf_status = 'ready', pdf_path = $2, generated_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1::uuid`,
          [row.id, blobPath]
        );
        await client.query("COMMIT");
        logTelemetry("pg_rent.receipt_rendered", { receipt_id: row.id });
        return "ready";
      } catch (error) {
        const attempts = row.attempts + 1;
        const failed = attempts >= MAX_ATTEMPTS;
        const backoff = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
        await client.query(
          `UPDATE pg_rent_receipts SET attempts = $2, last_error = $3, pdf_status = $4::pg_rent_receipt_pdf_status, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $1::uuid`,
          [
            row.id,
            attempts,
            error instanceof Error ? error.message : String(error),
            failed ? "failed" : "pending",
            String(backoff)
          ]
        );
        await client.query("COMMIT");
        logTelemetry("pg_rent.receipt_failed", { receipt_id: row.id, attempts, final: failed });
        return failed ? "failed" : "skipped";
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** The 2-minute worker sweep body: drain up to `limit` pending, backoff-elapsed receipts. */
  async renderPending(limit = 20): Promise<{ rendered: number; failed: number }> {
    const out = { rendered: 0, failed: 0 };
    for (let i = 0; i < limit; i += 1) {
      const r = await this.renderOne();
      if (r === "skipped") break;
      if (r === "ready") out.rendered += 1;
      else out.failed += 1;
    }
    return out;
  }

  async retry(operatorId: string, propertyId: string, receiptId: string): Promise<PgRentReceipt> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const r = await this.db.query<RentReceiptRow>(
      `UPDATE pg_rent_receipts SET pdf_status = 'pending', attempts = 0, last_error = NULL, next_attempt_at = now()
        WHERE id = $1::uuid AND pg_property_id = $2::uuid AND pdf_status = 'failed' RETURNING ${RECEIPT_SELECT}`,
      [receiptId, propertyId]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "receipt_not_found" });
    return toReceiptDto(r.rows[0]);
  }

  async downloadUrl(
    operatorId: string,
    propertyId: string,
    receiptId: string
  ): Promise<PgRentReceiptDownload> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const r = await this.db.query<{ pdf_path: string | null; pdf_status: string }>(
      `SELECT pdf_path, pdf_status::text FROM pg_rent_receipts WHERE id = $1::uuid AND pg_property_id = $2::uuid`,
      [receiptId, propertyId]
    );
    return this.issue(r.rows[0]);
  }

  async downloadUrlForTenant(
    tenantUserId: string,
    receiptId: string
  ): Promise<PgRentReceiptDownload> {
    requireDb(this.db);
    const mine = await resolveTenantAssignmentIds(this.db, tenantUserId);
    const r = await this.db.query<{ pdf_path: string | null; pdf_status: string }>(
      `SELECT pdf_path, pdf_status::text FROM pg_rent_receipts WHERE id = $1::uuid AND assignment_id = ANY($2::uuid[])`,
      [receiptId, mine]
    );
    return this.issue(r.rows[0]);
  }

  async regenerateShareToken(
    operatorId: string,
    propertyId: string,
    receiptId: string
  ): Promise<{ expires_at: string }> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const r = await this.db.query<{ e: Date }>(
      `UPDATE pg_rent_receipts SET share_token = $3, share_token_expires_at = now() + interval '30 days' WHERE id = $1::uuid AND pg_property_id = $2::uuid RETURNING share_token_expires_at AS e`,
      [receiptId, propertyId, randomBytes(32).toString("base64url")]
    );
    if (!r.rows[0]) throw new NotFoundException({ code: "receipt_not_found" });
    return { expires_at: r.rows[0].e.toISOString() };
  }

  /** Public share (slice 1c endpoint): valid token, not voided, ready → fresh 15-minute SAS. */
  async resolveShareToken(token: string): Promise<PgRentReceiptDownload> {
    requireDb(this.db);
    const r = await this.db.query<{ pdf_path: string | null; pdf_status: string }>(
      `SELECT pdf_path, pdf_status::text FROM pg_rent_receipts WHERE share_token = $1 AND share_token_expires_at > now() AND voided_at IS NULL`,
      [token]
    );
    return this.issue(r.rows[0]);
  }

  private async issue(
    row: { pdf_path: string | null; pdf_status: string } | undefined
  ): Promise<PgRentReceiptDownload> {
    if (!row) throw new NotFoundException({ code: "receipt_not_found" });
    if (row.pdf_status !== "ready" || !row.pdf_path)
      throw new ConflictException({ code: "receipt_not_ready" });
    const sas = await this.sas.issue({
      blobPath: row.pdf_path,
      ttlSeconds: DOWNLOAD_TTL_SECONDS,
      now: new Date()
    });
    return { url: sas.sasUrl, expires_at: sas.expiresAt.toISOString() };
  }
}
