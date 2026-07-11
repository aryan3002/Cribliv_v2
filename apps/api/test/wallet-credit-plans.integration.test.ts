// apps/api/test/wallet-credit-plans.integration.test.ts
// In-memory (no DATABASE_URL) integration test, phase1.integration.test.ts style.
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

function getErrorCode(body: any): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  return (
    body.code ??
    body.error?.code ??
    body.message?.code ??
    body.response?.code ??
    body.response?.message?.code
  );
}

async function createApp(overrides: Record<string, string | undefined> = {}) {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.PAYMENT_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
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
      device_fingerprint: "wallet-credit-plans-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string; role: string } };
}

describe("wallet credit plan catalog", () => {
  it("returns only tenant plans to a tenant", async () => {
    const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: "true" });
    const tenant = await loginWithOtp(app, "+919999999902");
    const response = await http(app)
      .get("/v1/wallet/plans")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(response.body.data.items.map((item: { plan_id: string }) => item.plan_id)).toEqual([
      "starter_10",
      "growth_20"
    ]);
    await app.close();
  });

  it("returns only lead packs to owner-side roles", async () => {
    const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: "true" });
    const owner = await loginWithOtp(app, "+919999999901");
    const response = await http(app)
      .get("/v1/wallet/plans")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);
    expect(response.body.data.items.map((item: { plan_id: string }) => item.plan_id)).toEqual([
      "leads_5",
      "leads_15"
    ]);
    expect(response.body.data.items[1]).toMatchObject({
      amount_paise: 69900,
      credits: 15,
      recommended: true
    });
    await app.close();
  });

  it("rejects a cheap tenant pack for an owner", async () => {
    const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: "true" });
    const owner = await loginWithOtp(app, "+919999999901");
    const response = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .set("Idempotency-Key", "owner-cross-plan")
      .send({ plan_id: "starter_10", provider: "upi" })
      .expect(403);
    expect(getErrorCode(response.body)).toBe("plan_not_available_for_role");
    await app.close();
  });

  it("keeps plan listing and purchase creation disabled by default", async () => {
    const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: undefined });
    const tenant = await loginWithOtp(app, "+919999999902");
    await http(app)
      .get("/v1/wallet/plans")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(403);
    await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "flag-off")
      .send({ plan_id: "starter_10", provider: "upi" })
      .expect(403);
    await app.close();
  });
});
