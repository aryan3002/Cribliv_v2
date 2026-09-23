import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { RentAllocationService } from "../services/rent-allocation.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentAllocationService mutations", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;
  const service = new RentAllocationService();
  let seq = 0;

  async function invoice(
    kind: "rent" | "deposit" | "adhoc" | "settlement",
    totalPaise: number,
    dueDate: string,
    status = "issued"
  ): Promise<string> {
    seq += 1;
    const inv = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices (pg_property_id, assignment_id, room_number, bed_label, kind, invoice_number, billing_month, due_date, status, source, total_paise)
       VALUES ($1::uuid, $2::uuid, 'R1', 'A', $3::pg_rent_invoice_kind, $4, date_trunc('month', $5::date)::date, $5::date, $6::pg_rent_invoice_status, 'manual', $7) RETURNING id::text`,
      [
        propertyId,
        assignmentId,
        kind,
        `T-INV-${String(seq).padStart(4, "0")}`,
        dueDate,
        status,
        totalPaise
      ]
    );
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'other', 'x', $2, 'operator')`,
      [inv.rows[0].id, totalPaise]
    );
    return inv.rows[0].id;
  }
  async function inflow(
    amountPaise: number,
    paidOn: string,
    status = "confirmed"
  ): Promise<string> {
    const p = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on, confirmed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'cash', 'operator', $4::pg_rent_payment_status, $5::date, now()) RETURNING id::text`,
      [propertyId, assignmentId, amountPaise, status, paidOn]
    );
    return p.rows[0].id;
  }
  async function outflow(amountPaise: number): Promise<string> {
    const p = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, direction, amount_paise, method, source, status, paid_on, note)
       VALUES ($1::uuid, $2::uuid, 'outflow', $3, 'cash', 'operator', 'confirmed', '2026-10-20', 'returned') RETURNING id::text`,
      [propertyId, assignmentId, amountPaise]
    );
    return p.rows[0].id;
  }
  async function state(invoiceId: string) {
    const r = await db.query<{ status: string; paid: string; settled_on: string | null }>(
      `SELECT status::text, amount_paid_paise::text AS paid, to_char(settled_on, 'YYYY-MM-DD') AS settled_on FROM pg_rent_invoices WHERE id = $1::uuid`,
      [invoiceId]
    );
    return r.rows[0];
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
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("allocateInflow: targets, then FIFO with deposit first, remainder credit, settled_on set on closed invoices", async () => {
    const dep = await invoice("deposit", 1800000, "2026-09-01");
    const sep = await invoice("rent", 900000, "2026-09-05");
    const oct = await invoice("rent", 900000, "2026-10-05");
    const p = await inflow(3000000, "2026-09-03");

    const plan = await transaction(db, (c) =>
      service.allocateInflow(c, p, [{ invoice_id: oct, amount_inr: 4000 }], SYSTEM_ACTOR)
    );
    expect(plan).toEqual({
      allocations: [
        { invoiceId: oct, amountPaise: 400000 },
        { invoiceId: dep, amountPaise: 1800000 },
        { invoiceId: sep, amountPaise: 800000 }
      ],
      creditPaise: 0
    });
    expect(await state(dep)).toEqual({ status: "paid", paid: "1800000", settled_on: "2026-09-03" });
    expect(await state(sep)).toEqual({
      status: "partially_paid",
      paid: "800000",
      settled_on: null
    });
    expect(await state(oct)).toEqual({
      status: "partially_paid",
      paid: "400000",
      settled_on: null
    });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(0);
    await assertRentInvariants(db, propertyId);

    // a second inflow closes sep and oct and leaves credit
    const p2 = await inflow(700000, "2026-09-10");
    const plan2 = await transaction(db, (c) => service.allocateInflow(c, p2, null, SYSTEM_ACTOR));
    expect(plan2.creditPaise).toBe(100000);
    expect(await state(sep)).toMatchObject({ status: "paid", settled_on: "2026-09-10" });
    expect(await state(oct)).toMatchObject({ status: "paid", settled_on: "2026-09-10" });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(100000);
    await assertRentInvariants(db, propertyId);

    // deallocateExcess: shrink oct's total by 3000 → excess released newest-first (p2's allocation first)
    await transaction(db, async (c) => {
      await service.deallocateExcess(c, oct, 300000, SYSTEM_ACTOR);
      await c.query(
        `UPDATE pg_rent_invoice_lines SET amount_paise = 600000 WHERE invoice_id = $1::uuid`,
        [oct]
      );
      await c.query(`UPDATE pg_rent_invoices SET total_paise = 600000 WHERE id = $1::uuid`, [oct]);
      await service.recomputeInvoice(c, oct);
    });
    expect(await state(oct)).toMatchObject({ status: "paid", paid: "600000" });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(400000);
    const ev = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'invoice.excess_deallocated'`,
      [oct]
    );
    expect(ev.rows[0].payload).toMatchObject({ payment_id: p2, paise: 300000 });
    await assertRentInvariants(db, propertyId);

    // releaseAllocations (cancel path) on sep → its 900000 goes back to credit
    const released = await transaction(db, (c) => service.releaseAllocations(c, sep, SYSTEM_ACTOR));
    expect(released).toBe(900000);
    expect(await state(sep)).toMatchObject({ status: "issued", paid: "0", settled_on: null });
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(1300000);

    // fundOutflow: 13000 refund is fully funded; 13001 is refused
    const ok = await outflow(1300000);
    await transaction(db, (c) => service.fundOutflow(c, ok));
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(0);
    const tooMuch = await outflow(100);
    await expect(transaction(db, (c) => service.fundOutflow(c, tooMuch))).rejects.toMatchObject({
      response: { code: "refund_exceeds_credit" }
    });
    await db.query(`DELETE FROM pg_rent_payments WHERE id = $1::uuid`, [tooMuch]);
    await assertRentInvariants(db, propertyId);

    // removeAllocationsOf the refund → credit is back; of p → dep and oct walk back
    expect(await transaction(db, (c) => service.removeAllocationsOf(c, ok))).toEqual([]);
    expect(await service.unallocatedCredit(db, assignmentId)).toBe(1300000);
    const touched = await transaction(db, (c) => service.removeAllocationsOf(c, p));
    expect(new Set(touched)).toEqual(new Set([dep, oct]));
    expect(await state(dep)).toMatchObject({ status: "issued", paid: "0", settled_on: null });
    await db.query(`DELETE FROM pg_rent_payments WHERE id = $1::uuid`, [ok]);
    await assertRentInvariants(db, propertyId);
  });

  it("refuses targets on drafts, other assignments and over-balance", async () => {
    const draft = await invoice("rent", 100000, "2026-11-05", "draft");
    const p = await inflow(100000, "2026-11-01");
    await expect(
      transaction(db, (c) =>
        service.allocateInflow(c, p, [{ invoice_id: draft, amount_inr: 1000 }], SYSTEM_ACTOR)
      )
    ).rejects.toMatchObject({
      response: { code: "invalid_allocation" }
    });
  });
});
