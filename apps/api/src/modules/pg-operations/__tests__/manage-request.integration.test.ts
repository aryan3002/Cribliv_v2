import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("PG manage requests (integration)", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let cityId: number;
  let operatorId: string;
  let otherOperatorId: string;
  let adminId: string;

  const testRunId = randomUUID();
  const userIds: string[] = [];

  const identities = (): Record<string, { id: string; role: Role }> => ({
    operator: { id: operatorId, role: "pg_operator" },
    other_operator: { id: otherOperatorId, role: "pg_operator" },
    admin: { id: adminId, role: "admin" }
  });

  async function createListing(operatorUserId: string, title: string) {
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties (operator_id, display_name, city_id, is_primary)
       VALUES ($1::uuid, $2, $3, true)
       RETURNING id::text`,
      [operatorUserId, `Property ${title}`, cityId]
    );
    const listingId = randomUUID();
    await db.query(
      `INSERT INTO pg_listings
         (id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 1200000, 'active', 'unverified')`,
      [listingId, operatorUserId, property.rows[0].id, title]
    );
    return { listingId, propertyId: property.rows[0].id };
  }

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'PG Operations Test City', 'PG Operations Test City', 'Test State', 'Test State')
       RETURNING id`,
      [`pg-ops-${testRunId}`]
    );
    cityId = city.rows[0].id;

    const users = await Promise.all(
      [
        { phone: `+91990${testRunId.replace(/-/g, "").slice(0, 9)}`, role: "pg_operator" },
        { phone: `+91991${testRunId.replace(/-/g, "").slice(0, 9)}`, role: "pg_operator" },
        { phone: `+91992${testRunId.replace(/-/g, "").slice(0, 9)}`, role: "admin" }
      ].map(async ({ phone, role }) => {
        const user = await db.query<{ id: string }>(
          `INSERT INTO users (phone_e164, role, preferred_language)
           VALUES ($1, $2::user_role, 'en')
           RETURNING id::text`,
          [phone, role]
        );
        userIds.push(user.rows[0].id);
        return user.rows[0].id;
      })
    );
    [operatorId, otherOperatorId, adminId] = users;

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
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (db) {
      await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
      await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
    }
    if (app) await app.close();
    if (db) await db.onModuleDestroy();
  }, 30_000);

  it("rejects a manage request for an unowned listing", async () => {
    const { listingId } = await createListing(otherOperatorId, "Unowned listing");

    await request(app.getHttpServer())
      .post(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `unowned-${testRunId}`)
      .send({ reason: "Please manage this PG" })
      .expect(403);
  });

  it("creates a pending request and rejects a second pending request", async () => {
    const { listingId } = await createListing(operatorId, "Pending listing");

    const created = await request(app.getHttpServer())
      .post(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `create-${testRunId}`)
      .send({ reason: "Please manage this PG" })
      .expect(201);
    expect(created.body.data).toMatchObject({
      listing_id: listingId,
      status: "pending",
      requested_reason: "Please manage this PG"
    });

    const state = await request(app.getHttpServer())
      .get(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .expect(200);
    expect(state.body.data).toMatchObject({
      status: "pending",
      request: { id: created.body.data.id, listing_id: listingId }
    });

    const queue = await request(app.getHttpServer())
      .get("/v1/admin/pg/manage-requests?status=pending")
      .set("x-test-identity", "admin")
      .expect(200);
    expect(queue.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.body.data.id, listing_title: "Pending listing" })
      ])
    );

    const duplicate = await request(app.getHttpServer())
      .post(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `duplicate-${testRunId}`)
      .send({ reason: "Retry" })
      .expect(409);
    expect(duplicate.body.code).toBe("manage_request_exists");
  });

  it("approves atomically and keeps the approved request authoritative", async () => {
    const { listingId, propertyId } = await createListing(operatorId, "Approval listing");
    const created = await request(app.getHttpServer())
      .post(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `approve-create-${testRunId}`)
      .send({ reason: "Approve me" })
      .expect(201);
    const requestId = created.body.data.id as string;

    const approved = await request(app.getHttpServer())
      .post(`/v1/admin/pg/manage-requests/${requestId}/approve`)
      .set("x-test-identity", "admin")
      .send({ notes: "Approved for operations" })
      .expect(201);
    expect(approved.body.data).toMatchObject({
      id: requestId,
      status: "approved",
      decided_by: adminId,
      decision_notes: "Approved for operations"
    });

    const authoritative = await db.query<{
      request_status: string;
      manage_enabled: boolean;
      layout_status: string;
      managed_activated_at: string | null;
    }>(
      `SELECT r.status::text AS request_status, p.manage_enabled, p.layout_status,
              p.managed_activated_at::text
         FROM pg_manage_requests r
         JOIN pg_properties p ON p.id = r.pg_property_id
        WHERE r.id = $1::uuid AND p.id = $2::uuid`,
      [requestId, propertyId]
    );
    expect(authoritative.rows[0]).toMatchObject({
      request_status: "approved",
      manage_enabled: true,
      layout_status: "needs_setup"
    });
    expect(authoritative.rows[0].managed_activated_at).not.toBeNull();

    const repeated = await request(app.getHttpServer())
      .post(`/v1/admin/pg/manage-requests/${requestId}/approve`)
      .set("x-test-identity", "admin")
      .send({ notes: "Ignored on replay" })
      .expect(201);
    expect(repeated.body.data).toMatchObject({ id: requestId, status: "approved" });

    const rejectApproved = await request(app.getHttpServer())
      .post(`/v1/admin/pg/manage-requests/${requestId}/reject`)
      .set("x-test-identity", "admin")
      .send({ notes: "Must not undo approval" })
      .expect(409);
    expect(rejectApproved.body.code).toBe("manage_request_already_approved");
  });

  it("rejects without enabling management on the property", async () => {
    const { listingId, propertyId } = await createListing(operatorId, "Rejection listing");
    const created = await request(app.getHttpServer())
      .post(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `reject-create-${testRunId}`)
      .send({ reason: "Please review" })
      .expect(201);

    const rejected = await request(app.getHttpServer())
      .post(`/v1/admin/pg/manage-requests/${created.body.data.id}/reject`)
      .set("x-test-identity", "admin")
      .send({ notes: "Missing documents" })
      .expect(201);
    expect(rejected.body.data).toMatchObject({
      status: "rejected",
      decision_notes: "Missing documents"
    });

    const property = await db.query<{ manage_enabled: boolean }>(
      `SELECT manage_enabled FROM pg_properties WHERE id = $1::uuid`,
      [propertyId]
    );
    expect(property.rows[0].manage_enabled).toBe(false);
  });

  it("blocks non-admin users from the admin queue and decisions", async () => {
    const { listingId } = await createListing(operatorId, "Role listing");
    const created = await request(app.getHttpServer())
      .post(`/v1/pg-operator/listings/${listingId}/manage-request`)
      .set("x-test-identity", "operator")
      .set("idempotency-key", `role-create-${testRunId}`)
      .send({ reason: "Role test" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/v1/admin/pg/manage-requests")
      .set("x-test-identity", "operator")
      .expect(403);
    await request(app.getHttpServer())
      .post(`/v1/admin/pg/manage-requests/${created.body.data.id}/approve`)
      .set("x-test-identity", "operator")
      .send({ notes: "Not allowed" })
      .expect(403);
  });
});
