import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("receipt render queue", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;
  let receipts: RentReceiptService;
  let payments: RentPaymentService;
  const renderer = { render: vi.fn() };

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId, { internalCode: "RCP" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    const settings = new RentSettingsService(db);
    await settings.enable(operatorId, propertyId, { billing_starts_on: "2026-09-01" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01"
    });
    const alloc = new RentAllocationService();
    await new RentInvoiceEngineService(db, settings, alloc).generateInvoicesForProperty(
      propertyId,
      "2026-09-01"
    );
    receipts = new RentReceiptService(
      db,
      renderer,
      new InMemoryPdfStorage(),
      new DevApiSasIssuer({ baseUrl: "http://api.test" })
    );
    payments = new RentPaymentService(db, settings, alloc, receipts);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("renders pending receipts, retries with backoff, marks failed after 5 attempts, and serves a download URL", async () => {
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 9000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    const receiptId = paid.receipt_id!;
    await expect(receipts.downloadUrl(operatorId, propertyId, receiptId)).rejects.toMatchObject({
      response: { code: "receipt_not_ready" }
    });

    renderer.render.mockRejectedValueOnce(new Error("chromium down"));
    expect(await receipts.renderPending()).toEqual({ rendered: 0, failed: 0 }); // attempt 1 failed → still pending with backoff
    let row = (
      await db.query<{ pdf_status: string; attempts: number; last_error: string }>(
        `SELECT pdf_status::text, attempts, last_error FROM pg_rent_receipts WHERE id = $1::uuid`,
        [receiptId]
      )
    ).rows[0];
    expect(row).toMatchObject({ pdf_status: "pending", attempts: 1, last_error: "chromium down" });
    expect(await receipts.renderPending()).toEqual({ rendered: 0, failed: 0 }); // backoff not elapsed → skipped
    await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
      receiptId
    ]);

    renderer.render.mockResolvedValueOnce(Buffer.from("%PDF-1.4 fake"));
    expect(await receipts.renderPending()).toEqual({ rendered: 1, failed: 0 });
    row = (
      await db.query<{ pdf_status: string; attempts: number; last_error: string }>(
        `SELECT pdf_status::text, attempts, last_error FROM pg_rent_receipts WHERE id = $1::uuid`,
        [receiptId]
      )
    ).rows[0];
    expect(row.pdf_status).toBe("ready");
    expect(renderer.render).toHaveBeenLastCalledWith(
      expect.objectContaining({ receipt_number: "RCP-0001" }),
      "en",
      false
    );
    const dl = await receipts.downloadUrl(operatorId, propertyId, receiptId);
    expect(dl.url).toContain("http://api.test");

    // five failures → failed; retry resets
    const paid2 = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 100, method: "cash", paid_on: "2026-09-03" },
      randomUUID()
    );
    for (let i = 0; i < 5; i += 1) {
      renderer.render.mockRejectedValueOnce(new Error("boom"));
      await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
        paid2.receipt_id
      ]);
      await receipts.renderPending();
    }
    expect(
      (
        await db.query<{ s: string }>(
          `SELECT pdf_status::text AS s FROM pg_rent_receipts WHERE id = $1::uuid`,
          [paid2.receipt_id]
        )
      ).rows[0].s
    ).toBe("failed");
    expect(await receipts.retry(operatorId, propertyId, paid2.receipt_id!)).toMatchObject({
      pdf_status: "pending",
      attempts: 0
    });
  });

  it("share token resolves only while valid, ready and not voided", async () => {
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 200, method: "upi", paid_on: "2026-09-04" },
      randomUUID()
    );
    const token = (
      await db.query<{ t: string }>(
        `SELECT share_token AS t FROM pg_rent_receipts WHERE id = $1::uuid`,
        [paid.receipt_id]
      )
    ).rows[0].t;
    await expect(receipts.resolveShareToken(token)).rejects.toMatchObject({
      response: { code: "receipt_not_ready" }
    });
    renderer.render.mockResolvedValueOnce(Buffer.from("%PDF"));
    await receipts.renderPending();
    expect((await receipts.resolveShareToken(token)).url).toContain("http://api.test");
    await expect(receipts.resolveShareToken("nope")).rejects.toMatchObject({
      response: { code: "receipt_not_found" }
    });
    await db.query(
      `UPDATE pg_rent_receipts SET share_token_expires_at = now() - interval '1 day' WHERE id = $1::uuid`,
      [paid.receipt_id]
    );
    await expect(receipts.resolveShareToken(token)).rejects.toMatchObject({
      response: { code: "receipt_not_found" }
    });
    const regen = await receipts.regenerateShareToken(operatorId, propertyId, paid.receipt_id!);
    expect(new Date(regen.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});
