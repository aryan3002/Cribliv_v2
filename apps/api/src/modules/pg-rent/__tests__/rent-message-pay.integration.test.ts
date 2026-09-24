import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { DevApiSasIssuer } from "../../rent-agreement/downloads/dev-api-sas-issuer";
import { InMemoryPdfStorage } from "../../rent-agreement/pdf/in-memory-pdf-storage";
import { RentAllocationService } from "../services/rent-allocation.service";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentMessageService } from "../services/rent-message.service";
import { RentPayInstructionService } from "../services/rent-pay-instruction.service";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("RentPayInstructionService.buildPayInstruction", () => {
  const svc = new RentPayInstructionService({ isEnabled: () => false } as DatabaseService);
  it("prefers UPI intent with a QR, then bank details, then manual", async () => {
    const upi = await svc.buildPayInstruction({
      settings: { upi_vpa: "sun@okaxis", upi_payee_name: "Sunrise", bank_details: null },
      amountInr: 9000,
      note: "Rent September 2026",
      tr: "SUN-INV-0007"
    });
    expect(upi.mode).toBe("upi_intent");
    if (upi.mode === "upi_intent") {
      expect(upi.upi_uri).toContain("pa=sun%40okaxis");
      expect(upi.qr_svg.startsWith("<svg")).toBe(true);
      expect(upi.bank).toBeNull();
    }
    const bank = await svc.buildPayInstruction({
      settings: {
        upi_vpa: null,
        upi_payee_name: null,
        bank_details: {
          account_name: "A",
          account_number: "1",
          ifsc: "HDFC0001234",
          bank_name: "HDFC"
        }
      },
      amountInr: 1,
      note: "",
      tr: "X"
    });
    expect(bank.mode).toBe("bank_details");
    expect(
      (
        await svc.buildPayInstruction({
          settings: { upi_vpa: null, upi_payee_name: null, bank_details: null },
          amountInr: 1,
          note: "",
          tr: "X"
        })
      ).mode
    ).toBe("manual");
  });
  it("pay links use the apex site URL and the locale", () => {
    expect(svc.payLinkFor("hi", "abc")).toMatch(/^https:\/\/cribliv\.com\/hi\/pay\/abc$/);
  });
});

