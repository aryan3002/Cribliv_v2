import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

/* ──────────────────────────────────────────────────────────────────────
 * AdminRevenueService — drives the Revenue Attribution tab.
 *
 * Two queries:
 *   - attribution: pivot revenue across day/city/listing_type
 *   - cohorts: monthly cohorts of owner sign-ups with LTV + churn
 * ──────────────────────────────────────────────────────────────────── */

export type RevenueRange = "7d" | "30d" | "90d";
export type RevenueGroupBy = "day" | "city" | "listing_type";

const RANGE_DAYS: Record<RevenueRange, number> = { "7d": 7, "30d": 30, "90d": 90 };

export interface AttributionResponse {
  buckets: Array<{ key: string; revenue_paise: number; order_count: number }>;
  total_revenue_paise: number;
  total_orders: number;
  range: RevenueRange;
  group_by: RevenueGroupBy;
}

export interface CohortsResponse {
  cohorts: Array<{
    cohort_month: string;
    owners_count: number;
    total_revenue_paise: number;
    avg_ltv_paise: number;
    churn_30d_count: number;
  }>;
}

@Injectable()
export class AdminRevenueService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get enabled() {
    return readFeatureFlags().ff_admin_analytics_enabled && this.database.isEnabled();
  }

  async getAttribution(opts: {
    range?: RevenueRange;
    group_by?: RevenueGroupBy;
  }): Promise<AttributionResponse> {
    const range: RevenueRange = (
      opts.range && RANGE_DAYS[opts.range] ? opts.range : "30d"
    ) as RevenueRange;
    const group_by: RevenueGroupBy =
      opts.group_by === "city" || opts.group_by === "listing_type" ? opts.group_by : "day";
    const days = RANGE_DAYS[range];

    if (!this.enabled) {
      return { buckets: [], total_revenue_paise: 0, total_orders: 0, range, group_by };
    }

    let buckets: Array<{ key: string; revenue_paise: number; order_count: number }> = [];

    if (group_by === "day") {
      const result = await this.database.query<{
        key: string;
        revenue_paise: number;
        order_count: number;
      }>(
        `WITH days AS (
           SELECT generate_series(
             (now() - make_interval(days => $1 - 1))::date,
             now()::date,
             interval '1 day'
           )::date AS d
         )
         SELECT to_char(d.d, 'YYYY-MM-DD') AS key,
                COALESCE(sum(po.amount_paise)::bigint, 0)::int AS revenue_paise,
                COALESCE(count(po.id)::int, 0) AS order_count
         FROM days d
         LEFT JOIN payment_orders po
           ON po.status = 'captured'
          AND po.created_at::date = d.d
         GROUP BY d.d
         ORDER BY d.d`,
        [days]
      );
      buckets = result.rows;
    } else if (group_by === "city") {
      const result = await this.database.query<{
        key: string;
        revenue_paise: number;
        order_count: number;
      }>(
        `SELECT COALESCE(c.slug, 'unknown') AS key,
                COALESCE(sum(po.amount_paise)::bigint, 0)::int AS revenue_paise,
                count(po.id)::int AS order_count
         FROM payment_orders po
         LEFT JOIN listing_boosts lb ON lb.payment_order_id = po.id
         LEFT JOIN listings l ON l.id = lb.listing_id
         LEFT JOIN listing_locations ll ON ll.listing_id = l.id
         LEFT JOIN cities c ON c.id = ll.city_id
         WHERE po.status = 'captured'
           AND po.created_at >= now() - make_interval(days => $1)
         GROUP BY c.slug
         ORDER BY revenue_paise DESC`,
        [days]
      );
      buckets = result.rows;
    } else {
      const result = await this.database.query<{
        key: string;
        revenue_paise: number;
        order_count: number;
      }>(
        `SELECT COALESCE(l.listing_type::text, 'unknown') AS key,
                COALESCE(sum(po.amount_paise)::bigint, 0)::int AS revenue_paise,
                count(po.id)::int AS order_count
         FROM payment_orders po
         LEFT JOIN listing_boosts lb ON lb.payment_order_id = po.id
         LEFT JOIN listings l ON l.id = lb.listing_id
         WHERE po.status = 'captured'
           AND po.created_at >= now() - make_interval(days => $1)
         GROUP BY l.listing_type
         ORDER BY revenue_paise DESC`,
        [days]
      );
      buckets = result.rows;
    }

    const total_revenue_paise = buckets.reduce((s, b) => s + (b.revenue_paise || 0), 0);
    const total_orders = buckets.reduce((s, b) => s + (b.order_count || 0), 0);

    return { buckets, total_revenue_paise, total_orders, range, group_by };
  }

  async getCohorts(months = 6): Promise<CohortsResponse> {
    if (!this.enabled) return { cohorts: [] };

    const m = Math.min(Math.max(months, 1), 24);

    const result = await this.database.query<{
      cohort_month: string;
      owners_count: number;
      total_revenue_paise: number;
      avg_ltv_paise: number;
      churn_30d_count: number;
    }>(
      `WITH cohort AS (
         SELECT u.id AS owner_user_id,
                date_trunc('month', u.created_at)::date AS cohort_month,
                u.last_login_at
         FROM users u
         WHERE u.role IN ('owner', 'pg_operator')
           AND u.created_at >= date_trunc('month', now()) - make_interval(months => $1 - 1)
       ),
       revenue AS (
         SELECT po.user_id AS owner_user_id,
                COALESCE(sum(po.amount_paise)::bigint, 0)::int AS owner_revenue
         FROM payment_orders po
         WHERE po.status = 'captured'
         GROUP BY po.user_id
       )
       SELECT to_char(c.cohort_month, 'YYYY-MM') AS cohort_month,
              count(c.owner_user_id)::int AS owners_count,
              COALESCE(sum(r.owner_revenue)::bigint, 0)::int AS total_revenue_paise,
              COALESCE(round(avg(r.owner_revenue))::int, 0) AS avg_ltv_paise,
              count(*) FILTER (
                WHERE c.last_login_at IS NULL
                   OR c.last_login_at < now() - interval '30 days'
              )::int AS churn_30d_count
       FROM cohort c
       LEFT JOIN revenue r ON r.owner_user_id = c.owner_user_id
       GROUP BY c.cohort_month
       ORDER BY c.cohort_month DESC`,
      [m]
    );

    return { cohorts: result.rows };
  }
}
