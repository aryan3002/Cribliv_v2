import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";

/**
 * Centralised aggregate queries that power the SEO landing pages. Each page
 * shows live counts and median rents; we run them through this service to:
 *   - share the SQL between locality / metro / landmark pages
 *   - keep them small and indexable
 *   - return safe zeros when DB is disabled (page still renders)
 */

export interface PageAggregates {
  listing_count: number;
  pg_count: number;
  flat_count: number;
  median_rent_pg: number | null;
  median_rent_1bhk: number | null;
  median_rent_2bhk: number | null;
  median_rent_3bhk: number | null;
}

export interface LocalityRow {
  id: number;
  slug: string;
  name_en: string;
  name_hi: string;
  lat: number | null;
  lng: number | null;
  parent_locality_slug: string | null;
  listing_count: number;
}

export interface MetroStationRow {
  id: number;
  station_name: string;
  line_name: string;
  line_color: string;
  lat: number;
  lng: number;
  sequence: number;
}

export interface MetroStationWithCount extends MetroStationRow {
  /** Derived in SQL with the same expression findMetroStation resolves. */
  slug: string;
  listing_count: number;
}

export interface LandmarkWithCount {
  id: number;
  slug: string;
  name_en: string;
  name_hi: string;
  listing_count: number;
}

@Injectable()
export class SeoAggregatesService {
  private readonly logger = new Logger(SeoAggregatesService.name);

  constructor(private readonly database: DatabaseService) {}

  async aggregatesForLocality(citySlug: string, localitySlug: string): Promise<PageAggregates> {
    return this.aggregatesWhere(`c.slug = $1 AND loc.slug = $2`, [citySlug, localitySlug]);
  }

  async aggregatesForMetro(
    city: string,
    stationName: string,
    radiusKm = 1.5
  ): Promise<PageAggregates> {
    if (!this.database.isEnabled()) return emptyAggregates();
    const { rows } = await this.database.query<{ lat: number; lng: number }>(
      `SELECT lat::float8 AS lat, lng::float8 AS lng FROM metro_stations
       WHERE city = $1 AND station_name = $2 LIMIT 1`,
      [city, stationName]
    );
    const station = rows[0];
    if (!station) return emptyAggregates();
    return this.aggregatesNearPoint(station.lat, station.lng, radiusKm);
  }

  async aggregatesNearPoint(lat: number, lng: number, radiusKm: number): Promise<PageAggregates> {
    if (!this.database.isEnabled()) return emptyAggregates();
    try {
      const { rows } = await this.database.query<PageAggregates>(
        `WITH near AS (
           SELECT l.id, l.listing_type, l.monthly_rent, l.bhk
           FROM listings l
           JOIN listing_locations ll ON ll.listing_id = l.id
           WHERE l.status = 'active'
             AND ll.geo_point IS NOT NULL
             AND ST_DWithin(
               ll.geo_point,
               ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
               $3::float8
             )
         )
         SELECT
           COUNT(*)::int AS listing_count,
           COUNT(*) FILTER (WHERE listing_type = 'pg')::int AS pg_count,
           COUNT(*) FILTER (WHERE listing_type = 'flat_house')::int AS flat_count,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent) FILTER (WHERE listing_type = 'pg'), 0)::int AS median_rent_pg,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent) FILTER (WHERE listing_type = 'flat_house' AND bhk = 1), 0)::int AS median_rent_1bhk,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent) FILTER (WHERE listing_type = 'flat_house' AND bhk = 2), 0)::int AS median_rent_2bhk,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY monthly_rent) FILTER (WHERE listing_type = 'flat_house' AND bhk = 3), 0)::int AS median_rent_3bhk
         FROM near`,
        [lng, lat, radiusKm * 1000]
      );
      return rows[0] ?? emptyAggregates();
    } catch (err) {
      this.logger.debug(`PostGIS aggregate failed: ${err instanceof Error ? err.message : err}`);
      return emptyAggregates();
    }
  }

