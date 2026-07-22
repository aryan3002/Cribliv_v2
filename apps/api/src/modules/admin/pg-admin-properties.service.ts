import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { toBlobUrl } from "../../common/photo-url";
import type {
  PgAdminListingListItem,
  PgAdminListingDetail,
  PgAdminListingAnalytics,
  PgAdminListingSort,
  PgAdminListingsParams,
  PgAdminListingsResponse,
  PgAdminPropertyPatch,
  PgProperty,
  TrendPoint
} from "@cribliv/shared-types";

const round2 = (n: number) => Math.round(n * 100) / 100;
const ratio = (num: number, den: number) => (den > 0 ? round2(num / den) : 0);

/**
 * Shared FROM for the three admin PG list queries.
 *
 * `listings l` is the public READ PROJECTION of the PG head (same id, 1:1 — see
 * migration 0032). It is joined solely for verification truth: the admin
 * verification-decision endpoint writes `listings.verification_status` and never
 * touches the pg_listings head, and search/map/homes all read the projection.
 * LEFT JOIN (not JOIN) so a listing whose projection row is somehow missing is
 * still visible to admins rather than silently disappearing.
 */
const PG_LIST_FROM = `
     FROM pg_listings pl
     JOIN users u ON u.id = pl.operator_user_id
     LEFT JOIN listings l ON l.id = pl.id
     LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
     LEFT JOIN cities c ON c.id = pp.city_id
     LEFT JOIN localities loc ON loc.id = pp.locality_id`;

/** Public verification truth. Projection wins; pg head is the fallback. */
const PG_VERIFICATION_SQL = `COALESCE(l.verification_status::text, pl.verification_status::text)`;

/**
 * Free-text predicate, IDENTICAL across all three queries so facet counts can
 * never disagree with the visible rows. Always bound to $1 — every query below
 * reserves $1 for `q` precisely so this constant is reusable without renumbering.
 * Raw phone is MATCHED here but never SELECTed.
 */
const PG_LIST_Q_PREDICATE = `($1::text IS NULL OR (
             pl.title            ILIKE '%' || $1 || '%'
          OR pl.id::text         ILIKE '%' || $1 || '%'
          OR pp.display_name     ILIKE '%' || $1 || '%'
          OR u.full_name         ILIKE '%' || $1 || '%'
          OR u.phone_e164        ILIKE '%' || $1 || '%'
          OR loc.slug            ILIKE '%' || $1 || '%'
          OR loc.name_en         ILIKE '%' || $1 || '%'
          OR c.slug              ILIKE '%' || $1 || '%'
          OR c.name_en           ILIKE '%' || $1 || '%'))`;

/**
 * Admin-facing PG management. The unit of management is a pg_listing (an
 * operator owns one pg_property containing many listings), so list/detail/
 * analytics are listing-centric. Locality/geocoding edits still target the
 * shared pg_property (see updateProperty) and propagate to listing_locations.
 */
