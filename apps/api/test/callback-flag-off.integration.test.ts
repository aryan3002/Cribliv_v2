// apps/api/test/callback-flag-off.integration.test.ts
// In-memory (no DATABASE_URL) integration test, phase1.integration.test.ts style.
//
// Consolidated kill-switch regression: with ff_callback_leads OFF (the
// default), every callback-model route must be inert (403 feature_disabled)
// and the legacy contact-unlock reveal shape must be untouched.
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

async function createApp(overrides: Record<string, string | undefined> = {}) {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.PAYMENT_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
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
  const verifyRes = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: sendRes.body.data.challenge_id,
      otp_code: sendRes.body.data.dev_otp,
      device_fingerprint: "callback-flag-off-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string };
}

async function getFirstListingId(app: INestApplication) {
  const res = await http(app).get("/v1/listings/search").expect(200);
  return res.body.data.items[0].id as string;
}

const DUMMY_ID = "00000000-0000-0000-0000-000000000001";

describe("callback routes — flag OFF kill switch", () => {
  let app: INestApplication;
  let tenantToken: string;
  let ownerToken: string;
  let adminToken: string;

  beforeEach(async () => {
    // No overrides — flag must be off by default. Also explicitly delete the
    // env var so a leftover from another suite can't leak flag state in.
    delete process.env.FF_CALLBACK_LEADS;
    app = await createApp();
    tenantToken = (await loginWithOtp(app, "+919999999902")).access_token;
    ownerToken = (await loginWithOtp(app, "+919999999901")).access_token;
    adminToken = (await loginWithOtp(app, "+919999999903")).access_token;
  });

  afterEach(async () => {
    await app.close();
    delete process.env.FF_CALLBACK_LEADS;
  });

  it("POST /v1/owner/leads/:id/unlock is inert", async () => {
    const res = await http(app)
      .post(`/v1/owner/leads/${DUMMY_ID}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "flag-off-unlock-1")
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("POST /v1/owner/leads/:id/call-click is inert", async () => {
    const res = await http(app)
      .post(`/v1/owner/leads/${DUMMY_ID}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("GET /v1/tenant/callbacks is inert", async () => {
    const res = await http(app)
      .get("/v1/tenant/callbacks")
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("POST /v1/tenant/callbacks/:id/confirm is inert", async () => {
    const res = await http(app)
      .post(`/v1/tenant/callbacks/${DUMMY_ID}/confirm`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("POST /v1/tenant/callbacks/:id/dispute is inert", async () => {
    const res = await http(app)
      .post(`/v1/tenant/callbacks/${DUMMY_ID}/dispute`)
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("GET /v1/admin/leads/rescue-queue is inert", async () => {
    const res = await http(app)
      .get("/v1/admin/leads/rescue-queue")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("POST /v1/admin/leads/:id/team-called is inert", async () => {
    const res = await http(app)
      .post(`/v1/admin/leads/${DUMMY_ID}/team-called`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain("feature_disabled");
  });

  it("legacy shape intact: tenant contact-unlock reveals owner phone, no callback key", async () => {
    const listingId = await getFirstListingId(app);
    const res = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenantToken}`)
      .set("Idempotency-Key", "flag-off-legacy-1")
      .send({ listing_id: listingId })
      .expect(201);

    expect(res.body.data.owner_contact.phone_e164).toBeTruthy();
    expect(res.body.data.callback).toBeUndefined();
  });
});
