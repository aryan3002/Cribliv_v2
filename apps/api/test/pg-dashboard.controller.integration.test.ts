import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { PgDashboardController } from "../src/modules/pg-operator/pg-dashboard.controller";
import { PgDashboardService } from "../src/modules/pg-operator/services/pg-dashboard.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

const allowAllGuard = {
  canActivate: (ctx: any) => {
    ctx.switchToHttp().getRequest().user = { id: "op-1", role: "pg_operator" };
    return true;
  }
};

let callCount = 0;
const dashboardMock = {
  getDashboard: async () => {
    callCount++;
    return { listing_health: [], leads_inbox: [] };
  }
};

@Module({
  controllers: [PgDashboardController],
  providers: [{ provide: PgDashboardService, useValue: dashboardMock }]
})
class TestPgDashboardModule {}

describe("PgDashboardController (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestPgDashboardModule] })
      .overrideGuard(AuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RolesGuard)
      .useValue(allowAllGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /pg-operator/dashboard returns aggregated payload", async () => {
    const r = await request(app.getHttpServer()).get("/pg-operator/dashboard");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ listing_health: [], leads_inbox: [] });
    expect(callCount).toBeGreaterThan(0);
  });
});
