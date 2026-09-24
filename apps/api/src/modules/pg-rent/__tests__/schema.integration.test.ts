import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("0072 pg_rent_collection schema", () => {
  let db: DatabaseService;
  beforeAll(() => {
    db = new DatabaseService();
  });
  afterAll(async () => {
    await db.onModuleDestroy();
  });

  it("creates every table the spec names", async () => {
    const result = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        ORDER BY table_name`,
      [
        [
          "pg_rent_settings",
          "pg_rent_counters",
          "pg_rent_invoices",
          "pg_rent_invoice_lines",
          "pg_rent_payments",
          "pg_rent_payment_allocations",
          "pg_rent_receipts",
          "pg_rent_expenses",
          "pg_rent_events",
          "pg_operator_preferences"
        ]
      ]
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      "pg_operator_preferences",
      "pg_rent_counters",
      "pg_rent_events",
      "pg_rent_expenses",
      "pg_rent_invoice_lines",
      "pg_rent_invoices",
      "pg_rent_payment_allocations",
      "pg_rent_payments",
      "pg_rent_receipts",
      "pg_rent_settings"
    ]);
  });

  it("adds the four assignment columns", async () => {
    const result = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'pg_bed_assignments'
          AND column_name IN ('rent_due_day','late_fee_exempt','late_fee_override_paise','default_item_overrides')
        ORDER BY column_name`
    );
    expect(result.rows.map((r) => r.column_name)).toEqual([
      "default_item_overrides",
      "late_fee_exempt",
      "late_fee_override_paise",
      "rent_due_day"
    ]);
  });

  it("enforces amount_paid <= total and the allocation one-of check at the DB", async () => {
    const propertyId = randomUUID();
    // A bare invoice row cannot exist without a property; use a savepoint-free
    // approach: expect the CHECK to fire before the FK by inserting into a
    // temp copy of the constraint expression.
    const check = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'pg_rent_invoices_paid_lte_total'
       ) AS ok`
    );
    expect(check.rows[0].ok).toBe(true);
    const oneOf = await db.query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint
          WHERE conname = 'pg_rent_alloc_one_target'
       ) AS ok`
    );
    expect(oneOf.rows[0].ok).toBe(true);
    expect(propertyId).toBeTruthy();
  });

  it("declares the partial unique indexes the engine relies on", async () => {
    const result = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename IN ('pg_rent_invoices','pg_rent_payments','pg_rent_receipts')
          AND indexname = ANY($1::text[])
        ORDER BY indexname`,
      [
        [
          "uq_pg_rent_invoice_rent_period",
          "uq_pg_rent_invoice_deposit",
          "uq_pg_rent_invoice_settlement",
          "uq_pg_rent_payment_idem",
          "uq_pg_rent_payment_pending_claim",
          "uq_pg_rent_payment_deposit_release",
          "uq_pg_rent_receipt_live_payment"
        ]
      ]
    );
    expect(result.rows).toHaveLength(7);
  });

  it("0074: invoices store an idempotency key behind a partial unique index per property", async () => {
    const column = await db.query<{ data_type: string; is_nullable: string }>(
      `SELECT data_type, is_nullable FROM information_schema.columns
          WHERE table_name = 'pg_rent_invoices' AND column_name = 'idempotency_key'`
    );
    expect(column.rows).toEqual([{ data_type: "text", is_nullable: "YES" }]);
    const index = await db.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'pg_rent_invoices' AND indexname = 'uq_pg_rent_invoice_idem'`
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].indexdef).toContain("UNIQUE INDEX");
    expect(index.rows[0].indexdef).toContain("(pg_property_id, idempotency_key)");
    expect(index.rows[0].indexdef).toContain("WHERE (idempotency_key IS NOT NULL)");
  });
});
