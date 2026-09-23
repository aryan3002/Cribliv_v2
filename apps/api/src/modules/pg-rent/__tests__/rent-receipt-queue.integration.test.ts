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
    // Fix round 1, Claim A: recordByOperator's own immediate-render hook now
    // fires for real (RentPaymentService.getAndRenderReceipt), so it — not a
    // later explicit call — is "attempt 1". Configuring the mock BEFORE the
    // call and awaiting the exposed handle (lastMintedReceiptRender) is what
    // makes this deterministic without deleting the hook (see that method's
    // docstring): it settles before the test's very next line runs, so the
    // shared mock is always under the test's control at every step.
    //
    // Cross-task determinism note (unchanged from the earlier round):
    // renderPending() is deliberately global/unscoped (spec §6.7 — one
    // worker sweep drains every property's queue), and 23+ other call sites
    // across this suite mint receipts they never render, leaving them
    // "pending" in the same shared pg_rent_receipts table for their whole
    // test file's lifetime. renderOne(receiptId) — the brief's own scoping
    // overload — is used for every explicit call below so this test never
    // claims a stray receipt from a different test file under concurrent
    // execution; production's unscoped renderPending()/the worker sweep are
    // untouched.
    renderer.render.mockRejectedValueOnce(new Error("chromium down"));
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 9000, method: "cash", paid_on: "2026-09-02" },
      randomUUID()
    );
    await payments.lastMintedReceiptRender;
    const receiptId = paid.receipt_id!;
    await expect(receipts.downloadUrl(operatorId, propertyId, receiptId)).rejects.toMatchObject({
      response: { code: "receipt_not_ready" }
    });
    let row = (
      await db.query<{ pdf_status: string; attempts: number; last_error: string }>(
        `SELECT pdf_status::text, attempts, last_error FROM pg_rent_receipts WHERE id = $1::uuid`,
        [receiptId]
      )
    ).rows[0];
    // attempt 1: the immediate hook, using the mock configured above — still
    // pending with backoff
    expect(row).toMatchObject({ pdf_status: "pending", attempts: 1, last_error: "chromium down" });
    expect(await receipts.renderOne(receiptId)).toBe("skipped"); // backoff not elapsed → skipped
    await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
      receiptId
    ]);

    renderer.render.mockResolvedValueOnce(Buffer.from("%PDF-1.4 fake"));
    expect(await receipts.renderOne(receiptId)).toBe("ready");
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

    // five failures → failed; retry resets. The immediate hook consumes the
    // first of the five (configured below, before recordByOperator), so the
    // explicit loop only needs four more.
    renderer.render.mockRejectedValueOnce(new Error("boom"));
    const paid2 = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 100, method: "cash", paid_on: "2026-09-03" },
      randomUUID()
    );
    await payments.lastMintedReceiptRender;
    for (let i = 0; i < 4; i += 1) {
      renderer.render.mockRejectedValueOnce(new Error("boom"));
      await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
        paid2.receipt_id
      ]);
      await receipts.renderOne(paid2.receipt_id!);
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
    // Same reasoning as the previous test: the immediate hook fires on
    // recordByOperator, so configure its outcome first and await the handle.
    renderer.render.mockRejectedValueOnce(new Error("not ready yet"));
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 200, method: "upi", paid_on: "2026-09-04" },
      randomUUID()
    );
    await payments.lastMintedReceiptRender;
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
    // The hook's failed attempt above set a backoff; bypass it for this
    // explicit, scoped retry (see determinism note in the test above).
    await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
      paid.receipt_id
    ]);
    await receipts.renderOne(paid.receipt_id!);
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

  it("does not resurrect a receipt voided mid-render as a clean 'ready' PDF (Important A, fix round 2)", async () => {
    // Keep the immediate hook out of this scenario: fail its attempt so the
    // receipt is 'pending' after minting, then drive the render explicitly
    // and deterministically below.
    renderer.render.mockRejectedValueOnce(new Error("not yet"));
    const paid = await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 300, method: "cash", paid_on: "2026-09-05" },
      randomUUID()
    );
    await payments.lastMintedReceiptRender;
    const receiptId = paid.receipt_id!;
    await db.query(`UPDATE pg_rent_receipts SET next_attempt_at = now() WHERE id = $1::uuid`, [
      receiptId
    ]);

    // Simulate a reversal's void() landing WHILE this render is in flight.
    // claimForRender's own short transaction has already committed and
    // released its client by the time render() is invoked (the whole point
    // of the round-1 claim/render/finalize split), so a concurrent
    // connection is free to update the row right here — exactly the window
    // rent-payment.service.ts's reverse()/remint() would use in production.
    renderer.render.mockImplementationOnce(async () => {
      await db.query(
        `UPDATE pg_rent_receipts SET voided_at = now(), void_reason = 'reallocated' WHERE id = $1::uuid`,
        [receiptId]
      );
      return Buffer.from("%PDF-clean");
    });
    // finalizeRender still reports "ready" on a CAS miss (parked, not this
    // test's concern — see the fix-round-2 report). What must not happen is
    // the row actually ending up ready with the pre-void PDF.
    await receipts.renderOne(receiptId);
    const row = (
      await db.query<{ pdf_status: string; voided_at: Date | null; pdf_path: string | null }>(
        `SELECT pdf_status::text, voided_at, pdf_path FROM pg_rent_receipts WHERE id = $1::uuid`,
        [receiptId]
      )
    ).rows[0];
    expect(row.voided_at).not.toBeNull();
    // Without the voided_at CAS, this would be "ready" with pdf_path set to
    // the pre-void, un-bannered PDF the mock returned above.
    expect(row.pdf_status).toBe("pending");
    expect(row.pdf_path).toBeNull();
    await expect(receipts.downloadUrl(operatorId, propertyId, receiptId)).rejects.toMatchObject({
      response: { code: "receipt_not_ready" }
    });
  });

  it("confirmBulk never fires the immediate-render hook, so an N-item batch opens zero Chromium pages, not N (Important B, fix round 2)", async () => {
    // confirmBulk's own result only ever carries payment ids
    // (PgRentBulkResult.succeeded: string[]) — confirm()'s single-item hook
    // is what BrowserPool.acquire()'s uncapped page creation would otherwise
    // fan out N times for a batch. Prove the bound is real: renderer.render
    // is called zero additional times across three items confirmed together,
    // and every one of their receipts is left 'pending' for the worker sweep.
    const tenant = await fx.createUser("tenant", "+917700000088");
    await db.query(`UPDATE pg_bed_assignments SET tenant_user_id = $2::uuid WHERE id = $1::uuid`, [
      assignmentId,
      tenant
    ]);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const claimed = await payments.claimByTenant(tenant, {
        assignment_id: assignmentId,
        amount_inr: 50 + i,
        method: "upi",
        paid_on: "2026-09-06",
        idempotency_key: randomUUID()
      });
      ids.push(claimed.id);
    }
    const callsBefore = renderer.render.mock.calls.length;
    const result = await payments.confirmBulk(operatorId, propertyId, ids);
    expect(result).toEqual({ succeeded: ids, failed: [] });
    expect(renderer.render.mock.calls.length).toBe(callsBefore); // zero, not "up to N"
    const rows = await db.query<{ pdf_status: string }>(
      `SELECT pdf_status::text FROM pg_rent_receipts WHERE payment_id = ANY($1::uuid[])`,
      [ids]
    );
    expect(rows.rows).toHaveLength(3); // finalizeConfirmed still minted one per item
    expect(rows.rows.every((r) => r.pdf_status === "pending")).toBe(true);
  });
});
