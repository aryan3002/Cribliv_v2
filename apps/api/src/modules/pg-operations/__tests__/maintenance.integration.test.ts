import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { AzureBlobPhotoStorageService } from "../../owner/azure-blob-photo-storage.service";
import { PgBedAssignmentService } from "../services/pg-bed-assignment.service";
import { PgMaintenanceService } from "../services/pg-maintenance.service";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const testRunId = randomUUID().replace(/-/g, "");

describe("PG maintenance without a database", () => {
  it("returns typed empty reads and rejects writes", async () => {
    const service = new PgMaintenanceService({ isEnabled: () => false } as DatabaseService);
    const userId = randomUUID();
    const propertyId = randomUUID();
    const requestId = randomUUID();

    await expect(service.listForProperty(userId, propertyId)).resolves.toEqual([]);
    await expect(service.listForBed(userId, propertyId, randomUUID())).resolves.toEqual([]);
    await expect(service.listForResidence(userId)).resolves.toEqual([]);
    await expect(service.summaryForBed(userId, propertyId, randomUUID())).resolves.toEqual({
      open_items: 0,
      overdue_items: 0
    });
    await expect(
      service.create(userId, "", "", {
        category: "plumbing",
        description: "The tap has been leaking since morning."
      })
    ).rejects.toMatchObject({
      response: {
        code: "operations_requires_db",
        message: "PG operations require a database"
      }
    });
    await expect(service.updateStatus(userId, requestId, "in_progress")).rejects.toMatchObject({
      response: { code: "operations_requires_db" }
    });
    await expect(service.addComment(userId, requestId, "checking")).rejects.toMatchObject({
      response: { code: "operations_requires_db" }
    });
  });
});

