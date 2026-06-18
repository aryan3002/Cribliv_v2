import { Inject, Injectable } from "@nestjs/common";
import { PgFunnelService, type PgFunnelAnalytics } from "../pg-operator/services/pg-funnel.service";
import { DatabaseService } from "../../common/database.service";
import type { PgAdminOverview } from "@cribliv/shared-types";

/**
 * Admin-facing PG listing-process analytics. Delegates the heavy aggregate to
 * PgFunnelService (which already folds in funnel + quality + voice + score
 * health per Plan 3 R6); this seam exists so future cross-module admin reads
 * have a home without bloating the operator-owned funnel service.
 */
@Injectable()
export class PgAdminAnalyticsService {
  constructor(
    @Inject(PgFunnelService) private readonly funnel: PgFunnelService,
    @Inject(DatabaseService) private readonly db: DatabaseService
  ) {}

  async getListingAnalytics(days: number): Promise<PgFunnelAnalytics> {
    const window = Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 30;
    return this.funnel.getAnalytics(window);
  }

  async getOverview(days: number): Promise<PgAdminOverview> {
    const window = Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 30;
    const empty: PgAdminOverview = {
      range_days: window,
      supply: {
        properties_by_status: { active: 0, paused: 0, archived: 0 },
        total_beds: 0,
        vacant_beds: 0,
        vacancy_rate: 0,
        avg_starting_rent_paise: null,
        gender_mix: { boys: 0, girls: 0, coed: 0 }
      },
      distribution: [],
      operators: { total: 0, without_live_listing: 0 },
      demand: { top_queries: [], zero_result_queries: [] }
    };
    if (!this.db.isEnabled()) return empty;
    const since = `${window} days`;

    const [supply, dist, ops, topQ, zeroQ] = await Promise.all([
      this.db
        .query<{
          active: number;
          paused: number;
          archived: number;
          total_beds: number;
          vacant_beds: number;
          avg_starting_rent_paise: number | null;
          boys: number;
          girls: number;
          coed: number;
        }>(
          `SELECT
           count(*) FILTER (WHERE pp.status = 'active')::int AS active,
           count(*) FILTER (WHERE pp.status = 'paused')::int AS paused,
           count(*) FILTER (WHERE pp.status = 'archived')::int AS archived,
           (SELECT count(*)::int FROM pg_beds b JOIN pg_rooms r ON r.id = b.room_id JOIN pg_properties p ON p.id = r.pg_property_id) AS total_beds,
           (SELECT count(*)::int FROM pg_beds b WHERE b.status = 'vacant') AS vacant_beds,
           (SELECT avg(starting_rent_paise) FROM pg_listings WHERE starting_rent_paise IS NOT NULL) AS avg_starting_rent_paise,
           (SELECT count(*)::int FROM pg_details WHERE gender_policy = 'boys') AS boys,
           (SELECT count(*)::int FROM pg_details WHERE gender_policy = 'girls') AS girls,
           (SELECT count(*)::int FROM pg_details WHERE gender_policy = 'coed') AS coed
         FROM pg_properties pp`
        )
        .then((r) => r.rows[0])
        .catch(() => null),
      this.db
        .query<{ city: string; locality: string | null; count: number }>(
          `SELECT c.slug AS city, loc.slug AS locality, count(*)::int AS count
           FROM pg_properties pp JOIN cities c ON c.id = pp.city_id
           LEFT JOIN localities loc ON loc.id = pp.locality_id
          GROUP BY c.slug, loc.slug ORDER BY count DESC LIMIT 50`
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{ total: number; without_live: number }>(
          `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE NOT EXISTS (
                  SELECT 1 FROM pg_listings pl WHERE pl.operator_user_id = u.id AND pl.status = 'active'))::int AS without_live
           FROM users u WHERE u.role = 'pg_operator'`
        )
        .then((r) => r.rows[0])
        .catch(() => null),
      this.db
        .query<{ query: string; count: number }>(
          `SELECT query, count(*)::int AS count FROM pg_search_events
          WHERE created_at >= now() - $1::interval AND query IS NOT NULL AND btrim(query) <> ''
          GROUP BY query ORDER BY count DESC LIMIT 10`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => []),
      this.db
        .query<{ query: string; count: number }>(
          `SELECT query, count(*)::int AS count FROM pg_search_events
          WHERE created_at >= now() - $1::interval AND result_count = 0 AND query IS NOT NULL AND btrim(query) <> ''
          GROUP BY query ORDER BY count DESC LIMIT 10`,
          [since]
        )
        .then((r) => r.rows)
        .catch(() => [])
    ]);

    const s = supply ?? {
      active: 0,
      paused: 0,
      archived: 0,
      total_beds: 0,
      vacant_beds: 0,
      avg_starting_rent_paise: null,
      boys: 0,
      girls: 0,
      coed: 0
    };
    const totalBeds = Number(s.total_beds) || 0;
    const vacant = Number(s.vacant_beds) || 0;
    return {
      range_days: window,
      supply: {
        properties_by_status: {
          active: Number(s.active) || 0,
          paused: Number(s.paused) || 0,
          archived: Number(s.archived) || 0
        },
        total_beds: totalBeds,
        vacant_beds: vacant,
        vacancy_rate: totalBeds > 0 ? Math.round((vacant / totalBeds) * 100) / 100 : 0,
        avg_starting_rent_paise:
          s.avg_starting_rent_paise != null ? Number(s.avg_starting_rent_paise) : null,
        gender_mix: {
          boys: Number(s.boys) || 0,
          girls: Number(s.girls) || 0,
          coed: Number(s.coed) || 0
        }
      },
      distribution: dist.map((d) => ({
        city: d.city,
        locality: d.locality,
        count: Number(d.count) || 0
      })),
      operators: {
        total: Number(ops?.total) || 0,
        without_live_listing: Number(ops?.without_live) || 0
      },
      demand: {
        top_queries: topQ.map((q) => ({ query: q.query, count: Number(q.count) || 0 })),
        zero_result_queries: zeroQ.map((q) => ({ query: q.query, count: Number(q.count) || 0 }))
      }
    };
  }
}
