// apps/api/test/tenant-callbacks.integration.test.ts
// In-memory (no DATABASE_URL) integration test, phase1.integration.test.ts style.
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AppStateService } from "../src/common/app-state.service";

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
      device_fingerprint: "callback-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string };
}

async function getFirstListingId(app: INestApplication) {
  const res = await http(app).get("/v1/listings/search").expect(200);
  return res.body.data.items[0].id as string;
}

describe("tenant callbacks", () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createApp({ FF_CALLBACK_LEADS: "true" });
  });
  afterEach(async () => {
    await app.close();
    delete process.env.FF_CALLBACK_LEADS;
  });

  it("lists a fresh request as awaiting_call", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-1")
      .send({ listing_id: listingId })
      .expect(201);

    const list = await http(app)
      .get("/v1/tenant/callbacks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    const item = list.body.data.items.find(
      (i: { callback_id: string }) => i.callback_id === unlock.body.data.unlock_id
    );
    expect(item.status).toBe("awaiting_call");
    expect(item.call_claimed_at).toBeNull();
  });

  it("shows call_claimed after the owner responds, and confirm records it", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-2")
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;

    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "call" })
      .expect(201);

    const list = await http(app)
      .get("/v1/tenant/callbacks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    const item = list.body.data.items.find(
      (i: { callback_id: string }) => i.callback_id === unlockId
    );
    expect(item.status).toBe("call_claimed");

    const confirm = await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(201);
    expect(confirm.body.data.tenant_confirmed_at).toBeTruthy();
  });

  it("dispute refunds the credit exactly once", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-3")
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;
    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "call" })
      .expect(201);

    const dispute = await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(201);
    expect(dispute.body.data.refunded).toBe(true);
    expect(dispute.body.data.credits_remaining).toBe(2); // 2 - 1 + 1

    await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(409); // already_refunded
  });

  it("409s a dispute with no claimed call", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-4")
      .send({ listing_id: listingId })
      .expect(201);
    await http(app)
      .post(`/v1/tenant/callbacks/${unlock.body.data.unlock_id}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(409);
  });

  it("409s a dispute outside the 72h window", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-5")
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;
    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "call" })
      .expect(201);

    const appState = app.get(AppStateService);
    const record = appState.unlocks.get(unlockId)!;
    record.ownerRespondedAt = Date.now() - 73 * 60 * 60 * 1000;

    await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(409); // dispute_window_closed
  });
});
