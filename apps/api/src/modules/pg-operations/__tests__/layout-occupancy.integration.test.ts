import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PgLayoutPutInput, PgRoom } from "@cribliv/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { PgLayoutService } from "../services/pg-layout.service";
import { PgOccupancyService } from "../services/pg-occupancy.service";

const HAS_DB = Boolean(process.env.DATABASE_URL);

function roomInput(
  roomNumber: string,
  floor: number,
  statuses: Array<"vacant" | "reserved" | "occupied" | "blocked" | "inactive">,
  roomTypeId?: string
): PgLayoutPutInput["rooms"][number] {
  return {
    room_type_id: roomTypeId ?? null,
    floor,
    room_number: roomNumber,
    display_label: `Room ${roomNumber}`,
    bed_count: statuses.length,
    beds: statuses.map((status, index) => ({
      bed_label: String.fromCharCode(65 + index),
      status,
      available_from: status === "vacant" ? "2099-01-01" : null,
      sort_order: index + 1,
      metadata: { fixture: true }
    }))
  };
}

describe("PG layout and occupancy without a database", () => {
  it("returns typed empty reads and rejects writes", async () => {
    const db = { isEnabled: () => false } as DatabaseService;
    const layout = new PgLayoutService(db);
    const occupancy = new PgOccupancyService(db);
    const operatorId = randomUUID();
    const propertyId = randomUUID();
    const bedId = randomUUID();

    await expect(layout.generateDraft(operatorId, propertyId, [])).resolves.toEqual({
      property_id: propertyId,
      room_counts: [],
      rooms: []
    });
    await expect(layout.getLayout(operatorId, propertyId)).resolves.toEqual([]);
    await expect(occupancy.listManagedProperties(operatorId)).resolves.toEqual([]);
    await expect(occupancy.getManagedProperty(operatorId, propertyId)).resolves.toBeNull();
    await expect(occupancy.summary(operatorId, propertyId)).resolves.toMatchObject({
      property_id: propertyId,
      total_beds: 0,
      occupancy_percent: 0,
      upcoming_move_ins: [],
      upcoming_move_outs: []
    });

    await expect(layout.putLayout(operatorId, propertyId, { rooms: [] })).rejects.toMatchObject({
      response: {
        code: "operations_requires_db",
        message: "PG operations require a database"
      }
    });
    await expect(
      occupancy.updateBedStatus(operatorId, propertyId, bedId, "blocked")
    ).rejects.toMatchObject({ response: { code: "operations_requires_db" } });
    await expect(occupancy.relistBed(operatorId, propertyId, bedId)).rejects.toMatchObject({
      response: { code: "operations_requires_db" }
    });
  });
});

