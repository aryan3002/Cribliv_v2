import { Injectable, Logger, Optional } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { GoogleServiceAuth } from "./google/google-service-auth";

const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const ROW_LIMIT = 5000;
const MAX_PAGES = 5;
const LOOKBACK_DAYS = 28;
// Bound each page fetch so a hung socket can't stall the weekly poller mid-loop
// (the whole loop is wrapped in try/catch, so a timeout ends the poll safely).
const FETCH_TIMEOUT_MS = 10_000;
const CITY_HUB_PATTERN = /\/(en|hi)\/city\/([a-z0-9-]+)/;

interface GscQueryRow {
  keys: [string, string];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface KeywordRankingRow {
  keyword: string;
  page: string;
  locale: string;
  city_slug: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  captured_at: string;
}

function isoDateDaysAgo(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function deriveLocaleAndCity(page: string): { locale: string; city_slug: string | null } {
  const match = page.match(CITY_HUB_PATTERN);
  if (match) {
    return { locale: match[1], city_slug: match[2] };
  }
  return { locale: "en", city_slug: null };
}

@Injectable()
export class GscService {
  private readonly logger = new Logger(GscService.name);
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly database: DatabaseService,
    private readonly auth: GoogleServiceAuth,
    @Optional() fetchImpl?: typeof fetch
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  async pollAndUpsert(capturedAt?: string): Promise<{ rowsUpserted: number; pagesRead: number }> {
    if (!readFeatureFlags().ff_seo_gsc || !this.database.isEnabled()) {
      return { rowsUpserted: 0, pagesRead: 0 };
    }

    const endDate = capturedAt ?? new Date().toISOString().slice(0, 10);
    const startDate = isoDateDaysAgo(endDate, LOOKBACK_DAYS);
    const siteUrl = process.env.GSC_SITE_URL ?? "";
    let rowsUpserted = 0;
    let pagesRead = 0;

    try {
      const token = await this.auth.getAccessToken([READONLY_SCOPE]);

      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await this.fetchImpl(
          `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
            siteUrl
          )}/searchAnalytics/query`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              startDate,
              endDate,
              dimensions: ["query", "page"],
              rowLimit: ROW_LIMIT,
              startRow: page * ROW_LIMIT
            }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
          }
        );

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          this.logger.warn(`GSC searchanalytics.query failed (${response.status}): ${detail}`);
          break;
        }

        const body = (await response.json()) as { rows?: GscQueryRow[] };
        const rows = body.rows ?? [];
        if (rows.length === 0) {
          break;
        }

        pagesRead += 1;
        for (const row of rows) {
          const [keyword, gscPage] = row.keys;
          const { locale, city_slug } = deriveLocaleAndCity(gscPage);
          await this.database.query(
            `INSERT INTO keyword_rankings
               (keyword, page, locale, city_slug, position, impressions, clicks, ctr, captured_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (keyword, page, locale, captured_at) DO UPDATE SET
               city_slug = EXCLUDED.city_slug,
               position = EXCLUDED.position,
               impressions = EXCLUDED.impressions,
               clicks = EXCLUDED.clicks,
               ctr = EXCLUDED.ctr`,
            [
              keyword,
              gscPage,
              locale,
              city_slug,
              row.position,
              row.impressions,
              row.clicks,
              row.ctr,
              endDate
            ]
          );
          rowsUpserted += 1;
        }
      }
    } catch (err) {
      this.logger.warn(
        `gsc_poller aborting mid-run: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { rowsUpserted, pagesRead };
  }

  async fetchCoverage(): Promise<{
    indexed_count: number | null;
    submitted_count: number | null;
  }> {
    if (!this.database.isEnabled()) {
      return { indexed_count: null, submitted_count: null };
    }

    const [indexed, submitted] = await Promise.all([
      this.database.query<{ count: number }>(
        `SELECT count(DISTINCT page)::int AS count FROM keyword_rankings`,
        []
      ),
      this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM seo_indexing_queue WHERE status = 'submitted'`,
        []
      )
    ]);

    return {
      indexed_count: indexed.rows[0]?.count ?? 0,
      submitted_count: submitted.rows[0]?.count ?? 0
    };
  }
}
