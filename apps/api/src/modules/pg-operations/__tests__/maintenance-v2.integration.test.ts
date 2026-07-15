import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { autoCloseResolvedMaintenance } from "../../../worker/maintenance-sweeps";
import { AzureBlobPhotoStorageService } from "../../owner/azure-blob-photo-storage.service";
import { PgMaintenanceService } from "../services/pg-maintenance.service";

const HAS_DB = Boolean(process.env.DATABASE_URL);
const testRunId = randomUUID().replace(/-/g, "");

describe.skipIf(!HAS_DB)("PG maintenance V2 operator queue and timeline", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let maintenance: PgMaintenanceService;
  let cityId: number;
  let operatorId: string;
  let otherOperatorId: string;
  let tenantId: string;
  let otherTenantId: string;
  const propertyIds: string[] = [];
  const userIds: string[] = [];

  type Fixture = {
    propertyId: string;
    roomId: string;
    bedIds: [string, string];
    assignmentIds: [string, string];
  };

  async function createUser(role: Role, phoneSuffix: string): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, $2::user_role, 'en')
       RETURNING id::text`,
      [`+917${phoneSuffix}`, role]
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
       VALUES ($1::uuid, $2, $3, false, true, 'ready', 4)
       RETURNING id::text`,
      [ownerId, `P5 V2 property ${randomUUID()}`, cityId]
    );
    const propertyId = property.rows[0].id;
    propertyIds.push(propertyId);

    const room = await db.query<{ id: string }>(
      `INSERT INTO pg_rooms
         (pg_property_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, 2, $2, 'V2 room', 2, 'active')
       RETURNING id::text`,
      [propertyId, `V2-${randomUUID().slice(0, 8)}`]
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
        [propertyId, bed.rows[0].id, `Queue Tenant ${index + 1}`, ownerId, tenantUserId]
      );
      assignmentIds.push(assignment.rows[0].id);
    }

    return {
      propertyId,
      roomId: room.rows[0].id,
      bedIds: bedIds as [string, string],
      assignmentIds: assignmentIds as [string, string]
    };
  }

  async function createTicket(
    fixture: Fixture,
    overrides: {
      id?: string;
      assignmentIndex?: 0 | 1;
      categorySlug?: string;
      priority?: "emergency" | "high" | "normal" | "low";
      status?: "open" | "in_progress" | "waiting_on_tenant" | "resolved" | "closed" | "cancelled";
      createdAt?: string;
      slaDueAt?: string;
      locationKind?: "bed" | "room" | "floor" | "common_area" | "property_wide" | "other";
      commonArea?: string | null;
      floor?: number | null;
      description?: string;
    } = {}
  ): Promise<string> {
    const assignmentIndex = overrides.assignmentIndex ?? 0;
    const categorySlug = overrides.categorySlug ?? "plumbing";
    const category = await db.query<{ display_name: string; default_priority: string }>(
      `SELECT display_name, default_priority::text AS default_priority
         FROM pg_maintenance_categories
        WHERE slug = $1`,
      [categorySlug]
    );
    const priority = overrides.priority ?? (category.rows[0].default_priority as "high");
    const locationKind = overrides.locationKind ?? "bed";
    const floor = overrides.floor ?? (locationKind === "floor" ? 2 : null);
    const commonArea = overrides.commonArea ?? (locationKind === "common_area" ? "kitchen" : null);
    const result = await db.query<{ id: string }>(
      `INSERT INTO pg_maintenance_requests
         (id, pg_property_id, assignment_id, created_by_user_id, category, category_slug,
          category_label_snapshot, description, status, priority, priority_source,
          sla_hours, sla_due_at, location_kind, room_id, bed_id, floor, common_area,
          location_snapshot, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
               $9::pg_maintenance_status, $10::pg_maintenance_priority, 'category_default',
               24, $11::timestamptz, $12::pg_maintenance_location_kind,
               $13::uuid, $14::uuid, $15, $16::pg_maintenance_common_area,
               $17::jsonb, $18::timestamptz, $18::timestamptz)
       RETURNING id::text`,
      [
        overrides.id ?? randomUUID(),
        fixture.propertyId,
        fixture.assignmentIds[assignmentIndex],
        assignmentIndex === 0 ? tenantId : otherTenantId,
        category.rows[0].display_name,
        categorySlug,
        category.rows[0].display_name,
        overrides.description ?? `${categorySlug} queue ticket`,
        overrides.status ?? "open",
        priority,
        overrides.slaDueAt ?? "2026-07-15T08:00:00.000Z",
        locationKind,
        locationKind === "bed" || locationKind === "room" ? fixture.roomId : null,
        locationKind === "bed" ? fixture.bedIds[assignmentIndex] : null,
        floor,
        commonArea,
        JSON.stringify({
          kind: locationKind,
          property_name: "P5 V2 property",
          room_number: null,
          room_label: null,
          floor,
          bed_label: null,
          common_area: commonArea,
          detail: null
        }),
        overrides.createdAt ?? "2026-07-15T06:00:00.000Z"
      ]
    );
    return result.rows[0].id;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'P5 V2 City', 'P5 V2 City', 'Test State', 'Test State')
       RETURNING id`,
      [`p5-v2-${testRunId}`]
    );
    cityId = city.rows[0].id;

    operatorId = await createUser("pg_operator", `51${testRunId.slice(0, 9)}`);
    otherOperatorId = await createUser("pg_operator", `52${testRunId.slice(0, 9)}`);
    tenantId = await createUser("tenant", `53${testRunId.slice(0, 9)}`);
    otherTenantId = await createUser("tenant", `54${testRunId.slice(0, 9)}`);

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
  }, 30_000);

  afterEach(async () => {
    const ids = propertyIds.splice(0);
    if (ids.length > 0) {
      await db.query(
        `ALTER TABLE pg_maintenance_events DISABLE TRIGGER pg_maintenance_events_immutable`
      );
      try {
        await db.query(`DELETE FROM pg_properties WHERE id = ANY($1::uuid[])`, [ids]);
      } finally {
        await db.query(
          `ALTER TABLE pg_maintenance_events ENABLE TRIGGER pg_maintenance_events_immutable`
        );
      }
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

  it("returns the maintenance category catalog for operator pages", async () => {
    await request(app.getHttpServer())
      .get("/v1/pg-operator/maintenance/categories")
      .set("x-test-identity", "operator")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual(
          expect.arrayContaining([
            {
              slug: "plumbing",
              display_name: "Plumbing",
              default_priority: "high",
              active: true,
              sort_order: 10
            },
            {
              slug: "other",
              display_name: "Other",
              default_priority: "normal",
              active: true,
              sort_order: 150
            }
          ])
        );
        expect(body.data[0]).toMatchObject({ slug: "plumbing", sort_order: 10 });
      });
  });

  it("returns a keyset-paginated operator queue with filters and empty comments", async () => {
    const fixture = await createFixture();
    const matching = await createTicket(fixture, {
      categorySlug: "plumbing",
      priority: "high",
      locationKind: "common_area",
      commonArea: "kitchen",
      description: "Kitchen pipe overdue for Queue Tenant 1",
      createdAt: "2026-07-01T06:00:00.000Z",
      slaDueAt: "2026-07-15T08:00:00.000Z"
    });
    await createTicket(fixture, {
      categorySlug: "electrical",
      priority: "high",
      locationKind: "common_area",
      commonArea: "kitchen",
      description: "Wrong category Queue Tenant 1",
      createdAt: "2026-07-01T07:00:00.000Z",
      slaDueAt: "2026-07-15T07:30:00.000Z"
    });
    await createTicket(fixture, {
      categorySlug: "plumbing",
      priority: "normal",
      locationKind: "common_area",
      commonArea: "kitchen",
      description: "Wrong priority Queue Tenant 1",
      createdAt: "2026-07-01T07:30:00.000Z",
      slaDueAt: "2026-07-15T08:30:00.000Z"
    });
    await createTicket(fixture, {
      categorySlug: "plumbing",
      priority: "high",
      locationKind: "floor",
      floor: 2,
      description: "Wrong location Queue Tenant 1",
      createdAt: "2026-07-01T08:00:00.000Z",
      slaDueAt: "2026-07-15T09:00:00.000Z"
    });
    await createTicket(fixture, {
      categorySlug: "plumbing",
      priority: "high",
      status: "closed",
      locationKind: "common_area",
      commonArea: "kitchen",
      description: "Closed Queue Tenant 1",
      createdAt: "2026-07-01T08:30:00.000Z",
      slaDueAt: "2026-07-15T09:30:00.000Z"
    });

    await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance`)
      .query({
        priority: "high",
        sla_state: "overdue",
        category_slug: "plumbing",
        location_kind: "common_area",
        common_area: "kitchen",
        tenant_query: "Queue Tenant 1",
        include_closed: "false"
      })
      .set("x-test-identity", "operator")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual({
          rows: [
            expect.objectContaining({
              id: matching,
              priority: "high",
              category_slug: "plumbing",
              comments: [],
              location_snapshot: expect.objectContaining({
                kind: "common_area",
                common_area: "kitchen"
              })
            })
          ],
          next_cursor: null
        });
      });
  });

  it("continues the operator queue without overlap for sla_due and newest keysets", async () => {
    const fixture = await createFixture();
    const olderSameSla = await createTicket(fixture, {
      id: "00000000-0000-0000-0000-000000000101",
      priority: "low",
      createdAt: "2026-07-08T10:00:00.000Z",
      slaDueAt: "2026-07-15T10:00:00.000Z"
    });
    const newerSameSla = await createTicket(fixture, {
      id: "00000000-0000-0000-0000-000000000102",
      priority: "high",
      createdAt: "2026-07-14T10:00:00.000Z",
      slaDueAt: "2026-07-15T10:00:00.000Z"
    });
    const third = await createTicket(fixture, {
      id: "00000000-0000-0000-0000-000000000103",
      priority: "normal",
      createdAt: "2026-07-14T12:00:00.000Z",
      slaDueAt: "2026-07-15T12:00:00.000Z"
    });

    const firstPage = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance?limit=1`)
      .set("x-test-identity", "operator")
      .expect(200);
    const secondPage = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance`)
      .query({ limit: 1, cursor: firstPage.body.data.next_cursor })
      .set("x-test-identity", "operator")
      .expect(200);
    const thirdPage = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance`)
      .query({ limit: 1, cursor: secondPage.body.data.next_cursor })
      .set("x-test-identity", "operator")
      .expect(200);
    const fourthPage = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance`)
      .query({ limit: 1, cursor: thirdPage.body.data.next_cursor })
      .set("x-test-identity", "operator")
      .expect(200);

    const slaDuePages = [firstPage, secondPage, thirdPage].flatMap((page) =>
      page.body.data.rows.map((row: { id: string }) => row.id)
    );
    expect(slaDuePages).toEqual([newerSameSla, olderSameSla, third]);
    expect(new Set(slaDuePages).size).toBe(slaDuePages.length);
    expect(fourthPage.body.data.rows).toEqual([]);
    expect(fourthPage.body.data.next_cursor).toBeNull();

    const newestFirstPage = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance`)
      .query({ limit: 2, sort: "newest" })
      .set("x-test-identity", "operator")
      .expect(200);
    const newestSecondPage = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance`)
      .query({ limit: 2, sort: "newest", cursor: newestFirstPage.body.data.next_cursor })
      .set("x-test-identity", "operator")
      .expect(200);

    expect(newestFirstPage.body.data.rows.map((row: { id: string }) => row.id)).toEqual([
      third,
      newerSameSla
    ]);
    expect(newestSecondPage.body.data.rows.map((row: { id: string }) => row.id)).toEqual([
      olderSameSla
    ]);
  });

  it("overrides priority transactionally and records the timeline event", async () => {
    const fixture = await createFixture();
    const ticketId = await createTicket(fixture, {
      categorySlug: "other",
      priority: "low",
      createdAt: "2026-07-15T03:30:00.000Z",
      slaDueAt: "2026-07-22T03:30:00.000Z"
    });

    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/priority`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({ priority: "emergency", reason: "Water entering electrical panel" })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          id: ticketId,
          priority: "emergency",
          sla_hours: 4,
          sla_due_at: "2026-07-15T07:30:00.000Z",
          priority_overridden_by: operatorId,
          priority_override_reason: "Water entering electrical panel",
          priority_source: "operator_override"
        });
        expect(body.data.priority_overridden_at).toEqual(expect.any(String));
      });

    const events = await db.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type::text, payload
         FROM pg_maintenance_events
        WHERE request_id = $1::uuid
        ORDER BY created_at, id`,
      [ticketId]
    );
    expect(events.rows).toEqual([
      expect.objectContaining({
        event_type: "priority_overridden",
        payload: expect.objectContaining({
          from_priority: "low",
          to_priority: "emergency",
          reason: "Water entering electrical panel"
        })
      })
    ]);
  });

  it("adds operator-only internal notes and hides them from tenant detail", async () => {
    const fixture = await createFixture();
    const ticketId = await createTicket(fixture);
    const attachment = `pg-maintenance/${fixture.propertyId}/${ticketId}/internal-note.jpg`;

    const first = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/internal-notes`
      )
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", "internal-note-key")
      .send({
        body: "Call plumber again if this repeats.",
        attachments: [attachment]
      })
      .expect(201);
    const replay = await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/internal-notes`
      )
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", "internal-note-key")
      .send({
        body: "Call plumber again if this repeats.",
        attachments: [attachment]
      })
      .expect(201);

    expect(replay.body.data).toEqual(first.body.data);
    expect(first.body.data).toMatchObject({
      request_id: ticketId,
      author_user_id: operatorId,
      author_role: "pg_operator",
      visibility: "operator_internal",
      body: "Call plumber again if this repeats.",
      attachments: [attachment],
      attachment_urls: [`https://cdn.test/${attachment}`]
    });

    const operatorDetail = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}`)
      .set("x-test-identity", "operator")
      .expect(200);
    expect(operatorDetail.body.data.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "internal_note_added",
          visibility: "operator_internal",
          payload: expect.objectContaining({ body: "Call plumber again if this repeats." })
        })
      ])
    );

    const operatorTimeline = await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/timeline`)
      .set("x-test-identity", "operator")
      .expect(200);
    expect(operatorTimeline.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "internal_note_added",
          visibility: "operator_internal",
          payload: expect.objectContaining({ body: "Call plumber again if this repeats." })
        })
      ])
    );

    const tenantDetail = await request(app.getHttpServer())
      .get(`/v1/tenant/pg-residence/maintenance/${ticketId}`)
      .set("x-test-identity", "tenant")
      .expect(200);
    expect(
      (tenantDetail.body.data.timeline ?? []).some(
        (event: { event_type: string }) => event.event_type === "internal_note_added"
      )
    ).toBe(false);

    await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/internal-notes`
      )
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

  it("resolves in-progress maintenance with idempotency and records resolution events", async () => {
    const fixture = await createFixture();
    const ticketId = await createTicket(fixture, { status: "in_progress" });
    const key = randomUUID();

    const first = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/resolve`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", key)
      .send({
        note: "Replaced the tap washer.",
        fix_photo_paths: [],
        cost_paise: null,
        chargeable_damage: false
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.data.status).toBe("resolved");
        expect(body.data.resolution_note).toBe("Replaced the tap washer.");
        expect(body.data.resolution_source).toBe("operator");
        expect(body.data.resolution_cost_paise).toBeNull();
        expect(body.data.chargeable_damage).toBe(false);
        expect(body.data.fix_photo_paths).toEqual([]);
        expect(body.data.resolved_at).toEqual(expect.any(String));
        expect(body.data.auto_close_after).toEqual(expect.any(String));
      });

    const replay = await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${ticketId}/resolve`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", key)
      .send({
        note: "Replaced the tap washer.",
        fix_photo_paths: [],
        cost_paise: null,
        chargeable_damage: false
      })
      .expect(201);
    expect(replay.body.data).toEqual(first.body.data);

    const persisted = await db.query<{
      status: string;
      auto_close_hours: number;
    }>(
      `SELECT status::text,
              round(EXTRACT(EPOCH FROM (auto_close_after - resolved_at)) / 3600)::int AS auto_close_hours
         FROM pg_maintenance_requests
        WHERE id = $1::uuid`,
      [ticketId]
    );
    expect(persisted.rows[0]).toEqual({ status: "resolved", auto_close_hours: 72 });

    const events = await db.query<{
      event_type: string;
      from_status: string | null;
      to_status: string | null;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type::text, from_status, to_status, payload
         FROM pg_maintenance_events
        WHERE request_id = $1::uuid
        ORDER BY created_at, id`,
      [ticketId]
    );
    expect(events.rows).toEqual([
      expect.objectContaining({
        event_type: "resolution_recorded",
        from_status: null,
        to_status: null,
        payload: expect.objectContaining({ note: "Replaced the tap washer." })
      }),
      expect.objectContaining({
        event_type: "status_changed",
        from_status: "in_progress",
        to_status: "resolved"
      })
    ]);
  });

  it("rejects invalid maintenance resolution payloads", async () => {
    const fixture = await createFixture();
    const [emptyNote, negativeCost, missingChargeable] = await Promise.all([
      createTicket(fixture, { status: "in_progress" }),
      createTicket(fixture, { status: "in_progress" }),
      createTicket(fixture, { status: "in_progress" })
    ]);

    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${emptyNote}/resolve`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({ note: " ", fix_photo_paths: [], cost_paise: null, chargeable_damage: false })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${negativeCost}/resolve`)
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({
        note: "Replaced the tap washer.",
        fix_photo_paths: [],
        cost_paise: -1,
        chargeable_damage: false
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(
        `/v1/pg-operator/properties/${fixture.propertyId}/maintenance/${missingChargeable}/resolve`
      )
      .set("x-test-identity", "operator")
      .set("Idempotency-Key", randomUUID())
      .send({ note: "Replaced the tap washer.", fix_photo_paths: [], cost_paise: null })
      .expect(400);
  });

  it("auto-closes due resolved maintenance idempotently", async () => {
    const fixture = await createFixture();
    const ticketId = await createTicket(fixture, { status: "resolved" });
    await db.query(
      `UPDATE pg_maintenance_requests
          SET resolved_at = now() - INTERVAL '4 days',
              auto_close_after = now() - INTERVAL '1 minute'
        WHERE id = $1::uuid`,
      [ticketId]
    );

    await expect(autoCloseResolvedMaintenance(db)).resolves.toBeGreaterThanOrEqual(1);
    await autoCloseResolvedMaintenance(db);

    const persisted = await db.query<{
      status: string;
      closed_at: Date | null;
      auto_closed_at: Date | null;
    }>(
      `SELECT status::text, closed_at, auto_closed_at
         FROM pg_maintenance_requests
        WHERE id = $1::uuid`,
      [ticketId]
    );
    expect(persisted.rows[0]).toMatchObject({
      status: "closed",
      closed_at: expect.any(Date),
      auto_closed_at: expect.any(Date)
    });

    const events = await db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM pg_maintenance_events
        WHERE request_id = $1::uuid
          AND event_type = 'auto_closed'`,
      [ticketId]
    );
    expect(events.rows[0].count).toBe(1);
  });

  it("returns operator maintenance analytics with category counts", async () => {
    const fixture = await createFixture();
    const openTicket = await createTicket(fixture, { categorySlug: "plumbing", status: "open" });
    const overdueTicket = await createTicket(fixture, {
      categorySlug: "plumbing",
      status: "in_progress"
    });
    const waitingTicket = await createTicket(fixture, {
      categorySlug: "electrical",
      status: "waiting_on_tenant"
    });
    const resolvedTicket = await createTicket(fixture, {
      categorySlug: "other",
      status: "resolved"
    });
    const closedTicket = await createTicket(fixture, { categorySlug: "other", status: "closed" });
    await db.query(
      `UPDATE pg_maintenance_requests
          SET sla_due_at = CASE
                WHEN id = $1::uuid THEN now() + INTERVAL '1 hour'
                WHEN id = $2::uuid THEN now() - INTERVAL '1 hour'
                ELSE now() + INTERVAL '2 days'
              END,
              auto_close_after = CASE WHEN id = $3::uuid THEN now() + INTERVAL '1 day' ELSE auto_close_after END,
              closed_at = CASE WHEN id = $4::uuid THEN now() ELSE closed_at END
        WHERE id = ANY($5::uuid[])`,
      [
        openTicket,
        overdueTicket,
        resolvedTicket,
        closedTicket,
        [openTicket, overdueTicket, waitingTicket, resolvedTicket, closedTicket]
      ]
    );

    await request(app.getHttpServer())
      .get(`/v1/pg-operator/properties/${fixture.propertyId}/maintenance/analytics`)
      .set("x-test-identity", "operator")
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual({
          open: 2,
          overdue: 1,
          due_today: 1,
          waiting_on_tenant: 1,
          resolved_pending_close: 1,
          closed_this_month: 1,
          by_category: [{ category_slug: "plumbing", display_name: "Plumbing", count: 2 }]
        });
      });
  });
});