describe.skipIf(!HAS_DB)("PG layout and occupancy (integration)", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let layout: PgLayoutService;
  let occupancy: PgOccupancyService;
  let cityId: number;
  let operatorId: string;

  const testRunId = randomUUID();
  const propertyIds: string[] = [];
  const listingIds: string[] = [];

  type Fixture = {
    propertyId: string;
    listingId: string;
    roomTypes: { single: string; double: string; dorm: string };
  };

  async function createFixture(
    options: { managed?: boolean; listingStatus?: string } = {}
  ): Promise<Fixture> {
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, true, $4, 'needs_setup', 5)
       RETURNING id::text`,
      [operatorId, `P2 property ${randomUUID()}`, cityId, options.managed ?? true]
    );
    const propertyId = property.rows[0].id;
    propertyIds.push(propertyId);

    const listingId = randomUUID();
    listingIds.push(listingId);
    await db.query(
      `INSERT INTO pg_listings
         (id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 1200000, $5::listing_status, 'unverified')`,
      [
        listingId,
        operatorId,
        propertyId,
        `P2 listing ${listingId}`,
        options.listingStatus ?? "active"
      ]
    );

    const roomTypes = await Promise.all(
      [
        { key: "single" as const, sharing: "single", rent: 900000 },
        { key: "double" as const, sharing: "double", rent: 700000 },
        { key: "dorm" as const, sharing: "dorm", rent: 500000 }
      ].map(async ({ key, sharing, rent }) => {
        const result = await db.query<{ id: string }>(
          `INSERT INTO pg_room_types
             (listing_id, sharing, ac, bathroom_kind, furnishing, monthly_rent_paise, vacancy_count)
           VALUES ($1::uuid, $2::pg_sharing_kind, false, 'shared_western', 'semi_furnished', $3, 0)
           RETURNING id::text`,
          [listingId, sharing, rent]
        );
        return [key, result.rows[0].id] as const;
      })
    );

    return {
      propertyId,
      listingId,
      roomTypes: Object.fromEntries(roomTypes) as Fixture["roomTypes"]
    };
  }

  async function getBed(propertyId: string, roomNumber: string, bedLabel: string) {
    const result = await db.query<{ id: string; status: string; available_from: string | null }>(
      `SELECT b.id::text, b.status::text, b.available_from::text
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE r.pg_property_id = $1::uuid
          AND r.room_number = $2
          AND b.bed_label = $3`,
      [propertyId, roomNumber, bedLabel]
    );
    return result.rows[0];
  }

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'P2 Test City', 'P2 Test City', 'Test State', 'Test State')
       RETURNING id`,
      [`p2-${testRunId}`]
    );
    cityId = city.rows[0].id;

    const compact = testRunId.replace(/-/g, "");
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'pg_operator'::user_role, 'en')
       RETURNING id::text`,
      [`+9198${compact.slice(0, 9)}`]
    );
    operatorId = user.rows[0].id;

    const identities: Record<string, { id: string; role: Role }> = {
      operator: { id: operatorId, role: "pg_operator" }
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string | undefined>; user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const identity = identities[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
    layout = app.get(PgLayoutService);
    occupancy = app.get(PgOccupancyService);
  }, 30_000);

  afterAll(async () => {
    if (db) {
      if (propertyIds.length > 0) {
        await db.query(`DELETE FROM pg_bed_assignments WHERE pg_property_id = ANY($1::uuid[])`, [
          propertyIds
        ]);
      }
      if (listingIds.length > 0) {
        await db.query(`DELETE FROM pg_listings WHERE id = ANY($1::uuid[])`, [listingIds]);
      }
      if (propertyIds.length > 0) {
        await db.query(`DELETE FROM pg_properties WHERE id = ANY($1::uuid[])`, [propertyIds]);
      }
      if (operatorId) await db.query(`DELETE FROM users WHERE id = $1::uuid`, [operatorId]);
      if (cityId) await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
    }
    if (app) await app.close();
    if (db) await db.onModuleDestroy();
  }, 30_000);

  it("generates sharing-based rooms and labels without persisting the draft", async () => {
    const fixture = await createFixture();
    const roomCounts = [
      { room_type_id: fixture.roomTypes.single, count: 1, floor: 1 },
      { room_type_id: fixture.roomTypes.double, count: 2, floor: 2 },
      { room_type_id: fixture.roomTypes.dorm, count: 1, floor: 3, bed_count: 5 },
      { room_type_id: fixture.roomTypes.dorm, count: 1, floor: 4 }
    ];

    const draft = await layout.generateDraft(operatorId, fixture.propertyId, roomCounts);

    expect(draft.property_id).toBe(fixture.propertyId);
    expect(
      draft.rooms.map((room) => ({
        type: room.room_type_id,
        floor: room.floor,
        number: room.room_number,
        beds: room.beds.map((bed) => bed.bed_label)
      }))
    ).toEqual([
      { type: fixture.roomTypes.single, floor: 1, number: "101", beds: ["A"] },
      { type: fixture.roomTypes.double, floor: 2, number: "201", beds: ["A", "B"] },
      { type: fixture.roomTypes.double, floor: 2, number: "202", beds: ["A", "B"] },
      { type: fixture.roomTypes.dorm, floor: 3, number: "301", beds: ["A", "B", "C", "D", "E"] },
      {
        type: fixture.roomTypes.dorm,
        floor: 4,
        number: "401",
        beds: ["A", "B", "C", "D", "E", "F"]
      }
    ]);
    const persisted = await db.query<{ rooms: string; beds: string }>(
      `SELECT count(DISTINCT r.id)::text AS rooms, count(b.id)::text AS beds
         FROM pg_properties p
         LEFT JOIN pg_rooms r ON r.pg_property_id = p.id
         LEFT JOIN pg_beds b ON b.room_id = r.id
        WHERE p.id = $1::uuid`,
      [fixture.propertyId]
    );
    expect(persisted.rows[0]).toEqual({ rooms: "0", beds: "0" });
  });

  it("persists the reviewed layout exactly and marks it ready", async () => {
    const fixture = await createFixture();
    const input: PgLayoutPutInput = {
      rooms: [
        roomInput("101", 1, ["vacant"], fixture.roomTypes.single),
        roomInput("201", 2, ["vacant", "blocked"], fixture.roomTypes.double)
      ]
    };

    const saved = await layout.putLayout(operatorId, fixture.propertyId, input);
    const fetched = await layout.getLayout(operatorId, fixture.propertyId);

    const simplify = (rooms: PgRoom[]) =>
      rooms.map((room) => ({
        room_number: room.room_number,
        floor: room.floor,
        bed_count: room.bed_count,
        status: room.status,
        beds: room.beds.map((bed) => ({
          bed_label: bed.bed_label,
          status: bed.status,
          sort_order: bed.sort_order,
          metadata: bed.metadata
        }))
      }));
    expect(simplify(saved)).toEqual(simplify(fetched));
    expect(simplify(fetched)).toEqual([
      {
        room_number: "101",
        floor: 1,
        bed_count: 1,
        status: "active",
        beds: [{ bed_label: "A", status: "vacant", sort_order: 1, metadata: { fixture: true } }]
      },
      {
        room_number: "201",
        floor: 2,
        bed_count: 2,
        status: "active",
        beds: [
          { bed_label: "A", status: "vacant", sort_order: 1, metadata: { fixture: true } },
          { bed_label: "B", status: "blocked", sort_order: 2, metadata: { fixture: true } }
        ]
      }
    ]);
    const property = await db.query<{ layout_status: string }>(
      `SELECT layout_status FROM pg_properties WHERE id = $1::uuid`,
      [fixture.propertyId]
    );
    expect(property.rows[0].layout_status).toBe("ready");
  });

  it("rejects room types that do not belong to the target property", async () => {
    const target = await createFixture();
    const other = await createFixture();

    await expect(
      layout.putLayout(operatorId, target.propertyId, {
        rooms: [roomInput("101", 1, ["vacant"], other.roomTypes.single)]
      })
    ).rejects.toMatchObject({ response: { code: "invalid_room_type" } });

    const persisted = await db.query<{ layout_status: string; room_count: string }>(
      `SELECT p.layout_status, count(r.id)::text AS room_count
         FROM pg_properties p
         LEFT JOIN pg_rooms r ON r.pg_property_id = p.id
        WHERE p.id = $1::uuid
        GROUP BY p.id`,
      [target.propertyId]
    );
    expect(persisted.rows[0]).toEqual({ layout_status: "needs_setup", room_count: "0" });
  });

  it("hard-deletes a removed history-free bed", async () => {
    const fixture = await createFixture();
    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [roomInput("101", 1, ["vacant", "vacant"], fixture.roomTypes.double)]
    });
    const removedBed = await getBed(fixture.propertyId, "101", "B");

    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [roomInput("101", 1, ["vacant"], fixture.roomTypes.double)]
    });

    const persisted = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_beds WHERE id = $1::uuid`,
      [removedBed.id]
    );
    expect(persisted.rows[0].count).toBe("0");
  });

  it("marks a removed bed inactive when assignment history exists", async () => {
    const fixture = await createFixture();
    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [roomInput("101", 1, ["vacant", "vacant"], fixture.roomTypes.double)]
    });
    const removedBed = await getBed(fixture.propertyId, "101", "B");
    await db.query(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, occupant_name, occupant_phone_e164, status, move_out_date)
       VALUES ($1::uuid, $2::uuid, 'Past occupant', '+919999900001', 'moved_out', CURRENT_DATE)`,
      [fixture.propertyId, removedBed.id]
    );

    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [roomInput("101", 1, ["vacant"], fixture.roomTypes.double)]
    });

    const persisted = await getBed(fixture.propertyId, "101", "B");
    expect(persisted).toMatchObject({ id: removedBed.id, status: "inactive" });
  });

  it("returns only editable inventory after historical beds and rooms are retired", async () => {
    const fixture = await createFixture();
    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [
        roomInput("101", 1, ["vacant", "vacant"], fixture.roomTypes.double),
        roomInput("102", 1, ["vacant"], fixture.roomTypes.single)
      ]
    });
    const retiredBed = await getBed(fixture.propertyId, "101", "B");
    const retiredRoomBed = await getBed(fixture.propertyId, "102", "A");
    await db.query(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, occupant_name, occupant_phone_e164, status, move_out_date)
       VALUES
         ($1::uuid, $2::uuid, 'Past occupant', '+919999900004', 'moved_out', CURRENT_DATE),
         ($1::uuid, $3::uuid, 'Past occupant', '+919999900005', 'moved_out', CURRENT_DATE)`,
      [fixture.propertyId, retiredBed.id, retiredRoomBed.id]
    );

    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [roomInput("101", 1, ["vacant"], fixture.roomTypes.double)]
    });

    const editable = await layout.getLayout(operatorId, fixture.propertyId);
    expect(
      editable.map((room) => ({
        room_number: room.room_number,
        bed_count: room.bed_count,
        beds: room.beds.map((bed) => ({ bed_label: bed.bed_label, status: bed.status }))
      }))
    ).toEqual([
      {
        room_number: "101",
        bed_count: 1,
        beds: [{ bed_label: "A", status: "vacant" }]
      }
    ]);

    await expect(
      layout.putLayout(operatorId, fixture.propertyId, { rooms: editable })
    ).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ room_number: "101", status: "active" })])
    );
    const retired = await db.query<{ room_status: string; bed_status: string }>(
      `SELECT r.status AS room_status, b.status::text AS bed_status
         FROM pg_rooms r
         JOIN pg_beds b ON b.room_id = r.id
        WHERE r.pg_property_id = $1::uuid
          AND r.room_number = '102'`,
      [fixture.propertyId]
    );
    expect(retired.rows[0]).toEqual({ room_status: "inactive", bed_status: "inactive" });
  });

  it("aggregates occupancy, floors, availability, and upcoming moves in SQL", async () => {
    const fixture = await createFixture();
    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [
        roomInput("101", 1, ["vacant", "reserved"], fixture.roomTypes.double),
        roomInput("201", 2, ["occupied", "blocked", "inactive"], fixture.roomTypes.dorm)
      ]
    });
    const reserved = await getBed(fixture.propertyId, "101", "B");
    const occupied = await getBed(fixture.propertyId, "201", "A");
    await db.query(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, occupant_name, occupant_phone_e164, status, expected_move_in_date)
       VALUES ($1::uuid, $2::uuid, 'Future resident', '+919999900002', 'reserved', '2099-01-02')`,
      [fixture.propertyId, reserved.id]
    );
    await db.query(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, occupant_name, occupant_phone_e164, status, notice_end_date)
       VALUES ($1::uuid, $2::uuid, 'Departing resident', '+919999900003', 'notice_served', '2099-02-01')`,
      [fixture.propertyId, occupied.id]
    );

    const summary = await occupancy.summary(operatorId, fixture.propertyId);

    expect(summary).toMatchObject({
      total_beds: 5,
      vacant_beds: 1,
      reserved_beds: 1,
      occupied_beds: 1,
      blocked_beds: 1,
      inactive_beds: 1,
      occupancy_percent: 25,
      by_status: { vacant: 1, reserved: 1, occupied: 1, blocked: 1, inactive: 1 }
    });
    expect(summary.by_floor).toEqual([
      expect.objectContaining({
        floor: 1,
        total_beds: 2,
        vacant_beds: 1,
        reserved_beds: 1,
        occupancy_percent: 0
      }),
      expect.objectContaining({
        floor: 2,
        total_beds: 3,
        occupied_beds: 1,
        blocked_beds: 1,
        inactive_beds: 1,
        occupancy_percent: 50
      })
    ]);
    expect(summary.available_from).toContainEqual({ available_from: "2099-01-01", bed_count: 1 });
    expect(summary.upcoming_move_ins).toEqual([
      expect.objectContaining({
        bed_id: reserved.id,
        room_number: "101",
        bed_label: "B",
        date: "2099-01-02",
        occupant_name: "Future resident"
      })
    ]);
    expect(summary.upcoming_move_outs).toEqual([
      expect.objectContaining({
        bed_id: occupied.id,
        room_number: "201",
        bed_label: "A",
        date: "2099-02-01",
        occupant_name: "Departing resident"
      })
    ]);
  });

  it("excludes upcoming moves when the assignment property does not match the bed room", async () => {
    const target = await createFixture();
    const other = await createFixture();
    await layout.putLayout(operatorId, other.propertyId, {
      rooms: [roomInput("101", 1, ["reserved", "occupied"], other.roomTypes.double)]
    });
    const reserved = await getBed(other.propertyId, "101", "A");
    const occupied = await getBed(other.propertyId, "101", "B");
    await db.query(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, occupant_name, occupant_phone_e164, status,
          expected_move_in_date, notice_end_date)
       VALUES
         ($1::uuid, $2::uuid, 'Wrong property move in', '+919999900006', 'reserved',
          '2099-03-01', NULL),
         ($1::uuid, $3::uuid, 'Wrong property move out', '+919999900007', 'notice_served',
          NULL, '2099-04-01')`,
      [target.propertyId, reserved.id, occupied.id]
    );

    const summary = await occupancy.summary(operatorId, target.propertyId);

    expect(summary.upcoming_move_ins).toEqual([]);
    expect(summary.upcoming_move_outs).toEqual([]);
  });

  it("returns 403 from every property-scoped ops route when management is disabled", async () => {
    const fixture = await createFixture({ managed: false });
    const bedId = randomUUID();
    const routes = [
      () => request(app.getHttpServer()).get(`/v1/pg-operator/properties/${fixture.propertyId}`),
      () =>
        request(app.getHttpServer()).get(`/v1/pg-operator/properties/${fixture.propertyId}/layout`),
      () =>
        request(app.getHttpServer())
          .post(`/v1/pg-operator/properties/${fixture.propertyId}/layout/generate`)
          .send({ room_counts: [] }),
      () =>
        request(app.getHttpServer())
          .put(`/v1/pg-operator/properties/${fixture.propertyId}/layout`)
          .send({ rooms: [] }),
      () =>
        request(app.getHttpServer()).get(
          `/v1/pg-operator/properties/${fixture.propertyId}/occupancy`
        ),
      () =>
        request(app.getHttpServer())
          .patch(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${bedId}/status`)
          .send({ status: "blocked" }),
      () =>
        request(app.getHttpServer())
          .post(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${bedId}/relist`)
          .send({})
    ];

    for (const route of routes) {
      await route().set("x-test-identity", "operator").expect(403);
    }
  });

  it("scopes bed status updates through the managed property", async () => {
    const first = await createFixture();
    const second = await createFixture();
    await layout.putLayout(operatorId, second.propertyId, {
      rooms: [roomInput("101", 1, ["vacant"], second.roomTypes.single)]
    });
    const bed = await getBed(second.propertyId, "101", "A");

    await request(app.getHttpServer())
      .patch(`/v1/pg-operator/properties/${first.propertyId}/beds/${bed.id}/status`)
      .set("x-test-identity", "operator")
      .send({ status: "blocked" })
      .expect(404);

    const unchanged = await getBed(second.propertyId, "101", "A");
    expect(unchanged.status).toBe("vacant");

    const updated = await request(app.getHttpServer())
      .patch(`/v1/pg-operator/properties/${second.propertyId}/beds/${bed.id}/status`)
      .set("x-test-identity", "operator")
      .send({ status: "blocked" })
      .expect(200);
    expect(updated.body.data).toMatchObject({ id: bed.id, status: "blocked" });
  });

  it("relists only private bed availability and leaves the public listing paused", async () => {
    const fixture = await createFixture({ listingStatus: "paused" });
    await layout.putLayout(operatorId, fixture.propertyId, {
      rooms: [roomInput("101", 1, ["blocked"], fixture.roomTypes.single)]
    });
    const bed = await getBed(fixture.propertyId, "101", "A");

    const response = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${bed.id}/relist`)
      .set("x-test-identity", "operator")
      .send({})
      .expect(201);

    expect(response.body.data).toMatchObject({ id: bed.id, status: "vacant" });
    const state = await db.query<{ bed_status: string; listing_status: string }>(
      `SELECT b.status::text AS bed_status, l.status::text AS listing_status
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_listings l ON l.pg_property_id = r.pg_property_id
        WHERE b.id = $1::uuid`,
      [bed.id]
    );
    expect(state.rows[0]).toEqual({ bed_status: "vacant", listing_status: "paused" });
  });
});
