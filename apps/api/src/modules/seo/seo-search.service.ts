import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { GscService } from "./gsc.service";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_DAILY_QUOTA = 200;

export interface SearchPerformanceParams {
  city_slug?: string;
  locale?: string;
  quick_wins?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchPerformanceRow {
  keyword: string;
  page: string;
  locale: string;
  city_slug: string | null;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  captured_at: string;
  is_target: boolean;
  is_ignored: boolean;
}

export interface SearchPerformanceResult {
  items: SearchPerformanceRow[];
  total: number;
  totals: { total_impressions: number; total_clicks: number; avg_position: number | null };
}

const ROW_COLUMNS = `keyword, page, locale, city_slug, position::float8 AS position, impressions, clicks, ctr::float8 AS ctr,
       captured_at::text AS captured_at, is_target, is_ignored`;

function csvField(value: unknown): string {
  const str = String(value ?? "");
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

@Injectable()
export class SeoSearchService {
  constructor(
    private readonly database: DatabaseService,
    private readonly gsc: GscService
  ) {}

  private buildFilteredQuery(params: SearchPerformanceParams): { sql: string; args: unknown[] } {
    const conditions: string[] = [];
    const args: unknown[] = [];

    if (params.city_slug) {
      args.push(params.city_slug);
      conditions.push(`city_slug = $${args.length}`);
    }
    if (params.locale) {
      args.push(params.locale);
      conditions.push(`locale = $${args.length}`);
    }
    if (params.quick_wins) {
      conditions.push("position BETWEEN 11 AND 30");
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderClause = params.quick_wins
      ? "ORDER BY impressions DESC"
      : "ORDER BY captured_at DESC, impressions DESC";

    const sql = `
        SELECT ${ROW_COLUMNS} FROM (
          SELECT DISTINCT ON (keyword, page, locale) ${ROW_COLUMNS}
          FROM keyword_rankings
          ORDER BY keyword, page, locale, captured_at DESC
        ) latest
        ${whereClause}
        ${orderClause}
      `;

    return { sql, args };
  }

  async getSearchPerformance(params: SearchPerformanceParams): Promise<SearchPerformanceResult> {
    if (!this.database.isEnabled()) {
      return {
        items: [],
        total: 0,
        totals: { total_impressions: 0, total_clicks: 0, avg_position: null }
      };
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
    const offset = Math.max(0, params.offset ?? 0);
    const { sql, args } = this.buildFilteredQuery(params);

    const pagedArgs = [...args, limit, offset];
    const limitIdx = args.length + 1;
    const offsetIdx = args.length + 2;

    const { rows } = await this.database.query<SearchPerformanceRow>(
      `${sql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      pagedArgs
    );

    const { rows: countRows } = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM (${sql}) counted`,
      args
    );

    const { rows: totalsRows } = await this.database.query<{
      total_impressions: number;
      total_clicks: number;
      avg_position: number | null;
    }>(
      `SELECT
           COALESCE(sum(impressions), 0)::int AS total_impressions,
           COALESCE(sum(clicks), 0)::int AS total_clicks,
           avg(position)::float8 AS avg_position
         FROM (${sql}) totalled`,
      args
    );

    return {
      items: rows,
      total: countRows[0]?.count ?? 0,
      totals: totalsRows[0] ?? { total_impressions: 0, total_clicks: 0, avg_position: null }
    };
  }

  async exportSearchPerformanceCsv(params: SearchPerformanceParams): Promise<string> {
    const header = "keyword,page,locale,city_slug,position,impressions,clicks,ctr,captured_at\n";
    if (!this.database.isEnabled()) {
      return header;
    }

    const { sql, args } = this.buildFilteredQuery(params);
    const { rows } = await this.database.query<SearchPerformanceRow>(sql, args);

    const lines = rows.map((row) =>
      [
        row.keyword,
        row.page,
        row.locale,
        row.city_slug ?? "",
        row.position,
        row.impressions,
        row.clicks,
        row.ctr,
        row.captured_at
      ]
        .map(csvField)
        .join(",")
    );

    return header + lines.join("\n") + (lines.length ? "\n" : "");
  }

  async getCoverage(): Promise<{ indexed_count: number | null; submitted_count: number | null }> {
    return this.gsc.fetchCoverage();
  }

  async getIndexingQueueSummary(): Promise<{
    counts_by_status: Record<string, number>;
    submitted_today: number;
    daily_quota: number;
  }> {
    const dailyQuota = Number(process.env.GOOGLE_INDEXING_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA;

    if (!this.database.isEnabled()) {
      return { counts_by_status: {}, submitted_today: 0, daily_quota: dailyQuota };
    }

    const { rows: statusRows } = await this.database.query<{ status: string; count: number }>(
      "SELECT status, count(*)::int AS count FROM seo_indexing_queue GROUP BY status",
      []
    );
    const countsByStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));

    const { rows: todayRows } = await this.database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM seo_indexing_queue
         WHERE status = 'submitted' AND submitted_at >= date_trunc('day', now())`,
      []
    );

    return {
      counts_by_status: countsByStatus,
      submitted_today: todayRows[0]?.count ?? 0,
      daily_quota: dailyQuota
    };
  }
}
