import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import type { TrendPoint, PgSearchInsights } from "@cribliv/shared-types";

export interface SearchAppearanceRow {
  listing_id: string;
  appearances: number;
  clicks: number;
}
export interface FunnelTimeseriesRow {
  listing_id: string;
  series: TrendPoint[];
}

/**
 * PG-owned analytics. Writes search-scoped events to pg_search_events and reads
 * per-listing funnel aggregates for the operator dashboard. Mirrors
 * AnalyticsService: never throws to callers (writes swallow, reads return []).
 */
@Injectable()
export class PgAnalyticsService {
  private readonly logger = new Logger(PgAnalyticsService.name);

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async trackSearch(params: {
    session_id: string;
    user_id?: string;
    query?: string;
    city?: string;
    filters?: Record<string, unknown>;
    result_count?: number;
    shown_listing_ids?: string[];
    clicked_listing_id?: string;
    clicked_position?: number;
    surface?: string;
    ip?: string;
    user_agent?: string;
  }): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      await this.db.query(
        `INSERT INTO pg_search_events
           (session_id, user_id, query, city, filters, result_count,
            shown_listing_ids, clicked_listing_id, clicked_position, surface, ip, user_agent)
         VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6,
                 $7::jsonb, $8::uuid, $9, $10, $11::inet, $12)`,
        [
          params.session_id,
          params.user_id ?? null,
          params.query ?? null,
          params.city ?? null,
          JSON.stringify(params.filters ?? {}),
          params.result_count ?? 0,
          JSON.stringify(params.shown_listing_ids ?? []),
          params.clicked_listing_id ?? null,
          params.clicked_position ?? null,
          params.surface ?? "pg_search",
          params.ip ?? null,
          params.user_agent ?? null
        ]
      );
    } catch (error) {
      this.logger.warn("Failed to track pg search event", error);
    }
  }

  async getSearchAppearances(listingIds: string[], since: Date): Promise<SearchAppearanceRow[]> {
    if (!listingIds.length || !this.db.isEnabled()) return [];
    try {
      const r = await this.db.query<SearchAppearanceRow>(
        `SELECT ids.id AS listing_id,
                (SELECT count(*)::int FROM pg_search_events e,
                        jsonb_array_elements_text(e.shown_listing_ids) AS x(v)
                  WHERE x.v = ids.id AND e.created_at >= $2) AS appearances,
                (SELECT count(*)::int FROM pg_search_events e
                  WHERE e.clicked_listing_id::text = ids.id AND e.created_at >= $2) AS clicks
         FROM unnest($1::text[]) AS ids(id)`,
        [listingIds, since]
      );
      return r.rows.map((x) => ({
        listing_id: x.listing_id,
        appearances: Number(x.appearances) || 0,
        clicks: Number(x.clicks) || 0
      }));
    } catch (error) {
      this.logger.warn("Failed to read pg search appearances", error);
      return [];
    }
  }

  async getFunnelTimeseries(listingIds: string[], days: number): Promise<FunnelTimeseriesRow[]> {
    if (!listingIds.length || !this.db.isEnabled()) return [];
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    try {
      const r = await this.db.query<{
        listing_id: string;
        day: string;
        appearances: number;
        clicks: number;
        views: number;
        leads: number;
      }>(
        `WITH appr AS (
            SELECT x.v AS listing_id, date_trunc('day', e.created_at)::date::text AS day, count(*)::int AS n
            FROM pg_search_events e, jsonb_array_elements_text(e.shown_listing_ids) AS x(v)
            WHERE x.v = ANY($1::text[]) AND e.created_at >= $2 GROUP BY 1, 2),
          clk AS (
            SELECT e.clicked_listing_id::text AS listing_id, date_trunc('day', e.created_at)::date::text AS day, count(*)::int AS n
            FROM pg_search_events e
            WHERE e.clicked_listing_id::text = ANY($1::text[]) AND e.created_at >= $2 GROUP BY 1, 2),
          vw AS (
            SELECT le.listing_id::text AS listing_id, date_trunc('day', le.created_at)::date::text AS day, count(*)::int AS n
            FROM listing_events le
            WHERE le.event_type = 'view' AND le.listing_id::text = ANY($1::text[]) AND le.created_at >= $2 GROUP BY 1, 2),
          ld AS (
            SELECT l.listing_id::text AS listing_id, date_trunc('day', l.created_at)::date::text AS day, count(*)::int AS n
            FROM leads l
            WHERE l.listing_id::text = ANY($1::text[]) AND l.created_at >= $2 GROUP BY 1, 2),
          keys AS (
            SELECT listing_id, day FROM appr
            UNION SELECT listing_id, day FROM clk
            UNION SELECT listing_id, day FROM vw
            UNION SELECT listing_id, day FROM ld)
        SELECT k.listing_id, k.day,
               COALESCE(appr.n, 0) AS appearances,
               COALESCE(clk.n, 0)  AS clicks,
               COALESCE(vw.n, 0)   AS views,
               COALESCE(ld.n, 0)   AS leads
        FROM keys k
        LEFT JOIN appr USING (listing_id, day)
        LEFT JOIN clk  USING (listing_id, day)
        LEFT JOIN vw   USING (listing_id, day)
        LEFT JOIN ld   USING (listing_id, day)`,
        [listingIds, since]
      );
      return this.zeroFill(listingIds, days, r.rows);
    } catch (error) {
      this.logger.warn("Failed to read pg funnel timeseries", error);
      return [];
    }
  }

  /**
   * Demand insights for the operator's cities: most-run queries, most-applied
   * filters, and zero-result queries (unmet demand). Read-side, never throws.
   */
  async getSearchInsights(cities: string[], since: Date): Promise<PgSearchInsights> {
    const empty: PgSearchInsights = { top_queries: [], top_filters: [], zero_result_queries: [] };
    if (!cities.length || !this.db.isEnabled()) return empty;
    try {
      const [queries, filters, zero] = await Promise.all([
        this.db.query<{ query: string; count: number }>(
          `SELECT query, count(*)::int AS count
             FROM pg_search_events
            WHERE city = ANY($1::text[]) AND created_at >= $2
              AND query IS NOT NULL AND btrim(query) <> ''
            GROUP BY query ORDER BY count DESC, query ASC LIMIT 10`,
          [cities, since]
        ),
        this.db.query<{ key: string; value: string; count: number }>(
          `SELECT f.key AS key, f.value AS value, count(*)::int AS count
             FROM pg_search_events e, jsonb_each_text(e.filters) AS f(key, value)
            WHERE e.city = ANY($1::text[]) AND e.created_at >= $2
            GROUP BY f.key, f.value ORDER BY count DESC, f.key ASC LIMIT 10`,
          [cities, since]
        ),
        this.db.query<{ query: string; count: number }>(
          `SELECT query, count(*)::int AS count
             FROM pg_search_events
            WHERE city = ANY($1::text[]) AND created_at >= $2 AND result_count = 0
              AND query IS NOT NULL AND btrim(query) <> ''
            GROUP BY query ORDER BY count DESC, query ASC LIMIT 10`,
          [cities, since]
        )
      ]);
      return {
        top_queries: queries.rows.map((r) => ({ query: r.query, count: Number(r.count) || 0 })),
        top_filters: filters.rows.map((r) => ({
          key: r.key,
          value: r.value,
          count: Number(r.count) || 0
        })),
        zero_result_queries: zero.rows.map((r) => ({ query: r.query, count: Number(r.count) || 0 }))
      };
    } catch (error) {
      this.logger.warn("Failed to read pg search insights", error);
      return empty;
    }
  }

  /** Build a dense `days`-length series per listing, oldest→newest, gaps = 0. */
  private zeroFill(
    listingIds: string[],
    days: number,
    rows: Array<{
      listing_id: string;
      day: string;
      appearances: number;
      clicks: number;
      views: number;
      leads: number;
    }>
  ): FunnelTimeseriesRow[] {
    const byKey = new Map(rows.map((x) => [`${x.listing_id}|${x.day}`, x]));
    const dayKeys: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      dayKeys.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    }
    return listingIds.map((listing_id) => ({
      listing_id,
      series: dayKeys.map((day) => {
        const hit = byKey.get(`${listing_id}|${day}`);
        return {
          day,
          appearances: Number(hit?.appearances) || 0,
          clicks: Number(hit?.clicks) || 0,
          views: Number(hit?.views) || 0,
          leads: Number(hit?.leads) || 0
        };
      })
    }));
  }
}
