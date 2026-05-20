import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { RentAgreementModule } from "../../rent-agreement.module";
import { AuthGuard } from "../../../../common/auth.guard";

// Phase 11 smoke: drive the wizard for the basic plan end-to-end, mocking the
// AuthGuard to bypass the full session-token verification path (which needs a DB
// or AppStateService-seeded user — out of scope for this smoke).

describe("RentAgreementController — basic-plan wizard smoke", () => {
  let app: INestApplication;
  const userId = "00000000-0000-0000-0000-000000000001";

  beforeAll(async () => {
    process.env.RENT_AGREEMENT_IP_SALT = process.env.RENT_AGREEMENT_IP_SALT ?? "smoke-test-salt";
    process.env.RENT_AGREEMENT_PAN_KEY =
      process.env.RENT_AGREEMENT_PAN_KEY ?? Buffer.alloc(32, 7).toString("base64");

    const moduleRef = await Test.createTestingModule({ imports: [RentAgreementModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = { id: userId, role: "tenant" };
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix("v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("public: GET /v1/rent-agreement/plans returns 3 active plans", async () => {
    const res = await request(app.getHttpServer()).get("/v1/rent-agreement/plans").expect(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((p: { id: string }) => p.id).sort()).toEqual([
      "basic",
      "premium",
      "standard"
    ]);
  });

  it("public: GET /v1/rent-agreement/states returns 8 supported states", async () => {
    const res = await request(app.getHttpServer()).get("/v1/rent-agreement/states").expect(200);
    expect(res.body.data).toHaveLength(8);
    expect(res.body.data.map((s: { state_code: string }) => s.state_code).sort()).toEqual([
      "DL",
      "GJ",
      "HR",
      "KA",
      "MH",
      "RJ",
      "TN",
      "UP"
    ]);
  });

  it("public: GET /v1/rent-agreement/stamp-duty?state=KA&rent=2500000&tenure=11&deposit=5000000 returns duty", async () => {
    const res = await request(app.getHttpServer())
      .get("/v1/rent-agreement/stamp-duty?state=KA&rent=2500000&tenure=11&deposit=5000000")
      .expect(200);
    expect(res.body.data.state_code).toBe("KA");
    expect(res.body.data.stamp_duty_paise).toBeGreaterThan(0);
  });

  it("wizard: POST /draft -> GET /my reflects -> GET /:id round-trips", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .set("idempotency-key", "smoke-create-1")
      .send({ plan_id: "basic", locale: "en" })
      .expect(201);
    const draftId = createRes.body.data.id as string;
    expect(createRes.body.data.current_step).toBe(1);
    expect(createRes.body.data.status).toBe("draft");

    const listRes = await request(app.getHttpServer()).get("/v1/rent-agreement/my").expect(200);
    expect(listRes.body.data.map((d: { id: string }) => d.id)).toContain(draftId);

    const getRes = await request(app.getHttpServer())
      .get(`/v1/rent-agreement/${draftId}`)
      .expect(200);
    expect(getRes.body.data.id).toBe(draftId);
  });

  it("download path: claim on un-generated draft returns 425 PDF_NOT_READY", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .set("idempotency-key", "smoke-create-2")
      .send({ plan_id: "basic", locale: "en" })
      .expect(201);
    const draftId = createRes.body.data.id as string;
    const dlRes = await request(app.getHttpServer())
      .get(`/v1/rent-agreement/${draftId}/download`)
      .expect(425);
    expect(dlRes.body.error.code).toBe("RENT_AGREEMENT_PDF_NOT_READY");
  });

  it("status path: a fresh draft reports status='draft' and pdf_ready=false", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .set("idempotency-key", "smoke-create-3")
      .send({ plan_id: "basic", locale: "en" })
      .expect(201);
    const statusRes = await request(app.getHttpServer())
      .get(`/v1/rent-agreement/${createRes.body.data.id}/status`)
      .expect(200);
    expect(statusRes.body.data.status).toBe("draft");
    expect(statusRes.body.data.pdf_ready).toBe(false);
  });

  it("idempotency: missing idempotency-key on POST /draft returns 400", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .send({ plan_id: "basic", locale: "en" })
      .expect(400);
    expect(res.body.error.code).toBe("RENT_AGREEMENT_IDEMPOTENCY_REQUIRED");
  });

  it("idempotency: same key replays the same draft id", async () => {
    const first = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .set("idempotency-key", "smoke-replay-1")
      .send({ plan_id: "premium", locale: "en" })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/v1/rent-agreement/draft")
      .set("idempotency-key", "smoke-replay-1")
      .send({ plan_id: "premium", locale: "en" })
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
  });
});
