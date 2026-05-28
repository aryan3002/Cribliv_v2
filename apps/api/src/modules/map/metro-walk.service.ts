import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";

export interface ListingWalk {
  station_id: number;
  distance_m: number;
  duration_s: number;
}

interface DistanceMatrixElement {
  status: string;
  distance?: { value: number; text: string };
  duration?: { value: number; text: string };
}

interface DistanceMatrixResponse {
  status: string;
  rows: Array<{ elements: DistanceMatrixElement[] }>;
  error_message?: string;
}

/**
 * Walking-time cache between a listing and every metro station in its city.
 * On first request for a (listing, city), fetches Google Distance Matrix
 * once and persists results in `listing_metro_walks`. Subsequent reads come
 * straight from the DB.
 *
 * Cost model: 1 listing × N stations = N elements at $5/1000 (Google Distance
 * Matrix). Each pair is paid for exactly once — never again. See plan doc.
 */
@Injectable()
export class MetroWalkService {
  private readonly logger = new Logger(MetroWalkService.name);
  /** Per-listing in-flight promise dedup so concurrent requests for the
   *  same listing only fire one Distance Matrix call. */
  private readonly inflight = new Map<string, Promise<ListingWalk[]>>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /** Read cached walks for a listing. Does NOT trigger a fetch — call
   *  `ensureWalksForListing` if you want lazy compute on miss. */
  async getCachedWalks(listingId: string): Promise<ListingWalk[]> {
    if (!this.database.isEnabled()) return [];
    const result = await this.database.query<ListingWalk>(
      `SELECT station_id, distance_m, duration_s
       FROM listing_metro_walks
       WHERE listing_id = $1::uuid`,
      [listingId]
    );
    return result.rows;
  }

  /**
   * Lazy-compute: if any walks for this listing are missing, fetch them
   * from Distance Matrix and persist. Returns the full set after compute.
   * Safe to call repeatedly — second call is a no-op DB read.
   */
  async ensureWalksForListing(listingId: string): Promise<ListingWalk[]> {
    if (!this.database.isEnabled()) return [];

    const existing = this.inflight.get(listingId);
    if (existing) return existing;

    const work = this.computeAndCache(listingId).finally(() => {
      this.inflight.delete(listingId);
    });
    this.inflight.set(listingId, work);
    return work;
  }

  private async computeAndCache(listingId: string): Promise<ListingWalk[]> {
    // 1. Look up the listing's coords + city.
    const listingRows = await this.database.query<{
      lat: number | null;
      lng: number | null;
      city: string | null;
    }>(
      `SELECT ll.lat::float8 AS lat, ll.lng::float8 AS lng, c.slug AS city
       FROM listing_locations ll
       JOIN cities c ON c.id = ll.city_id
       WHERE ll.listing_id = $1::uuid
       LIMIT 1`,
      [listingId]
    );
    const listing = listingRows.rows[0];
    if (!listing || listing.lat == null || listing.lng == null || !listing.city) {
      return [];
    }

    // 2. Look up stations for the listing's city.
    const stationRows = await this.database.query<{
      id: number;
      lat: number;
      lng: number;
    }>(
      `SELECT id, lat::float8 AS lat, lng::float8 AS lng
       FROM metro_stations
       WHERE city = $1
       ORDER BY id`,
      [listing.city]
    );
    if (stationRows.rows.length === 0) return [];

    // 3. Identify stations not yet cached.
    const cachedIds = new Set(
      (
        await this.database.query<{ station_id: number }>(
          `SELECT station_id FROM listing_metro_walks WHERE listing_id = $1::uuid`,
          [listingId]
        )
      ).rows.map((r) => r.station_id)
    );
    const toFetch = stationRows.rows.filter((s) => !cachedIds.has(s.id));

    // 4. If everything is cached already, just return the cached set.
    if (toFetch.length === 0) {
      return this.getCachedWalks(listingId);
    }

    // 5. Hit Google Distance Matrix in chunks (max 25 destinations / call).
    const apiKey = process.env.GOOGLE_MAPS_APIKEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        `Skipping Distance Matrix fetch for listing ${listingId}: no GOOGLE_MAPS_APIKEY env`
      );
      return this.getCachedWalks(listingId);
    }

    const origin = `${listing.lat},${listing.lng}`;
    const CHUNK = 25;
    for (let i = 0; i < toFetch.length; i += CHUNK) {
      const chunk = toFetch.slice(i, i + CHUNK);
      const destinations = chunk.map((s) => `${s.lat},${s.lng}`).join("|");
      const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      url.searchParams.set("origins", origin);
      url.searchParams.set("destinations", destinations);
      url.searchParams.set("mode", "walking");
      url.searchParams.set("units", "metric");
      url.searchParams.set("key", apiKey);

      try {
        const res = await fetch(url.toString());
        if (!res.ok) {
          this.logger.warn(
            `Distance Matrix request failed (${res.status}) for listing ${listingId}`
          );
          continue;
        }
        const body = (await res.json()) as DistanceMatrixResponse;
        if (body.status !== "OK") {
          this.logger.warn(
            `Distance Matrix returned status=${body.status} for listing ${listingId}: ${body.error_message ?? ""}`
          );
          continue;
        }

        const elements = body.rows[0]?.elements ?? [];
        for (let j = 0; j < chunk.length; j++) {
          const el = elements[j];
          const station = chunk[j];
          if (
            !el ||
            el.status !== "OK" ||
            !el.distance ||
            !el.duration ||
            el.distance.value == null ||
            el.duration.value == null
          ) {
            continue;
          }
          await this.database.query(
            `INSERT INTO listing_metro_walks(listing_id, station_id, distance_m, duration_s)
             VALUES ($1::uuid, $2, $3, $4)
             ON CONFLICT (listing_id, station_id)
             DO UPDATE SET
               distance_m = EXCLUDED.distance_m,
               duration_s = EXCLUDED.duration_s,
               fetched_at = now()`,
            [listingId, station.id, el.distance.value, el.duration.value]
          );
        }
      } catch (err) {
        this.logger.warn(
          `Distance Matrix fetch error for listing ${listingId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return this.getCachedWalks(listingId);
  }
}
