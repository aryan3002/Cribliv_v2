import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { AppStateService } from "../src/common/app-state.service";

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

async function createApp() {
  delete process.env.DATABASE_URL;
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

describe("Phase 1 integration flows", () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("locks OTP challenge after 5 failed attempts", async () => {
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
});
