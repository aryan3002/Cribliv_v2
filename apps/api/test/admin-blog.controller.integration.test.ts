import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication, Module } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { DatabaseService } from "../src/common/database.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";
import { AdminBlogController } from "../src/modules/blog/admin-blog.controller";
import { BlogBriefService } from "../src/modules/blog/blog-brief.service";
import { BlogGeneratorService } from "../src/modules/blog/blog-generator.service";
import { BlogTopicPlannerService } from "../src/modules/blog/blog-topic-planner.service";
import { BlogService } from "../src/modules/blog/blog.service";

const post = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-0000-0000-00000000000a",
  slug: "s",
  title: "t",
  status: "in_review",
  quality_breakdown: { score: 1, passed: true, checks: [] },
  city_slug: "lucknow",
  ...overrides
});

const adminGuard = {
  canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
    ctx.switchToHttp().getRequest().user = {
      id: "11111111-1111-1111-1111-111111111111",
      role: "admin"
    };
    return true;
  }
};

const sqls: string[] = [];
const fakeDb = {
  isEnabled: () => true,
  query: async (sql: string) => {
    sqls.push(sql);
    return { rows: [] };
  }
};

let lastTransition: { id: string; to: string } | null = null;
const fakeBlog = {
  listForAdmin: async () => [post()],
  getById: async (id: string) => post({ id }),
  transition: async (id: string, to: string) => {
    lastTransition = { id, to };
    return post({ id, status: to, published_at: to === "published" ? "now" : null });
  },
  updateEditable: async (id: string) => post({ id, title: "edited" }),
  upsertDraft: async (input: Record<string, unknown>) => post({ ...input, status: input.status })
};

const fakeGen = {
  generate: async () => ({
    slug: "2bhk-rent-gomti-nagar",
    title: "2BHK rent in Gomti Nagar",
    h1: "H",
    metaTitle: "m",
    metaDescription: "d",
    excerpt: "e",
    bodyEn: "<h1>H</h1><p>x</p>",
    bodyHi: "<p>x</p>",
    targetKeyword: "2bhk rent gomti nagar",
    intent: null,
    citySlug: "lucknow",
    categorySlug: "data-reports",
    faqItems: [],
    sources: [],
    dataAsof: "2026-07-01",
    dataFacts: [],
    citedDataPointCount: 3,
    isDataPost: true,
    quality: { score: 1, passed: true, checks: [] }
  })
};

const fakeBriefs = {
  createBrief: async (brief: Record<string, unknown>) => ({
    id: "b1",
    ...brief,
    post_type: "data_report"
  }),
  getById: async () => null,
  markDone: async () => undefined
};

const fakePlanner = {
  planTopics: async () => ({
    created: 3,
    bySource: { gsc_quickwin: 0, gap: 0, data_trend: 2, evergreen: 1, manual: 0 }
  })
};

@Module({
  controllers: [AdminBlogController],
  providers: [
    { provide: BlogService, useValue: fakeBlog },
    { provide: BlogGeneratorService, useValue: fakeGen },
    { provide: BlogBriefService, useValue: fakeBriefs },
    { provide: BlogTopicPlannerService, useValue: fakePlanner },
    { provide: DatabaseService, useValue: fakeDb }
  ]
})
class TestAdminBlogModule {}

describe("AdminBlogController (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAdminBlogModule] })
      .overrideGuard(AuthGuard)
      .useValue(adminGuard)
      .overrideGuard(RolesGuard)
      .useValue(adminGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /admin/blog lists all statuses with quality breakdown", async () => {
    const response = await request(app.getHttpServer()).get("/admin/blog?status=in_review");
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].quality_breakdown.passed).toBe(true);
  });

  it("approve transitions to in_review and audits", async () => {
    sqls.length = 0;
    const response = await request(app.getHttpServer())
      .post("/admin/blog/00000000-0000-0000-0000-00000000000a/approve")
      .send({});
    expect(response.status).toBe(201);
    expect(lastTransition).toEqual({
      id: "00000000-0000-0000-0000-00000000000a",
      to: "in_review"
    });
    expect(sqls.some((sql) => /INSERT INTO admin_actions/i.test(sql))).toBe(true);
  });

  it("publish stamps published, enqueues embed and indexing, and audits", async () => {
    sqls.length = 0;
    const response = await request(app.getHttpServer())
      .post("/admin/blog/00000000-0000-0000-0000-00000000000a/publish")
      .send({});
    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe("published");
    expect(
      sqls.some(
        (sql) => /INSERT INTO outbound_events/i.test(sql) && /seo\.embed_blog|blog_post/i.test(sql)
      )
    ).toBe(true);
    expect(sqls.some((sql) => /seo_indexing_queue/i.test(sql))).toBe(true);
    expect(sqls.some((sql) => /INSERT INTO admin_actions/i.test(sql))).toBe(true);
  });

  it("generate-now produces a draft and audits without publishing", async () => {
    sqls.length = 0;
    const response = await request(app.getHttpServer()).post("/admin/blog/generate-now").send({
      target_keyword: "2bhk rent gomti nagar",
      city_slug: "lucknow",
      category_slug: "data-reports"
    });
    expect(response.status).toBe(201);
    expect(["draft", "needs_attention"]).toContain(response.body.data.status);
    expect(sqls.some((sql) => /INSERT INTO admin_actions/i.test(sql))).toBe(true);
  });

  it("plan runs the topic planner and audits", async () => {
    sqls.length = 0;
    const response = await request(app.getHttpServer())
      .post("/admin/blog/plan")
      .send({ city_slugs: ["lucknow"] });
    expect(response.status).toBe(201);
    expect(response.body.data.created).toBe(3);
    expect(sqls.some((sql) => /INSERT INTO admin_actions/i.test(sql))).toBe(true);
  });
});
