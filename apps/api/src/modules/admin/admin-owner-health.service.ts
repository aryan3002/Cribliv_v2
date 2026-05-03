import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { computeOwnerHealth, type OwnerHealthResult } from "./owner-health.calculator";

/* ──────────────────────────────────────────────────────────────────────
 * AdminOwnerHealthService
 *
 * One paginated read that returns every owner with all the inputs needed
 * for the health score, plus the score itself. Designed so the admin
 * Users tab can render a Health column without N additional round-trips.
 * ──────────────────────────────────────────────────────────────────── */

export interface OwnerHealthRow {
  owner_user_id: string;
  phone: string;
  name: string | null;
  listings_active: number;
  listings_paused: number;
  avg_response_minutes: number | null;
  unlocks_60d: number;
  deals_done_60d: number;
  last_login_at: string | null;
  days_since_last_login: number | null;
  report_count: number;
  score: number;
  grade: OwnerHealthResult["grade"];
  components: OwnerHealthResult["components"];
}

const ALLOWED_SORTS = new Set(["score_desc", "score_asc", "recent", "reports"]);

@Injectable()
export class AdminOwnerHealthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get enabled() {
    return readFeatureFlags().ff_admin_analytics_enabled && this.database.isEnabled();
  }

  async listOwners(opts: {
    limit?: number;
    offset?: number;
    sort?: string;
  }): Promise<{ items: OwnerHealthRow[]; total: number }> {
    if (!this.enabled) return { items: [], total: 0 };

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const sort = ALLOWED_SORTS.has(opts.sort ?? "") ? opts.sort! : "score_desc";

    // Pull the raw aggregates per owner. We compute the score in JS so the
    // weighting logic stays in one place and is easy to unit-test.
    const result = await this.database.query<{
      owner_user_id: string;
      phone: string;
      name: string | null;
      listings_active: number;
      listings_paused: number;
      avg_response_minutes: number | null;
      unlocks_60d: number;
      deals_done_60d: number;
      last_login_at: string | null;
      report_count: number;
    }>(
      `WITH owners AS (
         SELECT u.id, u.phone_e164, u.full_name, u.last_login_at
         FROM users u
         WHERE u.role IN ('owner', 'pg_operator')
       ),
       listing_agg AS (
         SELECT owner_user_id,
                count(*) FILTER (WHERE status = 'active')::int AS listings_active,
                count(*) FILTER (WHERE status = 'paused')::int AS listings_paused,
                COALESCE(sum(report_count)::int, 0) AS report_count
         FROM listings
         GROUP BY owner_user_id
       ),
       unlock_agg AS (
         SELECT l.owner_user_id,
                count(cu.id)::int AS unlocks_60d,
                AVG(EXTRACT(EPOCH FROM (cu.owner_responded_at - cu.created_at)) / 60.0)
                  FILTER (WHERE cu.owner_responded_at IS NOT NULL) AS avg_response_minutes
         FROM contact_unlocks cu
         JOIN listings l ON l.id = cu.listing_id
         WHERE cu.created_at >= now() - interval '60 days'
         GROUP BY l.owner_user_id
       ),
       deal_agg AS (
         SELECT owner_user_id,
                count(*) FILTER (WHERE status = 'deal_done')::int AS deals_done_60d
         FROM leads
         WHERE created_at >= now() - interval '60 days'
         GROUP BY owner_user_id
       )
       SELECT o.id::text AS owner_user_id,
              o.phone_e164 AS phone,
              o.full_name AS name,
              COALESCE(la.listings_active, 0) AS listings_active,
              COALESCE(la.listings_paused, 0) AS listings_paused,
              ua.avg_response_minutes,
              COALESCE(ua.unlocks_60d, 0) AS unlocks_60d,
              COALESCE(da.deals_done_60d, 0) AS deals_done_60d,
              o.last_login_at::text AS last_login_at,
              COALESCE(la.report_count, 0) AS report_count
       FROM owners o
       LEFT JOIN listing_agg la ON la.owner_user_id = o.id
       LEFT JOIN unlock_agg ua ON ua.owner_user_id = o.id
       LEFT JOIN deal_agg da ON da.owner_user_id = o.id
       ORDER BY o.last_login_at DESC NULLS LAST`
    );

    const allRows: OwnerHealthRow[] = result.rows.map((r) => {
      const days_since_last_login = r.last_login_at
        ? Math.floor((Date.now() - new Date(r.last_login_at).getTime()) / 86400000)
        : null;
      const health = computeOwnerHealth({
        listings_active: r.listings_active,
        listings_paused: r.listings_paused,
        avg_response_minutes: r.avg_response_minutes,
        unlocks_60d: r.unlocks_60d,
        deals_done_60d: r.deals_done_60d,
        days_since_last_login,
        report_count: r.report_count
      });
      return {
        ...r,
        avg_response_minutes:
          r.avg_response_minutes != null ? Math.round(r.avg_response_minutes) : null,
        days_since_last_login,
        score: health.score,
        grade: health.grade,
        components: health.components
      };
    });

    // Sort in JS since the score isn't a column.
    const sorted = [...allRows].sort((a, b) => {
      switch (sort) {
        case "score_asc":
          return a.score - b.score;
        case "recent":
          return (
            new Date(b.last_login_at ?? 0).getTime() - new Date(a.last_login_at ?? 0).getTime()
          );
        case "reports":
          return b.report_count - a.report_count;
        case "score_desc":
        default:
          return b.score - a.score;
      }
    });

    return {
      items: sorted.slice(offset, offset + limit),
      total: allRows.length
    };
  }
}
