import { describe, expect, it, vi } from "vitest";
import {
  runBlogEmbedSweep,
  runBlogGenerator,
  runBlogTopicPlanner
} from "../src/worker/blog-worker";

function makePool(
  handlers: Array<[RegExp, (params?: unknown[]) => { rows: unknown[]; rowCount?: number }]>
) {
  const calls: string[] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push(text);
    for (const [regexp, fn] of handlers) {
      if (regexp.test(text)) return fn(params);
    }
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query }, calls, query };
}

describe("blog-worker orchestration", () => {
  it("runBlogTopicPlanner seeds briefs", async () => {
    const { pool } = makePool([
      [/to_regclass\('public\.keyword_rankings'\)/i, () => ({ rows: [{ present: false }] })],
      [/FROM localities/i, () => ({ rows: [] })],
      [/INSERT INTO blog_briefs/i, () => ({ rows: [{ id: "b1" }] })]
    ]);
    const result = await runBlogTopicPlanner(pool as never, ["lucknow"]);
    expect(result.created).toBeGreaterThan(0);
  });

  it("runBlogGenerator drafts a passing post and marks the brief done", async () => {
    let claimed = 0;
    const { pool, calls } = makePool([
      [
        /UPDATE blog_briefs b[\s\S]*SET status = 'generating'/i,
        () => {
          claimed += 1;
          return claimed === 1
            ? {
                rows: [
                  {
                    id: "b1",
                    target_keyword: "2bhk rent gomti nagar",
                    intent: null,
                    outline: [],
                    required_data: [],
                    internal_link_targets: [
                      { href: "/city/lucknow/gomti-nagar", label: "x" },
                      { href: "/rent-in/lucknow", label: "y" }
                    ],
                    source: "data_trend",
                    status: "generating",
                    city_slug: "lucknow",
                    category_slug: "data-reports",
                    post_type: "data_report",
                    notes: null,
                    created_at: "t",
                    updated_at: "t"
                  }
                ]
              }
            : { rows: [] };
        }
      ],
      [
        /FROM localities/i,
        () => ({ rows: [{ slug: "gomti-nagar", name_en: "Gomti Nagar", listing_count: 42 }] })
      ],
      [
        /percentile_cont|FROM listings l/i,
        () => ({
          rows: [
            {
              listing_count: 42,
              pg_count: 5,
              flat_count: 37,
              median_rent_pg: 7000,
              median_rent_1bhk: 11000,
              median_rent_2bhk: 18000,
              median_rent_3bhk: 26000
            }
          ]
        })
      ],
      [
        /INSERT INTO blog_posts/i,
        () => ({ rows: [{ id: "p1", slug: "2bhk-rent-gomti-nagar", status: "draft" }] })
      ],
      [/blog_embeddings/i, () => ({ rows: [] })],
      [/UPDATE blog_briefs SET status = 'done'/i, () => ({ rows: [] })]
    ]);

    const result = await runBlogGenerator(pool as never, 1, {
      callJson: (async (opts: { system: string }) => {
        if (/outline/i.test(opts.system)) return { sections: [{ heading: "Overview" }] };
        if (/section/i.test(opts.system)) {
          return {
            html:
              '<p>The median 2BHK rent in Gomti Nagar is 18000, the 1BHK median is 11000, and 42 active listings. <a href="/city/lucknow/gomti-nagar">flats</a> <a href="/rent-in/lucknow">rentals</a> <a href="/city/lucknow/metro/gomti-nagar">metro</a>. ' +
              "Gomti Nagar has parks, schools, office access, and frequent rental supply. ".repeat(
                220
              ) +
              "</p>"
          };
        }
        if (/fact/i.test(opts.system)) return { ok: true };
        if (/seo|readability/i.test(opts.system)) {
          return {
            title: "2BHK rent in Gomti Nagar - Cribliv",
            h1: "2BHK rent in Gomti Nagar",
            meta_title: "m",
            meta_description: "d",
            excerpt: "e",
            faq_items: [],
            body_hi: "<p>x</p>"
          };
        }
        return null;
      }) as never,
      embedForUniqueness: async () => null
    });

    expect(result.drafted).toBe(1);
    expect(result.needsAttention).toBe(0);
    expect(calls.some((call) => /UPDATE blog_briefs SET status = 'done'/i.test(call))).toBe(true);
    expect(calls.some((call) => /status = 'published'/i.test(call))).toBe(false);
  });

  it("runBlogEmbedSweep processes seo.embed_blog events and marks them dispatched", async () => {
    let drained = 0;
    const { pool, calls } = makePool([
      [
        /FROM outbound_events[\s\S]*seo\.embed_blog/i,
        () => {
          drained += 1;
          return drained === 1
            ? {
                rows: [{ id: 7, aggregate_id: "p1", payload: { blog_post_id: "p1" } }],
                rowCount: 1
              }
            : { rows: [], rowCount: 0 };
        }
      ],
      [
        /SELECT id::text, title, target_keyword, body_en, city_slug[\s\S]*FROM blog_posts/i,
        () => ({
          rows: [
            { id: "p1", title: "t", target_keyword: "k", body_en: "<p>b</p>", city_slug: "lucknow" }
          ]
        })
      ],
      [/INSERT INTO blog_embeddings/i, () => ({ rows: [] })],
      [/UPDATE outbound_events[\s\S]*dispatched/i, () => ({ rows: [] })]
    ]);
    const result = await runBlogEmbedSweep(pool as never, 10, {
      embedText: async () => ({ embedding: [0.1, 0.2], tokenCount: 3, model: "m" })
    });
    expect(result.embedded).toBe(1);
    expect(calls.some((call) => /UPDATE outbound_events[\s\S]*dispatched/i.test(call))).toBe(true);
  });
});
