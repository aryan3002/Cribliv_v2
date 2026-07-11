// apps/api/test/wallet-purchase-confirmation.integration.test.ts
// Checkout signature confirmation (POST .../confirm) and status reads
// (GET .../:orderId) for wallet credit purchase intents. Mirrors the
// phase1.integration.test.ts webhook-signing helper style; the in-memory
// suite always runs, the DB suite is `describe.runIf(!!TEST_DATABASE_URL)`
// per the codebase's existing DB-integration-test convention.
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "crypto";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { canonicalPayload } from "../src/modules/payments/payments.util";

const TEST_DB = process.env.TEST_DATABASE_URL;
const CHECKOUT_SECRET = "test_checkout_secret";
const WEBHOOK_SECRET = "test_webhook_secret";

interface OtpVerifyData {
  access_token: string;
  user: { id: string; role: string };
}

interface PurchaseIntent {
  order_id: string;
  amount_paise: number;
  credits_to_grant: number;
}

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

function randPhone() {
  return `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
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
      device_fingerprint: "wallet-purchase-confirmation-test"
    })
    .expect(201);
  return verifyRes.body.data as OtpVerifyData;
}

async function createPurchaseIntent(
  app: INestApplication,
  accessToken: string,
  idempotencyKey: string,
  planId: "starter_10" | "growth_20" = "starter_10"
): Promise<PurchaseIntent> {
  const response = await http(app)
    .post("/v1/wallet/purchase-intents")
    .set("Authorization", `Bearer ${accessToken}`)
    .set("Idempotency-Key", idempotencyKey)
    .send({ plan_id: planId, provider: "razorpay" })
    .expect(201);

  return response.body.data as PurchaseIntent;
}

async function getWalletBalance(app: INestApplication, accessToken: string) {
  const res = await http(app)
    .get("/v1/wallet")
    .set("Authorization", `Bearer ${accessToken}`)
    .expect(200);
  return res.body.data.balance_credits as number;
}

/** Matches verifyRazorpayCheckoutSignature in payments.util.ts. */
function signCheckout(orderId: string, paymentId: string, secret = CHECKOUT_SECRET) {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

function signWebhook(payload: Record<string, unknown>, secret = WEBHOOK_SECRET) {
  return createHmac("sha256", secret).update(canonicalPayload(payload)).digest("hex");
}

async function captureViaWebhook(
  app: INestApplication,
  orderId: string,
  paymentId: string,
  eventId: string
) {
  const payload = {
    id: eventId,
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId
        }
      }
    }
  };
  return http(app)
    .post("/v1/webhooks/razorpay")
    .set("x-razorpay-signature", signWebhook(payload))
    .send(payload)
    .expect(201);
}

describe("wallet purchase-intent confirmation + status (in-memory)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    process.env.OTP_PROVIDER = "mock";
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.RAZORPAY_CHECKOUT_SECRET = CHECKOUT_SECRET;
    process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
    process.env.FF_CREDIT_PURCHASE_ENABLED = "true";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    delete process.env.FF_CREDIT_PURCHASE_ENABLED;
    delete process.env.RAZORPAY_CHECKOUT_SECRET;
    delete process.env.RAZORPAY_ORDERS_MODE;
  });

  it("confirms with a valid checkout signature, marks the order authorized, and leaves wallet balance untouched", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "confirm-happy-path");
    const balanceBefore = await getWalletBalance(app, tenant.access_token);

    const response = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: "pay_confirm_1",
        razorpay_signature: signCheckout(purchase.order_id, "pay_confirm_1")
      })
      .expect(201);

    expect(response.body.data).toEqual({
      order_id: purchase.order_id,
      status: "authorized",
      credits_to_grant: purchase.credits_to_grant
    });

    const balanceAfter = await getWalletBalance(app, tenant.access_token);
    expect(balanceAfter).toBe(balanceBefore);
  });

  it("rejects an invalid checkout signature with 401 invalid_payment_signature and leaves the order created", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "confirm-bad-signature");

    const response = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: "pay_bad_sig",
        razorpay_signature: "0".repeat(64)
      })
      .expect(401);

    expect(getErrorCode(response.body)).toBe("invalid_payment_signature");

    const status = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(status.body.data.status).toBe("created");
  });

  it("rejects a signature with multi-byte UTF-8 that matches string length but not byte length (401 invalid_payment_signature)", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "confirm-multibyte-sig");

    // 63 valid hex chars + "é" (2-byte UTF-8 char) = 64 string length, 65 byte length
    // This should not bypass the signature guard
    const response = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: "pay_multibyte",
        razorpay_signature: "0".repeat(63) + "é"
      })
      .expect(401);

    expect(getErrorCode(response.body)).toBe("invalid_payment_signature");

    const status = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(status.body.data.status).toBe("created");
  });

  it("rejects a body/path order id mismatch with 400 order_mismatch", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "confirm-mismatch");
    const otherOrderId = "order_mock_totally_different";

    const response = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: otherOrderId,
        razorpay_payment_id: "pay_mismatch",
        razorpay_signature: signCheckout(otherOrderId, "pay_mismatch")
      })
      .expect(400);

    expect(getErrorCode(response.body)).toBe("order_mismatch");

    const status = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(status.body.data.status).toBe("created");
  });

  it("returns 404 order_not_found when another user tries to confirm someone else's order", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "confirm-foreign-order");

    const response = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: "pay_foreign",
        razorpay_signature: signCheckout(purchase.order_id, "pay_foreign")
      })
      .expect(404);

    expect(getErrorCode(response.body)).toBe("order_not_found");

    const status = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(status.body.data.status).toBe("created");
  });

  it("returns 404 order_not_found when another user tries to read someone else's order status", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "status-foreign-order");

    const response = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(404);

    expect(getErrorCode(response.body)).toBe("order_not_found");
  });

  it("returns 404 order_not_found for an order id that does not exist", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");

    const response = await http(app)
      .get("/v1/wallet/purchase-intents/order_mock_does_not_exist")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(404);

    expect(getErrorCode(response.body)).toBe("order_not_found");
  });

  it("GET status returns order_id, status, plan_id, amount_paise, credits_to_grant, provider", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "status-happy-path",
      "growth_20"
    );

    const response = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);

    expect(response.body.data).toEqual({
      order_id: purchase.order_id,
      status: "created",
      plan_id: "growth_20",
      amount_paise: purchase.amount_paise,
      credits_to_grant: purchase.credits_to_grant,
      provider: "razorpay"
    });
  });

  it("a captured webhook after confirm moves status to captured and credits the wallet exactly once", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "confirm-then-capture");
    const balanceBefore = await getWalletBalance(app, tenant.access_token);
    const paymentId = "pay_confirm_then_capture";

    const confirmResponse = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: signCheckout(purchase.order_id, paymentId)
      })
      .expect(201);
    expect(confirmResponse.body.data.status).toBe("authorized");

    await captureViaWebhook(app, purchase.order_id, paymentId, "evt_confirm_then_capture");

    const status = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(status.body.data.status).toBe("captured");

    const balanceAfter = await getWalletBalance(app, tenant.access_token);
    expect(balanceAfter).toBe(balanceBefore + purchase.credits_to_grant);
  });

  it("a confirm arriving after a captured webhook does not downgrade status or double-credit the wallet", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(app, tenant.access_token, "capture-then-confirm");
    const balanceBefore = await getWalletBalance(app, tenant.access_token);
    const paymentId = "pay_capture_then_confirm";

    await captureViaWebhook(app, purchase.order_id, paymentId, "evt_capture_then_confirm");

    const balanceAfterCapture = await getWalletBalance(app, tenant.access_token);
    expect(balanceAfterCapture).toBe(balanceBefore + purchase.credits_to_grant);

    const confirmResponse = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: signCheckout(purchase.order_id, paymentId)
      })
      .expect(201);

    // Terminal: confirm must not downgrade an already-captured order back to
    // "authorized", and must never touch the wallet itself.
    expect(confirmResponse.body.data.status).toBe("captured");

    const balanceAfterConfirm = await getWalletBalance(app, tenant.access_token);
    expect(balanceAfterConfirm).toBe(balanceAfterCapture);
  });
});

describe.runIf(!!TEST_DB)("wallet purchase-intent confirmation + status (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const tenantPhone = randPhone();
  const otherPhone = randPhone();
  const phones = [tenantPhone, otherPhone];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.RAZORPAY_CHECKOUT_SECRET = CHECKOUT_SECRET;
    process.env.FF_CREDIT_PURCHASE_ENABLED = "true";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = new Client({ connectionString: TEST_DB! });
    await db.connect();
  }, 60_000);

  afterAll(async () => {
    await db.query(
      `DELETE FROM payment_webhook_events WHERE payment_order_id IN
         (SELECT id FROM payment_orders WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1)))`,
      [phones]
    );
    await db.query(
      `DELETE FROM wallet_transactions WHERE wallet_user_id IN
         (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(
      `DELETE FROM payment_orders WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(
      `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]
    );
    await db.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [phones]);
    await db.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [phones]);
    await db.end();
    await app.close();
    delete process.env.DATABASE_URL;
    delete process.env.FF_CREDIT_PURCHASE_ENABLED;
    delete process.env.RAZORPAY_CHECKOUT_SECRET;
  }, 60_000);

  it("confirms, then a captured webhook moves status to captured and credits the wallet exactly once", async () => {
    const tenant = await loginWithOtp(app, tenantPhone);
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "db-confirm-then-capture"
    );
    const balanceBefore = await getWalletBalance(app, tenant.access_token);
    const paymentId = "pay_db_confirm_then_capture";

    const confirmResponse = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: signCheckout(purchase.order_id, paymentId)
      })
      .expect(201);
    expect(confirmResponse.body.data.status).toBe("authorized");

    const balanceAfterConfirm = await getWalletBalance(app, tenant.access_token);
    expect(balanceAfterConfirm).toBe(balanceBefore);

    await captureViaWebhook(app, purchase.order_id, paymentId, "evt_db_confirm_then_capture");

    const status = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(status.body.data.status).toBe("captured");
    expect(status.body.data.plan_id).toBe("starter_10");
    expect(status.body.data.provider).toBe("razorpay");

    const balanceAfterCapture = await getWalletBalance(app, tenant.access_token);
    expect(balanceAfterCapture).toBe(balanceBefore + purchase.credits_to_grant);
  }, 20_000);

  it("returns 404 order_not_found when another user reads or confirms someone else's order", async () => {
    const tenant = await loginWithOtp(app, tenantPhone);
    const other = await loginWithOtp(app, otherPhone);
    const purchase = await createPurchaseIntent(app, tenant.access_token, "db-foreign-order");

    const statusResponse = await http(app)
      .get(`/v1/wallet/purchase-intents/${purchase.order_id}`)
      .set("Authorization", `Bearer ${other.access_token}`)
      .expect(404);
    expect(getErrorCode(statusResponse.body)).toBe("order_not_found");

    const confirmResponse = await http(app)
      .post(`/v1/wallet/purchase-intents/${purchase.order_id}/confirm`)
      .set("Authorization", `Bearer ${other.access_token}`)
      .send({
        razorpay_order_id: purchase.order_id,
        razorpay_payment_id: "pay_db_foreign",
        razorpay_signature: signCheckout(purchase.order_id, "pay_db_foreign")
      })
      .expect(404);
    expect(getErrorCode(confirmResponse.body)).toBe("order_not_found");
  }, 20_000);
});
