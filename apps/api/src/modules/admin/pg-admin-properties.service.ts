import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import type {
  PgAdminListingListItem,
  PgAdminListingDetail,
  PgAdminListingAnalytics,
  PgAdminPropertyPatch,
  PgProperty,
  TrendPoint
} from "@cribliv/shared-types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : 0);

/**
 * Admin-facing PG management. The unit of management is a pg_listing (an
 * operator owns one pg_property containing many listings), so list/detail/
 * analytics are listing-centric. Locality/geocoding edits still target the
 * shared pg_property (see updateProperty) and propagate to listing_locations.
 */
@Injectable()
export class PgAdminPropertiesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async listListings(params: {
    q?: string;
    status?: string;
    city?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: PgAdminListingListItem[]; total: number }> {
    if (!this.db.isEnabled()) return { items: [], total: 0 };
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const r = await this.db.query<PgAdminListingListItem & { total: number }>(
      `SELECT pl.id::text AS listing_id, pl.title, pl.status::text AS status,
              pl.pg_property_id::text AS pg_property_id, pp.display_name AS property_name,
              c.slug AS city_slug, loc.slug AS locality_slug,
              pl.operator_user_id::text AS owner_id, u.full_name AS owner_name,
              CASE WHEN u.phone_e164 IS NOT NULL
                   THEN regexp_replace(u.phone_e164, '(\\+\\d{2})(\\d{3})\\d+(\\d{3})', '\\1\\2***\\3')
                   ELSE NULL END AS owner_phone_masked,
              COALESCE(ld.cnt, 0)::int AS leads_7d,
              EXISTS (SELECT 1 FROM pg_analytics_overrides o
                       WHERE o.operator_id = pl.operator_user_id AND o.active = true
                         AND (o.listing_id IS NULL OR o.listing_id = pl.id)) AS analytics_cut,
              count(*) OVER ()::int AS total
         FROM pg_listings pl
         JOIN users u ON u.id = pl.operator_user_id
         LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
         LEFT JOIN cities c ON c.id = pp.city_id
         LEFT JOIN localities loc ON loc.id = pp.locality_id
         LEFT JOIN LATERAL (
           SELECT count(*) AS cnt FROM leads l
            WHERE l.listing_id = pl.id AND l.created_at >= now() - interval '7 days'
         ) ld ON true
        WHERE ($1::text IS NULL OR pl.title ILIKE '%' || $1 || '%' OR u.full_name ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR pl.status::text = $2)
          AND ($3::text IS NULL OR c.slug = $3)
        ORDER BY pl.created_at DESC
        LIMIT $4 OFFSET $5`,
      [params.q ?? null, params.status ?? null, params.city ?? null, pageSize, offset]
    );
    const total = r.rows[0]?.total ?? 0;
    const items = r.rows.map(({ total: _t, ...rest }) => rest as PgAdminListingListItem);
    return { items, total };
  }

  async getListing(listingId: string): Promise<PgAdminListingDetail> {
    if (!this.db.isEnabled()) throw new NotFoundException({ code: "db_disabled" });
    const r = await this.db.query<{
      listing_id: string;
      title: string | null;
      listing_status: string;
      property: PgProperty | null;
      city_slug: string | null;
      locality_slug: string | null;
      owner_id: string;
      owner_name: string | null;
      owner_phone: string | null;
      owner_email: string | null;
      owner_created_at: string;
      owner_property_count: number;
      owner_verification_status: string | null;
      ov_global: boolean;
      ov_listing: boolean;
    }>(
      `SELECT pl.id::text AS listing_id, pl.title, pl.status::text AS listing_status,
              CASE WHEN pp.id IS NOT NULL THEN to_jsonb(pp) ELSE NULL END AS property,
              c.slug AS city_slug, loc.slug AS locality_slug,
              u.id::text AS owner_id, u.full_name AS owner_name, u.phone_e164 AS owner_phone,
              NULL::text AS owner_email, u.created_at::text AS owner_created_at,
              (SELECT count(*)::int FROM pg_properties WHERE operator_id = u.id) AS owner_property_count,
              NULL::text AS owner_verification_status,
              EXISTS (SELECT 1 FROM pg_analytics_overrides o WHERE o.operator_id = pl.operator_user_id AND o.listing_id IS NULL AND o.active = true) AS ov_global,
              EXISTS (SELECT 1 FROM pg_analytics_overrides o WHERE o.operator_id = pl.operator_user_id AND o.listing_id = pl.id AND o.active = true) AS ov_listing
         FROM pg_listings pl
         JOIN users u ON u.id = pl.operator_user_id
         LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
         LEFT JOIN cities c ON c.id = pp.city_id
         LEFT JOIN localities loc ON loc.id = pp.locality_id
        WHERE pl.id = $1::uuid`,
      [listingId]
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundException({ code: "listing_not_found" });
    return {
      listing: { id: row.listing_id, title: row.title, status: row.listing_status },
      property: row.property,
      city_slug: row.city_slug,
      locality_slug: row.locality_slug,
      owner: {
        id: row.owner_id,
        name: row.owner_name,
        phone: row.owner_phone,
        email: row.owner_email,
        created_at: row.owner_created_at,
        property_count: Number(row.owner_property_count) || 0,
        verification_status: row.owner_verification_status
      },
      overrides: { global: row.ov_global, listing: row.ov_listing }
    };
  }

  async getListingAnalytics(listingId: string, days: number): Promise<PgAdminListingAnalytics> {
    const window = Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 30;
    const empty: PgAdminListingAnalytics = {
      listing_id: listingId,
      range_days: window,
      appearances: 0,
      clicks: 0,
      views: 0,
      leads: 0,
      ctr: 0,
      interest_rate: 0,
      conversion: 0,
      composite_score: null,
      trend: []
    };
    if (!this.db.isEnabled()) return empty;
    const since = new Date(Date.now() - window * 86_400_000);

    const r = await this.db.query<{
      day: string;
      appearances: number;
      clicks: number;
      views: number;
      leads: number;
    }>(
      `WITH
        appr AS (
          SELECT date_trunc('day', e.created_at)::date::text AS day, count(*)::int AS n
            FROM pg_search_events e, jsonb_array_elements_text(e.shown_listing_ids) AS x(v)
           WHERE x.v = $1::text AND e.created_at >= $2 GROUP BY 1),
        clk AS (
          SELECT date_trunc('day', e.created_at)::date::text AS day, count(*)::int AS n
            FROM pg_search_events e
           WHERE e.clicked_listing_id = $1::uuid AND e.created_at >= $2 GROUP BY 1),
        vw AS (
          SELECT date_trunc('day', le.created_at)::date::text AS day, count(*)::int AS n
            FROM listing_events le
           WHERE le.event_type = 'view' AND le.listing_id = $1::uuid AND le.created_at >= $2 GROUP BY 1),
        ld AS (
          SELECT date_trunc('day', l.created_at)::date::text AS day, count(*)::int AS n
            FROM leads l WHERE l.listing_id = $1::uuid AND l.created_at >= $2 GROUP BY 1),
        keys AS (SELECT day FROM appr UNION SELECT day FROM clk UNION SELECT day FROM vw UNION SELECT day FROM ld)
      SELECT k.day, COALESCE(appr.n,0) AS appearances, COALESCE(clk.n,0) AS clicks,
             COALESCE(vw.n,0) AS views, COALESCE(ld.n,0) AS leads
        FROM keys k
        LEFT JOIN appr USING (day) LEFT JOIN clk USING (day)
        LEFT JOIN vw USING (day) LEFT JOIN ld USING (day)
        ORDER BY k.day ASC`,
      [listingId, since]
    );
    const trend: TrendPoint[] = r.rows.map((x) => ({
      day: x.day,
      appearances: Number(x.appearances) || 0,
      clicks: Number(x.clicks) || 0,
      views: Number(x.views) || 0,
      leads: Number(x.leads) || 0
    }));
    const sum = trend.reduce(
      (s, p) => ({ a: s.a + p.appearances, c: s.c + p.clicks, v: s.v + p.views, l: s.l + p.leads }),
      { a: 0, c: 0, v: 0, l: 0 }
    );
    const score = await this.db.query<{ composite_score: number | null }>(
      `SELECT composite_score FROM listing_scores WHERE listing_id = $1::uuid LIMIT 1`,
      [listingId]
    );
    return {
      listing_id: listingId,
      range_days: window,
      appearances: sum.a,
      clicks: sum.c,
      views: sum.v,
      leads: sum.l,
      ctr: ratio(sum.c, sum.a),
      interest_rate: ratio(sum.l, sum.v),
      conversion: ratio(sum.l, sum.a),
      composite_score:
        score.rows[0]?.composite_score != null ? Number(score.rows[0].composite_score) : null,
      trend
    };
  }

  /**
   * Edit the shared pg_property (locality/geocoding/name/status/floors). Locality
   * and geo changes propagate to listing_locations for every listing under the
   * property, in one transaction. Audited.
   */
  async updateProperty(adminId: string, id: string, patch: PgAdminPropertyPatch): Promise<void> {
    if (!this.db.isEnabled()) return;
    const touchesLocation =
      patch.city_slug !== undefined ||
      patch.locality_slug !== undefined ||
      patch.lat !== undefined ||
      patch.lng !== undefined;

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const beforeR = await client.query(
        `SELECT * FROM pg_properties WHERE id = $1::uuid FOR UPDATE`,
        [id]
      );
      const before = beforeR.rows[0];
      if (!before) throw new NotFoundException({ code: "property_not_found" });

      let cityId = before.city_id as number;
      let localityId = before.locality_id as number | null;
      if (patch.city_slug !== undefined) {
        const c = await client.query<{ id: number }>(
          `SELECT id FROM cities WHERE slug = $1 LIMIT 1`,
          [patch.city_slug.toLowerCase()]
        );
        if (!c.rowCount)
          throw new BadRequestException({
            code: "unknown_city",
            message: `unknown_city: ${patch.city_slug}`
          });
        cityId = c.rows[0].id;
      }
      if (patch.locality_slug !== undefined) {
        if (patch.locality_slug === null) localityId = null;
        else {
          const l = await client.query<{ id: number }>(
            `SELECT id FROM localities WHERE city_id = $1 AND slug = $2 LIMIT 1`,
            [cityId, patch.locality_slug.toLowerCase()]
          );
          localityId = l.rows[0]?.id ?? null;
        }
      }
      const nextLat = patch.lat !== undefined ? patch.lat : before.lat;
      const nextLng = patch.lng !== undefined ? patch.lng : before.lng;

      await client.query(
        `UPDATE pg_properties SET
           display_name  = COALESCE($2, display_name),
           internal_code = CASE WHEN $3::boolean THEN $4 ELSE internal_code END,
           status        = COALESCE($5::pg_property_status, status),
           total_floors  = CASE WHEN $6::boolean THEN $7 ELSE total_floors END,
           city_id = $8, locality_id = $9, lat = $10, lng = $11,
           updated_at = now()
         WHERE id = $1::uuid`,
        [
          id,
          patch.display_name ?? null,
          patch.internal_code !== undefined,
          patch.internal_code ?? null,
          patch.status ?? null,
          patch.total_floors !== undefined,
          patch.total_floors ?? null,
          cityId,
          localityId,
          nextLat,
          nextLng
        ]
      );

      if (touchesLocation) {
        await client.query(
          `UPDATE listing_locations ll
              SET city_id = $2, locality_id = $3, lat = $4, lng = $5, updated_at = now()
             FROM pg_listings pl
            WHERE pl.pg_property_id = $1::uuid AND ll.listing_id = pl.id`,
          [id, cityId, localityId, nextLat, nextLng]
        );
      }

      await client.query(
        `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'pg_property', $2::uuid, 'edit_pg_property', NULL, $3::jsonb, $4::jsonb)`,
        [adminId, id, JSON.stringify(before), JSON.stringify(patch)]
      );

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
