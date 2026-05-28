import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AppStateService } from "../src/common/app-state.service";

interface OtpSendData {
  challenge_id: string;
  dev_otp: string;
}

interface OtpVerifyData {
  access_token: string;
  user: { id: string; role: string };
}

function getErrorCode(body: any): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  return (
    body.code ??
    body.error?.code ??
    body.message?.code ??
    body.response?.code ??
    body.response?.message?.code
  );
}

async function createApp() {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}

async function loginWithOtp(app: INestApplication, phone: string) {
  const sendRes = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);
  const sendData = sendRes.body.data as OtpSendData;
  const verifyRes = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: sendData.challenge_id,
      otp_code: sendData.dev_otp,
      device_fingerprint: "reorder-test"
    })
    .expect(201);
  return verifyRes.body.data as OtpVerifyData;
}

/**
 * In in-memory mode, the seeded `flat_house` listing belongs to the
 * `+919999999901` owner. We use that listing as our target — the reorder
 * endpoint runs full validation regardless of mode; only the DB-backed
 * branch validates that photo_ids belong to the listing.
 */
function findOwnerListingId(app: INestApplication, ownerId: string): string {
  const appState = app.get(AppStateService);
  for (const listing of appState.listings.values()) {
    if (listing.ownerUserId === ownerId) return listing.id;
  }
  throw new Error("No seeded listing found for owner");
}

describe("PATCH /owner/listings/:id/photos/reorder validation", () => {
  let app: INestApplication | null;
  let ownerToken: string;
  let ownerId: string;
  let listingId: string;

  beforeEach(async () => {
    app = await createApp();
    const owner = await loginWithOtp(app, "+919999999901");
    ownerToken = owner.access_token;
    ownerId = owner.user.id;
    listingId = findOwnerListingId(app, ownerId);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  function reorder(body: unknown, idem = "reorder-test-1") {
    return http(app!)
      .patch(`/v1/owner/listings/${listingId}/photos/reorder`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", idem)
      .send(body);
  }

  it("rejects requests with an empty items array (400 validation_error)", async () => {
    const res = await reorder({ items: [] }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("rejects requests missing the Idempotency-Key header", async () => {
    const res = await http(app!)
      .patch(`/v1/owner/listings/${listingId}/photos/reorder`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        items: [{ photo_id: "p-1", sort_order: 0, is_cover: true }]
      })
      .expect(400);
    expect(getErrorCode(res.body)).toBe("missing_idempotency_key");
  });

  it("rejects duplicate photo_id within the request", async () => {
    const res = await reorder({
      items: [
        { photo_id: "p-1", sort_order: 0, is_cover: true },
        { photo_id: "p-1", sort_order: 1, is_cover: false }
      ]
    }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("rejects duplicate sort_order within the request", async () => {
    const res = await reorder({
      items: [
        { photo_id: "p-1", sort_order: 0, is_cover: true },
        { photo_id: "p-2", sort_order: 0, is_cover: false }
      ]
    }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("rejects requests with zero covers", async () => {
    const res = await reorder({
      items: [
        { photo_id: "p-1", sort_order: 0, is_cover: false },
        { photo_id: "p-2", sort_order: 1, is_cover: false }
      ]
    }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("rejects requests with more than one cover", async () => {
    const res = await reorder({
      items: [
        { photo_id: "p-1", sort_order: 0, is_cover: true },
        { photo_id: "p-2", sort_order: 1, is_cover: true }
      ]
    }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("rejects requests with non-numeric sort_order", async () => {
    const res = await reorder({
      items: [{ photo_id: "p-1", sort_order: "first", is_cover: true }]
    }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("rejects requests with an empty photo_id", async () => {
    const res = await reorder({
      items: [{ photo_id: "   ", sort_order: 0, is_cover: true }]
    }).expect(400);
    expect(getErrorCode(res.body)).toBe("validation_error");
  });

  it("forbids reordering a listing the caller does not own", async () => {
    // pg_operator (phone …904 in seed) does not own the flat_house listing.
    const otherUser = await loginWithOtp(app!, "+919999999904");
    const res = await http(app!)
      .patch(`/v1/owner/listings/${listingId}/photos/reorder`)
      .set("Authorization", `Bearer ${otherUser.access_token}`)
      .set("Idempotency-Key", "reorder-test-forbidden")
      .send({
        items: [{ photo_id: "p-1", sort_order: 0, is_cover: true }]
      })
      .expect(403);
    expect(getErrorCode(res.body)).toBe("forbidden");
  });

  it("accepts a valid request in in-memory mode", async () => {
    const res = await reorder({
      items: [
        { photo_id: "p-1", sort_order: 0, is_cover: true },
        { photo_id: "p-2", sort_order: 1, is_cover: false },
        { photo_id: "p-3", sort_order: 2, is_cover: false }
      ]
    }).expect(200);

    const data = res.body.data;
    expect(data.updated_count).toBe(3);
    expect(data.items).toHaveLength(3);
    expect(data.items[0]).toMatchObject({
      id: "p-1",
      sort_order: 0,
      is_cover: true
    });
    expect(data.items[1]).toMatchObject({ is_cover: false });
    expect(data.items[2]).toMatchObject({ is_cover: false });
  });
});