  private async aggregatesWhere(whereClause: string, params: unknown[]): Promise<PageAggregates> {
    if (!this.database.isEnabled()) return emptyAggregates();
    try {
      const { rows } = await this.database.query<PageAggregates>(
        `SELECT
           COUNT(*)::int AS listing_count,
           COUNT(*) FILTER (WHERE l.listing_type = 'pg')::int AS pg_count,
           COUNT(*) FILTER (WHERE l.listing_type = 'flat_house')::int AS flat_count,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.monthly_rent) FILTER (WHERE l.listing_type = 'pg'), 0)::int AS median_rent_pg,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.monthly_rent) FILTER (WHERE l.listing_type = 'flat_house' AND l.bhk = 1), 0)::int AS median_rent_1bhk,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.monthly_rent) FILTER (WHERE l.listing_type = 'flat_house' AND l.bhk = 2), 0)::int AS median_rent_2bhk,
           NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.monthly_rent) FILTER (WHERE l.listing_type = 'flat_house' AND l.bhk = 3), 0)::int AS median_rent_3bhk
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         LEFT JOIN localities loc ON loc.id = ll.locality_id
         WHERE l.status = 'active' AND ${whereClause}`,
        params
      );
      return rows[0] ?? emptyAggregates();
    } catch (err) {
      this.logger.debug(
        `Locality aggregate query failed: ${err instanceof Error ? err.message : err}`
      );
      return emptyAggregates();
    }
  }

