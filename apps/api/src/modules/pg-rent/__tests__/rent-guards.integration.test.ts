import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { writeRentEvent } from "../services/rent-events";
import {
  SYSTEM_ACTOR,
  assertManagedOwnership,
  assertRentFlag,
  requireDb
} from "../services/rent-guards";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("rent guards without a database", () => {
  it("requireDb throws the rent_requires_db envelope", () => {
    expect(() => requireDb({ isEnabled: () => false })).toThrow(
      expect.objectContaining({
        response: { code: "rent_requires_db", message: "Rent collection requires a database" }
      })
    );
    expect(() => requireDb({ isEnabled: () => true })).not.toThrow();
  });
  it("assertRentFlag 404s when FF_PG_RENT_COLLECTION is off", () => {
    const prev = process.env.FF_PG_RENT_COLLECTION;
    delete process.env.FF_PG_RENT_COLLECTION;
    expect(() => assertRentFlag()).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: "feature_disabled" }) })
    );
    process.env.FF_PG_RENT_COLLECTION = "true";
    expect(() => assertRentFlag()).not.toThrow();
    if (prev === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = prev;
  });
});

describe.skipIf(!HAS_DB)("rent guards (real Postgres)", () => {
  let db: DatabaseService;
  let cityId: number;
  let operatorId: string;
  let otherOperatorId: string;
  let propertyId: string;
  const testRunId = randomUUID().replace(/-/g, "");

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'Rent guard city', 'Rent guard city', 'S', 'S') RETURNING id`,
      [`rg-${testRunId}`]
    );
    cityId = city.rows[0].id;
    const users = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'pg_operator', 'en'), ($2, 'pg_operator', 'en') RETURNING id::text`,
      [`+9181${testRunId.slice(0, 9)}`, `+9182${testRunId.slice(0, 9)}`]
    );
    operatorId = users.rows[0].id;
    otherOperatorId = users.rows[1].id;
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, 'Rent guard property', $2, false, true, 'ready', 1) RETURNING id::text`,
      [operatorId, cityId]
    );
    propertyId = property.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM pg_properties WHERE id = $1::uuid`, [propertyId]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[operatorId, otherOperatorId]]);
    await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
    await db.onModuleDestroy();
  });

  it("allows the managing operator and refuses everyone else", async () => {
    const client = await db.getClient();
    try {
      await expect(assertManagedOwnership(client, operatorId, propertyId)).resolves.toBeUndefined();
      await expect(
        assertManagedOwnership(client, otherOperatorId, propertyId)
      ).rejects.toMatchObject({
        response: { code: "forbidden" }
      });
      await db.query(`UPDATE pg_properties SET manage_enabled = false WHERE id = $1::uuid`, [
        propertyId
      ]);
      await expect(assertManagedOwnership(client, operatorId, propertyId)).rejects.toMatchObject({
        response: { code: "forbidden" }
      });
      await db.query(`UPDATE pg_properties SET manage_enabled = true WHERE id = $1::uuid`, [
        propertyId
      ]);
    } finally {
      client.release();
    }
  });

  it("writes an event row with actor and payload", async () => {
    const entityId = randomUUID();
    const client = await db.getClient();
    try {
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId,
        eventType: "settings.enabled",
        actor: SYSTEM_ACTOR,
        payload: { hello: "world" }
      });
    } finally {
      client.release();
    }
    const rows = await db.query<{
      event_type: string;
      actor_role: string;
      actor_user_id: string | null;
      payload: unknown;
    }>(
      `SELECT event_type, actor_role, actor_user_id::text, payload FROM pg_rent_events WHERE entity_id = $1::uuid`,
      [entityId]
    );
    expect(rows.rows).toEqual([
      {
        event_type: "settings.enabled",
        actor_role: "system",
        actor_user_id: null,
        payload: { hello: "world" }
      }
    ]);
  });
});
