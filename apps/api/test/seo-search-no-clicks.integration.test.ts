import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import type { DatabaseService } from "../src/common/database.service";
import type { GscService } from "../src/modules/seo/gsc.service";
import { SeoSearchService } from "../src/modules/seo/seo-search.service";

const TEST_DB = process.env.TEST_DATABASE_URL;
const TAG = "noclickstest";

/**
 * The `no_clicks` filter answers the question the admin could not previously
 * ask: which pages already rank on page one and still get ignored? That is a
 * title/description problem, not a ranking problem, and it is a different set
 * from `quick_wins` (position 11-30, a ranking problem).
 */
describe.runIf(!!TEST_DB)("SeoSearchService no_clicks filter (DB)", () => {
  let pool: Pool;
  let service: SeoSearchService;

  async function seed(row: {
    keyword: string;
    position: number;
    impressions: number;
    clicks: number;
  }) {
    await pool.query(
      `INSERT INTO keyword_rankings (keyword, page, locale, position, impressions, clicks, ctr, captured_at)
       VALUES ($1, $2, 'en', $3, $4, $5, $6, current_date)`,
      [
        row.keyword,
        `/en/${TAG}/${row.keyword.replace(/\s+/g, "-")}`,
        row.position,
        row.impressions,
        row.clicks,
        row.impressions > 0 ? row.clicks / row.impressions : 0
      ]
    );
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB });
    await pool.query(`DELETE FROM keyword_rankings WHERE keyword LIKE $1`, [`${TAG}%`]);

    // Ranks on page 1, nobody clicks — exactly what we want surfaced.
    await seed({ keyword: `${TAG} ignored winner`, position: 8.5, impressions: 159, clicks: 0 });
    // Page 1 and already earning clicks — nothing to fix here.
    await seed({ keyword: `${TAG} already working`, position: 8.5, impressions: 100, clicks: 5 });
    // Zero clicks but stuck on page 3 — that is a ranking problem, not a title one.
    await seed({ keyword: `${TAG} page three`, position: 25, impressions: 200, clicks: 0 });
    // Page 1, zero clicks, but too few impressions to conclude anything.
    await seed({ keyword: `${TAG} too quiet`, position: 3, impressions: 2, clicks: 0 });

    const database = {
      isEnabled: () => true,
      query: (sql: string, args: unknown[]) => pool.query(sql, args)
    } as unknown as DatabaseService;
    service = new SeoSearchService(database, {} as GscService);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM keyword_rankings WHERE keyword LIKE $1`, [`${TAG}%`]);
    await pool.end();
  });

  it("returns page-one keywords that earn impressions but no clicks", async () => {
    const result = await service.getSearchPerformance({ no_clicks: true, limit: 500 });
    const keywords = result.items.map((row) => row.keyword).filter((k) => k.startsWith(TAG));

    expect(keywords).toEqual([`${TAG} ignored winner`]);
  });

  it("orders the worklist by impressions so the biggest waste is first", async () => {
    await seed({ keyword: `${TAG} bigger waste`, position: 6, impressions: 500, clicks: 0 });

    const result = await service.getSearchPerformance({ no_clicks: true, limit: 500 });
    const keywords = result.items.map((row) => row.keyword).filter((k) => k.startsWith(TAG));

    expect(keywords).toEqual([`${TAG} bigger waste`, `${TAG} ignored winner`]);
  });

  it("does not change the unfiltered view", async () => {
    const result = await service.getSearchPerformance({ limit: 500 });
    const keywords = result.items.map((row) => row.keyword).filter((k) => k.startsWith(TAG));

    expect(keywords.length).toBeGreaterThanOrEqual(4);
  });
});
