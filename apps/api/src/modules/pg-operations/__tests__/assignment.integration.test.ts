import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PgBedAssignmentOccupantInput } from "@cribliv/shared-types";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import type { NotificationService } from "../../notifications/notification.service";
import { PgBedAssignmentService } from "../services/pg-bed-assignment.service";

const HAS_DB = Boolean(process.env.DATABASE_URL);

const occupant = (overrides: Partial<PgBedAssignmentOccupantInput> = {}) => ({
  occupant_name: "Phase 3 Occupant",
  occupant_phone_e164: "+919700000001",
  expected_move_in_date: "2099-01-15",
  monthly_rent_paise: 850000,
  security_deposit_paise: 1700000,
  operator_notes: "Integration fixture",
  ...overrides
});

describe("PG bed assignments without a database", () => {
  it("returns typed-empty reads and rejects every write", async () => {
    const db = { isEnabled: () => false } as DatabaseService;
    const notifications = { send: vi.fn() } as unknown as NotificationService;
    const service = new PgBedAssignmentService(db, notifications);
    const operatorId = randomUUID();
    const propertyId = randomUUID();
    const bedId = randomUUID();
    const assignmentId = randomUUID();
    const tenantId = randomUUID();
    const unavailable = {
      response: {
        code: "operations_requires_db",
        message: "PG operations require a database"
      }
    };

    await expect(service.list(operatorId, propertyId)).resolves.toEqual([]);
    await expect(service.reserve(operatorId, propertyId, bedId, occupant())).rejects.toMatchObject(
      unavailable
    );
    await expect(service.moveIn(operatorId, propertyId, bedId, occupant())).rejects.toMatchObject(
      unavailable
    );
    await expect(
      service.operatorMoveOutRequest(operatorId, propertyId, assignmentId)
    ).rejects.toMatchObject(unavailable);
    await expect(
      service.confirmMoveOut(operatorId, propertyId, assignmentId)
    ).rejects.toMatchObject(unavailable);
    await expect(service.cancelMoveOut(operatorId, propertyId, assignmentId)).rejects.toMatchObject(
      unavailable
    );
    await expect(
      service.cancelReservation(operatorId, propertyId, assignmentId)
    ).rejects.toMatchObject(unavailable);
    await expect(
      service.serveNotice(tenantId, assignmentId, { notice_end_date: "2099-02-15" })
    ).rejects.toMatchObject(unavailable);
    await expect(service.tenantMoveOutRequest(tenantId, assignmentId)).rejects.toMatchObject(
      unavailable
    );
    await expect(service.acceptOperatorMoveOut(tenantId, assignmentId)).rejects.toMatchObject(
      unavailable
    );
    await expect(service.rejectOperatorMoveOut(tenantId, assignmentId)).rejects.toMatchObject(
      unavailable
    );
  });
});

