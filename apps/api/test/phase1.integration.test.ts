import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createHmac } from "crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AppStateService } from "../src/common/app-state.service";
import { canonicalPayload } from "../src/modules/payments/payments.util";

interface OtpSendData {
  challenge_id: string;
  dev_otp: string;
}

interface OtpVerifyData {
  access_token: string;
  user: {
    id: string;
    role: string;
  };
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

async function createApp(overrides: Record<string, string | undefined> = {}) {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.PAYMENT_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
  process.env.LIVENESS_PROVIDER_URL = "";
  process.env.LIVENESS_PROVIDER_API_KEY = "";
  process.env.ELECTRICITY_PROVIDER_URL = "";
  process.env.ELECTRICITY_PROVIDER_API_KEY = "";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule]
  }).compile();

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
      device_fingerprint: "integration-test"
    })
    .expect(201);

  return verifyRes.body.data as OtpVerifyData;
}

async function getFirstListingId(app: INestApplication) {
  const searchRes = await http(app).get("/v1/listings/search").expect(200);
  return searchRes.body.data.items[0].id as string;
}

async function createPurchaseIntent(
  app: INestApplication,
  accessToken: string,
  idempotencyKey: string,
  planId: "starter_10" | "growth_20" = "starter_10",
  provider: "razorpay" | "upi" = "razorpay"
) {
  const response = await http(app)
    .post("/v1/wallet/purchase-intents")
    .set("Authorization", `Bearer ${accessToken}`)
    .set("Idempotency-Key", idempotencyKey)
    .send({ plan_id: planId, provider })
    .expect(201);

  return response.body.data as {
    order_id: string;
    amount_paise: number;
    credits_to_grant: number;
  };
}

function signWebhook(payload: Record<string, unknown>, secret = "test_webhook_secret") {
  return createHmac("sha256", secret).update(canonicalPayload(payload)).digest("hex");
}

