import "reflect-metadata";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Module, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { PgListingController } from "../src/modules/pg-operator/pg-listing.controller";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgPropertiesService } from "../src/modules/pg-operator/services/pg-properties.service";
import { PgDraftService } from "../src/modules/pg-operator/services/pg-draft.service";
import { AuthGuard } from "../src/common/auth.guard";

const DRAFT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PAYLOAD = {
  property: { display_name: "Sun PG", city_slug: "lucknow" },
  pg_details: { total_beds: 4 },
  room_types: []
};

function buildApp(userId = "op-1", draftOwner = "op-1") {
  const draftSvc = {
    upsert: vi.fn(async () => ({ draft_id: DRAFT_ID, updated_at: "2026-06-01T00:00:00Z" })),
    list: vi.fn(async () => [
      {
        draft_id: DRAFT_ID,
        display_name: "Sun PG",
        updated_at: "2026-06-01T00:00:00Z",
        committed_listing_id: null
      }
    ]),
    get: vi.fn(async (opId: string, id: string) =>
      opId === draftOwner && id === DRAFT_ID
        ? {
            draft_id: DRAFT_ID,
            payload: PAYLOAD,
            field_confidence: {},
            updated_at: "2026-06-01T00:00:00Z"
          }
        : null
    ),
    remove: vi.fn(async () => undefined)
  };

  @Module({
    controllers: [PgListingController],
    providers: [
      { provide: PgListingService, useValue: {} },
      { provide: PgPropertiesService, useValue: {} },
      { provide: PgDraftService, useValue: draftSvc }
    ]
  })
  class TestModule {}

  const guard = {
    canActivate: (ctx: any) => {
      ctx.switchToHttp().getRequest().user = { id: userId, role: "pg_operator" };
      return true;
    }
  };

  return { TestModule, guard, draftSvc };
}

async function start(mod: any, guard: any) {
  const ref = await Test.createTestingModule({ imports: [mod] })
    .overrideGuard(AuthGuard)
    .useValue(guard)
    .compile();
  const app = ref.createNestApplication();
  await app.init();
  return app;
}

describe("Draft endpoints integration", () => {
  let app: INestApplication;
  afterEach(async () => app?.close());

  it("PUT /pg-operator/listings/draft returns draft_id", async () => {
    const { TestModule, guard } = buildApp();
    app = await start(TestModule, guard);
    const res = await request(app.getHttpServer())
      .put("/pg-operator/listings/draft")
      .set("Idempotency-Key", "idem-1")
      .send({ payload: PAYLOAD, source: "manual" })
      .expect(200);
    expect(res.body.draft_id).toBe(DRAFT_ID);
  });

  it("GET /pg-operator/listings/drafts returns list", async () => {
    const { TestModule, guard } = buildApp();
    app = await start(TestModule, guard);
    const res = await request(app.getHttpServer()).get("/pg-operator/listings/drafts").expect(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("GET /pg-operator/listings/draft/:id 404 for other operator", async () => {
    const { TestModule, guard } = buildApp("other-op", "op-1");
    app = await start(TestModule, guard);
    await request(app.getHttpServer()).get(`/pg-operator/listings/draft/${DRAFT_ID}`).expect(404);
  });

  it("DELETE /pg-operator/listings/draft/:id returns 204", async () => {
    const { TestModule, guard } = buildApp();
    app = await start(TestModule, guard);
    await request(app.getHttpServer())
      .delete(`/pg-operator/listings/draft/${DRAFT_ID}`)
      .expect(204);
  });
});
