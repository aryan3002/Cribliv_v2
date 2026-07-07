import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { SeoAggregatesService } from "../seo/seo-aggregates.service";
import { BlogBriefService } from "./blog-brief.service";
import { EVERGREEN_SEEDS } from "./evergreen-seeds";
import type { BriefSource } from "./blog.types";

// A locality needs at least this many active listings before a "rent trends"
// data report is credible — a median over 2-3 listings is noise, not a report.
const DATA_TREND_MIN_LISTINGS = 5;

@Injectable()
export class BlogTopicPlannerService {
  private readonly logger = new Logger(BlogTopicPlannerService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly aggregates: SeoAggregatesService,
    private readonly briefs: BlogBriefService
  ) {}

  // Cities the operator has switched on for programmatic SEO (slice 1). The
  // planner targets these by default so it never plans for a city with no data.
  private async enabledCities(): Promise<string[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<{ city_slug: string }>(
        `SELECT city_slug FROM seo_city_config
         WHERE programmatic_enabled = true
         ORDER BY city_slug`
      );
      return rows.map((r) => r.city_slug);
    } catch {
      return [];
    }
  }

  // Keywords already covered by a live or in-flight post. Used to dedup so
  // repeated planning never re-proposes a topic that already has a post
  // (archived posts are excluded — those slots are open again).
  private async coveredKeywords(): Promise<Set<string>> {
    if (!this.database.isEnabled()) return new Set();
    try {
      const { rows } = await this.database.query<{ kw: string }>(
        `SELECT DISTINCT lower(target_keyword) AS kw
         FROM blog_posts
         WHERE status <> 'archived' AND target_keyword IS NOT NULL`
      );
      return new Set(rows.map((r) => r.kw));
    } catch {
      return new Set();
    }
  }

  private async rankingsTableExists(): Promise<boolean> {
    if (!this.database.isEnabled()) return false;
    try {
      const { rows } = await this.database.query<{ present: boolean }>(
        `SELECT to_regclass('public.keyword_rankings') IS NOT NULL AS present`
      );
      return Boolean(rows[0]?.present);
    } catch {
      return false;
    }
  }

  async planTopics(
    opts: { citySlugs?: string[]; maxBriefs?: number } = {}
  ): Promise<{ created: number; bySource: Record<BriefSource, number> }> {
    const requested = opts.citySlugs?.filter(Boolean) ?? [];
    const cities = requested.length ? requested : (await this.enabledCities()) || [];
    const effectiveCities = cities.length ? cities : ["noida"];
    const cap = opts.maxBriefs ?? 25;
    const bySource: Record<BriefSource, number> = {
      gsc_quickwin: 0,
      gap: 0,
      data_trend: 0,
      evergreen: 0,
      manual: 0
    };
    let created = 0;
    const covered = await this.coveredKeywords();

    const tryCreate = async (input: Parameters<BlogBriefService["createBrief"]>[0]) => {
      if (created >= cap) return;
      const key = input.target_keyword.trim().toLowerCase();
      if (covered.has(key)) return; // already has a post — don't re-propose
      const row = await this.briefs.createBrief(input);
      if (row) {
        created++;
        bySource[input.source]++;
        covered.add(key); // guard against dup candidates within this same run
      }
    };

    const hasRankings = await this.rankingsTableExists();

    if (hasRankings && created < cap) {
      try {
        const { rows } = await this.database.query<{
          keyword: string;
          page: string;
          position: number;
          impressions: number;
        }>(
          `SELECT keyword, page, position::float8 AS position, impressions
           FROM keyword_rankings
           WHERE position BETWEEN 11 AND 30
             AND captured_at = (SELECT MAX(captured_at) FROM keyword_rankings)
           ORDER BY impressions DESC
           LIMIT 20`
        );

        for (const row of rows) {
          const citySlug = effectiveCities.find((city) => row.page.includes(`/${city}`)) ?? null;
          await tryCreate({
            target_keyword: row.keyword,
            intent: "informational",
            source: "gsc_quickwin",
            city_slug: citySlug,
            category_slug: "market-updates",
            post_type: "query_targeted",
            notes: `quick-win pos ${row.position}, ${row.impressions} impressions, page ${row.page}`
          });
        }
      } catch (err) {
        this.logger.debug(`quick-win read failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (hasRankings && created < cap) {
      try {
        const { rows } = await this.database.query<{ keyword: string; impressions: number }>(
          `SELECT kr.keyword, MAX(kr.impressions) AS impressions
           FROM keyword_rankings kr
           LEFT JOIN blog_posts p
             ON p.status = 'published' AND lower(p.target_keyword) = lower(kr.keyword)
           WHERE p.id IS NULL AND kr.impressions > 50
           GROUP BY kr.keyword
           ORDER BY impressions DESC
           LIMIT 15`
        );

        for (const row of rows) {
          await tryCreate({
            target_keyword: row.keyword,
            source: "gap",
            category_slug: "market-updates",
            post_type: "query_targeted",
            notes: `content gap, ${row.impressions} impressions`
          });
        }
      } catch (err) {
        this.logger.debug(`gap read failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    for (const city of effectiveCities) {
      if (created >= cap) break;
      const localities = await this.aggregates.localitiesForCity(city);
      for (const locality of localities) {
        if (created >= cap) break;
        if ((locality.listing_count ?? 0) < DATA_TREND_MIN_LISTINGS) continue;

        await tryCreate({
          target_keyword: `rent trends in ${locality.name_en}`,
          intent: "informational",
          source: "data_trend",
          city_slug: city,
          category_slug: "data-reports",
          post_type: "data_report",
          internal_link_targets: [
            { href: `/city/${city}/${locality.slug}`, label: `Rentals in ${locality.name_en}` },
            { href: `/rent-in/${city}`, label: `Rentals in ${city}` }
          ],
          required_data: [
            { key: "median_rent_2bhk", label: "Median 2BHK rent", value: 0 },
            { key: "median_rent_1bhk", label: "Median 1BHK rent", value: 0 },
            { key: "listing_count", label: "Active listings", value: 0 }
          ]
        });
      }
    }

    for (const seed of EVERGREEN_SEEDS) {
      if (created >= cap) break;
      await tryCreate({
        target_keyword: seed.target_keyword,
        intent: seed.intent,
        source: "evergreen",
        category_slug: seed.category_slug,
        post_type: seed.post_type,
        outline: seed.outline
      });
    }

    return { created, bySource };
  }
}