@Injectable()
export class PgAdminPropertiesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /**
   * Verified-PGs inventory list. Returns an envelope mirroring
   * AdminHomesListResponse: page items + facet cities + scope summary.
   *
   * Filter semantics (deliberate, documented in PgAdminListingsResponse):
   *   items/total       — all filters (verification, status, city, q)
   *   available_cities  — verification + status + q; IGNORES city (facet pattern)
   *   summary           — q + city; IGNORES status and the verification toggle
   */
  async listListings(params: PgAdminListingsParams): Promise<PgAdminListingsResponse> {
    const filters = {
      verification: params.verification,
      status: params.status,
      city: params.city ?? null,
      q: params.q ?? null,
      sort: params.sort
    };

    if (!this.db.isEnabled()) {
      return {
        items: [],
        total: 0,
        page: params.page,
        page_size: params.page_size,
        filters,
        available_cities: [],
        summary: { verified: 0, active: 0, cities: 0 }
      };
    }

    const page = Math.max(1, params.page);
    const pageSize = params.page_size;
    const offset = (page - 1) * pageSize;

    // $1 q, $2 city, $3 verification, $4 status
    const where = `
        WHERE ${PG_LIST_Q_PREDICATE}
          AND ($2::text IS NULL OR c.slug = $2)
          AND ($3::text = 'all' OR ${PG_VERIFICATION_SQL} = 'verified')
          AND ($4::text = 'all' OR pl.status::text = $4)`;

    const filterValues = [
      params.q ?? null,
      params.city ?? null,
      params.verification,
      params.status
    ];

    const pageResult = await this.db.query<
      Omit<PgAdminListingListItem, "cover_photo_url" | "public_path" | "starting_rent_paise"> & {
        cover_blob: string | null;
        starting_rent_paise: string | null;
        total: number;
      }
    >(
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
              ${PG_VERIFICATION_SQL} AS verification_status,
              pl.starting_rent_paise::text AS starting_rent_paise,
              d.gender_policy::text AS gender_policy,
              pl.updated_at::text AS updated_at,
              cover.blob_path AS cover_blob,
              count(*) OVER ()::int AS total
         ${PG_LIST_FROM}
         LEFT JOIN pg_details d ON d.listing_id = pl.id
         LEFT JOIN LATERAL (
           SELECT count(*) AS cnt FROM leads lead
            WHERE lead.listing_id = pl.id AND lead.created_at >= now() - interval '7 days'
         ) ld ON true
         LEFT JOIN LATERAL (
           SELECT blob_path FROM listing_photos
            WHERE listing_id = pl.id AND moderation_status != 'rejected'
            ORDER BY is_cover DESC, sort_order ASC, created_at ASC
            LIMIT 1
         ) cover ON true
         ${where}
        ORDER BY ${this.pgListOrderBy(params.sort)}
        LIMIT $5 OFFSET $6`,
      [...filterValues, pageSize, offset]
    );

    const items: PgAdminListingListItem[] = pageResult.rows.map((row) => {
      const { total: _total, cover_blob, starting_rent_paise, ...rest } = row;
      const shareable = rest.status === "active" && !!rest.city_slug;
      return {
        ...rest,
        starting_rent_paise: starting_rent_paise == null ? null : Number(starting_rent_paise),
        cover_photo_url: toBlobUrl(cover_blob),
        public_path: shareable ? `/en/pg/${rest.city_slug}/${rest.listing_id}` : null
      };
    });

    // `count(*) OVER ()` rides on the returned rows, so an out-of-range page
    // yields no rows and no count. Fall back to an explicit COUNT so the UI
    // reports a real total instead of "Page 7 of 1 · 0 total".
    let total = pageResult.rows[0]?.total ?? 0;
    if (pageResult.rows.length === 0 && page > 1) {
      const countResult = await this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total ${PG_LIST_FROM} ${where}`,
        filterValues
      );
      total = countResult.rows[0]?.total ?? 0;
    }

    // Facet: $1 q, $2 verification, $3 status. City intentionally absent.
    const citiesResult = await this.db.query<{ slug: string; name: string; count: number }>(
      `SELECT c.slug AS slug, c.name_en AS name, count(*)::int AS count
         ${PG_LIST_FROM}
        WHERE ${PG_LIST_Q_PREDICATE}
          AND ($2::text = 'all' OR ${PG_VERIFICATION_SQL} = 'verified')
          AND ($3::text = 'all' OR pl.status::text = $3)
          AND c.slug IS NOT NULL
        GROUP BY c.slug, c.name_en
        ORDER BY name ASC, slug ASC`,
      [params.q ?? null, params.verification, params.status]
    );

    // Scope tiles: $1 q, $2 city. Status + verification toggle intentionally absent.
    const summaryResult = await this.db.query<{
      verified: number;
      active: number;
      cities: number;
    }>(
      `SELECT
          count(*) FILTER (WHERE ${PG_VERIFICATION_SQL} = 'verified')::int AS verified,
          count(*) FILTER (WHERE ${PG_VERIFICATION_SQL} = 'verified'
                             AND pl.status::text = 'active')::int AS active,
          count(DISTINCT c.slug) FILTER (WHERE ${PG_VERIFICATION_SQL} = 'verified')::int AS cities
         ${PG_LIST_FROM}
        WHERE ${PG_LIST_Q_PREDICATE}
          AND ($2::text IS NULL OR c.slug = $2)`,
      [params.q ?? null, params.city ?? null]
    );
    const summary = summaryResult.rows[0] ?? { verified: 0, active: 0, cities: 0 };

    return {
      items,
      total,
      page,
      page_size: pageSize,
      filters,
      available_cities: citiesResult.rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        count: Number(row.count)
      })),
      summary: {
        verified: Number(summary.verified),
        active: Number(summary.active),
        cities: Number(summary.cities)
      }
    };
  }

  /** Whitelisted ORDER BY. Never interpolate raw input. Mirrors admin-homes.service.ts:1360. */
  private pgListOrderBy(sort: PgAdminListingSort): string {
    const fallback = "pl.updated_at DESC, pl.id DESC";
    switch (sort) {
      case "updated":
        return fallback;
      case "rent_desc":
        return `pl.starting_rent_paise DESC NULLS LAST, ${fallback}`;
      case "rent_asc":
        return `pl.starting_rent_paise ASC NULLS LAST, ${fallback}`;
      case "leads":
      default:
        return `COALESCE(ld.cnt, 0) DESC, ${fallback}`;
    }
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
