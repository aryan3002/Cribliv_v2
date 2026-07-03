import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AiAdminController } from "../src/modules/ai/ai-admin.controller";
import { EmbeddingService } from "../src/modules/ai/embedding.service";
import { RankingService } from "../src/modules/ai/ranking.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

@Module({
  controllers: [AiAdminController],
  providers: [
    {
      provide: EmbeddingService,
      useValue: { backfillEmbeddings: vi.fn(async () => 1) }
    },
    {
      provide: RankingService,
      useValue: { recomputeScores: vi.fn(async () => 1) }
    },
    RolesGuard
  ]
})
class TestModule {}

describe("AiAdminController security", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = { id: "tenant-1", role: "tenant" };
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("forbids a tenant from triggering AI admin backfill jobs", async () => {
    const res = await request(app.getHttpServer()).post("/admin/ai/backfill-embeddings");
    expect(res.status).toBe(403);
  });
});