describe.skipIf(!HAS_DB)("RentMessageService + public pay page", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let tenantUserId: string;
  let propertyId: string;
  let assignmentId: string;
  let invoiceId: string;
  let messages: RentMessageService;
  let pay: RentPayInstructionService;
  let payments: RentPaymentService;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator", "+917700000011");
    await db.query(`UPDATE users SET full_name = 'Sunil Owner' WHERE id = $1::uuid`, [operatorId]);
    tenantUserId = await fx.createUser("tenant", "+917700000022");
    propertyId = await fx.createProperty(operatorId, {
      internalCode: "SUN",
      displayName: "Sunrise PG"
    });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "102" });
    const settings = new RentSettingsService(db);
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      upi_vpa: "sun@okaxis",
      upi_payee_name: "Sunrise PG",
      late_fee_enabled: true,
      late_fee_amount_inr: 300
    });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-09-01",
      occupantName: "Rahul Verma",
      occupantPhone: "+917700000022",
      tenantUserId
    });
    const alloc = new RentAllocationService();
    await new RentInvoiceEngineService(db, settings, alloc).generateInvoicesForProperty(
      propertyId,
      "2026-09-01"
    );
    invoiceId = (
      await db.query<{ id: string }>(
        `SELECT id::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent'`,
        [assignmentId]
      )
    ).rows[0].id;
    pay = new RentPayInstructionService(db);
    messages = new RentMessageService(db, pay);
    payments = new RentPaymentService(
      db,
      settings,
      alloc,
      new RentReceiptService(
        db,
        { render: async () => Buffer.from("%PDF") },
        new InMemoryPdfStorage(),
        new DevApiSasIssuer()
      )
    );
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("renders the four templates with real fields and wa.me links; unknown fields and no-VPA are warned", async () => {
    const m = await messages.messagesForInvoice(operatorId, propertyId, invoiceId);
    expect(m.pay_link).toMatch(/\/en\/pay\/[A-Za-z0-9_-]{43}$/);
    expect(m.reminder.text).toBe(
      `Hi Rahul Verma, rent of ₹9,000 for September 2026 (Room 102, Bed A) is overdue by ${daysSince("2026-09-05")} days. Pay here: ${m.pay_link} — Sunil Owner, Sunrise PG`
    );
    expect(m.reminder.wa_me_url).toMatch(/^https:\/\/wa\.me\/917700000022\?text=/);
    expect(m.reminder.recipient_e164).toBe("+917700000022");
    expect(m.overdue.text).toContain("₹9,000");
    expect(m.receipt_share).toBeNull(); // no receipt yet
    expect(m.warnings).toEqual([]);

    await db.query(
      `UPDATE pg_rent_settings SET msg_reminder = 'Hey {tenant_name} pay {amount} via {upi_id} {typo}' , upi_vpa = NULL WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const m2 = await messages.messagesForInvoice(operatorId, propertyId, invoiceId);
    expect(m2.reminder.text).toBe("Hey Rahul Verma pay ₹9,000 via (not set) {typo}");
    expect(m2.reminder.unknown_fields).toEqual(["typo"]);
    expect(m2.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/UPI ID/), expect.stringMatching(/typo/)])
    );
    await db.query(
      `UPDATE pg_rent_settings SET msg_reminder = NULL, upi_vpa = 'sun@okaxis' WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
  });

  it("an expired pay token blanks the shared pay_link and warns; regenerating restores it", async () => {
    await db.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      [invoiceId]
    );
    const expired = await messages.messagesForInvoice(operatorId, propertyId, invoiceId);
    expect(expired.pay_link).toBe("");
    expect(expired.warnings).toContain("pay_link_expired");
    expect(expired.reminder.text).not.toContain("/pay/");

    await messages.regeneratePayToken(operatorId, propertyId, invoiceId);
    const live = await messages.messagesForInvoice(operatorId, propertyId, invoiceId);
    expect(live.pay_link).toMatch(/\/en\/pay\/[A-Za-z0-9_-]{43}$/);
    expect(live.warnings).not.toContain("pay_link_expired");
  });

  it("preview merges arbitrary text against the invoice; reminder-opened logs stage + channel", async () => {
    const p = await messages.preview(operatorId, propertyId, {
      key: "overdue",
      text: "{tenant_name}: {balance} {due_phrase}",
      invoice_id: invoiceId
    });
    expect(p.text).toMatch(/^Rahul Verma: ₹9,000 overdue by \d+ days$/);
    await messages.reminderOpened(operatorId, propertyId, invoiceId, {
      stage: "overdue",
      channel: "whatsapp"
    });
    await messages.reminderOpened(operatorId, propertyId, invoiceId, {
      stage: "overdue",
      channel: "call"
    });
    const ev = await db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'reminder.opened' ORDER BY id`,
      [invoiceId]
    );
    expect(ev.rows.map((e) => e.payload)).toEqual([
      { stage: "overdue", channel: "whatsapp" },
      { stage: "overdue", channel: "call" }
    ]);
  });

  it("tenant-paid message for a claim carries the UTR and targets the owner", async () => {
    const claim = await payments.claimByTenant(tenantUserId, {
      assignment_id: assignmentId,
      amount_inr: 100,
      method: "upi",
      paid_on: "2026-09-07",
      reference: "123456789012",
      idempotency_key: randomUUID()
    });
    const m = await messages.tenantPaidMessage(tenantUserId, claim.id);
    expect(m.text).toBe(
      "Hi Sunil Owner, I've paid ₹100 for September 2026 rent, Room 102/Bed A. UTR: 123456789012 — Rahul Verma"
    );
    expect(m.wa_me_url).toMatch(/^https:\/\/wa\.me\/917700000011\?text=/);
  });

  it("public pay page: payable → paid → expired/regenerated; exposes first name only", async () => {
    const token = (
      await db.query<{ t: string }>(
        `SELECT pay_token AS t FROM pg_rent_invoices WHERE id = $1::uuid`,
        [invoiceId]
      )
    ).rows[0].t;
    const page = await pay.publicPayPage(token);
    expect(page).toMatchObject({
      state: "payable",
      property_name: "Sunrise PG",
      tenant_first_name: "Rahul",
      period_label: "September 2026",
      room_number: "102",
      bed_label: "A",
      balance_inr: 9000,
      owner_wa_digits: "917700000011"
    });
    expect(page.instruction?.mode).toBe("upi_intent");
    expect(page.notify_text).toContain("— Rahul");
    expect(JSON.stringify(page)).not.toContain("Verma");
    expect(JSON.stringify(page)).not.toContain("7700000022");
    expect(JSON.stringify(page)).not.toContain(token);
    await expect(pay.publicPayPage("nope")).rejects.toMatchObject({
      response: { code: "pay_link_not_found" }
    });

    // A cancelled invoice reads "expired", never "paid" — mirrors what
    // RentInvoiceService.cancel() does (status='cancelled', token expired).
    await db.query(
      `UPDATE pg_rent_invoices SET status = 'cancelled', pay_token_expires_at = now() WHERE id = $1::uuid`,
      [invoiceId]
    );
    expect((await pay.publicPayPage(token)).state).toBe("expired");
    await db.query(
      `UPDATE pg_rent_invoices SET status = 'issued', pay_token_expires_at = now() + interval '45 days' WHERE id = $1::uuid`,
      [invoiceId]
    );

    const regen = await messages.regeneratePayToken(operatorId, propertyId, invoiceId);
    expect(regen.pay_link).toMatch(/\/pay\/[A-Za-z0-9_-]{43}$/);
    await expect(pay.publicPayPage(token)).rejects.toMatchObject({
      response: { code: "pay_link_not_found" }
    }); // the old link stops working
    const fresh = regen.pay_link.slice(regen.pay_link.lastIndexOf("/") + 1);
    await db.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() - interval '1 minute' WHERE id = $1::uuid`,
      [invoiceId]
    );
    expect((await pay.publicPayPage(fresh)).state).toBe("expired");
    await db.query(
      `UPDATE pg_rent_invoices SET pay_token_expires_at = now() + interval '45 days' WHERE id = $1::uuid`,
      [invoiceId]
    );
    await payments.recordByOperator(
      operatorId,
      propertyId,
      { assignment_id: assignmentId, amount_inr: 9000, method: "upi", paid_on: "2026-09-06" },
      randomUUID()
    );
    expect((await pay.publicPayPage(fresh)).state).toBe("paid");
  });
});

function daysSince(iso: string): number {
  const today = new Date();
  const ist = new Date(today.getTime() + 5.5 * 60 * 60 * 1000);
  const t = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const d = Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10))
  );
  return Math.round((t - d) / 86400000);
}
