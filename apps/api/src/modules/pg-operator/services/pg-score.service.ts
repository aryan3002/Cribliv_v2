import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";
import { computePgListingScore } from "@cribliv/shared-types";
import type { PgScoreSignals, PgScoreResult, PgListingPayload } from "@cribliv/shared-types";

/**
 * PG listing score. The composite is computed by the shared, deterministic
 * `computePgListingScore` (the same fn the wizard meter uses — single source of
 * truth) and persisted into the shared `listing_scores` table that `/pg`
 * ranking reads.
 *
 * IMPORTANT: PG listings are EXCLUDED from the generic worker recompute
 * (`runRankingRecompute`, which uses the flat/house formula keyed on
 * bhk/area_sqft and would clobber PG scores). PG scores are owned here: written
 * on every state change (create / submit / go-live) via `rescoreListing`, and
 * refreshed periodically by the worker which instantiates this service over a
 * pool adapter.
 */
/** One row of the scoring SELECT — shared by the single + batch read paths. */
interface PgScoreRow {
  listing_id: string;
  display_name: string | null;
  verification_status: string | null;
  created_at: string | Date | null;
  city_slug: string | null;
  lat: number | null;
  gender_policy: string | null;
  tenant_type: string | null;
  security_deposit_paise: number | null;
  meals: unknown;
  amenities: unknown;
  house_rules: unknown;
  total_beds: number | null;
  photo_count: number;
  room_types: PgListingPayload["room_types"];
}

/** The five REAL columns the shared listing_scores table stores for a PG. */
interface ScoreColumns {
  verification: number;
  freshness: number;
  photo: number;
  completeness: number;
  composite: number;
}

@Injectable()
export class PgScoreService {
  private readonly logger = new Logger(PgScoreService.name);

  // Column set + joins shared by rescoreListing (single, by id) and
  // recomputeActiveScores (batch, keyset-paged). Callers append the WHERE.
  // Keeping ONE select body guarantees both paths feed computePgListingScore
  // identical inputs — no drift between single-rescore and the periodic job.
  private static readonly SCORING_SELECT = `
    SELECT
      l.id::text                 AS listing_id,
      l.title_en                 AS display_name,
      l.verification_status      AS verification_status,
      l.created_at               AS created_at,
      c.slug                     AS city_slug,
      ll.lat                     AS lat,
      pgd.gender_policy          AS gender_policy,
      pgd.tenant_type            AS tenant_type,
      pgd.security_deposit_paise AS security_deposit_paise,
      pgd.meals                  AS meals,
      pgd.amenities              AS amenities,
      pgd.house_rules            AS house_rules,
      pgd.total_beds             AS total_beds,
      (SELECT count(*)::int FROM listing_photos lp
         WHERE lp.listing_id = l.id AND lp.moderation_status != 'rejected') AS photo_count,
      COALESCE(
        (SELECT json_agg(json_build_object(
           'sharing', rt.sharing, 'ac', rt.ac,
           'monthly_rent_paise', rt.monthly_rent_paise,
           'vacancy_count', rt.vacancy_count))
         FROM pg_room_types rt WHERE rt.listing_id = l.id),
        '[]'::json) AS room_types
    FROM listings l
    JOIN listing_locations ll ON ll.listing_id = l.id
    LEFT JOIN cities c ON c.id = ll.city_id
    LEFT JOIN pg_details pgd ON pgd.listing_id = l.id`;

  constructor(private readonly db: DatabaseService) {}

  compute(payload: PgListingPayload, signals: PgScoreSignals): PgScoreResult {
    return computePgListingScore(payload, signals);
  }

  /** A DB row → the (payload, signals) computePgListingScore consumes. */
  private rowToInputs(row: PgScoreRow): { payload: PgListingPayload; signals: PgScoreSignals } {
    const payload = {
      property: { display_name: row.display_name ?? "", city_slug: row.city_slug ?? "" },
      pg_details: {
        total_beds: row.total_beds ?? 0,
        gender_policy: row.gender_policy ?? null,
        tenant_type: row.tenant_type ?? null,
        security_deposit_paise: row.security_deposit_paise ?? null,
        meals: row.meals ?? null,
        amenities: row.amenities ?? null,
        house_rules: row.house_rules ?? null
      },
      room_types: row.room_types ?? []
    } as PgListingPayload;

    const verification_status: PgScoreSignals["verification_status"] =
      row.verification_status === "verified"
        ? "verified"
        : row.verification_status === "pending"
          ? "pending"
          : "unverified";

    const signals: PgScoreSignals = {
      verification_status,
      created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
      has_exact_geo: row.lat != null,
      photo_count: Number(row.photo_count ?? 0)
    };
    return { payload, signals };
  }

  /**
   * Fold a PgScoreResult into the shared table's columns. PG-only factors
   * (pricing, geo_precision, amenities) are averaged into completeness_score —
   * no new columns needed. The authoritative ranking value is composite_score.
   * Single source of this mapping → single + batch persist can't diverge.
   */
  private resultToColumns(r: PgScoreResult): ScoreColumns {
    const byKey = Object.fromEntries(r.factors.map((f) => [f.key, f.score]));
    const completeness =
      ((byKey.completeness ?? 0) +
        (byKey.pricing ?? 0) +
        (byKey.geo_precision ?? 0) +
        (byKey.amenities ?? 0)) /
      4;
    return {
      verification: byKey.verification ?? 0,
      freshness: byKey.freshness ?? 1,
      photo: byKey.photos ?? 0,
      completeness,
      composite: r.composite / 100
    };
  }

