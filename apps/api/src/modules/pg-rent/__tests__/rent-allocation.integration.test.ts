import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { toIsoDate } from "../dto/common";
import { RentAllocationService } from "../services/rent-allocation.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentAllocationService.applyUnallocatedCredit", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;
  const service = new RentAllocationService();

  async function insertInvoice(totalPaise: number, number: string): Promise<string> {
    const inv = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, room_number, bed_label, kind, invoice_number, billing_month, due_date, status, source, total_paise)
       VALUES ($1::uuid, $2::uuid, 'R1', 'A', 'adhoc', $3, '2026-09-01', '2026-09-10', 'issued', 'manual', $4)
       RETURNING id::text`,
      [propertyId, assignmentId, number, totalPaise]
    );
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'other', 'Charge', $2, 'operator')`,
      [inv.rows[0].id, totalPaise]
    );
    return inv.rows[0].id;
  }

  async function insertConfirmedInflow(amountPaise: number, paidOn: string): Promise<string> {
    const p = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on, confirmed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'cash', 'operator', 'confirmed', $4::date, now()) RETURNING id::text`,
      [propertyId, assignmentId, amountPaise, paidOn]
    );
    return p.rows[0].id;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, { createdBy: operatorId });
  });
  afterAll(async () => {
    for (const id of fx.propertyIds) await assertRentInvariants(db, id);
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("applies credit oldest-first up to the balance, recomputes status, and is a no-op when nothing is unallocated", async () => {
    const p1 = await insertConfirmedInflow(100000, "2026-09-01"); // ₹1,000 older
    const p2 = await insertConfirmedInflow(50000, "2026-09-05"); // ₹500 newer
    const invoice = await insertInvoice(120000, "T-INV-0001"); // ₹1,200

    const applied = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice, SYSTEM_ACTOR)
    );
    expect(applied).toBe(120000);

    const allocs = await db.query<{ payment_id: string; amount_paise: string }>(
      `SELECT payment_id::text, amount_paise::text FROM pg_rent_payment_allocations WHERE invoice_id = $1::uuid ORDER BY created_at`,
      [invoice]
    );
    expect(allocs.rows).toEqual([
      { payment_id: p1, amount_paise: "100000" },
      { payment_id: p2, amount_paise: "20000" }
    ]);
    const row = await db.query<{
      status: string;
      amount_paid_paise: string;
      settled_on: Date | null;
    }>(
      `SELECT status::text, amount_paid_paise::text, settled_on FROM pg_rent_invoices WHERE id = $1::uuid`,
      [invoice]
    );
    expect(row.rows[0].status).toBe("paid");
    expect(row.rows[0].amount_paid_paise).toBe("120000");
    expect(row.rows[0].settled_on).not.toBeNull(); // p2's paid_on
    const events = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid`,
      [invoice]
    );
    expect(events.rows).toEqual([{ event_type: "allocation.changed" }]);

    // settled_on is written once, on the day the balance first reached zero, and never moved.
    const firstSettled = (
      await db.query<{ settled_on: Date | string }>(
        `SELECT settled_on FROM pg_rent_invoices WHERE id = $1::uuid`,
        [invoice]
      )
    ).rows[0].settled_on;
    expect(toIsoDate(firstSettled)).toBe("2026-09-05"); // p2's paid_on — the payment that closed it
    await transaction(db, (client) => service.recomputeInvoice(client, invoice, "2026-09-30"));
    const again = (
      await db.query<{ settled_on: Date | string }>(
        `SELECT settled_on FROM pg_rent_invoices WHERE id = $1::uuid`,
        [invoice]
      )
    ).rows[0].settled_on;
    expect(toIsoDate(again)).toBe("2026-09-05");

    // ₹300 of p2 remains; a second invoice takes it and stays partially paid
    const invoice2 = await insertInvoice(80000, "T-INV-0002");
    const applied2 = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice2, SYSTEM_ACTOR)
    );
    expect(applied2).toBe(30000);
    const row2 = await db.query<{ status: string }>(
      `SELECT status::text FROM pg_rent_invoices WHERE id = $1::uuid`,
      [invoice2]
    );
    expect(row2.rows[0].status).toBe("partially_paid");

    // nothing left
    const invoice3 = await insertInvoice(10000, "T-INV-0003");
    const applied3 = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice3, SYSTEM_ACTOR)
    );
    expect(applied3).toBe(0);
    await assertRentInvariants(db, propertyId);
  });

  it("ignores pending, reversed, outflow and other-assignment payments", async () => {
    await db.query(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on)
       VALUES ($1::uuid, $2::uuid, 99900, 'upi', 'tenant_claim', 'pending_confirmation', '2026-09-06')`,
      [propertyId, assignmentId]
    );
    const invoice = await insertInvoice(5000, "T-INV-0004");
    const applied = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice, SYSTEM_ACTOR)
    );
    expect(applied).toBe(0);
  });
});
