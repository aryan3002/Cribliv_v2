import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
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
}

/**
 * CRUD for pg_properties. V1 invariant: at most ONE property per operator
 * (multi-property is V2, gated by ff_pg_multi_property_enabled).
 * Schema already supports many — UI/service guards keep V1 single.
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

    const existing = await this.listProperties(operatorId);
    if (existing.length >= 1) {
      throw new ConflictException({
        code: "multi_property_not_enabled",
        message:
          "multi_property_not_enabled: V1 supports a single property per operator. Contact support to add more."
      });
    }

    const now = new Date().toISOString();
    const { cityId, localityId } = await this.resolveLocation(input.city_slug, input.locality_slug);

    const prop: PgProperty = {
      id: randomUUID(),
      operator_id: operatorId,
      display_name: input.display_name.trim(),
      internal_code: input.internal_code ?? null,
      city_id: cityId,
      locality_id: localityId,
      lat: null,
      lng: null,
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
            status, is_primary, total_floors, metadata, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
          prop.updated_at
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
   * Resolve city/locality slugs to integer FKs.
   * - DB path: queries cities + localities (scoped by city).
   * - In-memory path: maps known slugs to deterministic small ints for testing.
   *   ("delhi" -> 1, others -> 1; locality_slug -> 1). Sufficient for unit tests
   *   where no real city table exists.
   */
  private async resolveLocation(
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
