import { Injectable, NotFoundException } from "@nestjs/common";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { DatabaseService } from "../../common/database.service";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { readFeatureFlags } from "../../config/feature-flags";
import { IndexingService } from "./indexing.service";

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
  /**
   * Live-computed, not a stored column — `listAllWithCounts` spreads it in from
   * `computeCounts`. Declared here so the admin response shape is explicit
   * rather than an accidental extra key from a spread.
   */
  thin_count: number;
}

export interface RefreshedCounts {
  locality_count: number;
  landmark_count: number;
  metro_count: number;
  /**
   * Places clearing the listing threshold across ALL three kinds — localities,
   * metro stations and landmarks. This used to count localities only, so the
   * admin's headline ignored ~32k of the surface it was supposed to describe.
   */
  indexable_count: number;
  /**
   * Places that exist but are below the threshold, so they render `noindex` and
   * stay out of the sitemap. This is the number that should gate an Enable
   * decision: a city with 300 thin places and 0 indexable ones adds nothing.
   * Computed live only — there is no column for it.
   */
  thin_count: number;
}

@Injectable()
export class SeoCityConfigService {
  constructor(
    private readonly database: DatabaseService,
    private readonly aggregates: SeoAggregatesService,
    private readonly indexing: IndexingService
  ) {}

  async listEnabled(): Promise<SeoCityConfigRow[]> {
    if (!this.database.isEnabled()) return [];
    if (!readFeatureFlags().ff_programmatic_seo_cities_enabled) return [];

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
        indexable_count: 0,
        thin_count: 0
      };
    }

    const [localities, metros, landmarks] = await Promise.all([
      this.aggregates.localitiesForCity(citySlug),
      this.aggregates.metroStationsWithCountsForCity(citySlug),
      this.aggregates.landmarksWithCountsForCity(citySlug)
    ]);

    const passes = (count: number) => count >= INDEXABLE_MIN_LISTINGS;
    const indexableLocalities = localities.filter((row) => passes(row.listing_count)).length;
    const indexableMetro = metros.filter((row) => passes(row.listing_count)).length;
    const indexableLandmarks = landmarks.filter((row) => passes(row.listing_count)).length;
    const indexable = indexableLocalities + indexableMetro + indexableLandmarks;

    return {
      locality_count: localities.length,
      landmark_count: landmarks.length,
      metro_count: metros.length,
      indexable_count: indexable,
      thin_count: localities.length + metros.length + landmarks.length - indexable
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
         -- Keep the date this city was FIRST enabled. Setting it to NULL on
         -- disable destroyed the history the admin table displays, and stamping
         -- now() on every re-enable would misreport how long a city has been
         -- live. COALESCE stamps only the first enable; disabling leaves it.
         enabled_at = CASE
           WHEN $2 THEN COALESCE(seo_city_config.enabled_at, now())
           ELSE seo_city_config.enabled_at
         END,
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

    if (enabled && rows[0]) {
      for (const locale of ["en", "hi"] as const) {
        this.indexing.enqueue(`/${locale}/city/${citySlug}`, "city_enabled").catch(() => undefined);
      }
    }

    return rows[0] ?? null;
  }
}
