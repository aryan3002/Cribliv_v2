// apps/api/test/callback-pivot.integration.test.ts
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

describe("callback pivot (ff_callback_leads ON)", () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createApp({ FF_CALLBACK_LEADS: "true" });
  });
  afterEach(async () => {
    await app.close();
    delete process.env.FF_CALLBACK_LEADS;
  });

  it("returns callback shape without owner phone, 24h deadline", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const res = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "cb-1")
      .send({ listing_id: listingId })
      .expect(201);

    expect(res.body.data.owner_contact).toBeUndefined();
    expect(res.body.data.callback.status).toBe("awaiting_call");
    const deadlineMs = new Date(res.body.data.callback.call_deadline_at).getTime();
    expect(deadlineMs).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(deadlineMs).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);
  });

  it("idempotent replay returns the same callback shape", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const args = (k: string) =>
      http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", k)
        .send({ listing_id: listingId });
    const first = await args("cb-idem").expect(201);
    const second = await args("cb-idem").expect(201);
    expect(second.body.data.unlock_id).toBe(first.body.data.unlock_id);
    expect(second.body.data.owner_contact).toBeUndefined();
    expect(second.body.data.callback.status).toBe("awaiting_call");
  });

  it("still 402s when credits run out", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const appState = app.get(AppStateService);
    const tenantUser = appState.usersByPhone.get("+919999999902");
    if (!tenantUser) {
      throw new Error("Seeded tenant missing");
    }
    appState.wallets.set(tenantUser.id, 2);
    appState.promotionalWallets.delete(tenantUser.id);
    appState.walletTxns.set(tenantUser.id, []);

    const listingId = await getFirstListingId(app);
    for (const key of ["cb-a", "cb-b"]) {
      await http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", key)
        .send({ listing_id: listingId })
        .expect(201);
    }
    await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "cb-c")
      .send({ listing_id: listingId })
      .expect(402);
  });
});

describe("callback pivot regression (flag OFF)", () => {
  it("keeps the legacy owner_contact reveal", async () => {
    const app = await createApp();
    try {
      const tenant = await loginWithOtp(app, "+919999999902");
      const listingId = await getFirstListingId(app);
      const res = await http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", "legacy-1")
        .send({ listing_id: listingId })
        .expect(201);
      expect(res.body.data.owner_contact.phone_e164).toBeTruthy();
      expect(res.body.data.callback).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
