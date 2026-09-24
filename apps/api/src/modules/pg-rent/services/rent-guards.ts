import { ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { QueryResult, QueryResultRow } from "pg";

import type { DatabaseService } from "../../../common/database.service";
import { readFeatureFlags } from "../../../config/feature-flags";

/** The one query surface both a transaction `PoolClient` and `DatabaseService` satisfy. */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<QueryResult<T>>;
}

export interface RentActor {
  id: string | null;
  role: "tenant" | "pg_operator" | "admin" | "system";
}

export const SYSTEM_ACTOR: RentActor = { id: null, role: "system" };

/** D13: the rent module has no in-memory twin. */
export function requireDb(db: Pick<DatabaseService, "isEnabled">): void {
  if (!db.isEnabled()) {
    throw new ServiceUnavailableException({
      code: "rent_requires_db",
      message: "Rent collection requires a database"
    });
  }
}

/** HTTP gate only (spec §12). Internal hooks never call this. */
export function assertRentFlag(): void {
  if (!readFeatureFlags().ff_pg_rent_collection) {
    throw new NotFoundException({
      code: "feature_disabled",
      message: "Rent collection is not enabled"
    });
  }
}

/** Same rule as pg-bed-assignment.service.ts assertManagedOwnership; lock when inside a transaction. */
export async function assertManagedOwnership(
  q: Queryable,
  operatorId: string,
  propertyId: string,
  lock = false
): Promise<void> {
  const result = await q.query<{ id: string }>(
    `SELECT id FROM pg_properties
      WHERE id = $1::uuid AND operator_id = $2::uuid AND manage_enabled = true
      LIMIT 1${lock ? " FOR UPDATE" : ""}`,
    [propertyId, operatorId]
  );
  if (!result.rows[0]) {
    throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
  }
}

/** Spec §9: every assignment the user matches, any status, no auto-link. */
export async function resolveTenantAssignmentIds(q: Queryable, userId: string): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    `SELECT a.id::text FROM pg_bed_assignments a JOIN users u ON u.id = $1::uuid
      WHERE a.tenant_user_id = u.id OR (a.tenant_user_id IS NULL AND a.occupant_phone_e164 = u.phone_e164)`,
    [userId]
  );
  return r.rows.map((x) => x.id);
}
