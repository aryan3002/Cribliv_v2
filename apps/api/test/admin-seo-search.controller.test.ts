import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/common/auth.guard";
import { DatabaseService } from "../src/common/database.service";
import { RolesGuard } from "../src/common/roles.guard";
import type { Role } from "../src/common/types";
import { AdminSeoSearchController } from "../src/modules/admin/admin-seo-search.controller";
import { IndexingService } from "../src/modules/seo/indexing.service";
import { SeoSearchService } from "../src/modules/seo/seo-search.service";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const QUEUE_ROW = {
  id: "00000000-0000-4000-8000-0000000000bb",
  url: "https://cribliv.com/en/city/noida",
  status: "pending",
  reason: "city_enabled",
  attempts: 0,
  submitted_at: null,
  response: null,
  created_at: "2026-07-06T00:00:00.000Z",
  updated_at: "2026-07-06T00:00:00.000Z"
};
const PERFORMANCE_RESULT = {
  items: [
    {
      keyword: "2bhk noida",
      page: "/en/city/noida",
      locale: "en",
      city_slug: "noida",
      position: 14.2,
      impressions: 320,
      clicks: 18,
      ctr: 0.056,
      captured_at: "2026-07-06",
      is_target: false,
      is_ignored: false
    }
  ],
  total: 1,
  totals: { total_impressions: 320, total_clicks: 18, avg_position: 14.2 }
};

describe("AdminSeoSearchController", () => {
  let app: INestApplication;
  let currentUser: { id: string; role: Role };
  let seoSearch: {
    getSearchPerformance: ReturnType<typeof vi.fn>;
    exportSearchPerformanceCsv: ReturnType<typeof vi.fn>;
    getCoverage: ReturnType<typeof vi.fn>;
    getIndexingQueueSummary: ReturnType<typeof vi.fn>;
  };
  let indexing: {
    listQueue: ReturnType<typeof vi.fn>;
    enqueue: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  };
  let database: { query: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    currentUser = { id: ADMIN_ID, role: "admin" };
    seoSearch = {
      getSearchPerformance: vi.fn(async () => PERFORMANCE_RESULT),
      exportSearchPerformanceCsv: vi.fn(async () => "keyword,page\nfoo,bar\n"),
      getCoverage: vi.fn(async () => ({ indexed_count: 10, submitted_count: 4 })),
      getIndexingQueueSummary: vi.fn(async () => ({
        counts_by_status: { pending: 1 },
        submitted_today: 0,
        daily_quota: 200
      }))
    };
    indexing = {
      listQueue: vi.fn(async () => ({ items: [QUEUE_ROW], total: 1 })),
      enqueue: vi.fn(async () => QUEUE_ROW),
      retry: vi.fn(async () => QUEUE_ROW)
    };
    database = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };

    const moduleRef = await Test.createTestingModule({
      controllers: [AdminSeoSearchController],
      providers: [
        RolesGuard,
        { provide: SeoSearchService, useValue: seoSearch },
        { provide: IndexingService, useValue: indexing },
        { provide: DatabaseService, useValue: database }
      ]
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it("forbids tenants on every route", async () => {
    currentUser = { id: "tenant-1", role: "tenant" };
    await request(app.getHttpServer()).get("/admin/seo/search-performance").expect(403);
    await request(app.getHttpServer()).get("/admin/seo/indexing-queue").expect(403);
    await request(app.getHttpServer())
      .post("/admin/seo/indexing-queue")
      .send({ url: "https://cribliv.com/x" })
      .expect(403);
  });

  it("returns search performance with query filters forwarded", async () => {
    await request(app.getHttpServer())
      .get("/admin/seo/search-performance")
      .query({ city_slug: "noida", locale: "en", quick_wins: "true", limit: "20", offset: "0" })
      .expect(200)
      .expect({ data: PERFORMANCE_RESULT });

    expect(seoSearch.getSearchPerformance).toHaveBeenCalledWith({
      city_slug: "noida",
      locale: "en",
      quick_wins: true,
      limit: 20,
      offset: 0
    });
  });

  it("exports search performance as CSV with the right content type", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/seo/search-performance/export")
      .query({ quick_wins: "true" })
      .expect(200);

    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("search-performance.csv");
    expect(res.text).toBe("keyword,page\nfoo,bar\n");
    expect(seoSearch.exportSearchPerformanceCsv).toHaveBeenCalledWith({ quick_wins: true });
  });

  it("lists the indexing queue with a summary", async () => {
    await request(app.getHttpServer())
      .get("/admin/seo/indexing-queue")
      .query({ status: "pending" })
      .expect(200)
      .expect({
        data: {
          items: [QUEUE_ROW],
          total: 1,
          summary: { counts_by_status: { pending: 1 }, submitted_today: 0, daily_quota: 200 }
        }
      });

    expect(indexing.listQueue).toHaveBeenCalledWith({
      status: "pending",
      limit: undefined,
      offset: undefined
    });
  });

  it("manually submits a URL and writes an audited admin action", async () => {
    await request(app.getHttpServer())
      .post("/admin/seo/indexing-queue")
      .send({ url: "https://cribliv.com/en/city/noida", reason: "manual_admin_submit" })
      .expect(201)
      .expect({ data: QUEUE_ROW });

    expect(indexing.enqueue).toHaveBeenCalledWith(
      "https://cribliv.com/en/city/noida",
      "manual_admin_submit"
    );
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain("INSERT INTO admin_actions");
    expect(sql).toContain("'seo_indexing_queue'::admin_target_type");
    expect(sql).toContain("'submit_indexing_url'::admin_action_type");
    expect(params[0]).toBe(ADMIN_ID);
    expect(params[1]).toBe(QUEUE_ROW.id);
  });

  it("defaults reason to manual_admin_submit when not supplied", async () => {
    await request(app.getHttpServer())
      .post("/admin/seo/indexing-queue")
      .send({ url: "https://cribliv.com/en/city/noida" })
      .expect(201);

    expect(indexing.enqueue).toHaveBeenCalledWith(
      "https://cribliv.com/en/city/noida",
      "manual_admin_submit"
    );
  });

  it("rejects a missing url with 400", async () => {
    await request(app.getHttpServer()).post("/admin/seo/indexing-queue").send({}).expect(400);
    expect(indexing.enqueue).not.toHaveBeenCalled();
  });

  it("retries a failed row and writes an audited admin action", async () => {
    await request(app.getHttpServer())
      .post(`/admin/seo/indexing-queue/${QUEUE_ROW.id}/retry`)
      .expect(200)
      .expect({ data: QUEUE_ROW });

    expect(indexing.retry).toHaveBeenCalledWith(QUEUE_ROW.id);
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain("'retry_indexing_url'::admin_action_type");
    expect(params[1]).toBe(QUEUE_ROW.id);
  });

  it("returns 404 when retrying a row that does not exist", async () => {
    indexing.retry = vi.fn(async () => null);
    await request(app.getHttpServer())
      .post(`/admin/seo/indexing-queue/${QUEUE_ROW.id}/retry`)
      .expect(404);
    expect(database.query).not.toHaveBeenCalled();
  });

  it("returns coverage counts", async () => {
    await request(app.getHttpServer())
      .get("/admin/seo/coverage")
      .expect(200)
      .expect({ data: { indexed_count: 10, submitted_count: 4 } });
  });
});
