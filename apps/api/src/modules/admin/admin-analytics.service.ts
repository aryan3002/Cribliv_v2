import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";

@Injectable()
export class AdminAnalyticsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private get enabled() {
    return readFeatureFlags().ff_admin_analytics_enabled && this.database.isEnabled();
  }

  async getOverview(): Promise<{
    total_listings: number;
    active_listings: number;
    total_users: number;
    total_leads: number;
    total_unlocks: number;
    total_revenue_paise: number;
  } | null> {
    if (!this.enabled) return null;

    const result = await this.database.query<{
      total_listings: number;
      active_listings: number;
      total_users: number;
      total_leads: number;
      total_unlocks: number;
      total_revenue_paise: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM listings) AS total_listings,
         (SELECT count(*)::int FROM listings WHERE status = 'active') AS active_listings,
         (SELECT count(*)::int FROM users) AS total_users,
         (SELECT count(*)::int FROM leads) AS total_leads,
         (SELECT count(*)::int FROM contact_unlocks) AS total_unlocks,
         COALESCE((SELECT sum(amount_paise)::bigint FROM payment_orders WHERE status = 'captured'), 0) AS total_revenue_paise`
    );

    return result.rows[0] ?? null;
  }

  async getListingsByArea(): Promise<
    Array<{
      city: string;
      locality: string | null;
      count: number;
    }>
  > {
    if (!this.enabled) return [];

    const result = await this.database.query<{
      city: string;
      locality: string | null;
      count: number;
    }>(
      `SELECT c.slug AS city, loc.name_en AS locality, count(*)::int AS count
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       WHERE l.status = 'active'
       GROUP BY c.slug, loc.name_en
       ORDER BY count DESC
       LIMIT 50`
    );

    return result.rows;
  }

  async getDailyLeadCounts(days = 30): Promise<Array<{ date: string; count: number }>> {
    if (!this.enabled) return [];

    const result = await this.database.query<{ date: string; count: number }>(
      `SELECT date_trunc('day', created_at)::date::text AS date, count(*)::int AS count
       FROM leads
       WHERE created_at >= now() - make_interval(days => $1)
       GROUP BY date
       ORDER BY date ASC`,
      [days]
    );

    return result.rows;
  }

  async getOwnerResponseRates(): Promise<{
    avg_response_rate: number;
    total_unlocks: number;
    responded: number;
  } | null> {
    if (!this.enabled) return null;

    const result = await this.database.query<{
      total_unlocks: number;
      responded: number;
    }>(
      `SELECT
         count(*)::int AS total_unlocks,
         count(*) FILTER (WHERE owner_response_status = 'responded')::int AS responded
       FROM contact_unlocks
       WHERE created_at >= now() - interval '30 days'`
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      avg_response_rate: row.total_unlocks > 0 ? row.responded / row.total_unlocks : 0,
      total_unlocks: row.total_unlocks,
      responded: row.responded
    };
  }

  async getFeaturedRevenue(days = 30): Promise<{
    total_paise: number;
    order_count: number;
  }> {
    if (!this.enabled) return { total_paise: 0, order_count: 0 };

    const result = await this.database.query<{
      total_paise: number;
      order_count: number;
    }>(
      `SELECT
         COALESCE(sum(po.amount_paise)::bigint, 0) AS total_paise,
         count(*)::int AS order_count
       FROM payment_orders po
       WHERE po.status = 'captured'
         AND po.metadata->>'boost_type' IS NOT NULL
         AND po.created_at >= now() - make_interval(days => $1)`,
      [days]
    );

    return result.rows[0] ?? { total_paise: 0, order_count: 0 };
  }

  async getConversionFunnel(days = 30): Promise<{
    views: number;
    enquiries: number;
    unlocks: number;
    leads_created: number;
  }> {
    if (!this.enabled) return { views: 0, enquiries: 0, unlocks: 0, leads_created: 0 };

    const result = await this.database.query<{
      views: number;
      enquiries: number;
      unlocks: number;
      leads_created: number;
    }>(
      `SELECT
         COALESCE((SELECT count(*)::int FROM listing_events WHERE event_type = 'view' AND created_at >= now() - make_interval(days => $1)), 0) AS views,
         COALESCE((SELECT count(*)::int FROM listing_events WHERE event_type = 'enquiry' AND created_at >= now() - make_interval(days => $1)), 0) AS enquiries,
         COALESCE((SELECT count(*)::int FROM contact_unlocks WHERE created_at >= now() - make_interval(days => $1)), 0) AS unlocks,
         COALESCE((SELECT count(*)::int FROM leads WHERE created_at >= now() - make_interval(days => $1)), 0) AS leads_created`,
      [days]
    );

    return result.rows[0] ?? { views: 0, enquiries: 0, unlocks: 0, leads_created: 0 };
  }
}
