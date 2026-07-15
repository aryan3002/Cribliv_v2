import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import type { NotificationService } from "../../notifications/notification.service";
import { PgBedAssignmentService } from "../services/pg-bed-assignment.service";
import { PgResidenceService } from "../services/pg-residence.service";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("PG residence without a database", () => {
  it("returns null for reads and rejects tenant actions", async () => {
    const db = { isEnabled: () => false } as DatabaseService;
    const assignments = {
      serveNotice: vi.fn(),
      tenantMoveOutRequest: vi.fn(),
      acceptOperatorMoveOut: vi.fn(),
      rejectOperatorMoveOut: vi.fn()
    } as unknown as PgBedAssignmentService;
    const service = new PgResidenceService(db, assignments);
    const tenantId = randomUUID();

    await expect(service.resolve(tenantId)).resolves.toBeNull();
    await expect(
      service.serveNotice(tenantId, { notice_end_date: "2099-02-15" })
    ).rejects.toMatchObject({
      response: {
        code: "operations_requires_db",
        message: "PG operations require a database"
      }
    });
    await expect(service.tenantMoveOutRequest(tenantId)).rejects.toMatchObject({
      response: { code: "operations_requires_db" }
    });
  });
});

describe.skipIf(!HAS_DB)("PG tenant residence (real Postgres integration)", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let residence: PgResidenceService;
  let assignments: PgBedAssignmentService;
  let operatorId: string;
  let tenantId: string;
  let tenantPhone: string;
  let otherTenantId: string;
  let cityId: number;
  const propertyIds: string[] = [];
  const listingIds: string[] = [];
  const userIds: string[] = [];
  const sendNotification = vi.fn();
  const testRunId = randomUUID().replace(/-/g, "");
  let phoneSeq = 0;

  type Fixture = {
    propertyId: string;
    bedIds: string[];
    assignmentId: string;
  };

  const identities = (): Record<string, { id: string; role: Role }> => ({
    tenant: { id: tenantId, role: "tenant" },
    other_tenant: { id: otherTenantId, role: "tenant" },
    operator: { id: operatorId, role: "pg_operator" }
  });

  function uniquePhone(): string {
    phoneSeq += 1;
    return `+9183${String(Date.now() + phoneSeq).slice(-9)}`;
  }

  async function createFixture(
    occupantPhone = tenantPhone,
    options: { tenantUserId?: string | null; occupantName?: string } = {}
  ): Promise<Fixture> {
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, false, true, 'ready', 4)
       RETURNING id::text`,
      [operatorId, `P4 Residence ${randomUUID()}`, cityId]
    );
    const propertyId = property.rows[0].id;
    propertyIds.push(propertyId);

    const listingId = randomUUID();
    listingIds.push(listingId);
    await db.query(
      `INSERT INTO listings
         (id, owner_user_id, listing_type, title_en, status, verification_status, monthly_rent,
          security_deposit, furnishing, pg_property_id)
       VALUES
         ($1::uuid, $2::uuid, 'pg', 'P4 public listing', 'active', 'verified', 12345,
          24690, 'fully_furnished', $3::uuid)`,
      [listingId, operatorId, propertyId]
    );
    await db.query(
      `INSERT INTO pg_listings
         (id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'P4 public listing', 1234500, 'active', 'verified')`,
      [listingId, operatorId, propertyId]
    );
    await db.query(
      `INSERT INTO pg_details
         (listing_id, total_beds, onboarding_path, notice_period_days, lock_in_months,
          security_deposit_paise, meals, house_rules)
       VALUES
         ($1::uuid, 2, 'self_serve', 30, 3, 2469000,
          '{"provided":true,"breakfast":true,"dinner":true}'::jsonb,
          '{"smoking":false,"alcohol":false,"guests_policy":"Operator approval required"}'::jsonb)`,
      [listingId]
    );
    const roomType = await db.query<{ id: string }>(
      `INSERT INTO pg_room_types
         (listing_id, sharing, ac, bathroom_kind, furnishing, monthly_rent_paise, vacancy_count)
       VALUES ($1::uuid, 'double', true, 'attached_western', 'fully_furnished', 1234500, 2)
       RETURNING id::text`,
      [listingId]
    );
    const room = await db.query<{ id: string }>(
      `INSERT INTO pg_rooms
         (pg_property_id, room_type_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, $2::uuid, 4, '401', 'Room 401', 2, 'active')
       RETURNING id::text`,
      [propertyId, roomType.rows[0].id]
    );
    const bedIds: string[] = [];
    for (const label of ["A", "B"]) {
      const bed = await db.query<{ id: string }>(
        `INSERT INTO pg_beds (room_id, bed_label, status, sort_order, metadata)
         VALUES ($1::uuid, $2, 'vacant', $3, '{}'::jsonb)
         RETURNING id::text`,
        [room.rows[0].id, label, label === "A" ? 1 : 2]
      );
      bedIds.push(bed.rows[0].id);
    }

    const assignment = await assignments.moveIn(operatorId, propertyId, bedIds[0], {
      occupant_name: options.occupantName ?? "Seeded Tenant",
      occupant_phone_e164: occupantPhone,
      move_in_date: "2099-01-10",
      monthly_rent_paise: null,
      security_deposit_paise: null,
      operator_notes: "Private operator note"
    });

    if (options.tenantUserId === null) {
      await db.query(`UPDATE pg_bed_assignments SET tenant_user_id = NULL WHERE id = $1::uuid`, [
        assignment.id
      ]);
    }

    await assignments.moveIn(operatorId, propertyId, bedIds[1], {
      occupant_name: "Other Occupant Secret",
      occupant_phone_e164: uniquePhone(),
      move_in_date: "2099-01-11"
    });

    return { propertyId, bedIds, assignmentId: assignment.id };
  }

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'P4 Test City', 'P4 Test City', 'Test State', 'Test State')
       RETURNING id`,
      [`p4-${testRunId}`]
    );
    cityId = city.rows[0].id;

    const operator = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name, preferred_language)
       VALUES ($1, 'pg_operator'::user_role, 'P4 Operator', 'en')
       RETURNING id::text`,
      [`+9182${testRunId.slice(0, 9)}`]
    );
    operatorId = operator.rows[0].id;
    userIds.push(operatorId);

    tenantPhone = uniquePhone();
    const tenant = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant'::user_role, 'en')
       RETURNING id::text`,
      [tenantPhone]
    );
    tenantId = tenant.rows[0].id;
    userIds.push(tenantId);

    const otherTenant = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant'::user_role, 'en')
       RETURNING id::text`,
      [`+9181${testRunId.slice(0, 9)}`]
    );
    otherTenantId = otherTenant.rows[0].id;
    userIds.push(otherTenantId);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string | undefined>; user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const identity = identities()[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .overrideProvider(PgBedAssignmentService)
      .useFactory({
        factory: (database: DatabaseService) =>
          new PgBedAssignmentService(database, {
            send: sendNotification
          } as unknown as NotificationService),
        inject: [DatabaseService]
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
    residence = app.get(PgResidenceService);
    assignments = app.get(PgBedAssignmentService);
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
    const listings = listingIds.splice(0);
    if (listings.length > 0) {
      await db.query(`DELETE FROM pg_listings WHERE id = ANY($1::uuid[])`, [listings]);
      await db.query(`DELETE FROM listings WHERE id = ANY($1::uuid[])`, [listings]);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      if (userIds.length > 0) {
        await db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = ANY($1::uuid[])`, [
          userIds
        ]);
        await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      }
      if (cityId) await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
      await db.onModuleDestroy();
    }
  }, 30_000);

  it("resolves the signed-in tenant residence without leaking other occupants", async () => {
    await createFixture();

    const resolved = await residence.resolve(tenantId);

    expect(resolved).toMatchObject({
      room_number: "401",
      floor: 4,
      bed_label: "A",
      sharing: "double",
      monthly_rent_paise: 1234500,
      security_deposit_paise: 2469000,
      notice_period_days: 30,
      lock_in_months: 3,
      move_in_date: "2099-01-10",
      assignment_status: "active",
      operator_contact: {
        user_id: operatorId,
        name: "P4 Operator"
      }
    });
    expect(JSON.stringify(resolved)).not.toContain("Other Occupant Secret");
    expect(JSON.stringify(resolved)).not.toContain("Private operator note");
    expect(resolved).not.toHaveProperty("occupants");
  });

  it("resolves by verified phone when tenant_user_id is not linked yet", async () => {
    const phone = uniquePhone();
    const laterTenant = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant'::user_role, 'en')
       RETURNING id::text`,
      [phone]
    );
    userIds.push(laterTenant.rows[0].id);
    await createFixture(phone, { tenantUserId: null, occupantName: "Phone Matched Tenant" });

    await expect(residence.resolve(laterTenant.rows[0].id)).resolves.toMatchObject({
      bed_label: "A",
      assignment_status: "active"
    });
  });

  it("returns null instead of another tenant residence when no assignment belongs to the caller", async () => {
    await createFixture();

    await expect(residence.resolve(otherTenantId)).resolves.toBeNull();
    const response = await request(app.getHttpServer())
      .get("/v1/tenant/pg-residence")
      .set("x-test-identity", "other_tenant")
      .expect(200);
    expect(response.body.data).toBeNull();
  });

  it("serves notice through the tenant controller for only the caller residence", async () => {
    await createFixture();

    const forbidden = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/notice")
      .set("x-test-identity", "other_tenant")
      .send({ notice_end_date: "2099-02-15" })
      .expect(404);
    expect(forbidden.body.code).toBe("residence_not_found");

    const noticed = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/notice")
      .set("x-test-identity", "tenant")
      .send({ notice_end_date: "2099-02-15" })
      .expect(201);
    expect(noticed.body.data).toMatchObject({
      assignment_status: "notice_served",
      notice_end_date: "2099-02-15"
    });
    expect(noticed.body.data.notice_days_remaining).toBeTypeOf("number");
  });

  it("runs tenant move-out request and operator move-out accept/reject through scoped routes", async () => {
    const fixture = await createFixture();

    const requested = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/move-out-request")
      .set("x-test-identity", "tenant")
      .expect(201);
    expect(requested.body.data.assignment_status).toBe("move_out_requested");

    await assignments.operatorMoveOutRequest(operatorId, fixture.propertyId, fixture.assignmentId);
    await request(app.getHttpServer())
      .post(`/v1/tenant/pg-residence/operator-move-out/${fixture.assignmentId}/reject`)
      .set("x-test-identity", "other_tenant")
      .expect(403);

    const rejected = await request(app.getHttpServer())
      .post(`/v1/tenant/pg-residence/operator-move-out/${fixture.assignmentId}/reject`)
      .set("x-test-identity", "tenant")
      .expect(201);
    expect(rejected.body.data.assignment_status).toBe("active");

    await assignments.operatorMoveOutRequest(operatorId, fixture.propertyId, fixture.assignmentId);
    const accepted = await request(app.getHttpServer())
      .post(`/v1/tenant/pg-residence/operator-move-out/${fixture.assignmentId}/accept`)
      .set("x-test-identity", "tenant")
      .expect(201);
    expect(accepted.body.data.assignment_status).toBe("moved_out");
    await expect(residence.resolve(tenantId)).resolves.toBeNull();
  });
});
