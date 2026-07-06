import { describe, it, expect, vi } from "vitest";
import { BlogService } from "../src/modules/blog/blog.service";

function svc(query = vi.fn(), enabled = true) {
  const db = { isEnabled: () => enabled, query } as never;
  return { service: new BlogService(db), query };
}

const ROW = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "2bhk-rent-gomti-nagar",
  title: "2BHK rent in Gomti Nagar",
  meta_title: null,
  meta_description: null,
  excerpt: null,
  body_en: "...",
  body_hi: null,
  target_keyword: "2bhk rent gomti nagar",
  intent: null,
  city_slug: "lucknow",
  category_id: 1,
  category_slug: "data-reports",
  status: "draft",
  generated_by: "planner",
  quality_score: 0.9,
  quality_breakdown: { score: 0.9, passed: true, checks: [] },
  faq_items: [],
  hero_image_path: null,
  author: "Aditi Sharma",
  sources: [],
  data_asof: "2026-07-01",
  script: "en",
  is_pillar: false,
  brief_id: null,
  published_at: null,
  created_at: "t",
  updated_at: "t"
};

describe("BlogService (DB-only)", () => {
  it("returns empty published list without querying when DB disabled", async () => {
    const { service, query } = svc(vi.fn(), false);
    await expect(service.listPublished({})).resolves.toEqual({ items: [], total: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it("listPublished filters to status='published' and paginates", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ...ROW, status: "published" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const { service } = svc(query);
    const out = await service.listPublished({ page: 1, pageSize: 10, city: "lucknow" });
    const [listSql, listParams] = query.mock.calls[0];
    expect(listSql).toMatch(/status\s*=\s*'published'/i);
    expect(listSql).toMatch(/LIMIT/i);
    expect(listParams).toContain("lucknow");
    expect(out.total).toBe(1);
    expect(out.items[0].slug).toBe("2bhk-rent-gomti-nagar");
  });

  it("getPublishedBySlug only returns published rows", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ ...ROW, status: "published" }] });
    const { service } = svc(query);
    const row = await service.getPublishedBySlug("2bhk-rent-gomti-nagar");
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'published'/i);
    expect(row?.slug).toBe("2bhk-rent-gomti-nagar");
  });

  it("upsertDraft never writes status='published' and forwards draft/needs_attention", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [ROW] });
    const { service } = svc(query);
    await service.upsertDraft({
      slug: ROW.slug,
      title: ROW.title,
      generated_by: "planner",
      status: "draft",
      body_en: "...",
      quality_score: 0.9,
      quality_breakdown: { score: 0.9, passed: true, checks: [] }
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO blog_posts/i);
    expect(sql).toMatch(/ON CONFLICT \(slug\)/i);
    expect(params).toContain("draft");
    expect(params).not.toContain("published");
  });

  it("transition to published stamps published_at", async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [{ ...ROW, status: "published", published_at: "now" }]
    });
    const { service } = svc(query);
    const row = await service.transition(ROW.id, "published");
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'published'/i);
    expect(sql).toMatch(/published_at\s*=\s*now\(\)/i);
    expect(row?.status).toBe("published");
  });

  it("countByStatus returns the count", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ n: 4 }] });
    const { service } = svc(query);
    await expect(service.countByStatus("draft")).resolves.toBe(4);
  });
});
