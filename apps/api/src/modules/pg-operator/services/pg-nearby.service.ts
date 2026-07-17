import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";

const LIMIT_PER = 4;

@Injectable()
export class PgNearbyService {
  private readonly logger = new Logger(PgNearbyService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async nearby(lat: number, lng: number, radiusKm = 2.5) {
    const empty = { metro: [] as string[], college: [] as string[], office: [] as string[] };
    if (!this.database.isEnabled()) return empty;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return empty;

    const radiusMeters = Math.min(Math.max(radiusKm, 0.5), 5) * 1000;

    try {
      const landmarks = await this.database.query(
        `SELECT name_en, type,
                ST_Distance(geo_point, ST_SetSRID(ST_MakePoint($1::float8,$2::float8),4326)::geography) AS d
         FROM landmarks
         WHERE is_active AND geo_point IS NOT NULL
           AND type = ANY($3::landmark_type[])
           AND ST_DWithin(geo_point, ST_SetSRID(ST_MakePoint($1::float8,$2::float8),4326)::geography, $4::float8)
         ORDER BY d ASC LIMIT 40`,
        [lng, lat, ["college", "office", "it_park"], radiusMeters]
      );
      const metro = await this.database.query(
        `SELECT station_name,
                ST_Distance(ST_SetSRID(ST_MakePoint(lng::float8,lat::float8),4326)::geography,
                            ST_SetSRID(ST_MakePoint($1::float8,$2::float8),4326)::geography) AS d
         FROM metro_stations
         WHERE ST_DWithin(ST_SetSRID(ST_MakePoint(lng::float8,lat::float8),4326)::geography,
                          ST_SetSRID(ST_MakePoint($1::float8,$2::float8),4326)::geography, $3::float8)
         ORDER BY d ASC LIMIT $4`,
        [lng, lat, radiusMeters, LIMIT_PER]
      );
      const pick = (predicate: (row: any) => boolean) =>
        landmarks.rows
          .filter(predicate)
          .slice(0, LIMIT_PER)
          .map((row: any) => row.name_en as string);

      return {
        metro: metro.rows.map((row: any) => row.station_name as string),
        college: pick((row) => row.type === "college"),
        office: pick((row) => row.type === "office" || row.type === "it_park")
      };
    } catch (error) {
      this.logger.debug(
        `PostGIS nearby failed (${error instanceof Error ? error.message : error}); returning empty`
      );
      return empty;
    }
  }
}