  /** Persist a single computed score into the shared listing_scores table. */
  private async persist(listingId: string, r: PgScoreResult): Promise<void> {
    if (!this.db.isEnabled()) return;
    const c = this.resultToColumns(r);
    try {
      await this.db.query(
        `INSERT INTO listing_scores
           (listing_id, verification_score, freshness_score, photo_score,
            completeness_score, composite_score, computed_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, now())
         ON CONFLICT (listing_id) DO UPDATE SET
           verification_score = EXCLUDED.verification_score,
           freshness_score    = EXCLUDED.freshness_score,
           photo_score        = EXCLUDED.photo_score,
           completeness_score = EXCLUDED.completeness_score,
           composite_score    = EXCLUDED.composite_score,
           computed_at        = now()`,
        [listingId, c.verification, c.freshness, c.photo, c.completeness, c.composite]
      );
    } catch (e) {
      this.logger.warn(`pg score persist failed ${listingId}: ${String(e)}`);
    }
  }

  /** Persist many scores in ONE set-based UPSERT (PERF-H5: no per-row writes). */
  private async persistBatch(items: Array<{ listingId: string; r: PgScoreResult }>): Promise<void> {
    if (!items.length || !this.db.isEnabled()) return;
    const ids: string[] = [];
    const ver: number[] = [];
    const fre: number[] = [];
    const pho: number[] = [];
    const com: number[] = [];
    const cmp: number[] = [];
    for (const { listingId, r } of items) {
      const c = this.resultToColumns(r);
      ids.push(listingId);
      ver.push(c.verification);
      fre.push(c.freshness);
      pho.push(c.photo);
      com.push(c.completeness);
      cmp.push(c.composite);
    }
    try {
      await this.db.query(
        `INSERT INTO listing_scores
           (listing_id, verification_score, freshness_score, photo_score,
            completeness_score, composite_score, computed_at)
         SELECT u.listing_id, u.ver, u.fre, u.pho, u.com, u.cmp, now()
         FROM unnest($1::uuid[], $2::real[], $3::real[], $4::real[], $5::real[], $6::real[])
           AS u(listing_id, ver, fre, pho, com, cmp)
         ON CONFLICT (listing_id) DO UPDATE SET
           verification_score = EXCLUDED.verification_score,
           freshness_score    = EXCLUDED.freshness_score,
           photo_score        = EXCLUDED.photo_score,
           completeness_score = EXCLUDED.completeness_score,
           composite_score    = EXCLUDED.composite_score,
           computed_at        = now()`,
        [ids, ver, fre, pho, com, cmp]
      );
    } catch (e) {
      this.logger.warn(`pg score batch persist failed (${items.length} rows): ${String(e)}`);
    }
  }

  /**
   * Re-score every ACTIVE PG, keyset-paged in batches (PERF-H5). Replaces the
   * worker's per-row loop (1 SELECT + 1 UPSERT × N) with ~2 queries per page:
   * one set read + one set UPSERT. Same formula (computePgListingScore) and the
   * same inputs as rescoreListing → identical persisted values, bounded memory,
   * pool-friendly. Returns the number of listings scored.
   */
  async recomputeActiveScores(batchSize = 500): Promise<number> {
    if (!this.db.isEnabled()) return 0;
    let after = "00000000-0000-0000-0000-000000000000";
    let total = 0;
    for (;;) {
      const res = await this.db.query<PgScoreRow>(
        `${PgScoreService.SCORING_SELECT}
         WHERE l.listing_type = 'pg' AND l.status = 'active' AND l.id > $1::uuid
         ORDER BY l.id
         LIMIT $2`,
        [after, batchSize]
      );
      const rows = res.rows;
      if (!rows.length) break;
      const items = rows.map((row) => {
        const { payload, signals } = this.rowToInputs(row);
        return { listingId: row.listing_id, r: computePgListingScore(payload, signals) };
      });
      await this.persistBatch(items);
      total += items.length;
      after = rows[rows.length - 1].listing_id;
      if (rows.length < batchSize) break;
    }
    return total;
  }

  /**
   * Compute from an in-hand payload + signals and persist. Kept for callers
   * that already hold the payload; `rescoreListing` is preferred because it
   * reads real photo/verification/geo from the DB.
   */
  async recordScore(
    listingId: string,
    payload: PgListingPayload,
    signals: PgScoreSignals
  ): Promise<PgScoreResult> {
    const r = computePgListingScore(payload, signals);
    await this.persist(listingId, r);
    return r;
  }

  /**
   * Canonical re-score: rebuild payload + signals from DB truth (REAL photo
   * count, verification status, exact-geo, created_at) and persist. Idempotent.
   * Call after any change that affects the score — create, photo upload,
   * submit, go-live, verification — and from the periodic worker. This fixes
   * the "photo_count always 0 / verification always unverified" bug that
   * hardcoded signals had: values come from the database, not a create-time
   * snapshot.
   */
  async rescoreListing(listingId: string): Promise<PgScoreResult | null> {
    if (!this.db.isEnabled()) return null;
    try {
      const res = await this.db.query<PgScoreRow>(
        `${PgScoreService.SCORING_SELECT}
         WHERE l.id = $1::uuid AND l.listing_type = 'pg'`,
        [listingId]
      );

      const row = res.rows[0];
      if (!row) return null;

      const { payload, signals } = this.rowToInputs(row);
      const r = computePgListingScore(payload, signals);
      await this.persist(listingId, r);
      return r;
    } catch (e) {
      this.logger.warn(`pg rescore failed ${listingId}: ${String(e)}`);
      return null;
    }
  }
}
