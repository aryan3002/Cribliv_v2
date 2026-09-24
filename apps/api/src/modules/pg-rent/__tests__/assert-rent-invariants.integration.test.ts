import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("assertRentInvariants", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;

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

  it("passes on an empty property and names a broken total", async () => {
    await expect(assertRentInvariants(db, propertyId)).resolves.toBeUndefined();
    const inv = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, room_number, bed_label, kind, invoice_number, billing_month, due_date, status, source, total_paise)
       VALUES ($1::uuid, $2::uuid, 'R1', 'A', 'adhoc', 'T-INV-0001', '2026-09-01', '2026-09-10', 'issued', 'manual', 500)
       RETURNING id::text`,
      [propertyId, assignmentId]
    );
    await expect(assertRentInvariants(db, propertyId)).rejects.toThrow(/inv1 invoice/);
    await db.query(`DELETE FROM pg_rent_invoices WHERE id = $1::uuid`, [inv.rows[0].id]);
  });
});
