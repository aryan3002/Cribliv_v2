import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../../app.module";
import { DatabaseService } from "../../../common/database.service";
import { AdminPgTransferService } from "../../admin/admin-pg-transfer.service";
import { PgBedAssignmentService } from "../../pg-operations/services/pg-bed-assignment.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

/**
 * fx.nextPhone() bakes hex characters from a UUID into the number (fine for
 * rows inserted by raw SQL, e.g. createUser/createAssignment), but it fails
 * real validation: PgBedAssignmentService.validateOccupant's
 * `/^\+[1-9]\d{7,14}$/` and AdminPgTransferService's `normalizeIndianPhone`
 * (+91 then exactly 10 digits starting 6-9, phone.util.ts:27) both require an
 * all-digit number. Every phone below goes through one of those two real
 * validators, so it needs an actually-valid number instead.
 */
function randomIndianPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4));
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return `+91${first}${rest}`;
}

describe.skipIf(!HAS_DB)("pg-rent hooks", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let assignments: PgBedAssignmentService;
  let settings: RentSettingsService;
  let transfer: AdminPgTransferService;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    assignments = app.get(PgBedAssignmentService);
    settings = app.get(RentSettingsService);
    transfer = app.get(AdminPgTransferService);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    await fx.teardown();
    await db.onModuleDestroy();
  });

  async function flush() {
    // hooks are fire-and-forget after commit; give the event loop a tick
    await new Promise((r) => setTimeout(r, 200));
  }

  it("move-in issues the deposit and first rent invoice without waiting for the sweep", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    const bedId = await fx.createBed(roomId, "A", "vacant");
    await settings.enable(operatorId, propertyId, { billing_starts_on: "2026-01-01" });

    const moved = await assignments.moveIn(operatorId, propertyId, bedId, {
      occupant_name: "Hook Tenant",
      occupant_phone_e164: randomIndianPhone()
    });
    await flush();
    const rows = await db.query<{ kind: string }>(
      `SELECT kind::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind`,
      [moved.id]
    );
    expect(rows.rows.map((r) => r.kind)).toEqual(["deposit", "rent"]);
  });

  it("does nothing for a property without settings", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    const bedId = await fx.createBed(roomId, "A", "vacant");
    const moved = await assignments.moveIn(operatorId, propertyId, bedId, {
      occupant_name: "No Rent",
      occupant_phone_e164: randomIndianPhone()
    });
    await flush();
    const rows = await db.query(`SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid`, [
      moved.id
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("ownership transfer pauses rent and clears the payee inside the transfer transaction", async () => {
    // Build a transferable PG: property + pg_listings row the admin service
    // expects (pg_listings.pg_property_id -> pg_properties.id, both required
    // by AdminPgTransferService.transferOperator's initial FOR UPDATE lookups).
    // RentFixtures.createListingWithDetails already inserts exactly that shape.
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    await settings.enable(operatorId, propertyId, { upi_vpa: "old@okaxis", upi_payee_name: "Old" });
    const targetPhone = randomIndianPhone();

    // AdminPgTransferService's real method is `transferOperator(input)` — a
    // single PgTransferInput object with adminUserId/listingId/phoneE164/
    // fullName fields, not the `transfer(operatorId, listingId, {...})`
    // positional form the brief sketched. Verified against
    // admin-pg-transfer.service.ts:55-60 (and its master history) before writing
    // this call; there is no `transfer()` method on this service.
    await transfer.transferOperator({
      listingId,
      phoneE164: targetPhone,
      fullName: "New Owner",
      adminUserId: operatorId
    });

    const after = await db.query<{ pause_reason: string | null; upi_vpa: string | null }>(
      `SELECT pause_reason::text, upi_vpa FROM pg_rent_settings WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    expect(after.rows[0]).toEqual({ pause_reason: "transfer", upi_vpa: null });
    const newOwner = await db.query<{ id: string }>(
      `SELECT id::text FROM users WHERE phone_e164 = $1`,
      [targetPhone]
    );
    fx.userIds.push(newOwner.rows[0].id);
    // transferOperator() audits the transfer to admin_actions with
    // admin_user_id = operatorId (no ON DELETE CASCADE on that FK); clear it
    // here so RentFixtures.teardown()'s later `DELETE FROM users` for
    // operatorId doesn't hit admin_actions_admin_user_id_fkey.
    await db.query(`DELETE FROM admin_actions WHERE admin_user_id = $1::uuid`, [operatorId]);
  });
});
