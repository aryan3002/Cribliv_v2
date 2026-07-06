import { describe, expect, it, vi } from "vitest";
import { BlogEmbeddingService } from "../src/modules/blog/blog-embedding.service";

function make(opts: {
  enabled?: boolean;
  embed?: { embedding: number[]; tokenCount: number; model: string } | null;
  postRow?: Record<string, unknown> | null;
  nearestDistance?: number | null;
  related?: Array<{ blog_post_id: string; slug: string; title: string; distance: number }>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (/FROM blog_posts/i.test(sql) && /SELECT/i.test(sql) && /id\s*=/.test(sql)) {
      return { rows: opts.postRow ? [opts.postRow] : [] };
    }
    if (/INSERT INTO blog_embeddings/i.test(sql)) return { rows: [] };
    if (/1 - \(|<=>/.test(sql) && /LIMIT 1/i.test(sql)) {
      return { rows: opts.nearestDistance == null ? [] : [{ distance: opts.nearestDistance }] };
    }
    if (/<=>/.test(sql)) {
      return { rows: opts.related ?? [] };
    }
    return { rows: [] };
  });
  const database = { isEnabled: () => opts.enabled ?? true, query } as never;
  const embedding = {
    embedText: vi.fn(async () =>
      opts.embed === undefined ? { embedding: [0.1, 0.2], tokenCount: 3, model: "m" } : opts.embed
    )
  } as never;
  return { service: new BlogEmbeddingService(database, embedding), query, embedding };
}

describe("BlogEmbeddingService", () => {
  it("embedPost embeds the post document and upserts into blog_embeddings", async () => {
    const { service, query, embedding } = make({
      postRow: {
        id: "p1",
        title: "2BHK rent in Gomti Nagar",
        target_keyword: "2bhk rent gomti nagar",
        body_en: "<p>18000 rent</p>",
        city_slug: "lucknow"
      }
    });
    const ok = await service.embedPost("p1");
    expect(ok).toBe(true);
    expect(
      (embedding as unknown as { embedText: ReturnType<typeof vi.fn> }).embedText
    ).toHaveBeenCalled();
    expect(query.mock.calls.some((c) => /INSERT INTO blog_embeddings/i.test(c[0]))).toBe(true);
  });

  it("embedPost returns false when embeddings are unconfigured (null)", async () => {
    const { service } = make({
      embed: null,
      postRow: { id: "p1", title: "t", target_keyword: "k", body_en: "b", city_slug: null }
    });
    await expect(service.embedPost("p1")).resolves.toBe(false);
  });

  it("uniquenessDistance returns null for an empty corpus", async () => {
    const { service } = make({ nearestDistance: null });
    await expect(service.uniquenessDistance([0.1, 0.2])).resolves.toBeNull();
  });

  it("uniquenessDistance returns the nearest cosine distance", async () => {
    const { service } = make({ nearestDistance: 0.31 });
    await expect(service.uniquenessDistance([0.1, 0.2])).resolves.toBeCloseTo(0.31);
  });

  it("findRelated returns nearest other posts", async () => {
    const { service } = make({
      related: [{ blog_post_id: "p2", slug: "s2", title: "t2", distance: 0.2 }]
    });
    const rel = await service.findRelated("p1", 3);
    expect(rel[0].slug).toBe("s2");
  });
});
