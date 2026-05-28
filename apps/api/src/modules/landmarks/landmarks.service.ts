import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";

export type LandmarkType =
  | "college"
  | "hospital"
  | "mall"
  | "market"
  | "station"
  | "airport"
  | "it_park"
  | "office"
  | "religious"
  | "park"
  | "stadium"
  | "monument";

export interface Landmark {
  id: number;
  slug: string;
  name_en: string;
  name_hi: string;
  type: LandmarkType;
  aka: string[];
  lat: number;
  lng: number;
  primary_locality_slug: string | null;
  primary_locality_name_en: string | null;
}

@Injectable()
export class LandmarksService {
  private readonly logger = new Logger(LandmarksService.name);

  constructor(private readonly database: DatabaseService) {}

  async listByCity(citySlug: string, type?: LandmarkType): Promise<Landmark[]> {
    if (!this.database.isEnabled()) return [];
    const params: unknown[] = [citySlug];
    let typeClause = "";
    if (type) {
      params.push(type);
      typeClause = `AND l.type = $${params.length}::landmark_type`;
    }
    const { rows } = await this.database.query<Landmark>(
      `SELECT l.id, l.slug, l.name_en, l.name_hi, l.type, l.aka,
              l.lat::float8 AS lat, l.lng::float8 AS lng,
              loc.slug AS primary_locality_slug,
              loc.name_en AS primary_locality_name_en
       FROM landmarks l
       JOIN cities c ON c.id = l.city_id
       LEFT JOIN localities loc ON loc.id = l.primary_locality_id
       WHERE c.slug = $1 AND l.is_active = true ${typeClause}
       ORDER BY l.type, l.name_en`,
      params
    );
    return rows;
  }

  async findBySlug(citySlug: string, landmarkSlug: string): Promise<Landmark | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<Landmark>(
      `SELECT l.id, l.slug, l.name_en, l.name_hi, l.type, l.aka,
              l.lat::float8 AS lat, l.lng::float8 AS lng,
              loc.slug AS primary_locality_slug,
              loc.name_en AS primary_locality_name_en
       FROM landmarks l
       JOIN cities c ON c.id = l.city_id
       LEFT JOIN localities loc ON loc.id = l.primary_locality_id
       WHERE c.slug = $1 AND l.slug = $2 AND l.is_active = true`,
      [citySlug, landmarkSlug]
    );
    return rows[0] ?? null;
  }

  /**
   * Listings within `radiusKm` of the landmark, ordered by distance ascending.
   * Uses PostGIS when available, otherwise falls back to a lat/lng bounding
   * box approximation (good enough for SEO page rendering).
   */
  async listingsNear(
    landmark: Landmark,
    radiusKm = 2,
    limit = 24,
    filterSql = "",
    filterParams: unknown[] = []
  ): Promise<Array<Record<string, unknown>>> {
    if (!this.database.isEnabled()) return [];

    const params: unknown[] = [landmark.lng, landmark.lat, radiusKm * 1000];
    const filterStart = params.length + 1;
    for (const p of filterParams) params.push(p);
    params.push(limit);

    // Renumber the user-supplied filter clause to match concatenated params.
    let renumbered = filterSql;
    if (filterSql) {
      let i = 0;
      renumbered = filterSql.replace(/\$\d+/g, () => `$${filterStart + i++}`);
    }

    try {
      const { rows } = await this.database.query(
        `SELECT l.id, l.title_en AS title, l.listing_type, l.monthly_rent, l.bhk, l.furnishing,
                l.area_sqft, l.verification_status,
                c.slug AS city, loc.slug AS locality,
                (SELECT lp.blob_path FROM listing_photos lp WHERE lp.listing_id = l.id AND lp.is_cover ORDER BY lp.sort_order LIMIT 1) AS cover_photo,
                ST_Distance(
                  ll.geo_point,
                  ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography
                ) AS distance_m
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         LEFT JOIN localities loc ON loc.id = ll.locality_id
         WHERE l.status = 'active'
           AND ll.geo_point IS NOT NULL
           AND ST_DWithin(
             ll.geo_point,
             ST_SetSRID(ST_MakePoint($1::float8, $2::float8), 4326)::geography,
             $3::float8
           )
           ${renumbered}
         ORDER BY distance_m ASC
         LIMIT $${params.length}`,
        params
      );
      return rows as Array<Record<string, unknown>>;
    } catch (err) {
      // PostGIS may be unavailable or geo_point not backfilled — fall back
      // to a cheap bbox approximation.
      this.logger.debug(
        `PostGIS landmark query failed (${err instanceof Error ? err.message : err}); using bbox fallback`
      );
      const latDelta = radiusKm / 111;
      const lngDelta = radiusKm / (111 * Math.cos((landmark.lat * Math.PI) / 180));
      const fallbackParams: unknown[] = [
        landmark.lat - latDelta,
        landmark.lat + latDelta,
        landmark.lng - lngDelta,
        landmark.lng + lngDelta
      ];
      const fbStart = fallbackParams.length + 1;
      for (const p of filterParams) fallbackParams.push(p);
      fallbackParams.push(limit);
      let fbRenumbered = filterSql;
      if (filterSql) {
        let i = 0;
        fbRenumbered = filterSql.replace(/\$\d+/g, () => `$${fbStart + i++}`);
      }
      const { rows } = await this.database.query(
        `SELECT l.id, l.title_en AS title, l.listing_type, l.monthly_rent, l.bhk, l.furnishing,
                l.area_sqft, l.verification_status,
                c.slug AS city, loc.slug AS locality,
                (SELECT lp.blob_path FROM listing_photos lp WHERE lp.listing_id = l.id AND lp.is_cover ORDER BY lp.sort_order LIMIT 1) AS cover_photo
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         LEFT JOIN localities loc ON loc.id = ll.locality_id
         WHERE l.status = 'active'
           AND ll.lat BETWEEN $1 AND $2
           AND ll.lng BETWEEN $3 AND $4
           ${fbRenumbered}
         ORDER BY l.created_at DESC
         LIMIT $${fallbackParams.length}`,
        fallbackParams
      );
      return rows as Array<Record<string, unknown>>;
    }
  }
}
