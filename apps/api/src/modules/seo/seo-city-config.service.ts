import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { SeoAggregatesService } from "./seo-aggregates.service";

export const INDEXABLE_MIN = 3;

export interface SeoCityConfigRow {
  city_slug: string;
  programmatic_enabled: boolean;
  locality_count: number;
  landmark_count: number;
  metro_count: number;
  indexable_count: number;
  enabled_at: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface SeoCityConfigWithCity extends SeoCityConfigRow {
  name_en: string;
  name_hi: string;
  is_active: boolean;
}

export interface RefreshedCounts {
  locality_count: number;
  landmark_count: number;
  metro_count: number;
  indexable_count: number;
}

@Injectable()
export class SeoCityConfigService {
  constructor(
    private readonly database: DatabaseService,
    private readonly aggregates: SeoAggregatesService
  ) {}

  async listEnabled(): Promise<SeoCityConfigRow[]> {
    if (!this.database.isEnabled()) return [];

    const { rows } = await this.database.query<SeoCityConfigRow>(
      `SELECT city_slug,
              programmatic_enabled,
              locality_count,
              landmark_count,
              metro_count,
              indexable_count,
              enabled_at::text AS enabled_at,
              notes,
              created_at::text AS created_at,
              updated_at::text AS updated_at
       FROM seo_city_config
       WHERE programmatic_enabled = true
       ORDER BY city_slug`,
      []
    );
    return rows;
  }

  async listAllWithCounts(): Promise<SeoCityConfigWithCity[]> {
    if (!this.database.isEnabled()) return [];

    // Base row fields (name, status, enabled_at, notes) come from the stored
    // config; the count columns are ignored here and replaced below with
    // live counts, so cities that were never toggled don't show stale 0s.
    const { rows } = await this.database.query<SeoCityConfigWithCity>(
      `SELECT c.slug AS city_slug,
              c.name_en,
              c.name_hi,
              c.is_active,
              COALESCE(scc.programmatic_enabled, false) AS programmatic_enabled,
              COALESCE(scc.locality_count, 0)::int AS locality_count,
              COALESCE(scc.landmark_count, 0)::int AS landmark_count,
              COALESCE(scc.metro_count, 0)::int AS metro_count,
              COALESCE(scc.indexable_count, 0)::int AS indexable_count,
              scc.enabled_at::text AS enabled_at,
              scc.notes,
              scc.created_at::text AS created_at,
              scc.updated_at::text AS updated_at
       FROM cities c
       LEFT JOIN seo_city_config scc ON scc.city_slug = c.slug
       ORDER BY COALESCE(scc.programmatic_enabled, false) DESC, c.slug`,
      []
    );

    const withCounts = await Promise.all(
      rows.map(async (r) => ({ ...r, ...(await this.computeCounts(r.city_slug)) }))
    );
    return withCounts;
  }

  async computeCounts(citySlug: string): Promise<RefreshedCounts> {
    if (!this.database.isEnabled()) {
      return {
        locality_count: 0,
        landmark_count: 0,
        metro_count: 0,
        indexable_count: 0
      };
    }

    const [localities, metros, landmarkCount] = await Promise.all([
      this.aggregates.localitiesForCity(citySlug),
      this.aggregates.metroStationsForCity(citySlug),
      this.countLandmarks(citySlug)
    ]);

    return {
      locality_count: localities.length,
      landmark_count: landmarkCount,
      metro_count: metros.length,
      indexable_count: localities.filter((locality) => locality.listing_count >= INDEXABLE_MIN)
        .length
    };
  }

  async setEnabled(
    citySlug: string,
    enabled: boolean,
    notes?: string
  ): Promise<SeoCityConfigRow | null> {
    if (!this.database.isEnabled()) return null;

    const counts = await this.computeCounts(citySlug);

    let rows: SeoCityConfigRow[];
    try {
      ({ rows } = await this.database.query<SeoCityConfigRow>(
        `INSERT INTO seo_city_config (
         city_slug,
         programmatic_enabled,
         notes,
         locality_count,
         landmark_count,
         metro_count,
         indexable_count,
         enabled_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $2 THEN now() ELSE NULL END, now())
       ON CONFLICT (city_slug) DO UPDATE SET
         programmatic_enabled = EXCLUDED.programmatic_enabled,
         notes = EXCLUDED.notes,
         locality_count = EXCLUDED.locality_count,
         landmark_count = EXCLUDED.landmark_count,
         metro_count = EXCLUDED.metro_count,
         indexable_count = EXCLUDED.indexable_count,
         enabled_at = CASE WHEN $2 THEN now() ELSE NULL END,
         updated_at = now()
       RETURNING city_slug,
                 programmatic_enabled,
                 locality_count,
                 landmark_count,
                 metro_count,
                 indexable_count,
                 enabled_at::text AS enabled_at,
                 notes,
                 created_at::text AS created_at,
                 updated_at::text AS updated_at`,
        [
          citySlug,
          enabled,
          notes ?? null,
          counts.locality_count,
          counts.landmark_count,
          counts.metro_count,
          counts.indexable_count
        ]
      ));
    } catch (err) {
      // city_slug references cities(slug); an unknown slug is a 404, not a raw 500.
      if (err && typeof err === "object" && (err as { code?: string }).code === "23503") {
        throw new NotFoundException({
          code: "city_not_found",
          message: `Unknown city: ${citySlug}`
        });
      }
      throw err;
    }

    return rows[0] ?? null;
  }

  private async countLandmarks(citySlug: string): Promise<number> {
    try {
      const { rows } = await this.database.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
         FROM landmarks lm
         JOIN cities c ON c.id = lm.city_id
         WHERE c.slug = $1`,
        [citySlug]
      );
      return Number(rows[0]?.count ?? 0);
    } catch {
      return 0;
    }
  }
}