  async localitiesForCity(citySlug: string): Promise<LocalityRow[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<LocalityRow>(
        `SELECT loc.id, loc.slug, loc.name_en, loc.name_hi,
              loc.lat::float8 AS lat, loc.lng::float8 AS lng,
              parent.slug AS parent_locality_slug,
              COALESCE(COUNT(l.id) FILTER (WHERE l.status = 'active'), 0)::int AS listing_count
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       LEFT JOIN localities parent ON parent.id = loc.parent_locality_id
       LEFT JOIN listing_locations ll ON ll.locality_id = loc.id
       LEFT JOIN listings l ON l.id = ll.listing_id
       WHERE c.slug = $1
       GROUP BY loc.id, parent.slug
       ORDER BY listing_count DESC, loc.name_en ASC`,
        [citySlug]
      );
      return rows;
    } catch (err) {
      this.logger.debug(
        `localitiesForCity query failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }

  async findLocality(citySlug: string, localitySlug: string): Promise<LocalityRow | null> {
    if (!this.database.isEnabled()) return null;
    try {
      const { rows } = await this.database.query<LocalityRow>(
        `SELECT loc.id, loc.slug, loc.name_en, loc.name_hi,
              loc.lat::float8 AS lat, loc.lng::float8 AS lng,
              parent.slug AS parent_locality_slug,
              0::int AS listing_count
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       LEFT JOIN localities parent ON parent.id = loc.parent_locality_id
       WHERE c.slug = $1 AND (loc.slug = $2 OR $2 = ANY(loc.seo_aliases))
       LIMIT 1`,
        [citySlug, localitySlug]
      );
      return rows[0] ?? null;
    } catch (err) {
      this.logger.debug(`findLocality query failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async nearbyLocalities(localityId: number, limit = 5): Promise<LocalityRow[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<LocalityRow>(
        `WITH origin AS (
          SELECT geo_point FROM localities WHERE id = $1
        )
        SELECT loc.id, loc.slug, loc.name_en, loc.name_hi,
               loc.lat::float8 AS lat, loc.lng::float8 AS lng,
               parent.slug AS parent_locality_slug,
               0::int AS listing_count
        FROM localities loc, origin
        LEFT JOIN localities parent ON parent.id = loc.parent_locality_id
        WHERE loc.id != $1
          AND loc.geo_point IS NOT NULL
          AND origin.geo_point IS NOT NULL
        ORDER BY ST_Distance(loc.geo_point, origin.geo_point) ASC
        LIMIT $2`,
        [localityId, limit]
      );
      return rows;
    } catch {
      return [];
    }
  }

  async metroStationsForCity(city: string): Promise<MetroStationRow[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<MetroStationRow>(
        `SELECT id, station_name, line_name, line_color,
              lat::float8 AS lat, lng::float8 AS lng, sequence
       FROM metro_stations WHERE city = $1
       ORDER BY line_name, sequence`,
        [city]
      );
      return rows;
    } catch (err) {
      this.logger.debug(
        `metroStationsForCity query failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }

  async findMetroStation(city: string, stationSlug: string): Promise<MetroStationRow | null> {
    if (!this.database.isEnabled()) return null;
    // Stations seeded by name; slug is name lowercased + hyphenated.
    const normalised = stationSlug.toLowerCase();
    try {
      const { rows } = await this.database.query<MetroStationRow>(
        `SELECT id, station_name, line_name, line_color,
              lat::float8 AS lat, lng::float8 AS lng, sequence
       FROM metro_stations
       WHERE city = $1
         AND LOWER(REGEXP_REPLACE(station_name, '[^a-zA-Z0-9]+', '-', 'g')) = $2
       LIMIT 1`,
        [city, normalised]
      );
      return rows[0] ?? null;
    } catch (err) {
      this.logger.debug(
        `findMetroStation query failed: ${err instanceof Error ? err.message : err}`
      );
      return null;
    }
  }

  /**
   * Every metro station in a city with the number of active listings within
   * `radiusKm`. Used to gate metro pages out of the sitemap when there is
   * nothing to show.
   *
   * The slug is derived in SQL using the identical expression
   * `findMetroStation` matches on, so a URL we emit always resolves. Deriving
   * it in TypeScript instead is how the sitemap ended up emitting stations the
   * page could not resolve.
   */
  async metroStationsWithCountsForCity(
    citySlug: string,
    radiusKm = 1.5
  ): Promise<MetroStationWithCount[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<MetroStationWithCount>(
        `SELECT ms.id, ms.station_name, ms.line_name, ms.line_color,
                ms.lat::float8 AS lat, ms.lng::float8 AS lng, ms.sequence,
                LOWER(REGEXP_REPLACE(ms.station_name, '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
                COALESCE(cnt.listing_count, 0)::int AS listing_count
         FROM metro_stations ms
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS listing_count
           FROM listing_locations ll
           JOIN listings l ON l.id = ll.listing_id
           JOIN cities c ON c.id = ll.city_id
           WHERE l.status = 'active'
             AND c.slug = $1
             AND ll.geo_point IS NOT NULL
             AND ST_DWithin(
               ll.geo_point,
               ST_SetSRID(ST_MakePoint(ms.lng::float8, ms.lat::float8), 4326)::geography,
               $2::float8
             )
         ) cnt ON true
         WHERE ms.city = $1
         ORDER BY ms.line_name, ms.sequence`,
        [citySlug, radiusKm * 1000]
      );
      return rows;
    } catch (err) {
      this.logger.debug(
        `metroStationsWithCountsForCity failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }

  /**
   * Every active landmark in a city with the number of active listings within
   * `radiusKm`. Mirrors the 2 km radius the landmark page itself renders, so
   * the gate and the rendered content agree.
   */
  async landmarksWithCountsForCity(citySlug: string, radiusKm = 2): Promise<LandmarkWithCount[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<LandmarkWithCount>(
        `SELECT lm.id, lm.slug, lm.name_en, lm.name_hi,
                COALESCE(cnt.listing_count, 0)::int AS listing_count
         FROM landmarks lm
         JOIN cities c ON c.id = lm.city_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS listing_count
           FROM listing_locations ll
           JOIN listings l ON l.id = ll.listing_id
           WHERE l.status = 'active'
             AND ll.city_id = c.id
             AND ll.geo_point IS NOT NULL
             AND ST_DWithin(
               ll.geo_point,
               ST_SetSRID(ST_MakePoint(lm.lng::float8, lm.lat::float8), 4326)::geography,
               $2::float8
             )
         ) cnt ON true
         WHERE c.slug = $1 AND lm.is_active = true
         ORDER BY listing_count DESC, lm.name_en ASC`,
        [citySlug, radiusKm * 1000]
      );
      return rows;
    } catch (err) {
      this.logger.debug(
        `landmarksWithCountsForCity failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }
}

function emptyAggregates(): PageAggregates {
  return {
    listing_count: 0,
    pg_count: 0,
    flat_count: 0,
    median_rent_pg: null,
    median_rent_1bhk: null,
    median_rent_2bhk: null,
    median_rent_3bhk: null
  };
}