describe("Phase 1 integration flows", () => {
  let app: INestApplication | null;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it("locks OTP challenge after 5 failed attempts", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const sendRes = await http(app)
      .post("/v1/auth/otp/send")
      .send({ phone_e164: "+919999999991", purpose: "login" })
      .expect(201);

    const challengeId = (sendRes.body.data as OtpSendData).challenge_id;

    for (let i = 1; i <= 4; i += 1) {
      const res = await http(app)
        .post("/v1/auth/otp/verify")
        .send({
          challenge_id: challengeId,
          otp_code: "000000",
          device_fingerprint: "otp-lock-test"
        })
        .expect(401);
      expect(getErrorCode(res.body)).toBe("invalid_otp");
    }

    const blocked = await http(app)
      .post("/v1/auth/otp/verify")
      .send({ challenge_id: challengeId, otp_code: "000000", device_fingerprint: "otp-lock-test" })
      .expect(401);

    expect(getErrorCode(blocked.body)).toBe("otp_blocked");
  });

  it("deducts credits once for duplicate unlock idempotency key", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);

    const idem = "unlock-idem-1";
    const first = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", idem)
      .send({ listing_id: listingId })
      .expect(201);

    const second = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", idem)
      .send({ listing_id: listingId })
      .expect(201);

    expect(second.body.data.unlock_id).toBe(first.body.data.unlock_id);
    expect(second.body.data.credits_remaining).toBe(first.body.data.credits_remaining);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(1);
  });

  it("does not refund when owner responds before deadline", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);

    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "unlock-idem-responded")
      .send({ listing_id: listingId })
      .expect(201);

    const unlockId = unlock.body.data.unlock_id as string;
    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "whatsapp" })
      .expect(201);

    const appState = app.get(AppStateService);
    const unlockRecord = appState.unlocks.get(unlockId);
    if (unlockRecord) {
      unlockRecord.responseDeadlineAt = Date.now() - 60_000;
    }
    const refunded = appState.runRefundSweep();
    expect(refunded.length).toBe(0);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(1);
  });

  it("refunds exactly once after 12h no-response timeout", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);

    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "unlock-idem-timeout")
      .send({ listing_id: listingId })
      .expect(201);

    const unlockId = unlock.body.data.unlock_id as string;
    const appState = app.get(AppStateService);
    const unlockRecord = appState.unlocks.get(unlockId);
    if (unlockRecord) {
      unlockRecord.responseDeadlineAt = Date.now() - 60_000;
    }

    const firstSweep = appState.runRefundSweep();
    const secondSweep = appState.runRefundSweep();
    expect(firstSweep.length).toBe(1);
    expect(secondSweep.length).toBe(0);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(2);
  });

  it("enforces shortlist auth and supports CRUD for authenticated users", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    await http(app).get("/v1/shortlist").expect(401);
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);

    await http(app)
      .post("/v1/shortlist")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .send({ listing_id: listingId })
      .expect(201);

    const listed = await http(app)
      .get("/v1/shortlist")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(listed.body.data.total).toBe(1);

    await http(app)
      .delete(`/v1/shortlist/${listingId}`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);

    const afterDelete = await http(app)
      .get("/v1/shortlist")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(afterDelete.body.data.total).toBe(0);
  });

  it("returns same purchase intent for duplicate idempotency key", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const idem = "purchase-idem-1";

    const first = await createPurchaseIntent(
      app,
      tenant.access_token,
      idem,
      "starter_10",
      "razorpay"
    );
    const second = await createPurchaseIntent(
      app,
      tenant.access_token,
      idem,
      "starter_10",
      "razorpay"
    );

    expect(second.order_id).toBe(first.order_id);
    expect(second.amount_paise).toBe(first.amount_paise);
    expect(second.credits_to_grant).toBe(first.credits_to_grant);

    const appState = app.get(AppStateService);
    const userOrders = [...appState.paymentOrders.values()].filter(
      (order) => order.userId === tenant.user.id && order.providerOrderId === first.order_id
    );
    expect(userOrders.length).toBe(1);
  });

  it("credits wallet once on valid captured webhook and ignores replay", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "purchase-idem-capture",
      "starter_10",
      "razorpay"
    );

    const payload = {
      id: "evt_capture_1",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_abc_1",
            order_id: purchase.order_id
          }
        }
      }
    };

    const signature = signWebhook(payload);
    await http(app)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", signature)
      .send(payload)
      .expect(201);

    await http(app)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", signature)
      .send(payload)
      .expect(201);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);

    expect(wallet.body.data.balance_credits).toBe(12);
  });

  it("handles concurrent webhook replay without double credit", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "purchase-idem-concurrent",
      "starter_10",
      "razorpay"
    );

    const payload = {
      id: "evt_capture_concurrent",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_concurrent_1",
            order_id: purchase.order_id
          }
        }
      }
    };

    const signature = signWebhook(payload);
    await Promise.all([
      http(app)
        .post("/v1/webhooks/razorpay")
        .set("x-razorpay-signature", signature)
        .send(payload)
        .expect(201),
      http(app)
        .post("/v1/webhooks/razorpay")
        .set("x-razorpay-signature", signature)
        .send(payload)
        .expect(201)
    ]);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(12);
  });

  it("rejects invalid webhook signature without credit posting", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "purchase-idem-invalid-signature",
      "starter_10",
      "razorpay"
    );

    const payload = {
      id: "evt_invalid_sig",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_invalid_sig",
            order_id: purchase.order_id
          }
        }
      }
    };

    await http(app)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", "bad-signature")
      .send(payload)
      .expect(401);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(2);
  });

  it("accepts a later valid webhook after an invalid signature attempt on same event id", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "purchase-idem-invalid-then-valid",
      "starter_10",
      "razorpay"
    );

    const payload = {
      id: "evt_invalid_then_valid",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_invalid_then_valid_1",
            order_id: purchase.order_id
          }
        }
      }
    };

    await http(app)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", "bad-signature")
      .send(payload)
      .expect(401);

    await http(app)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", signWebhook(payload))
      .send(payload)
      .expect(201);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(12);
  });

  it("does not credit wallet for failed payment webhook", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const tenant = await loginWithOtp(app, "+919999999902");
    const purchase = await createPurchaseIntent(
      app,
      tenant.access_token,
      "purchase-idem-failed",
      "growth_20",
      "razorpay"
    );

    const payload = {
      id: "evt_failed_1",
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: "pay_failed_1",
            order_id: purchase.order_id
          }
        }
      }
    };

    await http(app)
      .post("/v1/webhooks/razorpay")
      .set("x-razorpay-signature", signWebhook(payload))
      .send(payload)
      .expect(201);

    const wallet = await http(app)
      .get("/v1/wallet")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    expect(wallet.body.data.balance_credits).toBe(2);
  });

  it("creates sales lead once per idempotency key and supports admin status updates", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const owner = await loginWithOtp(app, "+919999999901");
    const admin = await loginWithOtp(app, "+919999999903");
    const listingId = await getFirstListingId(app);

    const firstLead = await http(app)
      .post("/v1/sales/leads")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .set("Idempotency-Key", "sales-lead-idem-1")
      .send({
        source: "pg_sales_assist",
        listing_id: listingId,
        notes: "Need onboarding support"
      })
      .expect(201);

    const secondLead = await http(app)
      .post("/v1/sales/leads")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .set("Idempotency-Key", "sales-lead-idem-1")
      .send({
        source: "pg_sales_assist",
        listing_id: listingId
      })
      .expect(201);

    expect(secondLead.body.data.id).toBe(firstLead.body.data.id);
    expect(secondLead.body.data.status).toBe("new");

    const leads = await http(app)
      .get("/v1/admin/leads")
      .set("Authorization", `Bearer ${admin.access_token}`)
      .expect(200);

    const createdLead = (leads.body.data.items as Array<{ id: string }>).find(
      (lead) => lead.id === firstLead.body.data.id
    );
    expect(createdLead).toBeTruthy();

    const updatedLead = await http(app)
      .post(`/v1/admin/leads/${firstLead.body.data.id}/status`)
      .set("Authorization", `Bearer ${admin.access_token}`)
      .send({
        status: "qualified",
        reason: "Owner has complete docs"
      })
      .expect(201);

    expect(updatedLead.body.data.status).toBe("qualified");
  });

  it("includes verification provider metadata in responses", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);

    const video = await http(app)
      .post("/v1/owner/verification/video")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({
        listing_id: listingId,
        artifact_blob_path: "/tmp/video-proof.mp4",
        vendor_reference: "video_ref_1"
      })
      .expect(201);

    expect(video.body.data.provider).toBeTruthy();
    expect(video.body.data.provider_result_code).toBeTruthy();

    const status = await http(app)
      .get(`/v1/owner/verification/status?listing_id=${listingId}`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);

    const attempts = status.body.data.attempts as Array<Record<string, unknown>>;
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts[0].provider).toBeDefined();
  });

  it("keeps listing pending after automated pass until admin marks pass", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    const owner = await loginWithOtp(app, "+919999999901");
    const admin = await loginWithOtp(app, "+919999999903");
    const listingId = await getFirstListingId(app);

    const submitted = await http(app)
      .post("/v1/owner/verification/electricity")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({
        listing_id: listingId,
        consumer_id: "cons_001",
        address_text: "gurugram sector 14",
        bill_artifact_blob_path: "/tmp/bill.pdf"
      })
      .expect(201);

    expect(submitted.body.data.result).toBe("pass");

    const statusPending = await http(app)
      .get(`/v1/owner/verification/status?listing_id=${listingId}`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);

    expect(statusPending.body.data.overall_status).toBe("pending");
    const attemptId = statusPending.body.data.attempts[0].id as string;

    await http(app)
      .post(`/v1/admin/review/verifications/${attemptId}/decision`)
      .set("Authorization", `Bearer ${admin.access_token}`)
      .send({ decision: "pass" })
      .expect(201);

    const statusAfterAdmin = await http(app)
      .get(`/v1/owner/verification/status?listing_id=${listingId}`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);

    expect(statusAfterAdmin.body.data.overall_status).toBe("verified");
  });

  it("keeps listing pending after automated fail until admin marks fail", async () => {
    await app?.close();
    app = await createApp({
      FF_REAL_VERIFICATION_PROVIDER: "true",
      LIVENESS_PROVIDER_URL: "https://liveness.provider.local/verify",
      LIVENESS_PROVIDER_API_KEY: "test-live-key",
      ELECTRICITY_PROVIDER_URL: "https://electricity.provider.local/verify",
      ELECTRICITY_PROVIDER_API_KEY: "test-electric-key"
    });

    if (!app) {
      throw new Error("App not initialized");
    }
    const owner = await loginWithOtp(app, "+919999999901");
    const admin = await loginWithOtp(app, "+919999999903");
    const listingId = await getFirstListingId(app);

    const submitted = await http(app)
      .post("/v1/owner/verification/electricity")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({
        listing_id: listingId,
        consumer_id: "cons_002",
        address_text: "fraud mismatch-hard signal",
        bill_artifact_blob_path: "/tmp/bill-fail.pdf"
      })
      .expect(201);

    expect(submitted.body.data.result).toBe("fail");

    const statusPending = await http(app)
      .get(`/v1/owner/verification/status?listing_id=${listingId}`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);

    expect(statusPending.body.data.overall_status).toBe("pending");
    const attemptId = statusPending.body.data.attempts[0].id as string;

    await http(app)
      .post(`/v1/admin/review/verifications/${attemptId}/decision`)
      .set("Authorization", `Bearer ${admin.access_token}`)
      .send({ decision: "fail", reason: "Fraud indicators confirmed" })
      .expect(201);

    const statusAfterAdmin = await http(app)
      .get(`/v1/owner/verification/status?listing_id=${listingId}`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .expect(200);

    expect(statusAfterAdmin.body.data.overall_status).toBe("failed");
  });

  it("forces manual_review on provider timeout/error and exposes retryable evidence in admin queue", async () => {
    if (!app) {
      throw new Error("App not initialized");
    }
    process.env.FF_REAL_VERIFICATION_PROVIDER = "true";
    process.env.LIVENESS_PROVIDER_URL = "https://liveness.provider.local/verify";
    process.env.LIVENESS_PROVIDER_API_KEY = "test-live-key";
    process.env.ELECTRICITY_PROVIDER_URL = "https://electricity.provider.local/verify";
    process.env.ELECTRICITY_PROVIDER_API_KEY = "test-electric-key";

    const owner = await loginWithOtp(app, "+919999999901");
    const admin = await loginWithOtp(app, "+919999999903");
    const listingId = await getFirstListingId(app);

    const timeout = await http(app)
      .post("/v1/owner/verification/video")
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({
        listing_id: listingId,
        artifact_blob_path: "/tmp/video-proof.mp4",
        vendor_reference: "simulate-timeout"
      })
      .expect(201);

    expect(timeout.body.data.result).toBe("manual_review");
    expect(timeout.body.data.retryable).toBe(true);
    expect(timeout.body.data.review_reason).toContain("provider_fallback");

    const adminQueue = await http(app)
      .get("/v1/admin/review/verifications")
      .set("Authorization", `Bearer ${admin.access_token}`)
      .expect(200);

    const item = (adminQueue.body.data.items as Array<Record<string, unknown>>).find(
      (attempt) => attempt.listing_id === listingId
    );
    expect(item).toBeTruthy();
    expect(item?.provider_result_code).toBe("provider_timeout");
    expect(item?.retryable).toBe(true);
    expect(item?.machine_result).toBe("manual_review");
  });

  it("fails app startup if real provider mode is enabled without required provider config", async () => {
    await app?.close();
    app = null;

    await expect(
      createApp({
        FF_REAL_VERIFICATION_PROVIDER: "true",
        LIVENESS_PROVIDER_URL: undefined,
        LIVENESS_PROVIDER_API_KEY: undefined,
        ELECTRICITY_PROVIDER_URL: undefined,
        ELECTRICITY_PROVIDER_API_KEY: undefined
      })
    ).rejects.toThrow();
  });
});