describe.skipIf(!HAS_DB)("PG maintenance (real Postgres integration)", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let maintenance: PgMaintenanceService;
  let assignments: PgBedAssignmentService;
  let presignCalls: Array<{ propertyId: string; requestId: string; clientUploadId: string }>;
  let cityId: number;
  let operatorId: string;
  let otherOperatorId: string;
  let tenantId: string;
  let otherTenantId: string;
  let foreignTenantId: string;
  let foreignOtherTenantId: string;
  const propertyIds: string[] = [];
  const userIds: string[] = [];

  type Fixture = {
    propertyId: string;
    bedIds: [string, string];
    assignmentIds: [string, string];
  };

  async function createUser(role: Role, phoneSuffix: string): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, $2::user_role, 'en')
       RETURNING id::text`,
      [`+918${phoneSuffix}`, role]
    );
    userIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  async function createFixture(
    ownerId = operatorId,
    tenants: [string, string] = [tenantId, otherTenantId]
  ): Promise<Fixture> {
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, false, true, 'ready', 1)
       RETURNING id::text`,
      [ownerId, `P5 property ${randomUUID()}`, cityId]
    );
    const propertyId = property.rows[0].id;
    propertyIds.push(propertyId);

    const room = await db.query<{ id: string }>(
      `INSERT INTO pg_rooms
         (pg_property_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, 1, $2, 'Maintenance room', 2, 'active')
       RETURNING id::text`,
      [propertyId, `P5-${randomUUID().slice(0, 8)}`]
    );

    const bedIds: string[] = [];
    const assignmentIds: string[] = [];
    for (const [index, tenantUserId] of tenants.entries()) {
      const bed = await db.query<{ id: string }>(
        `INSERT INTO pg_beds (room_id, bed_label, status, sort_order, metadata)
         VALUES ($1::uuid, $2, 'occupied', $3, '{}'::jsonb)
         RETURNING id::text`,
        [room.rows[0].id, String.fromCharCode(65 + index), index + 1]
      );
      bedIds.push(bed.rows[0].id);

      const assignment = await db.query<{ id: string }>(
        `INSERT INTO pg_bed_assignments
           (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164, status, created_by)
         SELECT $1::uuid, $2::uuid, u.id, $3, u.phone_e164, 'active', $4::uuid
           FROM users u
          WHERE u.id = $5::uuid
         RETURNING id::text`,
        [propertyId, bed.rows[0].id, `P5 Tenant ${index + 1}`, ownerId, tenantUserId]
      );
      assignmentIds.push(assignment.rows[0].id);
    }

    return {
      propertyId,
      bedIds: bedIds as [string, string],
      assignmentIds: assignmentIds as [string, string]
    };
  }

  async function createTenantTicket(
    fixture: Fixture,
    tenantUserId = tenantId,
    input: { category?: string; description?: string; photo_paths?: string[] } = {}
  ) {
    return maintenance.create(tenantUserId, randomUUID(), randomUUID(), {
      category: input.category ?? "plumbing",
      description: input.description ?? "Water is leaking from the tap",
      photo_paths: input.photo_paths
    });
  }

  async function createHistoricalTicketForTenant(tenantUserId: string): Promise<string> {
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, false, true, 'ready', 1)
       RETURNING id::text`,
      [operatorId, `P5 old property ${randomUUID()}`, cityId]
    );
    propertyIds.push(property.rows[0].id);

    const room = await db.query<{ id: string }>(
      `INSERT INTO pg_rooms
         (pg_property_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, 1, $2, 'Old maintenance room', 1, 'active')
       RETURNING id::text`,
      [property.rows[0].id, `P5-old-${randomUUID().slice(0, 8)}`]
    );
    const bed = await db.query<{ id: string }>(
      `INSERT INTO pg_beds (room_id, bed_label, status, sort_order, metadata)
       VALUES ($1::uuid, 'A', 'vacant', 1, '{}'::jsonb)
       RETURNING id::text`,
      [room.rows[0].id]
    );
    const assignment = await db.query<{ id: string }>(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164,
          status, created_by, move_out_date)
       SELECT $1::uuid, $2::uuid, u.id, 'Old P5 Tenant', u.phone_e164,
              'moved_out', $3::uuid, CURRENT_DATE
         FROM users u
        WHERE u.id = $4::uuid
       RETURNING id::text`,
      [property.rows[0].id, bed.rows[0].id, operatorId, tenantUserId]
    );
    const ticket = await db.query<{ id: string }>(
      `INSERT INTO pg_maintenance_requests
         (pg_property_id, assignment_id, created_by_user_id, category, description)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'old', 'Old residence ticket')
       RETURNING id::text`,
      [property.rows[0].id, assignment.rows[0].id, tenantUserId]
    );
    return ticket.rows[0].id;
  }

  beforeAll(async () => {
    presignCalls = [];
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'P5 Test City', 'P5 Test City', 'Test State', 'Test State')
       RETURNING id`,
      [`p5-${testRunId}`]
    );
    cityId = city.rows[0].id;

    operatorId = await createUser("pg_operator", `61${testRunId.slice(0, 9)}`);
    otherOperatorId = await createUser("pg_operator", `62${testRunId.slice(0, 9)}`);
    tenantId = await createUser("tenant", `63${testRunId.slice(0, 9)}`);
    otherTenantId = await createUser("tenant", `64${testRunId.slice(0, 9)}`);
    foreignTenantId = await createUser("tenant", `65${testRunId.slice(0, 9)}`);
    foreignOtherTenantId = await createUser("tenant", `66${testRunId.slice(0, 9)}`);

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
            operator: { id: operatorId, role: "pg_operator" },
            otherOperator: { id: otherOperatorId, role: "pg_operator" },
            tenant: { id: tenantId, role: "tenant" },
            otherTenant: { id: otherTenantId, role: "tenant" }
          };
          const identity = identities[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .overrideProvider(AzureBlobPhotoStorageService)
      .useValue({
        validatePresignRequest: () => undefined,
        createMaintenanceUploadTarget: (input: {
          propertyId: string;
          requestId: string;
          clientUploadId: string;
          contentType: string;
        }) => {
          presignCalls.push({
            propertyId: input.propertyId,
            requestId: input.requestId,
            clientUploadId: input.clientUploadId
          });
          const extension = input.contentType === "image/png" ? "png" : "jpg";
          const blobPath = `pg-maintenance/${input.propertyId}/${input.requestId}/${input.clientUploadId}.${extension}`;
          return {
            uploadUrl: `https://upload.test/${blobPath}`,
            blobPath,
            expiresAt: "2099-01-01T00:00:00.000Z"
          };
        },
        validateMaintenanceUploadedBlob: () => Promise.resolve(),
        getPhotoPublicBaseUrl: () => "https://cdn.test"
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
    maintenance = app.get(PgMaintenanceService);
    assignments = app.get(PgBedAssignmentService);
  }, 30_000);

  afterEach(async () => {
    presignCalls = [];
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
        await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      }
      if (cityId) await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
      await db.onModuleDestroy();
    }
  }, 30_000);

  it("allows only the maintenance status workflow", async () => {
    const fixture = await createFixture();
    const ticket = await createTenantTicket(fixture);
    const legalStatuses = [
      "in_progress",
      "waiting_on_tenant",
      "in_progress",
      "resolved",
      "closed"
    ] as const;

    let current = ticket;
    for (const status of legalStatuses) {
      current = await maintenance.updateStatus(operatorId, current.id, status);
      expect(current.status).toBe(status);
    }
    expect(current.closed_at).not.toBeNull();

    const invalidTransitions = [
      ["open", "resolved"],
      ["waiting_on_tenant", "closed"],
      ["resolved", "in_progress"],
      ["closed", "cancelled"],
      ["cancelled", "open"]
    ] as const;
    for (const [fromStatus, targetStatus] of invalidTransitions) {
      const invalid = await db.query<{ id: string }>(
        `INSERT INTO pg_maintenance_requests
           (pg_property_id, assignment_id, created_by_user_id, category, description, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'test', 'invalid transition', $4::pg_maintenance_status)
         RETURNING id::text`,
        [fixture.propertyId, fixture.assignmentIds[0], tenantId, fromStatus]
      );
      await expect(
        maintenance.updateStatus(operatorId, invalid.rows[0].id, targetStatus)
      ).rejects.toMatchObject({ response: { code: "invalid_maintenance_transition" } });
    }
  });

  it("scopes tenant maintenance creates and listings to the caller residence", async () => {
    const fixture = await createFixture();
    const ownTicket = await createTenantTicket(fixture, tenantId, { category: "electricity" });
    const otherTicket = await createTenantTicket(fixture, otherTenantId, { category: "wifi" });
    const oldTicketId = await createHistoricalTicketForTenant(tenantId);

    expect(ownTicket).toMatchObject({
      pg_property_id: fixture.propertyId,
      assignment_id: fixture.assignmentIds[0],
      created_by_user_id: tenantId
    });
    await expect(maintenance.listForResidence(tenantId)).resolves.toEqual([
      expect.objectContaining({ id: ownTicket.id, category: "electricity" })
    ]);

    const tenantList = await request(app.getHttpServer())
      .get("/v1/tenant/pg-residence/maintenance")
      .set("x-test-identity", "tenant")
      .expect(200);
    expect(tenantList.body.data).toEqual([expect.objectContaining({ id: ownTicket.id })]);
    expect(tenantList.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: otherTicket.id }),
        expect.objectContaining({ id: oldTicketId })
      ])
    );
    await expect(
      maintenance.addComment(tenantId, oldTicketId, "old follow-up")
    ).rejects.toMatchObject({ response: { code: "forbidden" } });
    await expect(
      createTenantTicket(fixture, tenantId, { photo_paths: ["pg-maintenance/property/file.jpg"] })
    ).rejects.toMatchObject({ response: { code: "maintenance_photos_not_supported" } });
  });

  it("maps V2 category, SLA, and common-area location metadata when a tenant creates a ticket", async () => {
    await createFixture();

    const response = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/maintenance")
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", randomUUID())
      .send({
        category_slug: "plumbing",
        description: "The washroom tap is leaking badly.",
        location: { kind: "common_area", common_area: "common_bathroom" }
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      category_slug: "plumbing",
      category_label_snapshot: "Plumbing",
      priority: "high",
      sla_hours: 24,
      location_snapshot: expect.objectContaining({
        kind: "common_area",
        common_area: "common_bathroom"
      })
    });
    expect(new Date(response.body.data.sla_due_at).getTime()).toBeGreaterThan(
      new Date(response.body.data.created_at).getTime()
    );
  });

  it("returns room context and supports request and comment photos", async () => {
    const fixture = await createFixture();
    const createResponse = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/maintenance")
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", randomUUID())
      .send({
        category: "Plumbing",
        description: "The tap has been leaking since this morning."
      })
      .expect(201);
    const ticketId = createResponse.body.data.id as string;

    expect(createResponse.body.data.location).toMatchObject({
      property_id: fixture.propertyId,
      property_name: expect.stringContaining("P5 property"),
      room_number: expect.stringContaining("P5-"),
      room_label: "Maintenance room",
      floor: 1,
      bed_id: fixture.bedIds[0],
      bed_label: "A",
      tenant_name: "P5 Tenant 1",
      tenant_phone_e164: expect.stringMatching(/^\+918/)
    });

    const presignResponse = await request(app.getHttpServer())
      .post(`/v1/tenant/pg-residence/maintenance/${ticketId}/photos/presign`)
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", randomUUID())
      .send({
        files: [{ client_upload_id: "tap-proof", content_type: "image/jpeg", size_bytes: 1200 }]
      })
      .expect(201);
    const blobPath = presignResponse.body.data.uploads[0].blob_path as string;

    expect(blobPath).toBe(`pg-maintenance/${fixture.propertyId}/${ticketId}/tap-proof.jpg`);
    expect(presignCalls).toEqual([
      { propertyId: fixture.propertyId, requestId: ticketId, clientUploadId: "tap-proof" }
    ]);

    const photoResponse = await request(app.getHttpServer())
      .post(`/v1/tenant/pg-residence/maintenance/${ticketId}/photos/complete`)
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", randomUUID())
      .send({ photos: [{ client_upload_id: "tap-proof", blob_path: blobPath }] })
      .expect(201);

    expect(photoResponse.body.data).toMatchObject({
      id: ticketId,
      photo_paths: [blobPath],
      photo_urls: [`https://cdn.test/${blobPath}`]
    });

    const commentPresign = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/photos/presign`
      )
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({
        files: [{ client_upload_id: "repair-proof", content_type: "image/png", size_bytes: 900 }]
      })
      .expect(201);
    const commentBlobPath = commentPresign.body.data.uploads[0].blob_path as string;

    const commentResponse = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/comments`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({ body: "", attachments: [commentBlobPath] })
      .expect(201);

    expect(commentResponse.body.data).toMatchObject({
      body: "",
      attachments: [commentBlobPath],
      attachment_urls: [`https://cdn.test/${commentBlobPath}`]
    });

    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/comments`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({
        body: "",
        attachments: Array.from(
          { length: 7 },
          (_, index) => `pg-maintenance/${fixture.propertyId}/${ticketId}/overflow-${index}.jpg`
        )
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: "too_many_maintenance_attachments" });
      });
  });

  it("replays maintenance create and comment idempotency keys", async () => {
    const fixture = await createFixture();
    const createKey = randomUUID();
    const body = {
      category: "plumbing",
      description: "The bathroom tap has been leaking since morning."
    };

    const firstCreate = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/maintenance")
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", createKey)
      .send(body)
      .expect(201);
    const secondCreate = await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/maintenance")
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", createKey)
      .send(body)
      .expect(201);

    expect(secondCreate.body.data.id).toBe(firstCreate.body.data.id);
    await expect(maintenance.listForResidence(tenantId)).resolves.toEqual([
      expect.objectContaining({ id: firstCreate.body.data.id })
    ]);

    const commentKey = randomUUID();
    const firstComment = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${firstCreate.body.data.id}/comments`
      )
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", commentKey)
      .send({ body: "Plumber booked for noon" })
      .expect(201);
    const secondComment = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${firstCreate.body.data.id}/comments`
      )
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", commentKey)
      .send({ body: "Plumber booked for noon" })
      .expect(201);

    expect(secondComment.body.data.id).toBe(firstComment.body.data.id);
    await expect(maintenance.listForProperty(operatorId, fixture.propertyId)).resolves.toEqual([
      expect.objectContaining({
        id: firstCreate.body.data.id,
        comments: [expect.objectContaining({ id: firstComment.body.data.id })]
      })
    ]);
  });

  it("lets the property operator triage, comment on, and close a ticket", async () => {
    const fixture = await createFixture();
    const ticket = await createTenantTicket(fixture);

    await maintenance.updateStatus(operatorId, ticket.id, "in_progress");
    const operatorComment = await maintenance.addComment(
      operatorId,
      ticket.id,
      "Plumber booked for noon"
    );
    const tenantComment = await maintenance.addComment(
      tenantId,
      ticket.id,
      "Please call before arriving"
    );
    await maintenance.updateStatus(operatorId, ticket.id, "resolved");
    const closed = await maintenance.updateStatus(operatorId, ticket.id, "closed");

    expect(operatorComment.author_role).toBe("pg_operator");
    expect(tenantComment.author_role).toBe("tenant");
    expect(closed).toMatchObject({ status: "closed", closed_at: expect.any(String) });
  });

  it("returns comment threads in creation order", async () => {
    const fixture = await createFixture();
    const ticket = await createTenantTicket(fixture);
    const first = await maintenance.addComment(tenantId, ticket.id, "First message");
    const second = await maintenance.addComment(operatorId, ticket.id, "Second message");
    const listed = await maintenance.listForProperty(operatorId, fixture.propertyId);

    expect(listed).toEqual([
      expect.objectContaining({
        id: ticket.id,
        comments: [
          expect.objectContaining({ id: first.id, body: "First message" }),
          expect.objectContaining({ id: second.id, body: "Second message" })
        ]
      })
    ]);
  });

  it("enforces property ownership for operator maintenance routes", async () => {
    const foreignFixture = await createFixture(otherOperatorId, [
      foreignTenantId,
      foreignOtherTenantId
    ]);
    const ticket = await createTenantTicket(foreignFixture, foreignTenantId);
    const ownFixture = await createFixture();
    const ownTicket = await createTenantTicket(ownFixture);

    await expect(
      maintenance.listForProperty(operatorId, foreignFixture.propertyId)
    ).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
    await expect(
      maintenance.updateStatus(operatorId, ticket.id, "in_progress")
    ).rejects.toMatchObject({
      response: { code: "forbidden" }
    });

    await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${foreignFixture.propertyId}/maintenance`)
      .set("x-test-identity", "operator")
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/v1/pg-operator/properties/${ownFixture.propertyId}/maintenance/${ownTicket.id}`)
      .set("x-test-identity", "operator")
      .send({ status: "in_progress" })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/v1/pg-operator/properties/${foreignFixture.propertyId}/maintenance/${ownTicket.id}`)
      .set("x-test-identity", "otherOperator")
      .send({ status: "resolved" })
      .expect(404);
  });

  it("rejects malformed maintenance payloads and statuses with 400s", async () => {
    const fixture = await createFixture();
    const ticket = await createTenantTicket(fixture);

    await request(app.getHttpServer())
      .post("/v1/tenant/pg-residence/maintenance")
      .set("x-test-identity", "tenant")
      .set("Idempotency-Key", randomUUID())
      .send({ category: 42, description: "The tap has been leaking since morning." })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticket.id}/comments`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({ body: 42 })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticket.id}`)
      .set("x-test-identity", "operator")
      .send({ status: "done" })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance?status=done`)
      .set("x-test-identity", "operator")
      .expect(400);
  });

  it("returns live maintenance counts only for the requested bed", async () => {
    const fixture = await createFixture();
    const bedOneTicket = await createTenantTicket(fixture, tenantId);
    await createTenantTicket(fixture, otherTenantId);
    await maintenance.updateStatus(operatorId, bedOneTicket.id, "in_progress");

    const detail = await assignments.getBedDetail(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[0]
    );
    expect(detail.maintenance_summary).toEqual({ open_items: 1, overdue_items: 0 });

    const otherBedDetail = await assignments.getBedDetail(
      operatorId,
      fixture.propertyId,
      fixture.bedIds[1]
    );
    expect(otherBedDetail.maintenance_summary).toEqual({ open_items: 1, overdue_items: 0 });
  });

  it("does not leak maintenance tickets across beds or properties", async () => {
    const fixture = await createFixture();
    const ownBedTicket = await createTenantTicket(fixture, tenantId, { category: "fan" });
    const otherBedTicket = await createTenantTicket(fixture, otherTenantId, { category: "wifi" });
    const otherProperty = await createFixture(otherOperatorId, [
      foreignTenantId,
      foreignOtherTenantId
    ]);
    const otherPropertyTicket = await createTenantTicket(otherProperty, foreignTenantId, {
      category: "paint"
    });

    const response = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/beds/${fixture.bedIds[0]}/maintenance`)
      .set("x-test-identity", "operator")
      .expect(200);

    expect(response.body.data).toEqual([
      expect.objectContaining({ id: ownBedTicket.id, category: "fan" })
    ]);
    expect(response.body.data).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: otherBedTicket.id }),
        expect.objectContaining({ id: otherPropertyTicket.id })
      ])
    );
  });
});
