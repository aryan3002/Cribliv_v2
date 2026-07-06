import { describe, it, expect, vi } from "vitest";
import { BlogTopicPlannerService } from "../src/modules/blog/blog-topic-planner.service";
import { EVERGREEN_SEEDS } from "../src/modules/blog/evergreen-seeds";

function makePlanner(opts: {
  hasRankings: boolean;
  quickWins?: Array<{ keyword: string; page: string; position: number; impressions: number }>;
  localities?: Array<{ slug: string; name_en: string; listing_count: number }>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (/to_regclass/i.test(sql)) {
      return { rows: [{ present: opts.hasRankings }] };
    }
    if (/keyword_rankings/i.test(sql) && /position/i.test(sql)) {
      return { rows: opts.quickWins ?? [] };
    }
    return { rows: [] };
  });
  const database = { isEnabled: () => true, query } as never;
  const aggregates = {
    localitiesForCity: vi.fn(async () => opts.localities ?? [])
  } as never;
  const created: string[] = [];
  const briefs = {
    createBrief: vi.fn(async (brief: { target_keyword: string; source: string }) => {
      created.push(`${brief.source}:${brief.target_keyword}`);
      return { id: "x", ...brief };
    })
  } as never;
  return { planner: new BlogTopicPlannerService(database, aggregates, briefs), created, briefs };
}

describe("BlogTopicPlannerService", () => {
  it("exposes an evergreen tenancy seed list", () => {
    expect(EVERGREEN_SEEDS.length).toBeGreaterThanOrEqual(6);
    expect(EVERGREEN_SEEDS.map((seed) => seed.target_keyword)).toEqual(
      expect.arrayContaining([expect.stringMatching(/rent agreement/i)])
    );
  });

  it("seeds evergreen + data-trend briefs when GSC data is absent", async () => {
    const { planner, created } = makePlanner({
      hasRankings: false,
      localities: [
        { slug: "gomti-nagar", name_en: "Gomti Nagar", listing_count: 42 },
        { slug: "aliganj", name_en: "Aliganj", listing_count: 2 }
      ]
    });
    const res = await planner.planTopics({ citySlugs: ["lucknow"], maxBriefs: 50 });
    expect(res.created).toBeGreaterThan(0);
    expect(created.some((item) => item.startsWith("evergreen:"))).toBe(true);
    expect(
      created.some((item) => /data_trend:.*gomti-nagar|data_trend:.*Gomti Nagar/i.test(item))
    ).toBe(true);
    expect(created.some((item) => /aliganj/i.test(item))).toBe(false);
  });

  it("prioritizes GSC quick-wins when keyword_rankings exists", async () => {
    const { planner, created } = makePlanner({
      hasRankings: true,
      quickWins: [
        {
          keyword: "2bhk rent in indira nagar",
          page: "/en/city/lucknow/indira-nagar",
          position: 14,
          impressions: 900
        }
      ],
      localities: []
    });
    const res = await planner.planTopics({ citySlugs: ["lucknow"], maxBriefs: 50 });
    expect(res.bySource.gsc_quickwin).toBeGreaterThanOrEqual(1);
    expect(created.some((item) => item.startsWith("gsc_quickwin:"))).toBe(true);
  });

  it("caps at maxBriefs", async () => {
    const { planner, briefs } = makePlanner({ hasRankings: false, localities: [] });
    await planner.planTopics({ citySlugs: ["lucknow"], maxBriefs: 2 });
    expect(
      (briefs as unknown as { createBrief: ReturnType<typeof vi.fn> }).createBrief.mock.calls.length
    ).toBeLessThanOrEqual(2);
  });
});
