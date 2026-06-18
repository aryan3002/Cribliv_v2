import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseService } from "../../../common/database.service";
import { AppStateService } from "../../../common/app-state.service";
import type { PgProperty } from "@cribliv/shared-types";

export interface CreatePropertyInput {
  display_name: string;
  /** Public-API slug; resolved to city_id via DB lookup on write. */
  city_slug: string;
  /** Optional locality slug; resolved to locality_id (scoped by city). */
  locality_slug?: string;
  internal_code?: string;
  total_floors?: number;
  metadata?: Record<string, unknown>;
  lat?: number | null;
  lng?: number | null;
  formatted_address?: string | null;
}

/**
 * CRUD for pg_properties. Model: 1 listing : 1 property — every published
 * listing mints its own pg_property (no shared reuse). The old single-property
 * cap and its one-primary EXCLUDE constraint were removed in migration 0041.
 */
@Injectable()
export class PgPropertiesService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AppStateService) private readonly state: AppStateService
  ) {}

  async createProperty(operatorId: string, input: CreatePropertyInput): Promise<PgProperty> {
    if (!input.display_name?.trim()) {
      throw new BadRequestException({
        code: "missing_display_name",
        message: "missing_display_name: display_name is required"
      });
    }

    // 1 listing : 1 property — each publish mints its OWN fresh property, so there
    // is no single-property-per-operator cap anymore. (The one-primary EXCLUDE
    // constraint that backed that invariant was dropped in migration 0041.)
    const now = new Date().toISOString();
    const { cityId, localityId } = await this.resolveLocation(input.city_slug, input.locality_slug);

    const prop: PgProperty = {
      id: randomUUID(),
      operator_id: operatorId,
      display_name: input.display_name.trim(),
      internal_code: input.internal_code ?? null,
      city_id: cityId,
      locality_id: localityId,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      status: "active",
      is_primary: true,
      total_floors: input.total_floors ?? null,
      metadata: input.metadata ?? {},
      created_at: now,
      updated_at: now
    };

    if (this.db.isEnabled()) {
      await this.db.query(
        `INSERT INTO pg_properties
           (id, operator_id, display_name, internal_code, city_id, locality_id,
            status, is_primary, total_floors, metadata, created_at, updated_at, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          prop.id,
          prop.operator_id,
          prop.display_name,
          prop.internal_code,
          prop.city_id,
          prop.locality_id,
          prop.status,
          prop.is_primary,
          prop.total_floors,
          JSON.stringify(prop.metadata),
          prop.created_at,
          prop.updated_at,
          prop.lat,
          prop.lng
        ]
      );
    } else {
      this.state.insertPgProperty(prop as unknown as Record<string, unknown>);
    }
    return prop;
  }

  async listProperties(operatorId: string): Promise<PgProperty[]> {
    if (this.db.isEnabled()) {
      const r = await this.db.query<PgProperty>(
        `SELECT * FROM pg_properties WHERE operator_id = $1 ORDER BY created_at ASC`,
        [operatorId]
      );
      return r.rows;
    }
    return this.state.pgPropertiesByOperator(operatorId) as unknown as PgProperty[];
  }

  async getActiveProperty(operatorId: string): Promise<PgProperty | null> {
    const all = await this.listProperties(operatorId);
    return all.find((p) => p.is_primary) ?? all[0] ?? null;
  }

  /**
   * Property by id, scoped to its operator (ownership/IDOR guard). Used by the
   * create + edit flows that no longer assume a single primary property — they
   * resolve a specific property id rather than "the" active one.
   */
  async getOwnedProperty(operatorId: string, propertyId: string): Promise<PgProperty | null> {
    if (this.db.isEnabled()) {
      const r = await this.db.query<PgProperty>(
        `SELECT * FROM pg_properties WHERE id = $1::uuid AND operator_id = $2::uuid LIMIT 1`,
        [propertyId, operatorId]
      );
      return r.rows[0] ?? null;
    }
    const all = this.state.pgPropertiesByOperator(operatorId) as unknown as PgProperty[];
    return all.find((p) => p.id === propertyId) ?? null;
  }

  /**
   * Resolve city/locality slugs to integer FKs.
   * - DB path: queries cities + localities (scoped by city).
   * - In-memory path: maps known slugs to deterministic small ints for testing.
   *   ("delhi" -> 1, others -> 1; locality_slug -> 1). Sufficient for unit tests
   *   where no real city table exists.
   */
  async resolveLocation(
    citySlug: string,
    localitySlug?: string
  ): Promise<{ cityId: number; localityId: number | null }> {
    if (!this.db.isEnabled()) {
      return { cityId: 1, localityId: localitySlug ? 1 : null };
    }
    const city = await this.db.query<{ id: number }>(
      `SELECT id FROM cities WHERE slug = $1 LIMIT 1`,
      [citySlug.toLowerCase()]
    );
    if (!city.rowCount) {
      throw new BadRequestException({
        code: "unknown_city",
        message: `unknown_city: no city with slug=${citySlug}`
      });
    }
    let localityId: number | null = null;
    if (localitySlug) {
      const loc = await this.db.query<{ id: number }>(
        `SELECT id FROM localities WHERE city_id = $1 AND slug = $2 LIMIT 1`,
        [city.rows[0].id, localitySlug.toLowerCase()]
      );
      localityId = loc.rows[0]?.id ?? null;
    }
    return { cityId: city.rows[0].id, localityId };
  }
}
