// apps/api/test/wallet-purchase-intent.integration.test.ts
// In-memory (no DATABASE_URL) integration test, phase1.integration.test.ts style.
// Exercises WalletPurchaseService via the real HTTP surface, with
// RazorpayOrdersService swapped for a spy so we can assert on provider-call
// counts without hitting the network.
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { vi } from "vitest";
import { AppModule } from "../src/app.module";
import { RazorpayOrdersService } from "../src/modules/payments/razorpay-orders.service";

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

interface FakeRazorpayOrders {
  createOrder: ReturnType<typeof vi.fn>;
  keyId: ReturnType<typeof vi.fn>;
}

function createFakeRazorpayOrders(opts: { delayMs?: number } = {}): FakeRazorpayOrders {
  let counter = 0;
  return {
    createOrder: vi.fn(async (input: { amountPaise: number }) => {
      if (opts.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
      counter += 1;
      return {
        id: `order_test_${counter}`,
        amount: input.amountPaise,
        currency: "INR" as const
      };
    }),
    keyId: vi.fn(() => "rzp_test_fake_key")
  };
}

async function createApp(
  overrides: Record<string, string | undefined> = {},
  fakeRazorpay?: FakeRazorpayOrders
) {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.PAYMENT_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
  process.env.FF_CREDIT_PURCHASE_ENABLED = "true";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (fakeRazorpay) {
    builder.overrideProvider(RazorpayOrdersService).useValue(fakeRazorpay);
  }
  const moduleRef = await builder.compile();
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
      device_fingerprint: "wallet-purchase-intent-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string; role: string } };
}

describe("wallet purchase intents — Razorpay provider client + idempotency", () => {
  afterEach(() => {
    delete process.env.FF_CREDIT_PURCHASE_ENABLED;
    delete process.env.RAZORPAY_ORDERS_MODE;
  });

  it("returns provider_payload.order_id, key_id, amount and currency in Razorpay mock mode", async () => {
    const app = await createApp();
    const tenant = await loginWithOtp(app, "+919999999902");

    const response = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "mock-mode-order")
      .send({ plan_id: "starter_10", provider: "razorpay" })
      .expect(201);

    const data = response.body.data;
    expect(data.order_id).toMatch(/^order_mock_/);
    expect(data.provider_payload.order_id).toBe(data.order_id);
    expect(data.provider_payload.provider).toBe("razorpay");
    expect(data.provider_payload.key_id).toBeTruthy();
    expect(data.provider_payload.amount_paise).toBe(data.amount_paise);
    expect(data.provider_payload.currency).toBe("INR");

    await app.close();
  });

  it("returns the same order for a duplicate key/plan/provider and calls the provider once", async () => {
    const fake = createFakeRazorpayOrders();
    const app = await createApp({}, fake);
    const tenant = await loginWithOtp(app, "+919999999902");

    const first = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "dup-key-1")
      .send({ plan_id: "starter_10", provider: "razorpay" })
      .expect(201);

    const second = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "dup-key-1")
      .send({ plan_id: "starter_10", provider: "razorpay" })
      .expect(201);

    expect(second.body.data.order_id).toBe(first.body.data.order_id);
    expect(second.body.data.amount_paise).toBe(first.body.data.amount_paise);
    expect(second.body.data.credits_to_grant).toBe(first.body.data.credits_to_grant);
    expect(fake.createOrder).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("returns 409 purchase_intent_conflict when the same key is reused with a different plan", async () => {
    const fake = createFakeRazorpayOrders();
    const app = await createApp({}, fake);
    const tenant = await loginWithOtp(app, "+919999999902");

    await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "conflict-plan")
      .send({ plan_id: "starter_10", provider: "razorpay" })
      .expect(201);

    const conflict = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "conflict-plan")
      .send({ plan_id: "growth_20", provider: "razorpay" })
      .expect(409);

    expect(getErrorCode(conflict.body)).toBe("purchase_intent_conflict");

    await app.close();
  });

  it("returns 409 purchase_intent_conflict when the same key is reused with a different provider", async () => {
    const fake = createFakeRazorpayOrders();
    const app = await createApp({}, fake);
    const tenant = await loginWithOtp(app, "+919999999902");

    await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "conflict-provider")
      .send({ plan_id: "starter_10", provider: "razorpay" })
      .expect(201);

    const conflict = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "conflict-provider")
      .send({ plan_id: "starter_10", provider: "upi" })
      .expect(409);

    expect(getErrorCode(conflict.body)).toBe("purchase_intent_conflict");

    await app.close();
  });

  it("returns a UPI deep link and never calls RazorpayOrdersService.createOrder", async () => {
    const fake = createFakeRazorpayOrders();
    const app = await createApp({}, fake);
    const tenant = await loginWithOtp(app, "+919999999902");

    const response = await http(app)
      .post("/v1/wallet/purchase-intents")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "upi-order")
      .send({ plan_id: "starter_10", provider: "upi" })
      .expect(201);

    expect(response.body.data.provider_payload.provider).toBe("upi");
    expect(response.body.data.provider_payload.deep_link).toMatch(/^upi:\/\/pay\?/);
    expect(fake.createOrder).not.toHaveBeenCalled();

    await app.close();
  });

  it("converges two concurrent calls with the same key on one provider order in memory mode", async () => {
    const fake = createFakeRazorpayOrders({ delayMs: 30 });
    const app = await createApp({}, fake);
    const tenant = await loginWithOtp(app, "+919999999902");

    const [first, second] = await Promise.all([
      http(app)
        .post("/v1/wallet/purchase-intents")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", "concurrent-key")
        .send({ plan_id: "starter_10", provider: "razorpay" }),
      http(app)
        .post("/v1/wallet/purchase-intents")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", "concurrent-key")
        .send({ plan_id: "starter_10", provider: "razorpay" })
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.order_id).toBe(first.body.data.order_id);
    expect(fake.createOrder).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
