// Storage port for rent-agreement drafts. `DraftsService` keeps the wizard state
// machine; only row persistence flows through this interface.
//
// Two implementations: `InMemoryDraftsRepository` (dev / no DB / unit tests) and
// `DbDraftsRepository` (Postgres). Selected in rent-agreement.module.ts by
// `DatabaseService.isEnabled()`. Mirrors the StampDutyRepository pattern.

import type { DatabaseService } from "../../../common/database.service";
import type { RentAgreementRow } from "./draft-summary.mapper";
import {
  RENT_AGREEMENT_COLUMNS,
  appRowToColumns,
  dbRowToAppRow
} from "./rent-agreement-row.mapper";

export interface DraftsRepository {
  /** Insert a new agreement. No-op if (user_id, idempotency_key) already exists. */
  insert(row: RentAgreementRow): Promise<void>;
  findById(id: string): Promise<RentAgreementRow | null>;
  findByIdempotency(userId: string, idempotencyKey: string): Promise<RentAgreementRow | null>;
  findByUser(userId: string): Promise<RentAgreementRow[]>;
  /** Full-row update by id. */
  save(row: RentAgreementRow): Promise<void>;
}

// Deep-copies the mutable parts of a row so stored state and caller state never
// share references. Buffers (PAN ciphertext) are replaced wholesale, never
// mutated, so keeping the reference is safe — and avoids structuredClone turning
// a Buffer into a plain Uint8Array.
function cloneRow(row: RentAgreementRow): RentAgreementRow {
  return {
    ...row,
    step_validated_at: { ...row.step_validated_at },
    inventory_items: row.inventory_items.map((item) => ({ ...item })),
    additional_terms: [...row.additional_terms],
    witness_1: row.witness_1 ? { ...row.witness_1 } : null,
    witness_2: row.witness_2 ? { ...row.witness_2 } : null
  };
}

export class InMemoryDraftsRepository implements DraftsRepository {
  private readonly rows = new Map<string, RentAgreementRow>();
  private readonly idemIndex = new Map<string, string>();

  private idemKey(userId: string, idempotencyKey: string): string {
    return `${userId}|${idempotencyKey}`;
  }

  async insert(row: RentAgreementRow): Promise<void> {
    const key = this.idemKey(row.user_id, row.idempotency_key);
    if (this.idemIndex.has(key)) return;
    this.rows.set(row.id, cloneRow(row));
    this.idemIndex.set(key, row.id);
  }

  async findById(id: string): Promise<RentAgreementRow | null> {
    const row = this.rows.get(id);
    return row ? cloneRow(row) : null;
  }

  async findByIdempotency(
    userId: string,
    idempotencyKey: string
  ): Promise<RentAgreementRow | null> {
    const id = this.idemIndex.get(this.idemKey(userId, idempotencyKey));
    if (!id) return null;
    return this.findById(id);
  }

  async findByUser(userId: string): Promise<RentAgreementRow[]> {
    return Array.from(this.rows.values())
      .filter((row) => row.user_id === userId)
      .map(cloneRow);
  }

  async save(row: RentAgreementRow): Promise<void> {
    this.rows.set(row.id, cloneRow(row));
  }
}

export class DbDraftsRepository implements DraftsRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(row: RentAgreementRow): Promise<void> {
    const { columns, values } = appRowToColumns(row);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    await this.db.query(
      `INSERT INTO rent_agreements (${columns.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      values
    );
  }

  async findById(id: string): Promise<RentAgreementRow | null> {
    const result = await this.db.query(`SELECT * FROM rent_agreements WHERE id = $1`, [id]);
    return result.rows[0] ? dbRowToAppRow(result.rows[0]) : null;
  }

  async findByIdempotency(
    userId: string,
    idempotencyKey: string
  ): Promise<RentAgreementRow | null> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreements WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    return result.rows[0] ? dbRowToAppRow(result.rows[0]) : null;
  }

  async findByUser(userId: string): Promise<RentAgreementRow[]> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreements WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows.map(dbRowToAppRow);
  }

  async save(row: RentAgreementRow): Promise<void> {
    const { columns, values } = appRowToColumns(row);
    // Update every column except the primary key; id is the WHERE bind.
    const updatable = columns.filter((col) => col !== "id");
    const setClause = updatable.map((col) => `${col} = $${columns.indexOf(col) + 1}`).join(", ");
    const idIndex = columns.indexOf("id") + 1;
    await this.db.query(`UPDATE rent_agreements SET ${setClause} WHERE id = $${idIndex}`, values);
  }
}

// Re-exported so callers needing the canonical column list don't reach past this
// module.
export { RENT_AGREEMENT_COLUMNS };
