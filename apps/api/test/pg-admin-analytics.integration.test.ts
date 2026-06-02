import "reflect-metadata";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  Module,
  INestApplication,
  Controller,
  Get,
  Query,
  UseGuards,
  Inject,
  BadRequestException
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";
import { PgAdminAnalyticsService } from "../src/modules/admin/pg-admin-analytics.service";
import { PgFunnelService } from "../src/modules/pg-operator/services/pg-funnel.service";
import * as flags from "../src/config/feature-flags";

// Minimal controller mirroring the real admin route + guard composition, so the
// test exercises the guard + flag gate without booting the whole AdminModule.
@Controller("admin")
@UseGuards(AuthGuard, RolesGuard)
class TestAdminController {
  constructor(@Inject(PgAdminAnalyticsService) private readonly pg: PgAdminAnalyticsService) {}
  @Get("pg/listing-analytics")
  async analytics(@Query("days") days?: string) {
    if (!flags.readFeatureFlags().ff_pg_admin_analytics) {
      throw new BadRequestException({ code: "feature_disabled" });
    }
    return { data: await this.pg.getListingAnalytics(Number(days) || 30) };
  }
}

const SHAPE = {
  range_days: 30,
  funnel: {
    wizard_started: 10,
    step_completed_by_step: {},
    submitted: 3,
    published: 2,
    abandoned: 4
  },
  conversion: 0.3,
  publish_conversion: 0.2,
  median_time_to_publish_sec: 500,
  by_source: { manual: 8, voice: 2 },
  quality: { geocode_rate: 0.5, avg_photos: 4, missing_field_heatmap: [] },
  voice: { sessions: 2, completion_rate: 0.5, fallback_rate: 0.5 },
  score_health: {
    active_pg: 5,
    with_score: 4,
    without_score: 1,
    avg_composite: 0.6,
    distribution: []
  }
};

function buildApp(opts: { admin: boolean }) {
  const funnel = { getAnalytics: vi.fn(async () => SHAPE) };
  @Module({
    controllers: [TestAdminController],
    providers: [PgAdminAnalyticsService, { provide: PgFunnelService, useValue: funnel }]
  })
  class TestModule {}

  const authGuard = {
    canActivate: (ctx: any) => {
      ctx.switchToHttp().getRequest().user = { id: "a1", role: opts.admin ? "admin" : "tenant" };
      return true;
    }
  };
  const rolesGuard = { canActivate: () => opts.admin };
  return { TestModule, authGuard, rolesGuard };
}

async function start(mod: any, authGuard: any, rolesGuard: any): Promise<INestApplication> {
  const ref = await Test.createTestingModule({ imports: [mod] })
    .overrideGuard(AuthGuard)
    .useValue(authGuard)
    .overrideGuard(RolesGuard)
    .useValue(rolesGuard)
    .compile();
  const app = ref.createNestApplication();
  await app.init();
  return app;
}

describe("GET /admin/pg/listing-analytics (integration)", () => {
  let app: INestApplication;
  beforeEach(() =>
    vi.spyOn(flags, "readFeatureFlags").mockReturnValue({ ff_pg_admin_analytics: true } as any)
  );
  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it("returns the analytics shape for an admin", async () => {
    const { TestModule, authGuard, rolesGuard } = buildApp({ admin: true });
    app = await start(TestModule, authGuard, rolesGuard);
    const res = await request(app.getHttpServer())
      .get("/admin/pg/listing-analytics?days=30")
      .expect(200);
    expect(res.body.data.conversion).toBe(0.3);
    expect(res.body.data.score_health.with_score).toBe(4);
    expect(res.body.data.voice.completion_rate).toBe(0.5);
  });

  it("forbids non-admin (RolesGuard)", async () => {
    const { TestModule, authGuard, rolesGuard } = buildApp({ admin: false });
    app = await start(TestModule, authGuard, rolesGuard);
    await request(app.getHttpServer()).get("/admin/pg/listing-analytics").expect(403);
  });

  it("400s when the flag is off", async () => {
    vi.spyOn(flags, "readFeatureFlags").mockReturnValue({ ff_pg_admin_analytics: false } as any);
    const { TestModule, authGuard, rolesGuard } = buildApp({ admin: true });
    app = await start(TestModule, authGuard, rolesGuard);
    await request(app.getHttpServer()).get("/admin/pg/listing-analytics").expect(400);
  });
});
