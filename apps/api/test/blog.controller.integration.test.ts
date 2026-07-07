import "reflect-metadata";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { INestApplication, Module, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ApiKeyGuard } from "../src/common/api-key.guard";
import { BlogEmbeddingService } from "../src/modules/blog/blog-embedding.service";
import { BlogInternalController } from "../src/modules/blog/blog-internal.controller";
import { BlogController } from "../src/modules/blog/blog.controller";
import { BlogService } from "../src/modules/blog/blog.service";

const publishedRow = {
  id: "00000000-0000-0000-0000-000000000009",
  slug: "2bhk-rent-gomti-nagar",
  title: "2BHK rent in Gomti Nagar",
  meta_title: null,
  meta_description: null,
  excerpt: "x",
  body_en: "<p>hi</p>",
  body_hi: null,
  target_keyword: "2bhk rent gomti nagar",
  intent: null,
  city_slug: "lucknow",
  category_id: 1,
  category_slug: "data-reports",
  status: "published",
  generated_by: "planner",
  quality_score: 0.9,
  quality_breakdown: {},
  faq_items: [],
  hero_image_path: null,
  author: "Aditi Sharma",
  sources: [],
  data_asof: "2026-07-01",
  script: "en",
  is_pillar: false,
  brief_id: null,
  published_at: "2026-07-02",
  created_at: "t",
  updated_at: "t"
};

const fakeBlog = {
  listPublished: async () => ({
    items: [
      {
        slug: publishedRow.slug,
        title: publishedRow.title,
        excerpt: "x",
        category_slug: "data-reports",
        city_slug: "lucknow",
        hero_image_path: null,
        author: "Aditi Sharma",
        published_at: "2026-07-02",
        data_asof: "2026-07-01"
      }
    ],
    total: 1
  }),
  getPublishedBySlug: async (slug: string) => (slug === publishedRow.slug ? publishedRow : null),
  relatedPublished: async () => [],
  upsertDraft: async (input: Record<string, unknown>) => ({
    ...publishedRow,
    ...input,
    status: input.status
  }),
  updateEditable: async () => publishedRow,
  getById: async () => publishedRow
};
const fakeBlogEmbed = { findRelated: async () => [] };

@Module({
  controllers: [BlogController, BlogInternalController],
  providers: [
    ApiKeyGuard,
    { provide: BlogService, useValue: fakeBlog },
    { provide: BlogEmbeddingService, useValue: fakeBlogEmbed }
  ]
})
class TestBlogModule {}

describe("Blog controllers (integration)", () => {
  let app: INestApplication;
  const old = process.env.BLOG_WORKER_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestBlogModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    process.env.BLOG_WORKER_API_KEY = "worker-secret";
  });

  afterEach(() => {
    if (old === undefined) delete process.env.BLOG_WORKER_API_KEY;
    else process.env.BLOG_WORKER_API_KEY = old;
  });

  it("GET /blog returns the published list", async () => {
    const response = await request(app.getHttpServer()).get("/blog");
    expect(response.status).toBe(200);
    expect(response.body.data.items[0].slug).toBe("2bhk-rent-gomti-nagar");
    expect(response.body.data.total).toBe(1);
  });

  it("GET /blog/:slug returns the post and related items", async () => {
    const response = await request(app.getHttpServer()).get("/blog/2bhk-rent-gomti-nagar");
    expect(response.status).toBe(200);
    expect(response.body.data.post.slug).toBe("2bhk-rent-gomti-nagar");
    expect(Array.isArray(response.body.data.related)).toBe(true);
  });

  it("GET /blog/:slug returns null data for an unknown slug", async () => {
    const response = await request(app.getHttpServer()).get("/blog/nope");
    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it("POST /blog/drafts requires the worker API key", async () => {
    const noKey = await request(app.getHttpServer())
      .post("/blog/drafts")
      .send({ slug: "s", title: "t", generated_by: "planner", status: "draft" });
    expect(noKey.status).toBe(401);

    const ok = await request(app.getHttpServer())
      .post("/blog/drafts")
      .set("x-api-key", "worker-secret")
      .send({ slug: "s", title: "t", generated_by: "planner", status: "draft" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("draft");
  });

  it("POST /blog/drafts rejects status=published from the worker path", async () => {
    const response = await request(app.getHttpServer())
      .post("/blog/drafts")
      .set("x-api-key", "worker-secret")
      .send({ slug: "s", title: "t", generated_by: "planner", status: "published" });
    expect(response.status).toBe(400);
  });
});