describe.skipIf(!HAS_DB)("PG bed assignments (real Postgres integration)", () => {
  let db: DatabaseService;
  let app: INestApplication;
  let service: PgBedAssignmentService;
  let operatorId: string;
  let tenantId: string;
  let otherTenantId: string;
  let cityId: number;
  const propertyIds: string[] = [];
  const userIds: string[] = [];
  const sendNotification = vi.fn();
  const testRunId = randomUUID().replace(/-/g, "");

  type Fixture = {
    propertyId: string;
    bedIds: string[];
  };

  async function createFixture(
    options: {
      managed?: boolean;
      bedStatuses?: Array<"vacant" | "reserved" | "occupied" | "blocked" | "inactive">;
    } = {}
  ): Promise<Fixture> {
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, false, $4, 'ready', 1)
       RETURNING id::text`,
      [operatorId, `P3 property ${randomUUID()}`, cityId, options.managed ?? true]
    );
    const propertyId = property.rows[0].id;
    propertyIds.push(propertyId);

    const room = await db.query<{ id: string }>(
      `INSERT INTO pg_rooms
         (pg_property_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, 1, $2, $3, $4, 'active')
       RETURNING id::text`,
      [
        propertyId,
        `P3-${randomUUID().slice(0, 8)}`,
        "Phase 3 room",
        options.bedStatuses?.length ?? 3
      ]
    );
    const statuses = options.bedStatuses ?? ["vacant", "vacant", "vacant"];
    const bedIds: string[] = [];
    for (const [index, status] of statuses.entries()) {
      const bed = await db.query<{ id: string }>(
        `INSERT INTO pg_beds (room_id, bed_label, status, sort_order, metadata)
         VALUES ($1::uuid, $2, $3::pg_bed_status, $4, '{}'::jsonb)
         RETURNING id::text`,
        [room.rows[0].id, String.fromCharCode(65 + index), status, index + 1]
      );
      bedIds.push(bed.rows[0].id);
    }
    return { propertyId, bedIds };
  }

  async function expectUniqueViolation(promise: Promise<unknown>): Promise<void> {
    try {
      await promise;
      throw new Error("Expected a unique violation");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("23505");
    }
  }

  async function bedStatus(bedId: string): Promise<string> {
    const result = await db.query<{ status: string }>(
      `SELECT status::text FROM pg_beds WHERE id = $1::uuid`,
      [bedId]
    );
    return result.rows[0].status;
  }

  async function events(assignmentId: string) {
    const result = await db.query<{
      event_type: string;
      initiator: string;
      actor_user_id: string | null;
      from_status: string | null;
      to_status: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, initiator::text, actor_user_id::text, from_status, to_status, payload
         FROM pg_assignment_events
        WHERE assignment_id = $1::uuid
        ORDER BY created_at, id`,
      [assignmentId]
    );
    return result.rows;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'P3 Test City', 'P3 Test City', 'Test State', 'Test State')
       RETURNING id`,
      [`p3-${testRunId}`]
    );
    cityId = city.rows[0].id;

    const operator = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'pg_operator'::user_role, 'en')
       RETURNING id::text`,
      [`+9186${testRunId.slice(0, 9)}`]
    );
    operatorId = operator.rows[0].id;
    userIds.push(operatorId);

    const seededTenant = await db.query<{ id: string }>(
      `SELECT id::text FROM users WHERE phone_e164 = '+919999999902' LIMIT 1`
    );
    if (!seededTenant.rows[0]) throw new Error("Seeded tenant +919999999902 is required");
    tenantId = seededTenant.rows[0].id;

    const otherTenant = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant'::user_role, 'en')
       RETURNING id::text`,
      [`+9185${testRunId.slice(0, 9)}`]
    );
    otherTenantId = otherTenant.rows[0].id;
    userIds.push(otherTenantId);

    service = new PgBedAssignmentService(db, {
      send: sendNotification
    } as unknown as NotificationService);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string | undefined>; user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const identities: Record<string, { id: string; role: Role }> = {
            operator: { id: operatorId, role: "pg_operator" }
          };
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
  }, 30_000);

  beforeEach(() => {
    sendNotification.mockReset();
    sendNotification.mockResolvedValue(true);
  });

  afterEach(async () => {
    const ids = propertyIds.splice(0);
    if (ids.length > 0) {
      await db.query(`DELETE FROM pg_properties WHERE id = ANY($1::uuid[])`, [ids]);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      if (userIds.length > 0) {
        await db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = ANY($1::uuid[])`, [
          userIds
        ]);
      }
      if (userIds.length > 0) {
        await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      }
      if (cityId) await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
      await db.onModuleDestroy();
    }
  }, 30_000);

  it("proves both active-assignment partial unique indexes reject duplicates", async () => {
    const fixture = await createFixture();
    await db.query(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164, status, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Tenant A', '+919999999902', 'active', $4::uuid)`,
      [fixture.propertyId, fixture.bedIds[0], tenantId, operatorId]
    );

    await expectUniqueViolation(
      db.query(
        `INSERT INTO pg_bed_assignments
           (pg_property_id, bed_id, occupant_name, occupant_phone_e164, status, created_by)
         VALUES ($1::uuid, $2::uuid, 'Tenant B', '+919700000002', 'reserved', $3::uuid)`,
        [fixture.propertyId, fixture.bedIds[0], operatorId]
      )
    );
    await expectUniqueViolation(
      db.query(
        `INSERT INTO pg_bed_assignments
           (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164, status, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Tenant A again', '+919999999902', 'active', $4::uuid)`,
        [fixture.propertyId, fixture.bedIds[1], tenantId, operatorId]
      )
    );
  });

  it("requires managed ownership for operator reads and writes", async () => {
    const fixture = await createFixture({ managed: false });

    await expect(service.list(operatorId, fixture.propertyId)).rejects.toMatchObject({
      response: { code: "forbidden", message: "Forbidden" }
    });
    await expect(
      service.reserve(operatorId, fixture.propertyId, fixture.bedIds[0], occupant())
    ).rejects.toMatchObject({ response: { code: "forbidden" } });
    await expect(
      service.reserve(
        operatorId,
        fixture.propertyId,
        fixture.bedIds[0],
        occupant({ occupant_name: "", occupant_phone_e164: "not-e164" })
      )
    ).rejects.toMatchObject({ response: { code: "forbidden" } });
  });

  it("reserves then moves in, links the seeded tenant by phone, and writes one event each", async () => {
    const fixture = await createFixture();
    const reserved = await service.reserve(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );

    expect(reserved).toMatchObject({
      status: "reserved",
      tenant_user_id: tenantId,
      expected_move_in_date: "2099-01-15"
    });
    expect(await bedStatus(fixture.bedIds[0])).toBe("reserved");
    expect(await events(reserved.id)).toMatchObject([
      { initiator: "operator", actor_user_id: operatorId, from_status: null, to_status: "reserved" }
    ]);

    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_name: "Seeded Tenant", occupant_phone_e164: "+919999999902" })
    );

    expect(active).toMatchObject({
      id: reserved.id,
      status: "active",
      tenant_user_id: tenantId,
      occupant_name: "Seeded Tenant"
    });
    expect(active.move_in_date).not.toBeNull();
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
    expect(await events(active.id)).toMatchObject([
      { from_status: null, to_status: "reserved" },
      {
        initiator: "operator",
        actor_user_id: operatorId,
        from_status: "reserved",
        to_status: "active"
      }
    ]);
  });

  it("exposes reserve through a property-scoped idempotent controller endpoint", async () => {
    const fixture = await createFixture();
    const key = `reserve-${testRunId}`;

    const missingKey = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${fixture.bedIds[0]}/reserve`)
      .set("x-test-identity", "operator")
      .send(occupant())
      .expect(400);
    expect(missingKey.body.code).toBe("missing_idempotency_key");

    const first = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${fixture.bedIds[0]}/reserve`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", key)
      .send(occupant({ occupant_phone_e164: "+919999999902" }))
      .expect(201);

    const replay = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${fixture.bedIds[0]}/reserve`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", key)
      .send(occupant({ occupant_phone_e164: "+919999999902" }))
      .expect(201);

    expect(first.body.data).toMatchObject({
      id: replay.body.data.id,
      status: "reserved",
      tenant_user_id: tenantId
    });

    const listed = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/assignments?status=reserved`)
      .set("x-test-identity", "operator")
      .expect(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ id: first.body.data.id, status: "reserved" })
    ]);

    const movedIn = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${fixture.bedIds[0]}/move-in`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `${key}-move-in`)
      .send(occupant({ occupant_phone_e164: "+919999999902" }))
      .expect(201);
    expect(movedIn.body.data).toMatchObject({ id: first.body.data.id, status: "active" });

    const unlinked = await createFixture();
    const unlinkedMoveIn = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${unlinked.propertyId}/beds/${unlinked.bedIds[0]}/move-in`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `${key}-unlinked-move-in`)
      .send(occupant({ occupant_phone_e164: "+919700000004" }))
      .expect(201);

    const pending = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${unlinked.propertyId}/assignments/${unlinkedMoveIn.body.data.id}/operator-move-out-request`
      )
      .set("x-test-identity", "operator")
      .expect(201);
    expect(pending.body.data.status).toBe("move_out_pending_confirmation");

    const confirmed = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${unlinked.propertyId}/assignments/${unlinkedMoveIn.body.data.id}/confirm-move-out`
      )
      .set("x-test-identity", "operator")
      .expect(201);
    expect(confirmed.body.data.status).toBe("moved_out");
  });

  it("maps tenant double-occupancy unique violations to the clean 409 response", async () => {
    const fixture = await createFixture();
    await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );

    await expect(
      service.moveIn(
        operatorId,
        fixture.propertyId,
        fixture.bedIds[1],
        occupant({ occupant_phone_e164: "+919999999902" })
      )
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "bed_or_tenant_occupied" }
    });
    expect(await bedStatus(fixture.bedIds[1])).toBe("vacant");
  });

  it("lists assignments with status and bed filters", async () => {
    const fixture = await createFixture();
    const reserved = await service.reserve(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant()
    );
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[1],
      occupant({ occupant_phone_e164: "+919700000003" })
    );

    await expect(
      service.list(operatorId, fixture.propertyId, { status: "active" })
    ).resolves.toEqual([expect.objectContaining({ id: active.id, status: "active" })]);
    await expect(
      service.list(operatorId, fixture.propertyId, { bed_id: fixture.bedIds[0] })
    ).resolves.toEqual([expect.objectContaining({ id: reserved.id, status: "reserved" })]);
  });

  it("runs notice through pending confirmation to moved out and frees the bed only at confirmation", async () => {
    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );

    const noticed = await service.serveNotice(tenantId, active.id, {
      notice_end_date: "2099-02-15"
    });
    expect(noticed).toMatchObject({
      status: "notice_served",
      notice_end_date: "2099-02-15"
    });
    expect(noticed.notice_served_date).not.toBeNull();
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");

    const pending = await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);
    expect(pending.status).toBe("move_out_pending_confirmation");
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");

    const movedOut = await service.confirmMoveOut(operatorId, fixture.propertyId, active.id);
    expect(movedOut.status).toBe("moved_out");
    expect(movedOut.move_out_date).not.toBeNull();
    expect(await bedStatus(fixture.bedIds[0])).toBe("vacant");
    expect(await events(active.id)).toMatchObject([
      { from_status: null, to_status: "active", initiator: "operator" },
      { from_status: "active", to_status: "notice_served", initiator: "tenant" },
      {
        from_status: "notice_served",
        to_status: "move_out_pending_confirmation",
        initiator: "operator"
      },
      {
        from_status: "move_out_pending_confirmation",
        to_status: "moved_out",
        initiator: "operator"
      }
    ]);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "operator.pg_notice_served", recipientUserId: operatorId })
    );
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: "tenant.pg_move_out_requested", recipientUserId: tenantId })
    );
  });

  it("records a tenant move-out request, keeps the bed occupied, and scopes the action", async () => {
    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );

    await expect(service.tenantMoveOutRequest(otherTenantId, active.id)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
    const requested = await service.tenantMoveOutRequest(tenantId, active.id);
    expect(requested.status).toBe("move_out_requested");
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
    expect(await events(active.id)).toHaveLength(2);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "operator.pg_move_out_requested",
        recipientUserId: operatorId
      })
    );
  });

  it("lets the operator advance a tenant move-out request to pending confirmation", async () => {
    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );
    await service.tenantMoveOutRequest(tenantId, active.id);

    const pending = await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);

    expect(pending.status).toBe("move_out_pending_confirmation");
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
    expect(await events(active.id)).toMatchObject([
      { from_status: null, to_status: "active" },
      { from_status: "active", to_status: "move_out_requested" },
      { from_status: "move_out_requested", to_status: "move_out_pending_confirmation" }
    ]);
  });

  it("cancels a pending move-out back to active without freeing the bed", async () => {
    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant()
    );
    await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);

    const cancelled = await service.cancelMoveOut(operatorId, fixture.propertyId, active.id);
    expect(cancelled.status).toBe("active");
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
    expect(await events(active.id)).toMatchObject([
      { from_status: null, to_status: "active" },
      { from_status: "active", to_status: "move_out_pending_confirmation" },
      { from_status: "move_out_pending_confirmation", to_status: "active" }
    ]);
  });

  it("cancels a reservation, frees the bed, and writes an event", async () => {
    const fixture = await createFixture();
    const reserved = await service.reserve(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant()
    );

    const cancelled = await service.cancelReservation(operatorId, fixture.propertyId, reserved.id);

    expect(cancelled.status).toBe("cancelled");
    expect(await bedStatus(fixture.bedIds[0])).toBe("vacant");
    expect(await events(reserved.id)).toMatchObject([
      { from_status: null, to_status: "reserved" },
      { from_status: "reserved", to_status: "cancelled", initiator: "operator" }
    ]);
  });

  it("supports tenant rejection and acceptance of an operator move-out request", async () => {
    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );
    await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);

    const rejected = await service.rejectOperatorMoveOut(tenantId, active.id);
    expect(rejected.status).toBe("active");
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");

    await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);
    const accepted = await service.acceptOperatorMoveOut(tenantId, active.id);
    expect(accepted.status).toBe("moved_out");
    expect(await bedStatus(fixture.bedIds[0])).toBe("vacant");
    expect(await events(active.id)).toHaveLength(5);
  });

  it("rejects illegal transitions including move-in on a blocked bed", async () => {
    const blocked = await createFixture({ bedStatuses: ["blocked"] });
    await expect(
      service.moveIn(operatorId, blocked.propertyId, blocked.bedIds[0], occupant())
    ).rejects.toMatchObject({ response: { code: "bed_not_vacant" } });
    expect(await bedStatus(blocked.bedIds[0])).toBe("blocked");

    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant()
    );
    await expect(
      service.confirmMoveOut(operatorId, fixture.propertyId, active.id)
    ).rejects.toMatchObject({ response: { code: "invalid_assignment_transition" } });
    expect(await events(active.id)).toHaveLength(1);
  });

  it("does not let notification failures block committed transitions", async () => {
    const fixture = await createFixture();
    const active = await service.moveIn(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0],
      occupant({ occupant_phone_e164: "+919999999902" })
    );
    sendNotification.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(
      service.serveNotice(tenantId, active.id, { notice_end_date: "2099-03-01" })
    ).resolves.toMatchObject({ status: "notice_served" });
    expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
    expect(await events(active.id)).toHaveLength(2);
  });
});
