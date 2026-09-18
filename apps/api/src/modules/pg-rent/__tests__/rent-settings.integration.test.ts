import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("RentSettingsService without a database", () => {
  it("rejects every call with rent_requires_db", async () => {
    const service = new RentSettingsService({ isEnabled: () => false } as DatabaseService);
    const unavailable = { response: { code: "rent_requires_db" } };
    await expect(service.enable("u", "p", {})).rejects.toMatchObject(unavailable);
    await expect(service.get("u", "p")).rejects.toMatchObject(unavailable);
    await expect(
      service.patch("u", "p", { updated_at: new Date().toISOString() })
    ).rejects.toMatchObject(unavailable);
    await expect(service.pause("u", "p")).rejects.toMatchObject(unavailable);
    await expect(service.resume("u", "p", {})).rejects.toMatchObject(unavailable);
  });
});

describe.skipIf(!HAS_DB)("RentSettingsService (real Postgres)", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let service: RentSettingsService;
  let operatorId: string;
  let otherOperatorId: string;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    otherOperatorId = await fx.createUser("pg_operator");
    service = new RentSettingsService(db);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("enables with seeded defaults: due_day from pg_details, prefix from internal_code, counters row, event", async () => {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "bpg-7" });
    await fx.createListingWithDetails(propertyId, operatorId, { rentDueDay: 7 });

    const settings = await service.enable(operatorId, propertyId, {});
    expect(settings).toMatchObject({
      pg_property_id: propertyId,
      due_day: 7,
      receipt_prefix: "BPG7",
      cycle_mode: "calendar_month",
      billing_timing: "advance",
      enabled_on: todayIst(),
      billing_starts_on: todayIst(),
      paused_at: null,
      late_fee_enabled: false
    });
    const counters = await db.query<{ next_invoice_seq: number; next_receipt_seq: number }>(
      `SELECT next_invoice_seq, next_receipt_seq FROM pg_rent_counters WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    expect(counters.rows[0]).toEqual({ next_invoice_seq: 1, next_receipt_seq: 1 });
    const events = await db.query<{ event_type: string; actor_role: string }>(
      `SELECT event_type, actor_role FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [propertyId]
    );
    expect(events.rows).toEqual([{ event_type: "settings.enabled", actor_role: "pg_operator" }]);

    await expect(service.enable(operatorId, propertyId, {})).rejects.toMatchObject({
      response: { code: "already_enabled" }
    });
    await expect(service.enable(otherOperatorId, propertyId, {})).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
  });

  it("derives the prefix from the display name when there is no internal code, and accepts explicit inputs", async () => {
    const propertyId = await fx.createProperty(operatorId, { displayName: "Sunrise Boys Hostel" });
    const settings = await service.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      cycle_mode: "anniversary",
      billing_timing: "arrears",
      upi_vpa: "sunrise@okaxis",
      upi_payee_name: "Sunrise"
    });
    expect(settings).toMatchObject({
      receipt_prefix: "SBH",
      billing_starts_on: "2026-09-01",
      cycle_mode: "anniversary",
      billing_timing: "arrears",
      upi_vpa: "sunrise@okaxis",
      due_day: 1
    });
  });

  it("patches with the updated_at token, records a diff, and 409s on a stale token", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const before = await service.enable(operatorId, propertyId, {});

    const after = await service.patch(operatorId, propertyId, {
      updated_at: before.updated_at,
      due_day: 10,
      late_fee_enabled: true,
      late_fee_amount_inr: 150
    });
    expect(after).toMatchObject({ due_day: 10, late_fee_enabled: true, late_fee_amount_inr: 150 });
    expect(after.updated_at).not.toBe(before.updated_at);

    await expect(
      service.patch(operatorId, propertyId, { updated_at: before.updated_at, due_day: 11 })
    ).rejects.toMatchObject({ response: { code: "settings_conflict" } });

    const events = await db.query<{
      event_type: string;
      payload: { diff: Record<string, unknown> };
    }>(
      `SELECT event_type, payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'settings.updated'`,
      [propertyId]
    );
    expect(events.rows[0].payload.diff).toEqual({
      due_day: { from: 1, to: 10 },
      late_fee_enabled: { from: false, to: true },
      late_fee_amount_paise: { from: 10000, to: 15000 }
    });
  });

  it("pauses and resumes with a new floor; counters are untouched by the token", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const enabled = await service.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01"
    });

    const paused = await service.pause(operatorId, propertyId);
    expect(paused.paused_at).not.toBeNull();
    expect(paused.pause_reason).toBe("owner");

    // bumping a counter must not move updated_at (spec §4.2b)
    await db.query(
      `UPDATE pg_rent_counters SET next_invoice_seq = 5 WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const stillSame = await service.get(operatorId, propertyId);
    expect(stillSame?.updated_at).toBe(paused.updated_at);

    const resumed = await service.resume(operatorId, propertyId, {
      billing_starts_on: "2026-11-10"
    });
    expect(resumed).toMatchObject({
      paused_at: null,
      pause_reason: null,
      billing_starts_on: "2026-11-10",
      enabled_on: enabled.enabled_on
    });
    const events = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [propertyId]
    );
    expect(events.rows.map((e) => e.event_type)).toEqual([
      "settings.enabled",
      "settings.paused",
      "settings.resumed"
    ]);
  });

  it("ownership transfer pauses, clears payee details, keeps branding, and blocks resume until a payee is set", async () => {
    const propertyId = await fx.createProperty(operatorId);
    await service.enable(operatorId, propertyId, {
      upi_vpa: "old@okaxis",
      upi_payee_name: "Old Owner",
      bank_details: {
        account_name: "Old",
        account_number: "123456789012",
        ifsc: "HDFC0001234",
        bank_name: "HDFC"
      },
      whatsapp_phone_e164: "+919999999999",
      receipt_business_name: "Sunrise PG"
    });

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE pg_properties SET operator_id = $2::uuid WHERE id = $1::uuid`, [
        propertyId,
        otherOperatorId
      ]);
      await service.onOwnershipTransferred(client, propertyId, operatorId, otherOperatorId);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const after = await service.get(otherOperatorId, propertyId);
    expect(after).toMatchObject({
      pause_reason: "transfer",
      upi_vpa: null,
      upi_payee_name: null,
      bank_details: null,
      whatsapp_phone_e164: null,
      receipt_business_name: "Sunrise PG"
    });
    expect(after?.paused_at).not.toBeNull();
    await expect(service.get(operatorId, propertyId)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });

    await expect(service.resume(otherOperatorId, propertyId, {})).rejects.toMatchObject({
      response: { code: "payee_required" }
    });
    await service.patch(otherOperatorId, propertyId, {
      updated_at: after!.updated_at,
      upi_vpa: "new@okaxis",
      upi_payee_name: "New"
    });
    const resumed = await service.resume(otherOperatorId, propertyId, {});
    expect(resumed.paused_at).toBeNull();

    const events = await db.query<{
      event_type: string;
      actor_role: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, actor_role, payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'settings.transferred'`,
      [propertyId]
    );
    expect(events.rows[0].actor_role).toBe("admin");
    expect(events.rows[0].payload).toEqual({
      from_operator: operatorId,
      to_operator: otherOperatorId,
      cleared: ["upi_vpa", "upi_payee_name", "bank_details", "whatsapp_phone_e164"]
    });
  });

  it("is a no-op transfer hook for a property without settings", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await service.onOwnershipTransferred(client, propertyId, operatorId, otherOperatorId);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const events = await db.query(`SELECT 1 FROM pg_rent_events WHERE entity_id = $1::uuid`, [
      propertyId
    ]);
    expect(events.rowCount).toBe(0);
  });
});
