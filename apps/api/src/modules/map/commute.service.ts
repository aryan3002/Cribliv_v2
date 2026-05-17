import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { MapService } from "./map.service";

export interface LocalityReachability {
  locality_id: number;
  locality_slug: string;
  locality_name: string;
  lat: number;
  lng: number;
  total_minutes: number;
  walk_minutes: number;
  transit_minutes: number;
  via_station_id: number;
  via_station_name: string;
}

interface OfficeStationTransit {
  station_id: number;
  duration_s: number;
  distance_m: number;
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

/* Average walking pace, used for the listing → nearest-station leg.
 * 4.5 km/h is a realistic Indian urban pace (slightly slower than EU
 * 5 km/h, accounts for crossings + sidewalk quality). */
const WALK_KMH = 4.5;
/* Constant buffer added to every commute — accounts for waiting for the
 * train, transfers, last-mile mismatch. */
const BUFFER_MIN = 5;

function hashOfficeKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)}|${lng.toFixed(5)}`;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
}

/**
 * "Where Should I Live?" reverse-search engine.
 *
 * For a given office coordinate + city:
 *  1. Ensure we have transit times from the office to every metro station
 *     in that city (uses Google Distance Matrix once per unique office,
 *     cached forever in commute_office_transit).
 *  2. For every locality in that city, find the nearest metro station and
 *     compose total commute = walk(locality→station) + transit(station→
 *     office) + buffer.
 *
 * Single endpoint return powers both the heatmap and the listing-dim
 * frontend behaviour.
 */
@Injectable()
export class CommuteService {
  private readonly logger = new Logger(CommuteService.name);
  /* Per-office inflight dedup so concurrent renders of the heatmap don't
   * spin up parallel Distance Matrix calls. */
  private readonly inflight = new Map<string, Promise<OfficeStationTransit[]>>();

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MapService) private readonly mapService: MapService
  ) {}

  async getCachedOfficeTransit(officeKey: string): Promise<OfficeStationTransit[]> {
    if (!this.database.isEnabled()) return [];
    const result = await this.database.query<OfficeStationTransit>(
      `SELECT station_id, duration_s, distance_m
       FROM commute_office_transit
       WHERE office_key = $1`,
      [officeKey]
    );
    return result.rows;
  }

  async ensureOfficeTransit(
    office: { lat: number; lng: number },
    city: string
  ): Promise<OfficeStationTransit[]> {
    const officeKey = hashOfficeKey(office.lat, office.lng);
    const inflight = this.inflight.get(officeKey);
    if (inflight) return inflight;

    const work = this.computeAndCache(office, officeKey, city).finally(() => {
      this.inflight.delete(officeKey);
    });
    this.inflight.set(officeKey, work);
    return work;
  }

  private async computeAndCache(
    office: { lat: number; lng: number },
    officeKey: string,
    city: string
  ): Promise<OfficeStationTransit[]> {
    if (!this.database.isEnabled()) return [];

    // 1. Get the city's full metro station set (cross-city reach included).
    const metroResult = await this.mapService.getMetroStations(city);
    const stations: Array<{ id: number; lat: number; lng: number }> = [];
    for (const line of metroResult.lines) {
      for (const s of line.stations) {
        stations.push({ id: s.id, lat: s.lat, lng: s.lng });
      }
    }
    if (stations.length === 0) return [];

    // 2. What's already cached for this office?
    const cachedIds = new Set(
      (await this.getCachedOfficeTransit(officeKey)).map((r) => r.station_id)
    );
    const toFetch = stations.filter((s) => !cachedIds.has(s.id));
    if (toFetch.length === 0) {
      return this.getCachedOfficeTransit(officeKey);
    }

    // 3. Hit Distance Matrix in chunks (max 25 destinations / call), mode=transit.
    const apiKey = process.env.GOOGLE_MAPS_APIKEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      this.logger.warn(`Skipping Distance Matrix fetch for office ${officeKey}: no API key`);
      return this.getCachedOfficeTransit(officeKey);
    }

    const origin = `${office.lat},${office.lng}`;
    const CHUNK = 25;
    for (let i = 0; i < toFetch.length; i += CHUNK) {
      const chunk = toFetch.slice(i, i + CHUNK);
      const destinations = chunk.map((s) => `${s.lat},${s.lng}`).join("|");
      const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      url.searchParams.set("origins", origin);
      url.searchParams.set("destinations", destinations);
      url.searchParams.set("mode", "transit");
      url.searchParams.set("units", "metric");
      url.searchParams.set("key", apiKey);

      try {
        const res = await fetch(url.toString());
        if (!res.ok) {
          this.logger.warn(`Distance Matrix HTTP ${res.status} for office ${officeKey}`);
          continue;
        }
        const body = (await res.json()) as DistanceMatrixResponse;
        if (body.status !== "OK") {
          this.logger.warn(
            `Distance Matrix status=${body.status} for office ${officeKey}: ${body.error_message ?? ""}`
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
            `INSERT INTO commute_office_transit(office_key, station_id, duration_s, distance_m)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (office_key, station_id)
             DO UPDATE SET
               duration_s = EXCLUDED.duration_s,
               distance_m = EXCLUDED.distance_m,
               fetched_at = now()`,
            [officeKey, station.id, el.duration.value, el.distance.value]
          );
        }
      } catch (err) {
        this.logger.warn(
          `Distance Matrix error for office ${officeKey}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return this.getCachedOfficeTransit(officeKey);
  }

  /**
   * Per-locality reachability for the heatmap. Returns ALL localities in the
   * city with their composed commute time — the frontend slider decides
   * which buckets render green/amber.
   */
  async computeLocalityReachability(
    office: { lat: number; lng: number },
    city: string
  ): Promise<LocalityReachability[]> {
    if (!this.database.isEnabled()) return [];

    // 1. Office → station transit times (cached).
    const transit = await this.ensureOfficeTransit(office, city);
    if (transit.length === 0) return [];
    const transitByStation = new Map(transit.map((t) => [t.station_id, t]));

    // 2. The city's full station set with coordinates + names (for via-label).
    const metroResult = await this.mapService.getMetroStations(city);
    const stations: Array<{ id: number; name: string; lat: number; lng: number }> = [];
    for (const line of metroResult.lines) {
      for (const s of line.stations) {
        stations.push({ id: s.id, name: s.name, lat: s.lat, lng: s.lng });
      }
    }
    if (stations.length === 0) return [];

    // 3. All localities in the city with valid lat/lng.
    const localityRows = await this.database.query<{
      id: number;
      slug: string;
      name_en: string;
      lat: number;
      lng: number;
    }>(
      `SELECT loc.id, loc.slug, loc.name_en, loc.lat::float8 AS lat, loc.lng::float8 AS lng
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       WHERE c.slug = $1 AND loc.lat IS NOT NULL AND loc.lng IS NOT NULL`,
      [city]
    );

    // 4. For each locality, find nearest station (with transit data) and compose.
    const out: LocalityReachability[] = [];
    for (const loc of localityRows.rows) {
      let bestStation: (typeof stations)[number] | null = null;
      let bestKm = Infinity;
      for (const s of stations) {
        if (!transitByStation.has(s.id)) continue;
        const km = haversineKm({ lat: loc.lat, lng: loc.lng }, s);
        if (km < bestKm) {
          bestKm = km;
          bestStation = s;
        }
      }
      if (!bestStation) continue;
      const t = transitByStation.get(bestStation.id);
      if (!t) continue;

      const walk_minutes = Math.round((bestKm / WALK_KMH) * 60);
      const transit_minutes = Math.round(t.duration_s / 60);
      const total_minutes = walk_minutes + transit_minutes + BUFFER_MIN;

      out.push({
        locality_id: loc.id,
        locality_slug: loc.slug,
        locality_name: loc.name_en,
        lat: loc.lat,
        lng: loc.lng,
        total_minutes,
        walk_minutes,
        transit_minutes,
        via_station_id: bestStation.id,
        via_station_name: bestStation.name
      });
    }

    // Stable order — quickest first.
    out.sort((a, b) => a.total_minutes - b.total_minutes);
    return out;
  }
}
