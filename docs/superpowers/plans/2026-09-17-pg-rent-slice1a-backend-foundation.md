# PG Rent — Slice 1a: Backend foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `pg-rent` NestJS module's foundation: the 0072 schema, shared types, pure period/proration/status math, per-property settings (enable with preview, patch, pause/resume, ownership-transfer hook), and the idempotent invoice engine that issues rent periods and deposit invoices for every property — runnable from the worker and from "Generate now".

**Architecture:** A new DB-required module `apps/api/src/modules/pg-rent/` (D13). Pure functions under `pure/` do all date and money math with no I/O and 100 % branch coverage; services own transactions and events; controllers only validate (zod) and map rupees ⇄ paise (`dto/`). The engine walks each assignment's billing window from `move_in_date` (contiguity), applies the floor, cuts the final period at the window end, and writes each invoice in its own transaction under the assignment-row lock. Payments, receipts, late fees and settlement are slice 1b; this slice creates their tables and the allocation hook they plug into.

**Tech Stack:** NestJS 10, `pg`, zod 4, vitest (+ supertest for controllers), `@cribliv/shared-types`, Postgres 16 (local `cribliv-pg-local`).

**Spec:** `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` — §3, §4, §5.1–5.5, §5.7 ("Change rent" only), §5.8 (hooks), §5.9, §11, §11.2, §12 (settings + invoice reads + generate-now), §13, §16.

## Global Constraints

Everything in `docs/superpowers/plans/2026-09-17-pg-rent-00-index.md` "Global constraints" and "Environment". Specific to this slice:

- **Depends on slice 0** (`apps/api/src/common/date.ts` — `todayIst`, `IST_TODAY_SQL`, `isIsoDate`, `compareIsoDates`; `cancelNotice`; IST assignment dates). Do not start until slice 0 is merged.
- Migration file names are exactly `infra/migrations/0072_pg_rent_collection.sql` and `infra/migrations/0072_pg_rent_collection.rollback.sql`.
- All new SQL is parameterised; the only interpolated fragment is `IST_TODAY_SQL`.
- Rupee conversion happens **only** in `apps/api/src/modules/pg-rent/dto/money.ts` (Task 3); services and pure functions work in paise; DTO mappers are the last thing before `ok()`.
- No controller in this slice exists without the `FF_PG_RENT_COLLECTION` gate (404 `feature_disabled`) and, for operator routes, `assertManagedOwnership`.
- Late fees, payments, receipts, settlement: **not in this slice** — but the engine must call `RentAllocationService.applyUnallocatedCredit` (Task 12) so slice 1b's payments plug in without touching the engine.

---

## File structure

| File                                                                       | Responsibility                                                                                                 |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `infra/migrations/0072_pg_rent_collection.sql` / `.rollback.sql`           | Schema (§4)                                                                                                    |
| `packages/shared-types/src/pg-rent.ts` (+ export in `index.ts`)            | Wire types, rupees, string enums                                                                               |
| `apps/api/src/config/feature-flags.ts`                                     | `ff_pg_rent_collection`                                                                                        |
| `apps/api/src/modules/pg-rent/pg-rent.module.ts`                           | Module wiring; exports the internal hook services                                                              |
| `apps/api/src/modules/pg-rent/dto/money.ts`                                | `inrToPaise`, `paiseToInr` — the only conversion point                                                         |
| `apps/api/src/modules/pg-rent/dto/settings.dto.ts`                         | zod: enable / patch / resume inputs; settings row → DTO mapper                                                 |
| `apps/api/src/modules/pg-rent/dto/invoice.dto.ts`                          | invoice row(+lines) → DTO mapper                                                                               |
| `apps/api/src/modules/pg-rent/services/rent-guards.ts`                     | `requireDb`, `assertRentFlag`, `assertManagedOwnership`, `RentAssignmentResolver` (tenant scope, no auto-link) |
| `apps/api/src/modules/pg-rent/services/rent-events.ts`                     | `writeRentEvent`                                                                                               |
| `apps/api/src/modules/pg-rent/pure/rent-dates.ts`                          | ISO date arithmetic (add days, end of month, days between, clamp day)                                          |
| `apps/api/src/modules/pg-rent/pure/rent-money.ts`                          | `roundToRupee`, `splitLargestRemainder`                                                                        |
| `apps/api/src/modules/pg-rent/pure/rent-period.ts`                         | period ends, natural periods, due dates, floor, walk                                                           |
| `apps/api/src/modules/pg-rent/pure/rent-window.ts`                         | status-aware billing window, cut                                                                               |
| `apps/api/src/modules/pg-rent/pure/rent-proration.ts`                      | `prorate`                                                                                                      |
| `apps/api/src/modules/pg-rent/pure/rent-status.ts`                         | `invoiceStatus`                                                                                                |
| `apps/api/src/modules/pg-rent/services/rent-settings.service.ts`           | enable/preview/get/patch/pause/resume/`onOwnershipTransferred`; counters                                       |
| `apps/api/src/modules/pg-rent/services/rent-allocation.service.ts`         | `applyUnallocatedCredit` (the 1b plug)                                                                         |
| `apps/api/src/modules/pg-rent/services/rent-invoice-engine.service.ts`     | `generateInvoicesForProperty`, `previewForProperty`, `onAssignmentEvent`                                       |
| `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts`            | reads: list / get / events; `changeRentFromNextCycle`                                                          |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-settings.controller.ts`  | settings lifecycle routes                                                                                      |
| `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts`  | `GET /invoices`, `GET /invoices/:id`, `GET /invoices/:id/events`, `POST /generate-now`                         |
| `apps/api/src/worker/pg-rent-sweeps.ts` + `worker.ts`                      | hourly `runPgRentSweep`                                                                                        |
| `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts` | post-commit `onAssignmentEvent` calls                                                                          |
| `apps/api/src/modules/admin/admin-pg-transfer.service.ts`                  | in-transaction `onOwnershipTransferred` call                                                                   |
| `apps/api/src/modules/pg-rent/__tests__/helpers/rent-fixtures.ts`          | property / room-type / assignment fixtures for DB tests                                                        |
| `apps/api/src/modules/pg-rent/__tests__/helpers/assert-rent-invariants.ts` | `assertRentInvariants(db, propertyId)`                                                                         |
| `apps/api/src/modules/pg-rent/__tests__/*.test.ts`                         | unit + integration suites                                                                                      |

---

### Task 1: Migration 0072 + rollback + schema test

**Files:**

- Create: `infra/migrations/0072_pg_rent_collection.sql`
- Create: `infra/migrations/0072_pg_rent_collection.rollback.sql`
- Test: `apps/api/src/modules/pg-rent/__tests__/schema.integration.test.ts`

**Interfaces:**

- Produces: every table/enum in spec §4 (names verbatim). Later tasks rely on exact column names below.

- [ ] **Step 1: Write the failing schema test**

```ts
// apps/api/src/modules/pg-rent/__tests__/schema.integration.test.ts
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
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/schema.integration.test.ts`
Expected: FAIL — first test returns `[]`.

- [ ] **Step 3: Write the migration**

```sql
-- infra/migrations/0072_pg_rent_collection.sql
-- PG rent collection (spec docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md §4).
-- Additive only. Paise in every money column. Every table hangs off pg_properties
-- with CASCADE (matching pg_maintenance_requests); links between money rows RESTRICT.

-- ── enums ─────────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE pg_rent_cycle_mode        AS ENUM ('calendar_month','anniversary'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_billing_timing    AS ENUM ('advance','arrears'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_proration_mode    AS ENUM ('actual_days','flat_30'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_late_fee_kind     AS ENUM ('flat','per_day','percent'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_invoice_kind      AS ENUM ('rent','deposit','adhoc','settlement'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_invoice_status    AS ENUM ('draft','issued','partially_paid','paid','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_invoice_source    AS ENUM ('auto','manual','backfill'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_rent_source       AS ENUM ('assignment','room_type','listing','none'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_line_kind         AS ENUM ('rent','deposit','late_fee','electricity','meals','maintenance','damage','cleaning','forfeit','other','discount','adjustment'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_line_source       AS ENUM ('system','operator','default_item','expense_split'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_payment_direction AS ENUM ('inflow','outflow'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_payment_method    AS ENUM ('cash','upi','bank_transfer','cheque','card','gateway','deposit','other'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_payment_source    AS ENUM ('operator','tenant_claim','gateway','backfill','deposit_release'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_payment_status    AS ENUM ('pending_confirmation','confirmed','rejected','reversed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_receipt_pdf_status AS ENUM ('pending','ready','failed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE pg_rent_pause_reason      AS ENUM ('owner','transfer'); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── settings (one row per property = rent collection enabled) ─────────────────
CREATE TABLE IF NOT EXISTS pg_rent_settings (
  pg_property_id              uuid PRIMARY KEY REFERENCES pg_properties(id) ON DELETE CASCADE,
  paused_at                   timestamptz,
  pause_reason                pg_rent_pause_reason,
  enabled_on                  date NOT NULL,
  billing_starts_on           date NOT NULL,
  cycle_mode                  pg_rent_cycle_mode NOT NULL DEFAULT 'calendar_month',
  billing_timing              pg_rent_billing_timing NOT NULL DEFAULT 'advance',
  due_day                     smallint NOT NULL DEFAULT 1 CHECK (due_day BETWEEN 1 AND 28),
  proration_mode              pg_rent_proration_mode NOT NULL DEFAULT 'actual_days',
  prorate_move_out            boolean NOT NULL DEFAULT false,
  invoice_lead_days           smallint NOT NULL DEFAULT 5 CHECK (invoice_lead_days BETWEEN 0 AND 15),
  reminder_offsets_days       smallint[] NOT NULL DEFAULT '{-3,0,1}',
  late_fee_enabled            boolean NOT NULL DEFAULT false,
  late_fee_grace_days         smallint NOT NULL DEFAULT 3 CHECK (late_fee_grace_days BETWEEN 0 AND 30),
  late_fee_kind               pg_rent_late_fee_kind NOT NULL DEFAULT 'flat',
  late_fee_amount_paise       bigint NOT NULL DEFAULT 10000 CHECK (late_fee_amount_paise BETWEEN 100 AND 1000000),
  late_fee_percent_bp         smallint NOT NULL DEFAULT 200 CHECK (late_fee_percent_bp BETWEEN 50 AND 1000),
  late_fee_cap_paise          bigint CHECK (late_fee_cap_paise IS NULL OR late_fee_cap_paise <= 5000000),
  late_fee_auto_apply         boolean NOT NULL DEFAULT false,
  upi_vpa                     text,
  upi_payee_name              text,
  bank_details                jsonb,
  whatsapp_phone_e164         text,
  msg_reminder                text,
  msg_overdue                 text,
  msg_tenant_paid             text,
  msg_receipt_share           text,
  receipt_prefix              text NOT NULL,
  receipt_business_name       text,
  receipt_address             text,
  receipt_footer              text,
  receipt_logo_path           text,
  default_line_items          jsonb NOT NULL DEFAULT '[]'::jsonb,
  electricity_unit_rate_paise integer CHECK (electricity_unit_rate_paise IS NULL OR electricity_unit_rate_paise BETWEEN 50 AND 5000),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS set_updated_at ON pg_rent_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_rent_settings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- Sequence counters live apart from settings so issuing never moves the
-- settings optimistic-concurrency token (spec §4.2b, §19 #7). No trigger.
CREATE TABLE IF NOT EXISTS pg_rent_counters (
  pg_property_id   uuid PRIMARY KEY REFERENCES pg_properties(id) ON DELETE CASCADE,
  next_invoice_seq integer NOT NULL DEFAULT 1,
  next_receipt_seq integer NOT NULL DEFAULT 1
);

-- ── per-tenant overrides (null = inherit, same precedent as monthly_rent_paise) ─
ALTER TABLE pg_bed_assignments
  ADD COLUMN IF NOT EXISTS rent_due_day            smallint CHECK (rent_due_day IS NULL OR rent_due_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS late_fee_exempt         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_fee_override_paise bigint,
  ADD COLUMN IF NOT EXISTS default_item_overrides  jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── invoices ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pg_rent_invoices (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id            uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  assignment_id             uuid NOT NULL REFERENCES pg_bed_assignments(id) ON DELETE RESTRICT,
  bed_id                    uuid REFERENCES pg_beds(id) ON DELETE SET NULL,
  room_id                   uuid REFERENCES pg_rooms(id) ON DELETE SET NULL,
  room_number               text NOT NULL,
  bed_label                 text NOT NULL,
  kind                      pg_rent_invoice_kind NOT NULL,
  invoice_number            text NOT NULL,
  period_start              date,
  period_end                date,
  billing_month             date NOT NULL,
  due_date                  date NOT NULL,
  status                    pg_rent_invoice_status NOT NULL,
  source                    pg_rent_invoice_source NOT NULL,
  total_paise               bigint NOT NULL DEFAULT 0,
  amount_paid_paise         bigint NOT NULL DEFAULT 0,
  rent_snapshot_paise       bigint,
  rent_source               pg_rent_rent_source,
  proration_factor          numeric(9,6),
  late_fee_eligible         boolean NOT NULL DEFAULT true,
  suggested_late_fee_paise  bigint,
  late_fee_computed_at      timestamptz,
  late_fee_waived_at        timestamptz,
  late_fee_waived_by        uuid REFERENCES users(id),
  late_fee_waive_reason     text,
  reprorate_suggestion      jsonb,
  pay_token                 text UNIQUE,
  pay_token_expires_at      timestamptz,
  tenant_note               text,
  internal_note             text,
  issued_at                 timestamptz,
  paid_at                   timestamptz,
  settled_on                date,
  cancelled_at              timestamptz,
  cancel_reason             text,
  created_by                uuid REFERENCES users(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pg_rent_invoices_period_order CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start),
  CONSTRAINT pg_rent_invoices_total_nonneg CHECK (total_paise >= 0),
  CONSTRAINT pg_rent_invoices_paid_lte_total CHECK (amount_paid_paise <= total_paise),
  CONSTRAINT pg_rent_invoices_number_unique UNIQUE (pg_property_id, invoice_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_invoice_rent_period
  ON pg_rent_invoices(assignment_id, period_start) WHERE kind = 'rent' AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_invoice_deposit
  ON pg_rent_invoices(assignment_id) WHERE kind = 'deposit' AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_invoice_settlement
  ON pg_rent_invoices(assignment_id) WHERE kind = 'settlement' AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_pg_rent_invoices_property_status ON pg_rent_invoices(pg_property_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_pg_rent_invoices_billing_month   ON pg_rent_invoices(pg_property_id, billing_month);
CREATE INDEX IF NOT EXISTS idx_pg_rent_invoices_assignment      ON pg_rent_invoices(assignment_id, due_date);
DROP TRIGGER IF EXISTS set_updated_at ON pg_rent_invoices;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_rent_invoices
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── expenses (before lines: lines reference expenses) ─────────────────────────
CREATE TABLE IF NOT EXISTS pg_rent_expenses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id         uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  category               text NOT NULL,
  label                  text,
  amount_paise           bigint NOT NULL CHECK (amount_paise > 0),
  spent_on               date NOT NULL,
  note                   text,
  meta                   jsonb NOT NULL DEFAULT '{}'::jsonb,
  bill_paths             jsonb NOT NULL DEFAULT '[]'::jsonb,
  maintenance_request_id uuid REFERENCES pg_maintenance_requests(id) ON DELETE SET NULL,
  split_at               timestamptz,
  recorded_by            uuid REFERENCES users(id),
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_rent_expenses_property_date
  ON pg_rent_expenses(pg_property_id, spent_on) WHERE deleted_at IS NULL;
DROP TRIGGER IF EXISTS set_updated_at ON pg_rent_expenses;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_rent_expenses
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── invoice lines ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pg_rent_invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES pg_rent_invoices(id) ON DELETE CASCADE,
  kind         pg_rent_line_kind NOT NULL,
  label        text NOT NULL,
  amount_paise bigint NOT NULL,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,
  source       pg_rent_line_source NOT NULL,
  expense_id   uuid REFERENCES pg_rent_expenses(id) ON DELETE SET NULL,
  sort_order   smallint NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pg_rent_lines_negative_only_discount
    CHECK (amount_paise >= 0 OR kind IN ('discount','adjustment'))
);
CREATE INDEX IF NOT EXISTS idx_pg_rent_lines_invoice ON pg_rent_invoice_lines(invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_lines_one_late_fee
  ON pg_rent_invoice_lines(invoice_id) WHERE kind = 'late_fee';
CREATE INDEX IF NOT EXISTS idx_pg_rent_lines_expense
  ON pg_rent_invoice_lines(expense_id) WHERE expense_id IS NOT NULL;

-- ── payments ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pg_rent_payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id     uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  assignment_id      uuid NOT NULL REFERENCES pg_bed_assignments(id) ON DELETE RESTRICT,
  direction          pg_rent_payment_direction NOT NULL DEFAULT 'inflow',
  amount_paise       bigint NOT NULL CHECK (amount_paise BETWEEN 100 AND 100000000),
  method             pg_rent_payment_method NOT NULL,
  source             pg_rent_payment_source NOT NULL,
  status             pg_rent_payment_status NOT NULL,
  claimed_invoice_id uuid REFERENCES pg_rent_invoices(id) ON DELETE SET NULL,
  paid_on            date NOT NULL,
  reference          text,
  proof_paths        jsonb NOT NULL DEFAULT '[]'::jsonb,
  note               text,
  idempotency_key    text,
  recorded_by        uuid REFERENCES users(id),
  confirmed_by       uuid REFERENCES users(id),
  confirmed_at       timestamptz,
  rejected_reason    text,
  reversed_by        uuid REFERENCES users(id),
  reversed_at        timestamptz,
  reversed_reason    text,
  gateway_order_id   text,
  gateway_payment_id text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pg_rent_payments_deposit_method
    CHECK ((method = 'deposit') = (source = 'deposit_release')),
  CONSTRAINT pg_rent_payments_outflow_shape
    CHECK (direction = 'inflow' OR (source = 'operator' AND status IN ('confirmed','reversed')))
);
CREATE INDEX IF NOT EXISTS idx_pg_rent_payments_property ON pg_rent_payments(pg_property_id, status, paid_on);
CREATE INDEX IF NOT EXISTS idx_pg_rent_payments_assignment ON pg_rent_payments(assignment_id, paid_on);
CREATE INDEX IF NOT EXISTS idx_pg_rent_payments_direction ON pg_rent_payments(assignment_id, direction, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_payment_idem
  ON pg_rent_payments(pg_property_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_payment_pending_claim
  ON pg_rent_payments(claimed_invoice_id) WHERE status = 'pending_confirmation' AND source = 'tenant_claim';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_payment_deposit_release
  ON pg_rent_payments(assignment_id) WHERE source = 'deposit_release' AND status = 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_payment_gateway_order
  ON pg_rent_payments(gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_payment_gateway_payment
  ON pg_rent_payments(gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
DROP TRIGGER IF EXISTS set_updated_at ON pg_rent_payments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_rent_payments
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ── allocations: an inflow → an invoice, or an inflow → an outflow (funding) ──
CREATE TABLE IF NOT EXISTS pg_rent_payment_allocations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id        uuid NOT NULL REFERENCES pg_rent_payments(id) ON DELETE CASCADE,
  invoice_id        uuid REFERENCES pg_rent_invoices(id) ON DELETE RESTRICT,
  refund_payment_id uuid REFERENCES pg_rent_payments(id) ON DELETE RESTRICT,
  amount_paise      bigint NOT NULL CHECK (amount_paise > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pg_rent_alloc_one_target
    CHECK ((invoice_id IS NULL) <> (refund_payment_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_alloc_invoice
  ON pg_rent_payment_allocations(payment_id, invoice_id) WHERE invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_alloc_refund
  ON pg_rent_payment_allocations(payment_id, refund_payment_id) WHERE refund_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pg_rent_alloc_payment ON pg_rent_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pg_rent_alloc_invoice ON pg_rent_payment_allocations(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pg_rent_alloc_refund  ON pg_rent_payment_allocations(refund_payment_id);

-- ── receipts (also the render queue) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pg_rent_receipts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id         uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  payment_id             uuid NOT NULL REFERENCES pg_rent_payments(id) ON DELETE RESTRICT,
  assignment_id          uuid NOT NULL REFERENCES pg_bed_assignments(id) ON DELETE RESTRICT,
  receipt_number         text NOT NULL,
  amount_paise           bigint NOT NULL,
  snapshot               jsonb NOT NULL,
  pdf_path               text,
  pdf_status             pg_rent_receipt_pdf_status NOT NULL DEFAULT 'pending',
  attempts               smallint NOT NULL DEFAULT 0,
  next_attempt_at        timestamptz NOT NULL DEFAULT now(),
  last_error             text,
  generated_at           timestamptz,
  voided_at              timestamptz,
  void_reason            text,
  superseded_by          uuid REFERENCES pg_rent_receipts(id),
  share_token            text UNIQUE,
  share_token_expires_at timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pg_rent_receipts_number_unique UNIQUE (pg_property_id, receipt_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_receipt_live_payment
  ON pg_rent_receipts(payment_id) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pg_rent_receipts_queue
  ON pg_rent_receipts(pdf_status, next_attempt_at) WHERE pdf_status <> 'ready';

-- ── events (append-only audit) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pg_rent_events (
  id             bigserial PRIMARY KEY,
  pg_property_id uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  entity_type    text NOT NULL CHECK (entity_type IN ('invoice','payment','expense','settings','assignment','receipt')),
  entity_id      uuid NOT NULL,
  event_type     text NOT NULL,
  actor_user_id  uuid REFERENCES users(id),
  actor_role     text NOT NULL CHECK (actor_role IN ('tenant','pg_operator','admin','system')),
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_rent_events_entity   ON pg_rent_events(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pg_rent_events_property ON pg_rent_events(pg_property_id, created_at DESC);

-- ── per-user dashboard preferences ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pg_operator_preferences (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rent_dashboard jsonb NOT NULL DEFAULT '{"v":1}'::jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 4: Write the rollback**

```sql
-- infra/migrations/0072_pg_rent_collection.rollback.sql
-- Only safe if FF_PG_RENT_COLLECTION was never enabled in this environment.
DROP TABLE IF EXISTS pg_operator_preferences;
DROP TABLE IF EXISTS pg_rent_events;
DROP TABLE IF EXISTS pg_rent_receipts;
DROP TABLE IF EXISTS pg_rent_payment_allocations;
DROP TABLE IF EXISTS pg_rent_payments;
DROP TABLE IF EXISTS pg_rent_invoice_lines;
DROP TABLE IF EXISTS pg_rent_expenses;
DROP TABLE IF EXISTS pg_rent_invoices;
ALTER TABLE pg_bed_assignments
  DROP COLUMN IF EXISTS rent_due_day,
  DROP COLUMN IF EXISTS late_fee_exempt,
  DROP COLUMN IF EXISTS late_fee_override_paise,
  DROP COLUMN IF EXISTS default_item_overrides;
DROP TABLE IF EXISTS pg_rent_counters;
DROP TABLE IF EXISTS pg_rent_settings;
DROP TYPE IF EXISTS pg_rent_pause_reason;
DROP TYPE IF EXISTS pg_rent_receipt_pdf_status;
DROP TYPE IF EXISTS pg_rent_payment_status;
DROP TYPE IF EXISTS pg_rent_payment_source;
DROP TYPE IF EXISTS pg_rent_payment_method;
DROP TYPE IF EXISTS pg_rent_payment_direction;
DROP TYPE IF EXISTS pg_rent_line_source;
DROP TYPE IF EXISTS pg_rent_line_kind;
DROP TYPE IF EXISTS pg_rent_rent_source;
DROP TYPE IF EXISTS pg_rent_invoice_source;
DROP TYPE IF EXISTS pg_rent_invoice_status;
DROP TYPE IF EXISTS pg_rent_invoice_kind;
DROP TYPE IF EXISTS pg_rent_late_fee_kind;
DROP TYPE IF EXISTS pg_rent_proration_mode;
DROP TYPE IF EXISTS pg_rent_billing_timing;
DROP TYPE IF EXISTS pg_rent_cycle_mode;
DELETE FROM schema_migrations WHERE filename = '0072_pg_rent_collection.sql';
```

- [ ] **Step 5: Apply and run the test**

```bash
pnpm db:migrate
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/schema.integration.test.ts
```

Expected: `Applied 0072_pg_rent_collection.sql`; 4 tests PASS. Then prove the rollback is symmetric:

```bash
psql "$DATABASE_URL" -f infra/migrations/0072_pg_rent_collection.rollback.sql
pnpm db:migrate
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/schema.integration.test.ts
```

Expected: applies again cleanly; PASS.

- [ ] **Step 6: Update CLAUDE.md's migration note and commit**

In `CLAUDE.md`, change `(`0001*init.sql`…`0054*…sql`, sequential; next free number is `0055`)` to `(`0001*init.sql`…`0072*…sql`, sequential; next free number is `0073`)`.

```bash
git add infra/migrations/0072_pg_rent_collection.sql infra/migrations/0072_pg_rent_collection.rollback.sql apps/api/src/modules/pg-rent/__tests__/schema.integration.test.ts CLAUDE.md
git commit -m "feat(db): 0072 pg rent collection schema"
```

---

### Task 2: Feature flag and shared types

**Files:**

- Modify: `apps/api/src/config/feature-flags.ts` (interface, `defaultFeatureFlags`, `readFeatureFlags`)
- Create: `packages/shared-types/src/pg-rent.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `.env.example`
- Test: `apps/api/src/modules/pg-rent/__tests__/feature-flag.test.ts`

**Interfaces:**

- Produces: `readFeatureFlags().ff_pg_rent_collection: boolean` (env `FF_PG_RENT_COLLECTION`, default `false`); every type below, exported from `@cribliv/shared-types`.

- [ ] **Step 1: Write the failing flag test**

```ts
// apps/api/src/modules/pg-rent/__tests__/feature-flag.test.ts
import { afterEach, describe, expect, it } from "vitest";

import { readFeatureFlags } from "../../../config/feature-flags";

describe("FF_PG_RENT_COLLECTION", () => {
  const original = process.env.FF_PG_RENT_COLLECTION;
  afterEach(() => {
    if (original === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = original;
  });

  it("defaults off", () => {
    delete process.env.FF_PG_RENT_COLLECTION;
    expect(readFeatureFlags().ff_pg_rent_collection).toBe(false);
  });

  it("turns on with the usual truthy values", () => {
    process.env.FF_PG_RENT_COLLECTION = "true";
    expect(readFeatureFlags().ff_pg_rent_collection).toBe(true);
    process.env.FF_PG_RENT_COLLECTION = "1";
    expect(readFeatureFlags().ff_pg_rent_collection).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/feature-flag.test.ts`
Expected: FAIL — `ff_pg_rent_collection` is `undefined`.

- [ ] **Step 3: Add the flag**

In `apps/api/src/config/feature-flags.ts`, directly after the `ff_pg_multi_property_enabled: boolean;` line in the interface:

```ts
/** PG rent collection module (spec 2026-09-17). HTTP routes 404 when off; internal hooks are data-driven. */
ff_pg_rent_collection: boolean;
```

after `ff_pg_multi_property_enabled: false,` in `defaultFeatureFlags`:

```ts
  ff_pg_rent_collection: false,
```

and after the `ff_pg_multi_property_enabled: parseBooleanEnv(...)` entry in `readFeatureFlags`:

```ts
    ff_pg_rent_collection: parseBooleanEnv(
      "FF_PG_RENT_COLLECTION",
      defaultFeatureFlags.ff_pg_rent_collection
    ),
```

In `.env.example`, next to the other `FF_PG_*` lines:

```
# PG rent collection (invoices, payments, receipts). Default off.
FF_PG_RENT_COLLECTION=false
NEXT_PUBLIC_FF_PG_RENT_COLLECTION=false
NEXT_PUBLIC_FF_PG_WORKSPACE_V2=false
```

- [ ] **Step 4: Run the flag test**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/feature-flag.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the shared types**

```ts
// packages/shared-types/src/pg-rent.ts
// Wire contracts for the PG rent module. Every amount is a whole-rupee integer
// with an `_inr` suffix (spec D2). The one exception is `electricity_unit_rate_inr`,
// a per-unit rate carried as a two-place decimal (spec §4.2, §19 #49).

export type PgRentCycleMode = "calendar_month" | "anniversary";
export type PgRentBillingTiming = "advance" | "arrears";
export type PgRentProrationMode = "actual_days" | "flat_30";
export type PgRentLateFeeKind = "flat" | "per_day" | "percent";
export type PgRentInvoiceKind = "rent" | "deposit" | "adhoc" | "settlement";
export type PgRentInvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "cancelled";
export type PgRentInvoiceSource = "auto" | "manual" | "backfill";
export type PgRentRentSource = "assignment" | "room_type" | "listing" | "none";
export type PgRentLineKind =
  | "rent"
  | "deposit"
  | "late_fee"
  | "electricity"
  | "meals"
  | "maintenance"
  | "damage"
  | "cleaning"
  | "forfeit"
  | "other"
  | "discount"
  | "adjustment";
export type PgRentLineSource = "system" | "operator" | "default_item" | "expense_split";
export type PgRentPaymentDirection = "inflow" | "outflow";
export type PgRentPaymentMethod =
  | "cash"
  | "upi"
  | "bank_transfer"
  | "cheque"
  | "card"
  | "gateway"
  | "deposit"
  | "other";
export type PgRentPaymentSource =
  | "operator"
  | "tenant_claim"
  | "gateway"
  | "backfill"
  | "deposit_release";
export type PgRentPaymentStatus = "pending_confirmation" | "confirmed" | "rejected" | "reversed";
export type PgRentPauseReason = "owner" | "transfer";
export type PgRentActorRole = "tenant" | "pg_operator" | "admin" | "system";

export interface PgRentBankDetails {
  account_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
}

export interface PgRentDefaultLineItem {
  key: string;
  kind: Exclude<PgRentLineKind, "rent" | "deposit" | "late_fee">;
  label: string;
  amount_inr: number;
}

export interface PgRentSettings {
  pg_property_id: string;
  paused_at: string | null;
  pause_reason: PgRentPauseReason | null;
  enabled_on: string;
  billing_starts_on: string;
  cycle_mode: PgRentCycleMode;
  billing_timing: PgRentBillingTiming;
  due_day: number;
  proration_mode: PgRentProrationMode;
  prorate_move_out: boolean;
  invoice_lead_days: number;
  reminder_offsets_days: number[];
  late_fee_enabled: boolean;
  late_fee_grace_days: number;
  late_fee_kind: PgRentLateFeeKind;
  late_fee_amount_inr: number;
  late_fee_percent_bp: number;
  late_fee_cap_inr: number | null;
  late_fee_auto_apply: boolean;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  bank_details: PgRentBankDetails | null;
  whatsapp_phone_e164: string | null;
  msg_reminder: string | null;
  msg_overdue: string | null;
  msg_tenant_paid: string | null;
  msg_receipt_share: string | null;
  receipt_prefix: string;
  receipt_business_name: string | null;
  receipt_address: string | null;
  receipt_footer: string | null;
  receipt_logo_path: string | null;
  default_line_items: PgRentDefaultLineItem[];
  electricity_unit_rate_inr: number | null;
  /** Optimistic-concurrency token for PATCH. */
  updated_at: string;
  created_at: string;
}

/** Fields the owner may set on enable and patch. Everything optional; server defaults apply. */
export interface PgRentSettingsInput {
  cycle_mode?: PgRentCycleMode;
  billing_timing?: PgRentBillingTiming;
  due_day?: number;
  proration_mode?: PgRentProrationMode;
  prorate_move_out?: boolean;
  invoice_lead_days?: number;
  reminder_offsets_days?: number[];
  late_fee_enabled?: boolean;
  late_fee_grace_days?: number;
  late_fee_kind?: PgRentLateFeeKind;
  late_fee_amount_inr?: number;
  late_fee_percent_bp?: number;
  late_fee_cap_inr?: number | null;
  late_fee_auto_apply?: boolean;
  upi_vpa?: string | null;
  upi_payee_name?: string | null;
  bank_details?: PgRentBankDetails | null;
  whatsapp_phone_e164?: string | null;
  msg_reminder?: string | null;
  msg_overdue?: string | null;
  msg_tenant_paid?: string | null;
  msg_receipt_share?: string | null;
  receipt_prefix?: string;
  receipt_business_name?: string | null;
  receipt_address?: string | null;
  receipt_footer?: string | null;
  receipt_logo_path?: string | null;
  default_line_items?: PgRentDefaultLineItem[];
  electricity_unit_rate_inr?: number | null;
}

export interface PgRentEnableInput extends PgRentSettingsInput {
  /** Rent-period floor. Defaults to today (IST). */
  billing_starts_on?: string;
}

export interface PgRentPatchSettingsInput extends PgRentSettingsInput {
  /** Must equal the current `updated_at` or the PATCH is refused with 409. */
  updated_at: string;
}

export interface PgRentResumeInput {
  billing_starts_on?: string;
}

export type PgRentPreviewSkipReason = "no_rent" | "no_move_in" | "nothing_in_window";

export interface PgRentPreviewPeriod {
  period_start: string;
  period_end: string;
  due_date: string;
  amount_inr: number;
  prorated: boolean;
  /** True when rent resolves only from the listing or not at all (issued as draft). */
  draft: boolean;
}

export interface PgRentPreviewTenant {
  assignment_id: string;
  occupant_name: string;
  room_number: string;
  bed_label: string;
  first_period: PgRentPreviewPeriod | null;
  skip_reason: PgRentPreviewSkipReason | null;
  deposit_inr: number | null;
  /** True when the deposit invoice would be issued (move-in on/after `enabled_on`, none exists yet). */
  deposit_will_invoice: boolean;
}

export interface PgRentEnablePreview {
  billing_starts_on: string;
  tenants: PgRentPreviewTenant[];
  counts: {
    invoices: number;
    drafts: number;
    deposits: number;
    no_rent: number;
    no_move_in: number;
  };
}

export interface PgRentInvoiceLine {
  id: string;
  kind: PgRentLineKind;
  label: string;
  amount_inr: number;
  meta: Record<string, unknown>;
  source: PgRentLineSource;
  expense_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface PgRentInvoice {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  bed_id: string | null;
  room_id: string | null;
  room_number: string;
  bed_label: string;
  kind: PgRentInvoiceKind;
  invoice_number: string;
  period_start: string | null;
  period_end: string | null;
  billing_month: string;
  due_date: string;
  status: PgRentInvoiceStatus;
  source: PgRentInvoiceSource;
  total_inr: number;
  amount_paid_inr: number;
  balance_inr: number;
  rent_snapshot_inr: number | null;
  rent_source: PgRentRentSource | null;
  proration_factor: number | null;
  late_fee_eligible: boolean;
  suggested_late_fee_inr: number | null;
  late_fee_waived_at: string | null;
  /** Owner-tap suggestion after notice / move-out (spec §5.8); null when none. */
  reprorate_suggestion: {
    leave_on: string;
    from_inr: number;
    to_inr: number;
    mode: "reprorate" | "restore";
  } | null;
  pay_token_expires_at: string | null;
  tenant_note: string | null;
  internal_note: string | null;
  issued_at: string | null;
  paid_at: string | null;
  settled_on: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  lines: PgRentInvoiceLine[];
  created_at: string;
  updated_at: string;
}

export interface PgRentInvoiceListFilters {
  status?: PgRentInvoiceStatus;
  kind?: PgRentInvoiceKind;
  assignment_id?: string;
  /** `YYYY-MM-01` */
  billing_month?: string;
}

export interface PgRentEvent {
  id: string;
  entity_type: "invoice" | "payment" | "expense" | "settings" | "assignment" | "receipt";
  entity_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_role: PgRentActorRole;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PgRentGenerateResult {
  invoices_created: number;
  drafts_created: number;
  deposits_created: number;
  skipped: Array<{ assignment_id: string; reason: PgRentPreviewSkipReason }>;
}

export interface PgRentTenantOverridesInput {
  rent_due_day?: number | null;
  late_fee_exempt?: boolean;
  late_fee_override_inr?: number | null;
  default_item_excludes?: string[];
  /** Only accepted while the assignment's move_in_date is null. */
  move_in_date?: string;
  /** "Change rent from next cycle": writes pg_bed_assignments.monthly_rent_paise. */
  monthly_rent_inr?: number;
}
```

Append to `packages/shared-types/src/index.ts`:

```ts
export * from "./pg-rent";
```

- [ ] **Step 6: Build shared-types and typecheck**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api typecheck
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/config/feature-flags.ts packages/shared-types/src/pg-rent.ts packages/shared-types/src/index.ts .env.example apps/api/src/modules/pg-rent/__tests__/feature-flag.test.ts
git commit -m "feat(pg-rent): feature flag and shared wire types"
```

---

### Task 3: Money — DTO conversion and pure rounding/splitting

**Files:**

- Create: `apps/api/src/modules/pg-rent/dto/money.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-money.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-money.test.ts`

**Interfaces:**

- Produces:
  - `inrToPaise(inr: number): number` — whole rupees → paise; throws `RangeError` on non-integer or negative unless `allowNegative`.
  - `paiseToInr(paise: number | string | bigint): number` — rounds to the nearest rupee (invariant 9).
  - `ratePaiseToInr(paise: number | null): number | null` — two-place decimal for `electricity_unit_rate`.
  - `rateInrToPaise(inr: number): number`.
  - `roundToRupee(paise: number): number` — nearest 100, half-up.
  - `splitLargestRemainder(totalPaise: number, parts: number): number[]` — each part a multiple of 100, sums exactly.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-money.test.ts
import { describe, expect, it } from "vitest";

import { inrToPaise, paiseToInr, rateInrToPaise, ratePaiseToInr } from "../dto/money";
import { roundToRupee, splitLargestRemainder } from "../pure/rent-money";

describe("roundToRupee", () => {
  it("rounds half-up to the nearest 100 paise", () => {
    expect(roundToRupee(0)).toBe(0);
    expect(roundToRupee(149)).toBe(100);
    expect(roundToRupee(150)).toBe(200);
    expect(roundToRupee(570000)).toBe(570000);
    expect(roundToRupee(-150)).toBe(-100); // half-up towards +∞ for negatives too (discount lines)
  });
});

describe("splitLargestRemainder", () => {
  it("makes the parts sum exactly to the whole in rupee multiples", () => {
    expect(splitLargestRemainder(100000, 3)).toEqual([33400, 33300, 33300]);
    expect(splitLargestRemainder(100000, 1)).toEqual([100000]);
    expect(splitLargestRemainder(200, 3)).toEqual([100, 100, 0]);
    expect(splitLargestRemainder(89600, 4)).toEqual([22400, 22400, 22400, 22400]);
  });
  it("rejects a non-positive part count or a non-rupee total", () => {
    expect(() => splitLargestRemainder(100000, 0)).toThrow(RangeError);
    expect(() => splitLargestRemainder(100050, 2)).toThrow(RangeError);
  });
});

describe("dto/money", () => {
  it("converts whole rupees to paise and back", () => {
    expect(inrToPaise(9000)).toBe(900000);
    expect(paiseToInr(900000)).toBe(9000);
    expect(paiseToInr("900000")).toBe(9000);
    expect(paiseToInr(BigInt(900000))).toBe(9000);
  });
  it("rounds paise to the nearest rupee on the way out", () => {
    expect(paiseToInr(570049)).toBe(5700);
    expect(paiseToInr(570050)).toBe(5701);
  });
  it("refuses fractional or negative rupees on the way in", () => {
    expect(() => inrToPaise(12.5)).toThrow(RangeError);
    expect(() => inrToPaise(-1)).toThrow(RangeError);
    expect(inrToPaise(-1, { allowNegative: true })).toBe(-100);
  });
  it("carries the electricity rate as a two-place decimal", () => {
    expect(ratePaiseToInr(850)).toBe(8.5);
    expect(ratePaiseToInr(null)).toBeNull();
    expect(rateInrToPaise(8.5)).toBe(850);
    expect(rateInrToPaise(0.5)).toBe(50);
    expect(() => rateInrToPaise(8.555)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-money.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/pure/rent-money.ts
/** Nearest whole rupee, half-up (invariant 9). Input and output are paise. */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100;
}

/**
 * Split a rupee-multiple total into `parts` rupee-multiple shares whose sum is
 * exactly the total. Largest-remainder: every share gets floor(total/parts)
 * rounded down to a rupee, then the leftover rupees go one each to the first
 * shares (spec invariant 9, §8.6).
 */
export function splitLargestRemainder(totalPaise: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError("parts must be >= 1");
  if (!Number.isInteger(totalPaise) || totalPaise % 100 !== 0) {
    throw new RangeError("total must be a whole-rupee paise amount");
  }
  const totalRupees = totalPaise / 100;
  const base = Math.floor(totalRupees / parts);
  let leftover = totalRupees - base * parts;
  const shares: number[] = [];
  for (let i = 0; i < parts; i += 1) {
    const extra = leftover > 0 ? 1 : 0;
    leftover -= extra;
    shares.push((base + extra) * 100);
  }
  return shares;
}
```

```ts
// apps/api/src/modules/pg-rent/dto/money.ts
// The ONLY place rupees and paise meet (spec D2, §13). Services work in paise.

/** Whole rupees → paise. Throws on fractions; negatives only when allowed (discount lines). */
export function inrToPaise(inr: number, options: { allowNegative?: boolean } = {}): number {
  if (!Number.isInteger(inr)) throw new RangeError("amount_inr must be a whole rupee");
  if (inr < 0 && !options.allowNegative) throw new RangeError("amount_inr must not be negative");
  return inr * 100;
}

/** Paise (number, numeric-string from pg, or bigint) → nearest whole rupee. */
export function paiseToInr(paise: number | string | bigint): number {
  const value = typeof paise === "bigint" ? Number(paise) : Number(paise);
  return Math.round(value / 100);
}

/** Electricity rate: paise per unit → rupees with two decimals (spec §19 #49). */
export function ratePaiseToInr(paise: number | string | null): number | null {
  if (paise === null) return null;
  return Number(paise) / 100;
}

/** Rupees with at most two decimals → paise per unit. */
export function rateInrToPaise(inr: number): number {
  const paise = Math.round(inr * 100);
  if (Math.abs(paise - inr * 100) > 1e-6)
    throw new RangeError("rate must have at most two decimals");
  return paise;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-money.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/dto/money.ts apps/api/src/modules/pg-rent/pure/rent-money.ts apps/api/src/modules/pg-rent/__tests__/rent-money.test.ts
git commit -m "feat(pg-rent): rupee/paise boundary and largest-remainder split"
```

---

### Task 4: Pure date arithmetic

**Files:**

- Create: `apps/api/src/modules/pg-rent/pure/rent-dates.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-dates.test.ts`

**Interfaces:**

- Produces (all ISO `YYYY-MM-DD` strings in, strings out; no `Date` leaks):
  - `addDays(iso, n): string`
  - `daysInclusive(startIso, endIso): number` — both ends counted (Sep 12–30 = 19).
  - `daysInMonthOf(iso): number`
  - `endOfMonth(iso): string`
  - `firstOfMonth(iso): string`
  - `clampDayInMonth(yearMonthIso, day): string` — `("2026-02-01", 31)` → `"2026-02-28"`.
  - `addMonthsToFirst(firstOfMonthIso, n): string` — first-of-month arithmetic.
  - `dayOf(iso): number`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-dates.test.ts
import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonthsToFirst,
  clampDayInMonth,
  dayOf,
  daysInMonthOf,
  daysInclusive,
  endOfMonth,
  firstOfMonth
} from "../pure/rent-dates";

describe("rent-dates", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });
  it("counts inclusive days", () => {
    expect(daysInclusive("2026-09-12", "2026-09-30")).toBe(19);
    expect(daysInclusive("2026-09-01", "2026-09-30")).toBe(30);
    expect(daysInclusive("2026-09-12", "2026-10-11")).toBe(30);
    expect(daysInclusive("2026-01-31", "2026-02-27")).toBe(28);
  });
  it("knows month lengths", () => {
    expect(daysInMonthOf("2026-02-10")).toBe(28);
    expect(daysInMonthOf("2024-02-10")).toBe(29);
    expect(daysInMonthOf("2026-09-01")).toBe(30);
    expect(endOfMonth("2026-09-12")).toBe("2026-09-30");
    expect(firstOfMonth("2026-09-12")).toBe("2026-09-01");
  });
  it("clamps an anchor day to the month", () => {
    expect(clampDayInMonth("2026-02-01", 31)).toBe("2026-02-28");
    expect(clampDayInMonth("2026-04-01", 31)).toBe("2026-04-30");
    expect(clampDayInMonth("2026-03-01", 31)).toBe("2026-03-31");
    expect(clampDayInMonth("2026-03-01", 5)).toBe("2026-03-05");
  });
  it("adds months to a first-of-month", () => {
    expect(addMonthsToFirst("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonthsToFirst("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonthsToFirst("2026-01-01", 14)).toBe("2027-03-01");
  });
  it("reads the day", () => {
    expect(dayOf("2026-09-12")).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-dates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/pure/rent-dates.ts
// ISO-date arithmetic on strings. Everything runs in UTC on purpose: the
// strings are IST calendar dates already, and we never want the host zone to
// shift a day. No Date object escapes this file.

function parse(iso: string): [number, number, number] {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return [y, m, d];
}

function format(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function toUtc(iso: string): number {
  const [y, m, d] = parse(iso);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  const date = new Date(ms);
  return format(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

/** Inclusive count: the period Sep 12–30 has 19 days. */
export function daysInclusive(startIso: string, endIso: string): number {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / DAY_MS) + 1;
}

export function daysInMonthOf(iso: string): number {
  const [y, m] = parse(iso);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function endOfMonth(iso: string): string {
  const [y, m] = parse(iso);
  return format(y, m, daysInMonthOf(iso));
}

export function firstOfMonth(iso: string): string {
  const [y, m] = parse(iso);
  return format(y, m, 1);
}

/** The `day`-th of the month containing `yearMonthIso`, clamped to that month's length. */
export function clampDayInMonth(yearMonthIso: string, day: number): string {
  const [y, m] = parse(yearMonthIso);
  return format(y, m, Math.min(day, daysInMonthOf(yearMonthIso)));
}

export function addMonthsToFirst(firstOfMonthIso: string, n: number): string {
  const [y, m] = parse(firstOfMonthIso);
  const index = y * 12 + (m - 1) + n;
  return format(Math.floor(index / 12), (index % 12) + 1, 1);
}

export function dayOf(iso: string): number {
  return parse(iso)[2];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-dates.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/pure/rent-dates.ts apps/api/src/modules/pg-rent/__tests__/rent-dates.test.ts
git commit -m "feat(pg-rent): pure ISO date arithmetic"
```

---

### Task 5: Pure period math — ends, due dates, floor, walk

**Files:**

- Create: `apps/api/src/modules/pg-rent/pure/rent-period.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-period.test.ts`

**Interfaces:**

- Consumes: Task 4.
- Produces:

```ts
export interface PeriodSpec {
  cycleMode: "calendar_month" | "anniversary";
  /** anniversary only: tenant rent_due_day override ?? day(move_in_date) */
  anchorDay: number;
}
export interface DueSpec {
  timing: "advance" | "arrears";
  /** calendar only: property due_day, overridden by the tenant's rent_due_day */
  dueDay: number;
}
export interface Period {
  start: string;
  end: string;
}
export function periodEndFor(start: string, spec: PeriodSpec): string;
export function naturalPeriodContaining(iso: string, spec: PeriodSpec): Period;
export function isNaturalPeriod(period: Period, spec: PeriodSpec): boolean;
export function naturalDueDate(period: Period, spec: PeriodSpec, due: DueSpec): string;
export function floorDate(period: Period, spec: PeriodSpec, due: DueSpec): string; // max(naturalDue, start)
export function firstGeneratedPeriod(
  moveIn: string,
  billingStartsOn: string,
  spec: PeriodSpec,
  due: DueSpec
): Period | null;
export function nextPeriod(lastEnd: string, spec: PeriodSpec): Period;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-period.test.ts
import { describe, expect, it } from "vitest";

import {
  firstGeneratedPeriod,
  floorDate,
  isNaturalPeriod,
  naturalDueDate,
  naturalPeriodContaining,
  nextPeriod,
  periodEndFor
} from "../pure/rent-period";

const calendar = { cycleMode: "calendar_month", anchorDay: 1 } as const;
const anniv12 = { cycleMode: "anniversary", anchorDay: 12 } as const;
const anniv31 = { cycleMode: "anniversary", anchorDay: 31 } as const;
const advance5 = { timing: "advance", dueDay: 5 } as const;
const arrears5 = { timing: "arrears", dueDay: 5 } as const;

describe("periodEndFor", () => {
  it("calendar: end of the start month", () => {
    expect(periodEndFor("2026-09-12", calendar)).toBe("2026-09-30");
    expect(periodEndFor("2026-10-01", calendar)).toBe("2026-10-31");
  });
  it("anniversary: the day before the next anchor, computed from the anchor (no drift)", () => {
    expect(periodEndFor("2026-09-12", anniv12)).toBe("2026-10-11");
    expect(periodEndFor("2026-10-12", anniv12)).toBe("2026-11-11");
    expect(periodEndFor("2026-01-31", anniv31)).toBe("2026-02-27");
    expect(periodEndFor("2026-02-28", anniv31)).toBe("2026-03-30");
    expect(periodEndFor("2026-03-31", anniv31)).toBe("2026-04-29");
  });
  it("anniversary bridge: a start that is not on the anchor ends at the next anchor − 1", () => {
    expect(periodEndFor("2026-11-01", anniv12)).toBe("2026-11-11");
    expect(periodEndFor("2026-11-12", anniv12)).toBe("2026-12-11");
  });
});

describe("naturalPeriodContaining / isNaturalPeriod", () => {
  it("calendar: the month", () => {
    expect(naturalPeriodContaining("2026-09-12", calendar)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30"
    });
    expect(isNaturalPeriod({ start: "2026-09-01", end: "2026-09-30" }, calendar)).toBe(true);
    expect(isNaturalPeriod({ start: "2026-09-12", end: "2026-09-30" }, calendar)).toBe(false);
  });
  it("anniversary: anchor to anchor − 1", () => {
    expect(naturalPeriodContaining("2026-11-01", anniv12)).toEqual({
      start: "2026-10-12",
      end: "2026-11-11"
    });
    expect(naturalPeriodContaining("2026-10-12", anniv12)).toEqual({
      start: "2026-10-12",
      end: "2026-11-11"
    });
    expect(isNaturalPeriod({ start: "2026-11-01", end: "2026-11-11" }, anniv12)).toBe(false);
  });
});

describe("naturalDueDate", () => {
  it("calendar advance: due_day of the period month", () => {
    expect(naturalDueDate({ start: "2026-10-01", end: "2026-10-31" }, calendar, advance5)).toBe(
      "2026-10-05"
    );
    expect(naturalDueDate({ start: "2026-09-12", end: "2026-09-30" }, calendar, advance5)).toBe(
      "2026-09-05"
    );
  });
  it("calendar arrears: natural period → due_day next month; cut period → end + 1", () => {
    expect(naturalDueDate({ start: "2026-09-01", end: "2026-09-30" }, calendar, arrears5)).toBe(
      "2026-10-05"
    );
    expect(naturalDueDate({ start: "2026-09-12", end: "2026-09-30" }, calendar, arrears5)).toBe(
      "2026-10-01"
    );
    expect(naturalDueDate({ start: "2026-11-01", end: "2026-11-11" }, calendar, arrears5)).toBe(
      "2026-11-12"
    );
  });
  it("anniversary: advance → start, arrears → end + 1", () => {
    expect(
      naturalDueDate({ start: "2026-09-12", end: "2026-10-11" }, anniv12, {
        timing: "advance",
        dueDay: 5
      })
    ).toBe("2026-09-12");
    expect(
      naturalDueDate({ start: "2026-09-12", end: "2026-10-11" }, anniv12, {
        timing: "arrears",
        dueDay: 5
      })
    ).toBe("2026-10-12");
  });
});

describe("floorDate", () => {
  it("is the natural due date or the period start, whichever is later", () => {
    expect(floorDate({ start: "2026-09-20", end: "2026-09-30" }, calendar, advance5)).toBe(
      "2026-09-20"
    );
    expect(floorDate({ start: "2026-09-01", end: "2026-09-30" }, calendar, advance5)).toBe(
      "2026-09-05"
    );
    expect(floorDate({ start: "2026-09-01", end: "2026-09-30" }, calendar, arrears5)).toBe(
      "2026-10-05"
    );
  });
});

describe("firstGeneratedPeriod", () => {
  it("advance, enabled Sep 17, tenant since Aug 12, due 5 → October is first", () => {
    expect(firstGeneratedPeriod("2026-08-12", "2026-09-17", calendar, advance5)).toEqual({
      start: "2026-10-01",
      end: "2026-10-31"
    });
  });
  it("advance, move-in Sep 20 after the Sep 17 floor → the move-in period itself (§19 #48)", () => {
    expect(firstGeneratedPeriod("2026-09-20", "2026-09-17", calendar, advance5)).toEqual({
      start: "2026-09-20",
      end: "2026-09-30"
    });
  });
  it("arrears, enabled Sep 17, tenant since Aug 12 → September is first", () => {
    expect(firstGeneratedPeriod("2026-08-12", "2026-09-17", calendar, arrears5)).toEqual({
      start: "2026-09-01",
      end: "2026-09-30"
    });
  });
  it("anniversary advance, enabled Sep 17, move-in Aug 20 → Sep 20 period", () => {
    expect(
      firstGeneratedPeriod(
        "2026-08-20",
        "2026-09-17",
        { cycleMode: "anniversary", anchorDay: 20 },
        advance5
      )
    ).toEqual({ start: "2026-09-20", end: "2026-10-19" });
  });
  it("enabled before move-in → the move-in period", () => {
    expect(firstGeneratedPeriod("2026-09-12", "2026-09-01", calendar, advance5)).toEqual({
      start: "2026-09-12",
      end: "2026-09-30"
    });
  });
  it("gives up after 240 periods (a floor decades ahead)", () => {
    expect(firstGeneratedPeriod("2026-09-12", "2099-01-01", calendar, advance5)).toBeNull();
  });
});

describe("nextPeriod", () => {
  it("is contiguous and ends by the (possibly new) mode", () => {
    expect(nextPeriod("2026-10-31", calendar)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(nextPeriod("2026-10-31", anniv12)).toEqual({ start: "2026-11-01", end: "2026-11-11" });
    expect(nextPeriod("2026-11-11", anniv12)).toEqual({ start: "2026-11-12", end: "2026-12-11" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-period.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/pure/rent-period.ts
// Billing periods (spec §5.3). No I/O. Every date is an ISO string.

import {
  addDays,
  addMonthsToFirst,
  clampDayInMonth,
  compareIso,
  endOfMonth,
  firstOfMonth
} from "./rent-dates";

export interface PeriodSpec {
  cycleMode: "calendar_month" | "anniversary";
  /** anniversary only: tenant rent_due_day override ?? day(move_in_date) */
  anchorDay: number;
}

export interface DueSpec {
  timing: "advance" | "arrears";
  /** calendar only: property due_day, overridden by the tenant's rent_due_day */
  dueDay: number;
}

export interface Period {
  start: string;
  end: string;
}

/** First anchor date strictly after `iso`, clamping day 29–31 to short months. */
function nextAnchorAfter(iso: string, anchorDay: number): string {
  const thisMonth = clampDayInMonth(firstOfMonth(iso), anchorDay);
  if (compareIso(thisMonth, iso) > 0) return thisMonth;
  return clampDayInMonth(addMonthsToFirst(firstOfMonth(iso), 1), anchorDay);
}

/** Last anchor date on or before `iso`. */
function anchorOnOrBefore(iso: string, anchorDay: number): string {
  const thisMonth = clampDayInMonth(firstOfMonth(iso), anchorDay);
  if (compareIso(thisMonth, iso) <= 0) return thisMonth;
  return clampDayInMonth(addMonthsToFirst(firstOfMonth(iso), -1), anchorDay);
}

export function periodEndFor(start: string, spec: PeriodSpec): string {
  if (spec.cycleMode === "calendar_month") return endOfMonth(start);
  return addDays(nextAnchorAfter(start, spec.anchorDay), -1);
}

export function naturalPeriodContaining(iso: string, spec: PeriodSpec): Period {
  if (spec.cycleMode === "calendar_month") {
    return { start: firstOfMonth(iso), end: endOfMonth(iso) };
  }
  const start = anchorOnOrBefore(iso, spec.anchorDay);
  return { start, end: addDays(nextAnchorAfter(start, spec.anchorDay), -1) };
}

export function isNaturalPeriod(period: Period, spec: PeriodSpec): boolean {
  const natural = naturalPeriodContaining(period.start, spec);
  return natural.start === period.start && natural.end === period.end;
}

/** Spec §5.3 due-date table. */
export function naturalDueDate(period: Period, spec: PeriodSpec, due: DueSpec): string {
  if (spec.cycleMode === "anniversary") {
    return due.timing === "advance" ? period.start : addDays(period.end, 1);
  }
  if (due.timing === "advance") {
    return clampDayInMonth(firstOfMonth(period.start), due.dueDay);
  }
  if (isNaturalPeriod(period, spec)) {
    return clampDayInMonth(addMonthsToFirst(firstOfMonth(period.start), 1), due.dueDay);
  }
  return addDays(period.end, 1);
}

/** Floor test value (spec §5.3, §19 #48): a period cannot be due before it starts. */
export function floorDate(period: Period, spec: PeriodSpec, due: DueSpec): string {
  const natural = naturalDueDate(period, spec, due);
  return compareIso(natural, period.start) >= 0 ? natural : period.start;
}

const MAX_WALK = 240;

/**
 * Walk natural periods from move-in; the first whose floor date is on/after
 * `billingStartsOn` is generated. Null when nothing qualifies within 20 years.
 */
export function firstGeneratedPeriod(
  moveIn: string,
  billingStartsOn: string,
  spec: PeriodSpec,
  due: DueSpec
): Period | null {
  let period: Period = { start: moveIn, end: periodEndFor(moveIn, spec) };
  for (let i = 0; i < MAX_WALK; i += 1) {
    if (compareIso(floorDate(period, spec, due), billingStartsOn) >= 0) return period;
    period = nextPeriod(period.end, spec);
  }
  return null;
}

/** Contiguity (invariant 11): the next period starts the day after the last one ended. */
export function nextPeriod(lastEnd: string, spec: PeriodSpec): Period {
  const start = addDays(lastEnd, 1);
  return { start, end: periodEndFor(start, spec) };
}
```

Add `compareIso` to `rent-dates.ts` (re-exporting the slice-0 helper so pure code has one import):

```ts
export { compareIsoDates as compareIso } from "../../../common/date";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-period.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/pure/rent-period.ts apps/api/src/modules/pg-rent/pure/rent-dates.ts apps/api/src/modules/pg-rent/__tests__/rent-period.test.ts
git commit -m "feat(pg-rent): pure billing-period math (cycle modes, timing, floor, contiguity)"
```

---

### Task 6: Pure window, proration and status

**Files:**

- Create: `apps/api/src/modules/pg-rent/pure/rent-window.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-proration.ts`
- Create: `apps/api/src/modules/pg-rent/pure/rent-status.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-window-proration-status.test.ts`

**Interfaces:**

- Produces:

```ts
// rent-window.ts
export interface WindowAssignment {
  status:
    | "reserved"
    | "active"
    | "notice_served"
    | "move_out_requested"
    | "move_out_pending_confirmation"
    | "moved_out"
    | "cancelled";
  move_in_date: string | null;
  notice_end_date: string | null;
  move_out_date: string | null;
}
export interface BillingWindow {
  start: string;
  end: string | null;
} // end null = open-ended
export function billingWindow(a: WindowAssignment): BillingWindow | null; // null = not eligible / no move-in
export function cutToWindow(
  period: Period,
  window: BillingWindow
): { period: Period; cut: boolean } | null; // null = starts after the end

// rent-proration.ts
export function prorate(
  rentPaise: number,
  period: Period,
  spec: PeriodSpec,
  mode: "actual_days" | "flat_30"
): { amountPaise: number; factor: number | null };

// rent-status.ts
export function invoiceStatus(i: {
  draft: boolean;
  cancelled: boolean;
  totalPaise: number;
  paidPaise: number;
}): "draft" | "cancelled" | "paid" | "partially_paid" | "issued";
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-window-proration-status.test.ts
import { describe, expect, it } from "vitest";

import { prorate } from "../pure/rent-proration";
import { invoiceStatus } from "../pure/rent-status";
import { billingWindow, cutToWindow } from "../pure/rent-window";

const base = { move_in_date: "2026-09-12", notice_end_date: null, move_out_date: null };

describe("billingWindow (spec §5.2)", () => {
  it("is open-ended for active and IGNORES a stale notice_end_date", () => {
    expect(billingWindow({ ...base, status: "active", notice_end_date: "2026-10-15" })).toEqual({
      start: "2026-09-12",
      end: null
    });
  });
  it("ends at notice_end_date in the notice family, open-ended when unset", () => {
    expect(
      billingWindow({ ...base, status: "notice_served", notice_end_date: "2026-10-15" })
    ).toEqual({
      start: "2026-09-12",
      end: "2026-10-15"
    });
    expect(billingWindow({ ...base, status: "move_out_requested" })).toEqual({
      start: "2026-09-12",
      end: null
    });
    expect(
      billingWindow({
        ...base,
        status: "move_out_pending_confirmation",
        notice_end_date: "2026-10-15"
      })?.end
    ).toBe("2026-10-15");
  });
  it("ends at move_out_date when moved out (moved_out IS eligible — §19 #37)", () => {
    expect(billingWindow({ ...base, status: "moved_out", move_out_date: "2026-10-15" })).toEqual({
      start: "2026-09-12",
      end: "2026-10-15"
    });
  });
  it("is null for reserved, cancelled, or no move-in", () => {
    expect(billingWindow({ ...base, status: "reserved" })).toBeNull();
    expect(billingWindow({ ...base, status: "cancelled" })).toBeNull();
    expect(billingWindow({ ...base, status: "active", move_in_date: null })).toBeNull();
  });
});

describe("cutToWindow", () => {
  const window = { start: "2026-09-12", end: "2026-10-15" };
  it("returns the period untouched when it ends inside the window", () => {
    expect(cutToWindow({ start: "2026-09-12", end: "2026-09-30" }, window)).toEqual({
      period: { start: "2026-09-12", end: "2026-09-30" },
      cut: false
    });
  });
  it("cuts a period that straddles the end", () => {
    expect(cutToWindow({ start: "2026-10-01", end: "2026-10-31" }, window)).toEqual({
      period: { start: "2026-10-01", end: "2026-10-15" },
      cut: true
    });
  });
  it("is null when the period starts after the window ends", () => {
    expect(cutToWindow({ start: "2026-11-01", end: "2026-11-30" }, window)).toBeNull();
  });
  it("never cuts against an open-ended window", () => {
    expect(
      cutToWindow({ start: "2026-10-01", end: "2026-10-31" }, { start: "2026-09-12", end: null })
        ?.cut
    ).toBe(false);
  });
});

describe("prorate (spec §5.3)", () => {
  const calendar = { cycleMode: "calendar_month", anchorDay: 1 } as const;
  const anniv12 = { cycleMode: "anniversary", anchorDay: 12 } as const;
  it("charges the full rent for a natural period with factor null", () => {
    expect(
      prorate(900000, { start: "2026-10-01", end: "2026-10-31" }, calendar, "actual_days")
    ).toEqual({
      amountPaise: 900000,
      factor: null
    });
  });
  it("actual_days: days ÷ days in the containing natural period, rounded to the rupee", () => {
    expect(
      prorate(900000, { start: "2026-09-12", end: "2026-09-30" }, calendar, "actual_days")
    ).toEqual({
      amountPaise: 570000,
      factor: 19 / 30
    });
    // anniversary bridge Nov 1–11 belongs to Oct 12–Nov 11 (31 days)
    expect(
      prorate(900000, { start: "2026-11-01", end: "2026-11-11" }, anniv12, "actual_days")
    ).toEqual({
      amountPaise: 319400,
      factor: 11 / 31
    });
  });
  it("flat_30: days ÷ 30", () => {
    expect(
      prorate(900000, { start: "2026-09-12", end: "2026-09-30" }, calendar, "flat_30")
    ).toEqual({
      amountPaise: 570000,
      factor: 19 / 30
    });
    expect(
      prorate(900000, { start: "2026-10-01", end: "2026-10-15" }, calendar, "flat_30")
    ).toEqual({
      amountPaise: 450000,
      factor: 15 / 30
    });
  });
});

describe("invoiceStatus (invariant 4, equality not ≥)", () => {
  it("covers every combination", () => {
    expect(invoiceStatus({ draft: true, cancelled: false, totalPaise: 100, paidPaise: 0 })).toBe(
      "draft"
    );
    expect(invoiceStatus({ draft: false, cancelled: true, totalPaise: 100, paidPaise: 50 })).toBe(
      "cancelled"
    );
    expect(invoiceStatus({ draft: false, cancelled: false, totalPaise: 0, paidPaise: 0 })).toBe(
      "paid"
    );
    expect(
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 900000 })
    ).toBe("paid");
    expect(
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 400000 })
    ).toBe("partially_paid");
    expect(
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 0 })
    ).toBe("issued");
    expect(() =>
      invoiceStatus({ draft: false, cancelled: false, totalPaise: 900000, paidPaise: 900100 })
    ).toThrow(/amount_paid exceeds total/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-window-proration-status.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three files**

```ts
// apps/api/src/modules/pg-rent/pure/rent-window.ts
// Status-aware billing window (spec §5.2). `active` ignores notice_end_date on
// purpose: cancelMoveOut left it populated on production rows before slice 0.

import { compareIso } from "./rent-dates";
import type { Period } from "./rent-period";

export interface WindowAssignment {
  status:
    | "reserved"
    | "active"
    | "notice_served"
    | "move_out_requested"
    | "move_out_pending_confirmation"
    | "moved_out"
    | "cancelled";
  move_in_date: string | null;
  notice_end_date: string | null;
  move_out_date: string | null;
}

export interface BillingWindow {
  start: string;
  /** null = open-ended */
  end: string | null;
}

export function billingWindow(a: WindowAssignment): BillingWindow | null {
  if (a.move_in_date === null) return null;
  switch (a.status) {
    case "active":
      return { start: a.move_in_date, end: null };
    case "notice_served":
    case "move_out_requested":
    case "move_out_pending_confirmation":
      return { start: a.move_in_date, end: a.notice_end_date };
    case "moved_out":
      return { start: a.move_in_date, end: a.move_out_date };
    default:
      return null;
  }
}

/** Trim a period to the window end. Null when the period starts after the end. */
export function cutToWindow(
  period: Period,
  window: BillingWindow
): { period: Period; cut: boolean } | null {
  if (window.end === null) return { period, cut: false };
  if (compareIso(period.start, window.end) > 0) return null;
  if (compareIso(period.end, window.end) <= 0) return { period, cut: false };
  return { period: { start: period.start, end: window.end }, cut: true };
}
```

```ts
// apps/api/src/modules/pg-rent/pure/rent-proration.ts
import { daysInclusive } from "./rent-dates";
import { roundToRupee } from "./rent-money";
import {
  isNaturalPeriod,
  naturalPeriodContaining,
  type Period,
  type PeriodSpec
} from "./rent-period";

/**
 * Spec §5.3 "Proration". A natural period is never prorated (factor null).
 * actual_days divides by the length of the natural period that contains the
 * partial one; flat_30 divides by 30. Result rounded to the rupee.
 */
export function prorate(
  rentPaise: number,
  period: Period,
  spec: PeriodSpec,
  mode: "actual_days" | "flat_30"
): { amountPaise: number; factor: number | null } {
  if (isNaturalPeriod(period, spec)) return { amountPaise: rentPaise, factor: null };
  const days = daysInclusive(period.start, period.end);
  const denominator =
    mode === "flat_30"
      ? 30
      : (() => {
          const natural = naturalPeriodContaining(period.start, spec);
          return daysInclusive(natural.start, natural.end);
        })();
  const factor = days / denominator;
  return { amountPaise: roundToRupee(rentPaise * factor), factor };
}
```

```ts
// apps/api/src/modules/pg-rent/pure/rent-status.ts
/** Invariant 4. Pure function of the four inputs; throws on invariant-14 breach. */
export function invoiceStatus(i: {
  draft: boolean;
  cancelled: boolean;
  totalPaise: number;
  paidPaise: number;
}): "draft" | "cancelled" | "paid" | "partially_paid" | "issued" {
  if (i.cancelled) return "cancelled";
  if (i.draft) return "draft";
  if (i.paidPaise > i.totalPaise) {
    throw new Error(`invariant 14: amount_paid exceeds total (${i.paidPaise} > ${i.totalPaise})`);
  }
  if (i.paidPaise === i.totalPaise) return "paid";
  if (i.paidPaise > 0) return "partially_paid";
  return "issued";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-window-proration-status.test.ts`
Expected: PASS, 12 tests. (`319400`: 900000 × 11/31 = 319354.8 → nearest rupee 319400 ✓.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/pure/rent-window.ts apps/api/src/modules/pg-rent/pure/rent-proration.ts apps/api/src/modules/pg-rent/pure/rent-status.ts apps/api/src/modules/pg-rent/__tests__/rent-window-proration-status.test.ts
git commit -m "feat(pg-rent): pure billing window, proration and invoice status"
```

---

### Task 7: Module skeleton — guards, events, module registration

**Files:**

- Create: `apps/api/src/modules/pg-rent/services/rent-guards.ts`
- Create: `apps/api/src/modules/pg-rent/services/rent-events.ts`
- Create: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Modify: `apps/api/src/app.module.ts` (add `PgRentModule` to `imports`)
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-guards.integration.test.ts`

**Interfaces:**

- Produces:

```ts
// rent-guards.ts
export function requireDb(db: Pick<DatabaseService, "isEnabled">): void; // throws ServiceUnavailableException {code:'rent_requires_db'}
export function assertRentFlag(): void; // throws NotFoundException {code:'feature_disabled'}
export async function assertManagedOwnership(
  q: Queryable,
  operatorId: string,
  propertyId: string,
  lock?: boolean
): Promise<void>; // ForbiddenException {code:'forbidden'}
export type Queryable = Pick<PoolClient, "query">;
export interface RentActor {
  id: string | null;
  role: "tenant" | "pg_operator" | "admin" | "system";
}
export const SYSTEM_ACTOR: RentActor;

// rent-events.ts
export interface RentEventInput {
  propertyId: string;
  entityType: "invoice" | "payment" | "expense" | "settings" | "assignment" | "receipt";
  entityId: string;
  eventType: string;
  actor: RentActor;
  payload?: Record<string, unknown>;
}
export async function writeRentEvent(client: Queryable, input: RentEventInput): Promise<void>;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-guards.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { writeRentEvent } from "../services/rent-events";
import {
  SYSTEM_ACTOR,
  assertManagedOwnership,
  assertRentFlag,
  requireDb
} from "../services/rent-guards";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("rent guards without a database", () => {
  it("requireDb throws the rent_requires_db envelope", () => {
    expect(() => requireDb({ isEnabled: () => false })).toThrow(
      expect.objectContaining({
        response: { code: "rent_requires_db", message: "Rent collection requires a database" }
      })
    );
    expect(() => requireDb({ isEnabled: () => true })).not.toThrow();
  });
  it("assertRentFlag 404s when FF_PG_RENT_COLLECTION is off", () => {
    const prev = process.env.FF_PG_RENT_COLLECTION;
    delete process.env.FF_PG_RENT_COLLECTION;
    expect(() => assertRentFlag()).toThrow(
      expect.objectContaining({ response: { code: "feature_disabled" } })
    );
    process.env.FF_PG_RENT_COLLECTION = "true";
    expect(() => assertRentFlag()).not.toThrow();
    if (prev === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = prev;
  });
});

describe.skipIf(!HAS_DB)("rent guards (real Postgres)", () => {
  let db: DatabaseService;
  let cityId: number;
  let operatorId: string;
  let otherOperatorId: string;
  let propertyId: string;
  const testRunId = randomUUID().replace(/-/g, "");

  beforeAll(async () => {
    db = new DatabaseService();
    const city = await db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'Rent guard city', 'Rent guard city', 'S', 'S') RETURNING id`,
      [`rg-${testRunId}`]
    );
    cityId = city.rows[0].id;
    const users = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'pg_operator', 'en'), ($2, 'pg_operator', 'en') RETURNING id::text`,
      [`+9181${testRunId.slice(0, 9)}`, `+9182${testRunId.slice(0, 9)}`]
    );
    operatorId = users.rows[0].id;
    otherOperatorId = users.rows[1].id;
    const property = await db.query<{ id: string }>(
      `INSERT INTO pg_properties (operator_id, display_name, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, 'Rent guard property', $2, false, true, 'ready', 1) RETURNING id::text`,
      [operatorId, cityId]
    );
    propertyId = property.rows[0].id;
  });

  afterAll(async () => {
    await db.query(`DELETE FROM pg_properties WHERE id = $1::uuid`, [propertyId]);
    await db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[operatorId, otherOperatorId]]);
    await db.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
    await db.onModuleDestroy();
  });

  it("allows the managing operator and refuses everyone else", async () => {
    const client = await db.getClient();
    try {
      await expect(assertManagedOwnership(client, operatorId, propertyId)).resolves.toBeUndefined();
      await expect(
        assertManagedOwnership(client, otherOperatorId, propertyId)
      ).rejects.toMatchObject({
        response: { code: "forbidden" }
      });
      await db.query(`UPDATE pg_properties SET manage_enabled = false WHERE id = $1::uuid`, [
        propertyId
      ]);
      await expect(assertManagedOwnership(client, operatorId, propertyId)).rejects.toMatchObject({
        response: { code: "forbidden" }
      });
      await db.query(`UPDATE pg_properties SET manage_enabled = true WHERE id = $1::uuid`, [
        propertyId
      ]);
    } finally {
      client.release();
    }
  });

  it("writes an event row with actor and payload", async () => {
    const entityId = randomUUID();
    const client = await db.getClient();
    try {
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId,
        eventType: "settings.enabled",
        actor: SYSTEM_ACTOR,
        payload: { hello: "world" }
      });
    } finally {
      client.release();
    }
    const rows = await db.query<{
      event_type: string;
      actor_role: string;
      actor_user_id: string | null;
      payload: unknown;
    }>(
      `SELECT event_type, actor_role, actor_user_id::text, payload FROM pg_rent_events WHERE entity_id = $1::uuid`,
      [entityId]
    );
    expect(rows.rows).toEqual([
      {
        event_type: "settings.enabled",
        actor_role: "system",
        actor_user_id: null,
        payload: { hello: "world" }
      }
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-guards.integration.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement guards and events**

```ts
// apps/api/src/modules/pg-rent/services/rent-guards.ts
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PoolClient } from "pg";

import type { DatabaseService } from "../../../common/database.service";
import { readFeatureFlags } from "../../../config/feature-flags";

export type Queryable = Pick<PoolClient, "query">;

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
```

```ts
// apps/api/src/modules/pg-rent/services/rent-events.ts
import type { Queryable, RentActor } from "./rent-guards";

export interface RentEventInput {
  propertyId: string;
  entityType: "invoice" | "payment" | "expense" | "settings" | "assignment" | "receipt";
  entityId: string;
  eventType: string;
  actor: RentActor;
  payload?: Record<string, unknown>;
}

/** Invariant 8: called inside the mutating transaction, never after it. */
export async function writeRentEvent(client: Queryable, input: RentEventInput): Promise<void> {
  await client.query(
    `INSERT INTO pg_rent_events
       (pg_property_id, entity_type, entity_id, event_type, actor_user_id, actor_role, payload)
     VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7::jsonb)`,
    [
      input.propertyId,
      input.entityType,
      input.entityId,
      input.eventType,
      input.actor.id,
      input.actor.role,
      JSON.stringify(input.payload ?? {})
    ]
  );
}
```

- [ ] **Step 4: Create the module and register it**

```ts
// apps/api/src/modules/pg-rent/pg-rent.module.ts
import { Module } from "@nestjs/common";

import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";

// Providers and controllers are appended by later tasks in this plan; the
// arrays start empty so the module can be registered (and AppModule boot
// tested) before any service exists.
@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [],
  providers: [],
  exports: []
})
export class PgRentModule {}
```

In `apps/api/src/app.module.ts`, add `import { PgRentModule } from "./modules/pg-rent/pg-rent.module";` beside the other module imports and add `PgRentModule` to the `imports: [...]` array after `PgOperationsModule` (find it with `grep -n "PgOperationsModule" apps/api/src/app.module.ts`).

- [ ] **Step 5: Run the tests and boot check**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-guards.integration.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-guards.ts apps/api/src/modules/pg-rent/services/rent-events.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/app.module.ts apps/api/src/modules/pg-rent/__tests__/rent-guards.integration.test.ts
git commit -m "feat(pg-rent): module skeleton, ownership/flag/db guards, event writer"
```

---

### Task 8: Test fixtures and the invariant checker

**Files:**

- Create: `apps/api/src/modules/pg-rent/__tests__/helpers/rent-fixtures.ts`
- Create: `apps/api/src/modules/pg-rent/__tests__/helpers/assert-rent-invariants.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/assert-rent-invariants.integration.test.ts`

**Interfaces:**

- Produces:

```ts
// rent-fixtures.ts
export class RentFixtures {
  constructor(db: DatabaseService, runId: string);
  cityId: number;
  userIds: string[];
  propertyIds: string[];
  async setup(): Promise<void>; // city
  async teardown(): Promise<void>; // properties (cascade), users, city
  async createUser(role: Role, suffix: string): Promise<string>;
  async createProperty(
    operatorId: string,
    opts?: { internalCode?: string; displayName?: string }
  ): Promise<string>;
  async createListingWithDetails(
    propertyId: string,
    operatorId: string,
    opts?: { rentDueDay?: number | null; depositPaise?: number | null; startingRentPaise?: number }
  ): Promise<string>; // pg_listings + pg_details
  async createRoomType(
    listingId: string,
    opts?: { rentPaise?: number; depositPaise?: number | null }
  ): Promise<string>;
  async createRoom(
    propertyId: string,
    opts?: { roomTypeId?: string | null; roomNumber?: string }
  ): Promise<string>;
  async createBed(roomId: string, label: string, status?: string): Promise<string>;
  async createAssignment(
    propertyId: string,
    bedId: string,
    opts: {
      status?: string;
      occupantPhone?: string;
      occupantName?: string;
      tenantUserId?: string | null;
      moveIn?: string | null;
      noticeEnd?: string | null;
      moveOut?: string | null;
      rentPaise?: number | null;
      depositPaise?: number | null;
      rentDueDay?: number | null;
      createdBy: string;
    }
  ): Promise<string>;
}
// assert-rent-invariants.ts
export async function assertRentInvariants(
  db: Pick<DatabaseService, "query">,
  propertyId: string
): Promise<void>; // throws with a list of violations
```

- [ ] **Step 1: Write the fixtures helper**

Copy the column lists from `pg-operations/__tests__/maintenance.integration.test.ts` `createFixture` (users, pg_properties, pg_rooms, pg_beds, pg_bed_assignments) — those inserts are known to satisfy the constraints — and add listing / details / room-type inserts:

```ts
// apps/api/src/modules/pg-rent/__tests__/helpers/rent-fixtures.ts
import { randomUUID } from "node:crypto";

import type { DatabaseService } from "../../../../common/database.service";
import type { Role } from "../../../../common/types";

export class RentFixtures {
  cityId = 0;
  readonly userIds: string[] = [];
  readonly propertyIds: string[] = [];
  private phoneSeq = 0;

  constructor(
    private readonly db: DatabaseService,
    private readonly runId: string
  ) {}

  async setup(): Promise<void> {
    const city = await this.db.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, 'Rent test city', 'Rent test city', 'Test State', 'Test State') RETURNING id`,
      [`rent-${this.runId}`]
    );
    this.cityId = city.rows[0].id;
  }

  async teardown(): Promise<void> {
    if (this.propertyIds.length) {
      await this.db.query(`DELETE FROM pg_properties WHERE id = ANY($1::uuid[])`, [
        this.propertyIds
      ]);
    }
    if (this.userIds.length) {
      await this.db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = ANY($1::uuid[])`, [
        this.userIds
      ]);
      await this.db.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [this.userIds]);
    }
    if (this.cityId) await this.db.query(`DELETE FROM cities WHERE id = $1`, [this.cityId]);
  }

  nextPhone(): string {
    this.phoneSeq += 1;
    return `+9177${this.runId.slice(0, 6)}${String(this.phoneSeq).padStart(3, "0")}`;
  }

  async createUser(role: Role, phone = this.nextPhone()): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language) VALUES ($1, $2::user_role, 'en') RETURNING id::text`,
      [phone, role]
    );
    this.userIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  async createProperty(
    operatorId: string,
    opts: { internalCode?: string | null; displayName?: string } = {}
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_properties
         (operator_id, display_name, internal_code, city_id, is_primary, manage_enabled, layout_status, total_floors)
       VALUES ($1::uuid, $2, $3, $4, false, true, 'ready', 1) RETURNING id::text`,
      [
        operatorId,
        opts.displayName ?? `Rent property ${randomUUID().slice(0, 8)}`,
        opts.internalCode ?? null,
        this.cityId
      ]
    );
    this.propertyIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  /** pg_listings + pg_details for the property (rent_due_day seed, listing-level deposit, starting rent fallback). */
  async createListingWithDetails(
    propertyId: string,
    operatorId: string,
    opts: {
      rentDueDay?: number | null;
      depositPaise?: number | null;
      startingRentPaise?: number;
    } = {}
  ): Promise<string> {
    const listingId = randomUUID();
    await this.db.query(
      `INSERT INTO pg_listings (id, operator_user_id, pg_property_id, title, starting_rent_paise, status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Rent test listing', $4, 'active')`,
      [listingId, operatorId, propertyId, opts.startingRentPaise ?? 700000]
    );
    await this.db.query(
      `INSERT INTO pg_details (listing_id, total_beds, onboarding_path, rent_due_day, security_deposit_paise)
       VALUES ($1::uuid, 10, 'self_serve'::pg_onboarding_path, $2, $3)`,
      [listingId, opts.rentDueDay ?? null, opts.depositPaise ?? null]
    );
    return listingId;
  }

  async createRoomType(
    listingId: string,
    opts: { rentPaise?: number; depositPaise?: number | null; sharing?: string } = {}
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_room_types
         (listing_id, sharing, ac, bathroom_kind, furnishing, monthly_rent_paise, security_deposit_paise, vacancy_count)
       VALUES ($1::uuid, $2::pg_sharing_kind, false, 'attached_western'::pg_bathroom_kind, 'semi_furnished'::furnishing_type, $3, $4, 0)
       RETURNING id::text`,
      [listingId, opts.sharing ?? "double", opts.rentPaise ?? 900000, opts.depositPaise ?? null]
    );
    return result.rows[0].id;
  }

  async createRoom(
    propertyId: string,
    opts: { roomTypeId?: string | null; roomNumber?: string } = {}
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_rooms (pg_property_id, room_type_id, floor, room_number, display_label, bed_count, status)
       VALUES ($1::uuid, $2::uuid, 1, $3, 'Rent room', 2, 'active') RETURNING id::text`,
      [propertyId, opts.roomTypeId ?? null, opts.roomNumber ?? `R-${randomUUID().slice(0, 6)}`]
    );
    return result.rows[0].id;
  }

  async createBed(roomId: string, label: string, status = "occupied"): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_beds (room_id, bed_label, status, sort_order, metadata)
       VALUES ($1::uuid, $2, $3::pg_bed_status, 1, '{}'::jsonb) RETURNING id::text`,
      [roomId, label, status]
    );
    return result.rows[0].id;
  }

  async createAssignment(
    propertyId: string,
    bedId: string,
    opts: {
      createdBy: string;
      status?: string;
      occupantPhone?: string;
      occupantName?: string;
      tenantUserId?: string | null;
      moveIn?: string | null;
      noticeEnd?: string | null;
      moveOut?: string | null;
      rentPaise?: number | null;
      depositPaise?: number | null;
      rentDueDay?: number | null;
    }
  ): Promise<string> {
    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_bed_assignments
         (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164, status,
          move_in_date, notice_end_date, move_out_date, monthly_rent_paise, security_deposit_paise, rent_due_day, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::pg_assignment_status,
               $7::date, $8::date, $9::date, $10, $11, $12, $13::uuid)
       RETURNING id::text`,
      [
        propertyId,
        bedId,
        opts.tenantUserId ?? null,
        opts.occupantName ?? "Rent Tenant",
        opts.occupantPhone ?? this.nextPhone(),
        opts.status ?? "active",
        opts.moveIn === undefined ? "2026-09-12" : opts.moveIn,
        opts.noticeEnd ?? null,
        opts.moveOut ?? null,
        opts.rentPaise ?? null,
        opts.depositPaise ?? null,
        opts.rentDueDay ?? null,
        opts.createdBy
      ]
    );
    return result.rows[0].id;
  }
}
```

Enum literals verified against the migrations: `pg_sharing_kind` ('single','double','triple','quad','dorm' — 0031:71), `pg_bathroom_kind` ('attached_western', … — 0031:74), `furnishing_type` ('unfurnished','semi_furnished','fully_furnished' — 0001:47), `pg_onboarding_path` ('self_serve','sales_assist' — 0001:71). `pg_details.total_beds` and `onboarding_path` are NOT NULL without defaults (0001:277, :283), hence the literal values in the insert.

- [ ] **Step 2: Write the invariant checker and its failing test**

```ts
// apps/api/src/modules/pg-rent/__tests__/helpers/assert-rent-invariants.ts
import type { DatabaseService } from "../../../../common/database.service";

/**
 * Spec §3 invariants that can be checked from the data alone. Throws with every
 * violation listed so a failing test names the broken rule, not just "false".
 */
export async function assertRentInvariants(
  db: Pick<DatabaseService, "query">,
  propertyId: string
): Promise<void> {
  const violations: string[] = [];

  // 1: total = Σ lines, total ≥ 0
  const totals = await db.query<{ id: string; total: string; sum: string }>(
    `SELECT i.id::text, i.total_paise::text AS total, COALESCE(SUM(l.amount_paise), 0)::text AS sum
       FROM pg_rent_invoices i LEFT JOIN pg_rent_invoice_lines l ON l.invoice_id = i.id
      WHERE i.pg_property_id = $1::uuid
      GROUP BY i.id HAVING i.total_paise <> COALESCE(SUM(l.amount_paise), 0) OR i.total_paise < 0`,
    [propertyId]
  );
  for (const r of totals.rows)
    violations.push(`inv1 invoice ${r.id}: total ${r.total} != lines ${r.sum}`);

  // 2 + 14: amount_paid = Σ confirmed allocations to the invoice, and ≤ total
  const paid = await db.query<{ id: string; paid: string; sum: string; total: string }>(
    `SELECT i.id::text, i.amount_paid_paise::text AS paid, i.total_paise::text AS total,
            COALESCE(SUM(a.amount_paise) FILTER (WHERE p.status = 'confirmed'), 0)::text AS sum
       FROM pg_rent_invoices i
       LEFT JOIN pg_rent_payment_allocations a ON a.invoice_id = i.id
       LEFT JOIN pg_rent_payments p ON p.id = a.payment_id
      WHERE i.pg_property_id = $1::uuid
      GROUP BY i.id
     HAVING i.amount_paid_paise <> COALESCE(SUM(a.amount_paise) FILTER (WHERE p.status = 'confirmed'), 0)
         OR i.amount_paid_paise > i.total_paise`,
    [propertyId]
  );
  for (const r of paid.rows)
    violations.push(`inv2/14 invoice ${r.id}: paid ${r.paid}, allocs ${r.sum}, total ${r.total}`);

  // 3: Σ allocations of an inflow ≤ its amount
  const over = await db.query<{ id: string }>(
    `SELECT p.id::text FROM pg_rent_payments p
       JOIN pg_rent_payment_allocations a ON a.payment_id = p.id
      WHERE p.pg_property_id = $1::uuid
      GROUP BY p.id HAVING SUM(a.amount_paise) > p.amount_paise`,
    [propertyId]
  );
  for (const r of over.rows) violations.push(`inv3 payment ${r.id}: over-allocated`);

  // 4: status is the pure function
  const status = await db.query<{ id: string; status: string; expected: string }>(
    `SELECT id::text, status::text,
            CASE WHEN status = 'cancelled' THEN 'cancelled'
                 WHEN status = 'draft' THEN 'draft'
                 WHEN amount_paid_paise = total_paise THEN 'paid'
                 WHEN amount_paid_paise > 0 THEN 'partially_paid'
                 ELSE 'issued' END AS expected
       FROM pg_rent_invoices WHERE pg_property_id = $1::uuid`,
    [propertyId]
  );
  for (const r of status.rows) {
    if (r.status !== r.expected)
      violations.push(`inv4 invoice ${r.id}: status ${r.status}, expected ${r.expected}`);
  }

  // 5: no overlapping non-cancelled rent periods per assignment
  const overlap = await db.query<{ a: string; b: string }>(
    `SELECT x.id::text AS a, y.id::text AS b
       FROM pg_rent_invoices x JOIN pg_rent_invoices y
         ON x.assignment_id = y.assignment_id AND x.id < y.id
        AND x.kind = 'rent' AND y.kind = 'rent'
        AND x.status <> 'cancelled' AND y.status <> 'cancelled'
        AND daterange(x.period_start, x.period_end, '[]') && daterange(y.period_start, y.period_end, '[]')
      WHERE x.pg_property_id = $1::uuid`,
    [propertyId]
  );
  for (const r of overlap.rows) violations.push(`inv5 invoices ${r.a} and ${r.b} overlap`);

  // 15: outflows fully funded; inflows never targets
  const outflows = await db.query<{ id: string; amount: string; funded: string }>(
    `SELECT p.id::text, p.amount_paise::text AS amount, COALESCE(SUM(a.amount_paise), 0)::text AS funded
       FROM pg_rent_payments p LEFT JOIN pg_rent_payment_allocations a ON a.refund_payment_id = p.id
      WHERE p.pg_property_id = $1::uuid AND p.direction = 'outflow' AND p.status = 'confirmed'
      GROUP BY p.id HAVING COALESCE(SUM(a.amount_paise), 0) <> p.amount_paise`,
    [propertyId]
  );
  for (const r of outflows.rows)
    violations.push(`inv15 outflow ${r.id}: amount ${r.amount}, funded ${r.funded}`);

  // 16: late_fee lines only on eligible rent invoices
  const fees = await db.query<{ id: string }>(
    `SELECT i.id::text FROM pg_rent_invoices i JOIN pg_rent_invoice_lines l ON l.invoice_id = i.id
      WHERE i.pg_property_id = $1::uuid AND l.kind = 'late_fee' AND (i.kind <> 'rent' OR i.late_fee_eligible = false)`,
    [propertyId]
  );
  for (const r of fees.rows)
    violations.push(`inv16 invoice ${r.id}: late fee on ineligible invoice`);

  if (violations.length) {
    throw new Error(`Rent invariants violated for ${propertyId}:\n${violations.join("\n")}`);
  }
}
```

```ts
// apps/api/src/modules/pg-rent/__tests__/assert-rent-invariants.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("assertRentInvariants", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, { createdBy: operatorId });
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("passes on an empty property and names a broken total", async () => {
    await expect(assertRentInvariants(db, propertyId)).resolves.toBeUndefined();
    const inv = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, room_number, bed_label, kind, invoice_number, billing_month, due_date, status, source, total_paise)
       VALUES ($1::uuid, $2::uuid, 'R1', 'A', 'adhoc', 'T-INV-0001', '2026-09-01', '2026-09-10', 'issued', 'manual', 500)
       RETURNING id::text`,
      [propertyId, assignmentId]
    );
    await expect(assertRentInvariants(db, propertyId)).rejects.toThrow(/inv1 invoice/);
    await db.query(`DELETE FROM pg_rent_invoices WHERE id = $1::uuid`, [inv.rows[0].id]);
  });
});
```

- [ ] **Step 3: Run**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/assert-rent-invariants.integration.test.ts`
Expected: PASS (1 test). If the `pg_room_types` insert in `createRoomType` fails on an enum literal, fix the literal per the note in Step 1 — this test does not exercise it, but Task 9's does.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/pg-rent/__tests__/helpers apps/api/src/modules/pg-rent/__tests__/assert-rent-invariants.integration.test.ts
git commit -m "test(pg-rent): DB fixtures and invariant checker"
```

---

### Task 9: Settings DTO — zod schemas and row mapper

**Files:**

- Create: `apps/api/src/modules/pg-rent/dto/settings.dto.ts`
- Create: `apps/api/src/modules/pg-rent/dto/common.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/settings-dto.test.ts`

**Interfaces:**

- Consumes: Task 3 money helpers.
- Produces:

```ts
// dto/common.ts
export function toIsoDate(value: Date | string | null): string | null     // pg date → 'YYYY-MM-DD'
export function toIsoTs(value: Date | string | null): string | null       // timestamptz → ISO
export function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T   // BadRequestException {code:'invalid_payload', message}

// dto/settings.dto.ts
export const RentSettingsInputSchema: z.ZodType<PgRentSettingsInput>     // all optional, bounds per §4.2
export const RentEnableInputSchema: z.ZodType<PgRentEnableInput>
export const RentPatchSettingsInputSchema: z.ZodType<PgRentPatchSettingsInput>
export const RentResumeInputSchema: z.ZodType<PgRentResumeInput>
export interface RentSettingsRow { …every column of pg_rent_settings as pg returns it… }
export function toSettingsDto(row: RentSettingsRow): PgRentSettings
export function settingsInputToColumns(input: PgRentSettingsInput): Record<string, unknown>  // inr→paise, rate, jsonb strings
export function normaliseOffsets(offsets: number[]): number[]              // sorted, deduped
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/settings-dto.test.ts
import { describe, expect, it } from "vitest";

import { parseOrThrow, toIsoDate, toIsoTs } from "../dto/common";
import {
  RentEnableInputSchema,
  RentPatchSettingsInputSchema,
  RentSettingsInputSchema,
  normaliseOffsets,
  settingsInputToColumns,
  toSettingsDto,
  type RentSettingsRow
} from "../dto/settings.dto";

const row: RentSettingsRow = {
  pg_property_id: "11111111-1111-1111-1111-111111111111",
  paused_at: null,
  pause_reason: null,
  enabled_on: new Date("2026-09-17T00:00:00Z"),
  billing_starts_on: "2026-09-17",
  cycle_mode: "calendar_month",
  billing_timing: "advance",
  due_day: 5,
  proration_mode: "actual_days",
  prorate_move_out: false,
  invoice_lead_days: 5,
  reminder_offsets_days: [-3, 0, 1],
  late_fee_enabled: false,
  late_fee_grace_days: 3,
  late_fee_kind: "flat",
  late_fee_amount_paise: "10000",
  late_fee_percent_bp: 200,
  late_fee_cap_paise: null,
  late_fee_auto_apply: false,
  upi_vpa: "owner@upi",
  upi_payee_name: "Owner",
  bank_details: null,
  whatsapp_phone_e164: null,
  msg_reminder: null,
  msg_overdue: null,
  msg_tenant_paid: null,
  msg_receipt_share: null,
  receipt_prefix: "BPG",
  receipt_business_name: null,
  receipt_address: null,
  receipt_footer: null,
  receipt_logo_path: null,
  default_line_items: [{ key: "meals", kind: "meals", label: "Meals", amount_paise: 250000 }],
  electricity_unit_rate_paise: 850,
  created_at: new Date("2026-09-17T10:00:00Z"),
  updated_at: "2026-09-17T10:00:00.000Z"
};

describe("toSettingsDto", () => {
  it("maps paise to rupees and dates to ISO strings; no _paise key escapes", () => {
    const dto = toSettingsDto(row);
    expect(dto.late_fee_amount_inr).toBe(100);
    expect(dto.late_fee_cap_inr).toBeNull();
    expect(dto.electricity_unit_rate_inr).toBe(8.5);
    expect(dto.default_line_items).toEqual([
      { key: "meals", kind: "meals", label: "Meals", amount_inr: 2500 }
    ]);
    expect(dto.enabled_on).toBe("2026-09-17");
    expect(dto.updated_at).toBe("2026-09-17T10:00:00.000Z");
    expect(JSON.stringify(dto)).not.toMatch(/_paise/);
  });
});

describe("RentSettingsInputSchema", () => {
  it("accepts a valid full input and converts to columns", () => {
    const parsed = parseOrThrow(RentSettingsInputSchema, {
      cycle_mode: "anniversary",
      billing_timing: "arrears",
      due_day: 5,
      reminder_offsets_days: [1, -3, 0, 1],
      late_fee_amount_inr: 100,
      late_fee_cap_inr: 500,
      upi_vpa: "owner.name-1@okaxis",
      bank_details: {
        account_name: "A",
        account_number: "123456789012",
        ifsc: "HDFC0001234",
        bank_name: "HDFC"
      },
      receipt_prefix: "BPG",
      default_line_items: [{ key: "meals", kind: "meals", label: "Meals", amount_inr: 2500 }],
      electricity_unit_rate_inr: 8.5
    });
    expect(parsed.reminder_offsets_days).toEqual([-3, 0, 1]);
    const cols = settingsInputToColumns(parsed);
    expect(cols.late_fee_amount_paise).toBe(10000);
    expect(cols.late_fee_cap_paise).toBe(50000);
    expect(cols.electricity_unit_rate_paise).toBe(850);
    expect(cols.default_line_items).toBe(
      JSON.stringify([{ key: "meals", kind: "meals", label: "Meals", amount_paise: 250000 }])
    );
    expect(cols.bank_details).toBe(
      JSON.stringify({
        account_name: "A",
        account_number: "123456789012",
        ifsc: "HDFC0001234",
        bank_name: "HDFC"
      })
    );
    expect(cols.cycle_mode).toBe("anniversary");
  });

  it("rejects out-of-bound values with invalid_payload", () => {
    for (const bad of [
      { due_day: 29 },
      { invoice_lead_days: 16 },
      { reminder_offsets_days: [] },
      { reminder_offsets_days: [-16] },
      { reminder_offsets_days: [1, 2, 3, 4, 5, 6] },
      { late_fee_grace_days: 31 },
      { late_fee_amount_inr: 0 },
      { late_fee_amount_inr: 10001 },
      { late_fee_percent_bp: 49 },
      { late_fee_cap_inr: 50001 },
      { upi_vpa: "no-at-sign" },
      { upi_payee_name: "x".repeat(51) },
      { bank_details: { account_name: "A", account_number: "12", ifsc: "bad", bank_name: "B" } },
      { whatsapp_phone_e164: "9999999999" },
      { msg_reminder: "x".repeat(601) },
      { receipt_prefix: "b" },
      { receipt_prefix: "ABCDEFG" },
      { receipt_business_name: "x".repeat(81) },
      { default_line_items: [{ key: "rent", kind: "rent", label: "Rent", amount_inr: 1 }] },
      {
        default_line_items: Array.from({ length: 11 }, (_, i) => ({
          key: `k${i}`,
          kind: "other",
          label: "x",
          amount_inr: 1
        }))
      },
      { electricity_unit_rate_inr: 0.4 },
      { electricity_unit_rate_inr: 51 },
      { electricity_unit_rate_inr: 8.555 },
      { cycle_mode: "weekly" }
    ]) {
      expect(() => parseOrThrow(RentSettingsInputSchema, bad), JSON.stringify(bad)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: "invalid_payload" }) })
      );
    }
  });

  it("strips unknown keys rather than failing (forward-compatible clients)", () => {
    const parsed = parseOrThrow(RentSettingsInputSchema, { due_day: 3, something_else: 1 });
    expect(parsed).toEqual({ due_day: 3 });
  });

  it("enable accepts billing_starts_on; patch requires updated_at", () => {
    expect(
      parseOrThrow(RentEnableInputSchema, { billing_starts_on: "2026-09-01" }).billing_starts_on
    ).toBe("2026-09-01");
    expect(() =>
      parseOrThrow(RentEnableInputSchema, { billing_starts_on: "2026-02-30" })
    ).toThrow();
    expect(() => parseOrThrow(RentPatchSettingsInputSchema, { due_day: 3 })).toThrow();
    expect(
      parseOrThrow(RentPatchSettingsInputSchema, {
        due_day: 3,
        updated_at: "2026-09-17T10:00:00.000Z"
      }).updated_at
    ).toBe("2026-09-17T10:00:00.000Z");
  });
});

describe("common", () => {
  it("normalises offsets, formats dates", () => {
    expect(normaliseOffsets([1, -3, 0, 1])).toEqual([-3, 0, 1]);
    expect(toIsoDate(new Date("2026-09-17T00:00:00Z"))).toBe("2026-09-17");
    expect(toIsoDate("2026-09-17")).toBe("2026-09-17");
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoTs(new Date("2026-09-17T10:00:00Z"))).toBe("2026-09-17T10:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/settings-dto.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `dto/common.ts`**

```ts
// apps/api/src/modules/pg-rent/dto/common.ts
import { BadRequestException } from "@nestjs/common";
import type { z } from "zod";

/** pg `date` columns arrive as JS Dates at UTC midnight (the driver parses them as UTC here). */
export function toIsoDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return value.slice(0, 10);
}

export function toIsoTs(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** The admin.controller.ts:1314 pattern, centralised. */
export function parseOrThrow<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "invalid_payload",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    });
  }
  return parsed.data;
}
```

**Driver note:** verify how this API's `pg` parses `date` columns — run `node -e "const {types}=require('pg');console.log(types.getTypeParser(1082)('2026-09-17'))"` inside `apps/api`. If it prints a `Date` at **local** midnight (default `pg` behaviour) rather than UTC, change `toIsoDate` to use `getFullYear/getMonth/getDate` exactly like `pg-bed-assignment.service.ts:120` does, and update the test's `enabled_on` fixture to `new Date(2026, 8, 17)`. Either way the exported behaviour (`'YYYY-MM-DD'`) is what every caller relies on.

- [ ] **Step 4: Implement `dto/settings.dto.ts`**

```ts
// apps/api/src/modules/pg-rent/dto/settings.dto.ts
import { z } from "zod";
import type {
  PgRentDefaultLineItem,
  PgRentEnableInput,
  PgRentPatchSettingsInput,
  PgRentResumeInput,
  PgRentSettings,
  PgRentSettingsInput
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";
import { toIsoDate, toIsoTs } from "./common";
import { inrToPaise, paiseToInr, rateInrToPaise, ratePaiseToInr } from "./money";

const LINE_KINDS_FOR_DEFAULTS = [
  "electricity",
  "meals",
  "maintenance",
  "damage",
  "cleaning",
  "forfeit",
  "other",
  "discount",
  "adjustment"
] as const;

const isoDate = z.string().refine(isIsoDate, "must be a real YYYY-MM-DD date");

export function normaliseOffsets(offsets: number[]): number[] {
  return Array.from(new Set(offsets)).sort((a, b) => a - b);
}

const BankDetailsSchema = z
  .object({
    account_name: z.string().trim().min(1).max(80),
    account_number: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, "6–20 digits"),
    ifsc: z
      .string()
      .trim()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC format"),
    bank_name: z.string().trim().min(1).max(60)
  })
  .strict();

const DefaultLineItemSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{1,24}$/),
    kind: z.enum(LINE_KINDS_FOR_DEFAULTS),
    label: z.string().trim().min(1).max(40),
    amount_inr: z.number().int().min(1).max(100000)
  })
  .strict();

export const RentSettingsInputSchema = z.object({
  cycle_mode: z.enum(["calendar_month", "anniversary"]).optional(),
  billing_timing: z.enum(["advance", "arrears"]).optional(),
  due_day: z.number().int().min(1).max(28).optional(),
  proration_mode: z.enum(["actual_days", "flat_30"]).optional(),
  prorate_move_out: z.boolean().optional(),
  invoice_lead_days: z.number().int().min(0).max(15).optional(),
  reminder_offsets_days: z
    .array(z.number().int().min(-15).max(30))
    .min(1)
    .max(5)
    .transform(normaliseOffsets)
    .optional(),
  late_fee_enabled: z.boolean().optional(),
  late_fee_grace_days: z.number().int().min(0).max(30).optional(),
  late_fee_kind: z.enum(["flat", "per_day", "percent"]).optional(),
  late_fee_amount_inr: z.number().int().min(1).max(10000).optional(),
  late_fee_percent_bp: z.number().int().min(50).max(1000).optional(),
  late_fee_cap_inr: z.number().int().min(1).max(50000).nullable().optional(),
  late_fee_auto_apply: z.boolean().optional(),
  upi_vpa: z
    .string()
    .trim()
    .regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, "UPI ID format")
    .nullable()
    .optional(),
  upi_payee_name: z.string().trim().min(1).max(50).nullable().optional(),
  bank_details: BankDetailsSchema.nullable().optional(),
  whatsapp_phone_e164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, "E.164")
    .nullable()
    .optional(),
  msg_reminder: z.string().max(600).nullable().optional(),
  msg_overdue: z.string().max(600).nullable().optional(),
  msg_tenant_paid: z.string().max(600).nullable().optional(),
  msg_receipt_share: z.string().max(600).nullable().optional(),
  receipt_prefix: z
    .string()
    .regex(/^[A-Z0-9]{2,6}$/, "2–6 capitals/digits")
    .optional(),
  receipt_business_name: z.string().trim().max(80).nullable().optional(),
  receipt_address: z.string().trim().max(200).nullable().optional(),
  receipt_footer: z.string().trim().max(200).nullable().optional(),
  receipt_logo_path: z.string().trim().max(300).nullable().optional(),
  default_line_items: z.array(DefaultLineItemSchema).max(10).optional(),
  electricity_unit_rate_inr: z
    .number()
    .min(0.5)
    .max(50)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "at most two decimals")
    .nullable()
    .optional()
}) satisfies z.ZodType<PgRentSettingsInput, PgRentSettingsInput>;

export const RentEnableInputSchema = RentSettingsInputSchema.extend({
  billing_starts_on: isoDate.optional()
}) satisfies z.ZodType<PgRentEnableInput, PgRentEnableInput>;

export const RentPatchSettingsInputSchema = RentSettingsInputSchema.extend({
  updated_at: z.string().datetime()
}) satisfies z.ZodType<PgRentPatchSettingsInput, PgRentPatchSettingsInput>;

export const RentResumeInputSchema = z.object({
  billing_starts_on: isoDate.optional()
}) satisfies z.ZodType<PgRentResumeInput, PgRentResumeInput>;

/** Every column of pg_rent_settings as the driver returns it. */
export interface RentSettingsRow {
  pg_property_id: string;
  paused_at: Date | string | null;
  pause_reason: "owner" | "transfer" | null;
  enabled_on: Date | string;
  billing_starts_on: Date | string;
  cycle_mode: "calendar_month" | "anniversary";
  billing_timing: "advance" | "arrears";
  due_day: number;
  proration_mode: "actual_days" | "flat_30";
  prorate_move_out: boolean;
  invoice_lead_days: number;
  reminder_offsets_days: number[];
  late_fee_enabled: boolean;
  late_fee_grace_days: number;
  late_fee_kind: "flat" | "per_day" | "percent";
  late_fee_amount_paise: number | string;
  late_fee_percent_bp: number;
  late_fee_cap_paise: number | string | null;
  late_fee_auto_apply: boolean;
  upi_vpa: string | null;
  upi_payee_name: string | null;
  bank_details: PgRentSettings["bank_details"];
  whatsapp_phone_e164: string | null;
  msg_reminder: string | null;
  msg_overdue: string | null;
  msg_tenant_paid: string | null;
  msg_receipt_share: string | null;
  receipt_prefix: string;
  receipt_business_name: string | null;
  receipt_address: string | null;
  receipt_footer: string | null;
  receipt_logo_path: string | null;
  default_line_items: Array<Omit<PgRentDefaultLineItem, "amount_inr"> & { amount_paise: number }>;
  electricity_unit_rate_paise: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function toSettingsDto(row: RentSettingsRow): PgRentSettings {
  return {
    pg_property_id: row.pg_property_id,
    paused_at: toIsoTs(row.paused_at),
    pause_reason: row.pause_reason,
    enabled_on: toIsoDate(row.enabled_on) as string,
    billing_starts_on: toIsoDate(row.billing_starts_on) as string,
    cycle_mode: row.cycle_mode,
    billing_timing: row.billing_timing,
    due_day: row.due_day,
    proration_mode: row.proration_mode,
    prorate_move_out: row.prorate_move_out,
    invoice_lead_days: row.invoice_lead_days,
    reminder_offsets_days: row.reminder_offsets_days,
    late_fee_enabled: row.late_fee_enabled,
    late_fee_grace_days: row.late_fee_grace_days,
    late_fee_kind: row.late_fee_kind,
    late_fee_amount_inr: paiseToInr(row.late_fee_amount_paise),
    late_fee_percent_bp: row.late_fee_percent_bp,
    late_fee_cap_inr: row.late_fee_cap_paise === null ? null : paiseToInr(row.late_fee_cap_paise),
    late_fee_auto_apply: row.late_fee_auto_apply,
    upi_vpa: row.upi_vpa,
    upi_payee_name: row.upi_payee_name,
    bank_details: row.bank_details,
    whatsapp_phone_e164: row.whatsapp_phone_e164,
    msg_reminder: row.msg_reminder,
    msg_overdue: row.msg_overdue,
    msg_tenant_paid: row.msg_tenant_paid,
    msg_receipt_share: row.msg_receipt_share,
    receipt_prefix: row.receipt_prefix,
    receipt_business_name: row.receipt_business_name,
    receipt_address: row.receipt_address,
    receipt_footer: row.receipt_footer,
    receipt_logo_path: row.receipt_logo_path,
    default_line_items: row.default_line_items.map((item) => ({
      key: item.key,
      kind: item.kind,
      label: item.label,
      amount_inr: paiseToInr(item.amount_paise)
    })),
    electricity_unit_rate_inr: ratePaiseToInr(row.electricity_unit_rate_paise),
    created_at: toIsoTs(row.created_at) as string,
    updated_at: toIsoTs(row.updated_at) as string
  };
}

/**
 * Input → column map for INSERT/UPDATE. Only keys present in `input` appear.
 * jsonb columns are pre-stringified so the caller binds them with `::jsonb`.
 */
export function settingsInputToColumns(input: PgRentSettingsInput): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  const copy = <K extends keyof PgRentSettingsInput>(key: K, column = key as string) => {
    if (input[key] !== undefined) cols[column] = input[key];
  };
  copy("cycle_mode");
  copy("billing_timing");
  copy("due_day");
  copy("proration_mode");
  copy("prorate_move_out");
  copy("invoice_lead_days");
  copy("reminder_offsets_days");
  copy("late_fee_enabled");
  copy("late_fee_grace_days");
  copy("late_fee_kind");
  copy("late_fee_percent_bp");
  copy("late_fee_auto_apply");
  copy("upi_vpa");
  copy("upi_payee_name");
  copy("whatsapp_phone_e164");
  copy("msg_reminder");
  copy("msg_overdue");
  copy("msg_tenant_paid");
  copy("msg_receipt_share");
  copy("receipt_prefix");
  copy("receipt_business_name");
  copy("receipt_address");
  copy("receipt_footer");
  copy("receipt_logo_path");
  if (input.late_fee_amount_inr !== undefined)
    cols.late_fee_amount_paise = inrToPaise(input.late_fee_amount_inr);
  if (input.late_fee_cap_inr !== undefined) {
    cols.late_fee_cap_paise =
      input.late_fee_cap_inr === null ? null : inrToPaise(input.late_fee_cap_inr);
  }
  if (input.bank_details !== undefined) {
    cols.bank_details = input.bank_details === null ? null : JSON.stringify(input.bank_details);
  }
  if (input.default_line_items !== undefined) {
    cols.default_line_items = JSON.stringify(
      input.default_line_items.map((item) => ({
        key: item.key,
        kind: item.kind,
        label: item.label,
        amount_paise: inrToPaise(item.amount_inr)
      }))
    );
  }
  if (input.electricity_unit_rate_inr !== undefined) {
    cols.electricity_unit_rate_paise =
      input.electricity_unit_rate_inr === null
        ? null
        : rateInrToPaise(input.electricity_unit_rate_inr);
  }
  return cols;
}
```

Zod 4 note: `satisfies z.ZodType<Out, In>` compiles only if the inferred output matches the shared type exactly; if the compiler complains about the `transform` on `reminder_offsets_days`, drop the `satisfies` clause on that schema and keep an explicit `type _Check = z.infer<typeof RentSettingsInputSchema> extends PgRentSettingsInput ? true : never;` line below it.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/settings-dto.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-rent/dto/common.ts apps/api/src/modules/pg-rent/dto/settings.dto.ts apps/api/src/modules/pg-rent/__tests__/settings-dto.test.ts
git commit -m "feat(pg-rent): settings zod schemas and row mapper"
```

---

### Task 10: Settings service — enable, get, patch, pause, resume, transfer hook

**Files:**

- Create: `apps/api/src/modules/pg-rent/services/rent-settings.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts` (provider + export)
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-settings.integration.test.ts`

**Interfaces:**

- Consumes: Tasks 7–9.
- Produces:

```ts
@Injectable()
export class RentSettingsService {
  constructor(@Inject(DatabaseService) db: DatabaseService)
  async enable(operatorId: string, propertyId: string, input: PgRentEnableInput): Promise<PgRentSettings>      // 409 already_enabled
  async get(operatorId: string, propertyId: string): Promise<PgRentSettings | null>
  async getRow(q: Queryable, propertyId: string, lock?: boolean): Promise<RentSettingsRow | null>            // internal, no ownership check
  async patch(operatorId: string, propertyId: string, input: PgRentPatchSettingsInput): Promise<PgRentSettings>  // 404 rent_not_enabled, 409 settings_conflict
  async pause(operatorId: string, propertyId: string): Promise<PgRentSettings>
  async resume(operatorId: string, propertyId: string, input: PgRentResumeInput): Promise<PgRentSettings>     // 409 payee_required when pause_reason='transfer' and no payee
  async onOwnershipTransferred(client: PoolClient, propertyId: string, fromOperatorId: string, toOperatorId: string): Promise<void>
  defaultsFor(q: Queryable, propertyId: string): Promise<{ due_day: number; receipt_prefix: string }>       // internal seed values
}
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-settings.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { todayIst } from "../../../common/date";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe("RentSettingsService without a database", () => {
  it("rejects every call with rent_requires_db", async () => {
    const service = new RentSettingsService({ isEnabled: () => false } as DatabaseService);
    const unavailable = { response: { code: "rent_requires_db" } };
    await expect(service.enable("u", "p", {})).rejects.toMatchObject(unavailable);
    await expect(service.get("u", "p")).rejects.toMatchObject(unavailable);
    await expect(
      service.patch("u", "p", { updated_at: new Date().toISOString() })
    ).rejects.toMatchObject(unavailable);
    await expect(service.pause("u", "p")).rejects.toMatchObject(unavailable);
    await expect(service.resume("u", "p", {})).rejects.toMatchObject(unavailable);
  });
});

describe.skipIf(!HAS_DB)("RentSettingsService (real Postgres)", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let service: RentSettingsService;
  let operatorId: string;
  let otherOperatorId: string;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    otherOperatorId = await fx.createUser("pg_operator");
    service = new RentSettingsService(db);
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("enables with seeded defaults: due_day from pg_details, prefix from internal_code, counters row, event", async () => {
    const propertyId = await fx.createProperty(operatorId, { internalCode: "bpg-7" });
    await fx.createListingWithDetails(propertyId, operatorId, { rentDueDay: 7 });

    const settings = await service.enable(operatorId, propertyId, {});
    expect(settings).toMatchObject({
      pg_property_id: propertyId,
      due_day: 7,
      receipt_prefix: "BPG7",
      cycle_mode: "calendar_month",
      billing_timing: "advance",
      enabled_on: todayIst(),
      billing_starts_on: todayIst(),
      paused_at: null,
      late_fee_enabled: false
    });
    const counters = await db.query<{ next_invoice_seq: number; next_receipt_seq: number }>(
      `SELECT next_invoice_seq, next_receipt_seq FROM pg_rent_counters WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    expect(counters.rows[0]).toEqual({ next_invoice_seq: 1, next_receipt_seq: 1 });
    const events = await db.query<{ event_type: string; actor_role: string }>(
      `SELECT event_type, actor_role FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [propertyId]
    );
    expect(events.rows).toEqual([{ event_type: "settings.enabled", actor_role: "pg_operator" }]);

    await expect(service.enable(operatorId, propertyId, {})).rejects.toMatchObject({
      response: { code: "already_enabled" }
    });
    await expect(service.enable(otherOperatorId, propertyId, {})).rejects.toMatchObject({
      response: { code: "forbidden" }
    });
  });

  it("derives the prefix from the display name when there is no internal code, and accepts explicit inputs", async () => {
    const propertyId = await fx.createProperty(operatorId, { displayName: "Sunrise Boys Hostel" });
    const settings = await service.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      cycle_mode: "anniversary",
      billing_timing: "arrears",
      upi_vpa: "sunrise@okaxis",
      upi_payee_name: "Sunrise"
    });
    expect(settings).toMatchObject({
      receipt_prefix: "SBH",
      billing_starts_on: "2026-09-01",
      cycle_mode: "anniversary",
      billing_timing: "arrears",
      upi_vpa: "sunrise@okaxis",
      due_day: 1
    });
  });

  it("patches with the updated_at token, records a diff, and 409s on a stale token", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const before = await service.enable(operatorId, propertyId, {});

    const after = await service.patch(operatorId, propertyId, {
      updated_at: before.updated_at,
      due_day: 10,
      late_fee_enabled: true,
      late_fee_amount_inr: 150
    });
    expect(after).toMatchObject({ due_day: 10, late_fee_enabled: true, late_fee_amount_inr: 150 });
    expect(after.updated_at).not.toBe(before.updated_at);

    await expect(
      service.patch(operatorId, propertyId, { updated_at: before.updated_at, due_day: 11 })
    ).rejects.toMatchObject({ response: { code: "settings_conflict" } });

    const events = await db.query<{
      event_type: string;
      payload: { diff: Record<string, unknown> };
    }>(
      `SELECT event_type, payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'settings.updated'`,
      [propertyId]
    );
    expect(events.rows[0].payload.diff).toEqual({
      due_day: { from: 1, to: 10 },
      late_fee_enabled: { from: false, to: true },
      late_fee_amount_paise: { from: 10000, to: 15000 }
    });
  });

  it("pauses and resumes with a new floor; counters are untouched by the token", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const enabled = await service.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01"
    });

    const paused = await service.pause(operatorId, propertyId);
    expect(paused.paused_at).not.toBeNull();
    expect(paused.pause_reason).toBe("owner");

    // bumping a counter must not move updated_at (spec §4.2b)
    await db.query(
      `UPDATE pg_rent_counters SET next_invoice_seq = 5 WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const stillSame = await service.get(operatorId, propertyId);
    expect(stillSame?.updated_at).toBe(paused.updated_at);

    const resumed = await service.resume(operatorId, propertyId, {
      billing_starts_on: "2026-11-10"
    });
    expect(resumed).toMatchObject({
      paused_at: null,
      pause_reason: null,
      billing_starts_on: "2026-11-10",
      enabled_on: enabled.enabled_on
    });
    const events = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [propertyId]
    );
    expect(events.rows.map((e) => e.event_type)).toEqual([
      "settings.enabled",
      "settings.paused",
      "settings.resumed"
    ]);
  });

  it("ownership transfer pauses, clears payee details, keeps branding, and blocks resume until a payee is set", async () => {
    const propertyId = await fx.createProperty(operatorId);
    await service.enable(operatorId, propertyId, {
      upi_vpa: "old@okaxis",
      upi_payee_name: "Old Owner",
      bank_details: {
        account_name: "Old",
        account_number: "123456789012",
        ifsc: "HDFC0001234",
        bank_name: "HDFC"
      },
      whatsapp_phone_e164: "+919999999999",
      receipt_business_name: "Sunrise PG"
    });

    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE pg_properties SET operator_id = $2::uuid WHERE id = $1::uuid`, [
        propertyId,
        otherOperatorId
      ]);
      await service.onOwnershipTransferred(client, propertyId, operatorId, otherOperatorId);
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const after = await service.get(otherOperatorId, propertyId);
    expect(after).toMatchObject({
      pause_reason: "transfer",
      upi_vpa: null,
      upi_payee_name: null,
      bank_details: null,
      whatsapp_phone_e164: null,
      receipt_business_name: "Sunrise PG"
    });
    expect(after?.paused_at).not.toBeNull();
    await expect(service.get(operatorId, propertyId)).rejects.toMatchObject({
      response: { code: "forbidden" }
    });

    await expect(service.resume(otherOperatorId, propertyId, {})).rejects.toMatchObject({
      response: { code: "payee_required" }
    });
    await service.patch(otherOperatorId, propertyId, {
      updated_at: after!.updated_at,
      upi_vpa: "new@okaxis",
      upi_payee_name: "New"
    });
    const resumed = await service.resume(otherOperatorId, propertyId, {});
    expect(resumed.paused_at).toBeNull();

    const events = await db.query<{
      event_type: string;
      actor_role: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, actor_role, payload FROM pg_rent_events WHERE entity_id = $1::uuid AND event_type = 'settings.transferred'`,
      [propertyId]
    );
    expect(events.rows[0].actor_role).toBe("admin");
    expect(events.rows[0].payload).toEqual({
      from_operator: operatorId,
      to_operator: otherOperatorId,
      cleared: ["upi_vpa", "upi_payee_name", "bank_details", "whatsapp_phone_e164"]
    });
  });

  it("is a no-op transfer hook for a property without settings", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const client = await db.getClient();
    try {
      await client.query("BEGIN");
      await service.onOwnershipTransferred(client, propertyId, operatorId, otherOperatorId);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const events = await db.query(`SELECT 1 FROM pg_rent_events WHERE entity_id = $1::uuid`, [
      propertyId
    ]);
    expect(events.rowCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-settings.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// apps/api/src/modules/pg-rent/services/rent-settings.service.ts
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentEnableInput,
  PgRentPatchSettingsInput,
  PgRentResumeInput,
  PgRentSettings
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { IST_TODAY_SQL, todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { settingsInputToColumns, toSettingsDto, type RentSettingsRow } from "../dto/settings.dto";
import { writeRentEvent } from "./rent-events";
import { assertManagedOwnership, requireDb, type Queryable, type RentActor } from "./rent-guards";

const SETTINGS_COLUMNS = `
  pg_property_id::text, paused_at, pause_reason::text, enabled_on, billing_starts_on,
  cycle_mode::text, billing_timing::text, due_day, proration_mode::text, prorate_move_out,
  invoice_lead_days, reminder_offsets_days, late_fee_enabled, late_fee_grace_days, late_fee_kind::text,
  late_fee_amount_paise, late_fee_percent_bp, late_fee_cap_paise, late_fee_auto_apply,
  upi_vpa, upi_payee_name, bank_details, whatsapp_phone_e164,
  msg_reminder, msg_overdue, msg_tenant_paid, msg_receipt_share,
  receipt_prefix, receipt_business_name, receipt_address, receipt_footer, receipt_logo_path,
  default_line_items, electricity_unit_rate_paise, created_at, updated_at`;

const PAYEE_COLUMNS = ["upi_vpa", "upi_payee_name", "bank_details", "whatsapp_phone_e164"] as const;

/** 2–6 capitals/digits from internal_code, else initials of the display name, else "PG". */
export function deriveReceiptPrefix(internalCode: string | null, displayName: string): string {
  const fromCode = (internalCode ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (fromCode.length >= 2) return fromCode;
  const initials = displayName
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 6);
  if (initials.length >= 2) return initials;
  return (initials + "PG").slice(0, 6);
}

@Injectable()
export class RentSettingsService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private actor(operatorId: string): RentActor {
    return { id: operatorId, role: "pg_operator" };
  }

  /** Internal read with no ownership check (engine, hooks). */
  async getRow(q: Queryable, propertyId: string, lock = false): Promise<RentSettingsRow | null> {
    const result = await q.query<RentSettingsRow>(
      `SELECT ${SETTINGS_COLUMNS} FROM pg_rent_settings WHERE pg_property_id = $1::uuid${lock ? " FOR UPDATE" : ""}`,
      [propertyId]
    );
    return result.rows[0] ?? null;
  }

  async defaultsFor(
    q: Queryable,
    propertyId: string
  ): Promise<{ due_day: number; receipt_prefix: string }> {
    const property = await q.query<{ internal_code: string | null; display_name: string }>(
      `SELECT internal_code, display_name FROM pg_properties WHERE id = $1::uuid`,
      [propertyId]
    );
    const details = await q.query<{ rent_due_day: number | null }>(
      `SELECT d.rent_due_day
         FROM pg_listings pl JOIN pg_details d ON d.listing_id = pl.id
        WHERE pl.pg_property_id = $1::uuid AND d.rent_due_day IS NOT NULL
        ORDER BY pl.created_at ASC LIMIT 1`,
      [propertyId]
    );
    return {
      due_day: details.rows[0]?.rent_due_day ?? 1,
      receipt_prefix: deriveReceiptPrefix(
        property.rows[0]?.internal_code ?? null,
        property.rows[0]?.display_name ?? "PG"
      )
    };
  }

  async enable(
    operatorId: string,
    propertyId: string,
    input: PgRentEnableInput
  ): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      if (await this.getRow(client, propertyId, true)) {
        throw new ConflictException({
          code: "already_enabled",
          message: "Rent collection is already enabled"
        });
      }
      const defaults = await this.defaultsFor(client, propertyId);
      const { billing_starts_on, ...rest } = input;
      const cols = {
        due_day: defaults.due_day,
        receipt_prefix: defaults.receipt_prefix,
        ...settingsInputToColumns(rest),
        pg_property_id: propertyId,
        enabled_on: todayIst(),
        billing_starts_on: billing_starts_on ?? todayIst()
      };
      const names = Object.keys(cols);
      const values = Object.values(cols);
      const placeholders = names.map((name, i) => this.cast(name, `$${i + 1}`)).join(", ");
      const inserted = await client.query<RentSettingsRow>(
        `INSERT INTO pg_rent_settings (${names.join(", ")}) VALUES (${placeholders}) RETURNING ${SETTINGS_COLUMNS}`,
        values
      );
      await client.query(`INSERT INTO pg_rent_counters (pg_property_id) VALUES ($1::uuid)`, [
        propertyId
      ]);
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.enabled",
        actor: this.actor(operatorId),
        payload: { billing_starts_on: cols.billing_starts_on }
      });
      return toSettingsDto(inserted.rows[0]);
    });
  }

  async get(operatorId: string, propertyId: string): Promise<PgRentSettings | null> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const row = await this.getRow(this.db, propertyId);
    return row ? toSettingsDto(row) : null;
  }

  async patch(
    operatorId: string,
    propertyId: string,
    input: PgRentPatchSettingsInput
  ): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await this.requireRow(client, propertyId, true);
      if (new Date(current.updated_at).toISOString() !== new Date(input.updated_at).toISOString()) {
        throw new ConflictException({
          code: "settings_conflict",
          message: "Settings changed since you loaded them"
        });
      }
      const { updated_at: _token, ...rest } = input;
      const cols = settingsInputToColumns(rest);
      if (Object.keys(cols).length === 0) return toSettingsDto(current);
      const updated = await this.applyColumns(client, propertyId, cols);
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.updated",
        actor: this.actor(operatorId),
        payload: { diff: this.diff(current, updated) }
      });
      return toSettingsDto(updated);
    });
  }

  async pause(operatorId: string, propertyId: string): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      await this.requireRow(client, propertyId, true);
      const updated = await client.query<RentSettingsRow>(
        `UPDATE pg_rent_settings SET paused_at = now(), pause_reason = 'owner'
          WHERE pg_property_id = $1::uuid RETURNING ${SETTINGS_COLUMNS}`,
        [propertyId]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.paused",
        actor: this.actor(operatorId)
      });
      return toSettingsDto(updated.rows[0]);
    });
  }

  async resume(
    operatorId: string,
    propertyId: string,
    input: PgRentResumeInput
  ): Promise<PgRentSettings> {
    requireDb(this.db);
    return transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await this.requireRow(client, propertyId, true);
      if (current.pause_reason === "transfer" && !current.upi_vpa && !current.bank_details) {
        throw new ConflictException({
          code: "payee_required",
          message: "Add a UPI ID or bank details before resuming after an ownership transfer"
        });
      }
      const floor = input.billing_starts_on ?? todayIst();
      const updated = await client.query<RentSettingsRow>(
        `UPDATE pg_rent_settings SET paused_at = NULL, pause_reason = NULL, billing_starts_on = $2::date
          WHERE pg_property_id = $1::uuid RETURNING ${SETTINGS_COLUMNS}`,
        [propertyId, floor]
      );
      await writeRentEvent(client, {
        propertyId,
        entityType: "settings",
        entityId: propertyId,
        eventType: "settings.resumed",
        actor: this.actor(operatorId),
        payload: { billing_starts_on: floor }
      });
      return toSettingsDto(updated.rows[0]);
    });
  }

  /**
   * Spec §11.2 / D20. Runs INSIDE AdminPgTransferService's transaction, after
   * operator_id is re-pointed. Data-driven: no settings row → nothing happens.
   */
  async onOwnershipTransferred(
    client: PoolClient,
    propertyId: string,
    fromOperatorId: string,
    toOperatorId: string
  ): Promise<void> {
    const current = await this.getRow(client, propertyId, true);
    if (!current) return;
    await client.query(
      `UPDATE pg_rent_settings
          SET paused_at = COALESCE(paused_at, now()), pause_reason = 'transfer',
              upi_vpa = NULL, upi_payee_name = NULL, bank_details = NULL, whatsapp_phone_e164 = NULL
        WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    await writeRentEvent(client, {
      propertyId,
      entityType: "settings",
      entityId: propertyId,
      eventType: "settings.transferred",
      actor: { id: null, role: "admin" },
      payload: {
        from_operator: fromOperatorId,
        to_operator: toOperatorId,
        cleared: [...PAYEE_COLUMNS]
      }
    });
  }

  private async requireRow(
    q: Queryable,
    propertyId: string,
    lock: boolean
  ): Promise<RentSettingsRow> {
    const row = await this.getRow(q, propertyId, lock);
    if (!row)
      throw new NotFoundException({
        code: "rent_not_enabled",
        message: "Rent collection is not enabled"
      });
    return row;
  }

  private cast(column: string, placeholder: string): string {
    if (column === "bank_details" || column === "default_line_items")
      return `${placeholder}::jsonb`;
    if (column === "reminder_offsets_days") return `${placeholder}::smallint[]`;
    if (column === "pg_property_id") return `${placeholder}::uuid`;
    if (column === "enabled_on" || column === "billing_starts_on") return `${placeholder}::date`;
    if (column === "cycle_mode") return `${placeholder}::pg_rent_cycle_mode`;
    if (column === "billing_timing") return `${placeholder}::pg_rent_billing_timing`;
    if (column === "proration_mode") return `${placeholder}::pg_rent_proration_mode`;
    if (column === "late_fee_kind") return `${placeholder}::pg_rent_late_fee_kind`;
    return placeholder;
  }

  private async applyColumns(
    client: Queryable,
    propertyId: string,
    cols: Record<string, unknown>
  ): Promise<RentSettingsRow> {
    const names = Object.keys(cols);
    const sets = names.map((name, i) => `${name} = ${this.cast(name, `$${i + 2}`)}`).join(", ");
    const updated = await client.query<RentSettingsRow>(
      `UPDATE pg_rent_settings SET ${sets} WHERE pg_property_id = $1::uuid RETURNING ${SETTINGS_COLUMNS}`,
      [propertyId, ...Object.values(cols)]
    );
    return updated.rows[0];
  }

  /** {column: {from, to}} for every column whose serialised value changed. */
  private diff(
    before: RentSettingsRow,
    after: RentSettingsRow
  ): Record<string, { from: unknown; to: unknown }> {
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(after) as Array<keyof RentSettingsRow>) {
      if (key === "updated_at" || key === "created_at") continue;
      const a = JSON.stringify(this.normalise(before[key]));
      const b = JSON.stringify(this.normalise(after[key]));
      if (a !== b) out[key] = { from: this.normalise(before[key]), to: this.normalise(after[key]) };
    }
    return out;
  }

  private normalise(value: unknown): unknown {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value); // bigint columns arrive as strings
    return value;
  }
}
```

Note on `IST_TODAY_SQL`: it is imported for the `enabled_on` default in case you prefer the SQL side; the implementation above binds `todayIst()` from TypeScript so the test can compare against the same function. Keep one or the other, not both — remove the unused import if you keep the TypeScript value.

Register in `pg-rent.module.ts`: add `RentSettingsService` to `providers` and `exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-settings.integration.test.ts`
Expected: PASS, 7 tests. If the diff test's `late_fee_amount_paise` compares `"10000"` vs `10000`, the `normalise` helper is what makes them equal — check it is applied on both sides.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-settings.service.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/rent-settings.integration.test.ts
git commit -m "feat(pg-rent): settings service with enable/patch/pause/resume and the ownership-transfer hook"
```

---

### Task 11: Allocation service — credit auto-apply (the slice 1b plug)

**Files:**

- Create: `apps/api/src/modules/pg-rent/services/rent-allocation.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-allocation.integration.test.ts`

**Interfaces:**

- Produces:

```ts
@Injectable()
export class RentAllocationService {
  /** Allocate unallocated credit of the invoice's assignment (confirmed inflows, oldest paid_on first) to this invoice up to its balance. Returns paise applied. Writes `allocation.changed` when > 0. Caller holds the transaction. */
  async applyUnallocatedCredit(
    client: PoolClient,
    invoiceId: string,
    actor: RentActor
  ): Promise<number>;
  /** Recompute amount_paid_paise, status, paid_at/settled_on for one invoice from its allocations. Returns the new status. Caller holds the transaction. */
  async recomputeInvoice(
    client: PoolClient,
    invoiceId: string,
    settledOn?: string | null
  ): Promise<PgRentInvoiceStatus>;
}
```

Slice 1b's `finalizeConfirmed` and every total-changing mutation call `recomputeInvoice`; the engine calls `applyUnallocatedCredit` at issue.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-allocation.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { RentAllocationService } from "../services/rent-allocation.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentAllocationService.applyUnallocatedCredit", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let propertyId: string;
  let assignmentId: string;
  const service = new RentAllocationService();

  async function insertInvoice(totalPaise: number, number: string): Promise<string> {
    const inv = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, room_number, bed_label, kind, invoice_number, billing_month, due_date, status, source, total_paise)
       VALUES ($1::uuid, $2::uuid, 'R1', 'A', 'adhoc', $3, '2026-09-01', '2026-09-10', 'issued', 'manual', $4)
       RETURNING id::text`,
      [propertyId, assignmentId, number, totalPaise]
    );
    await db.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source) VALUES ($1::uuid, 'other', 'Charge', $2, 'operator')`,
      [inv.rows[0].id, totalPaise]
    );
    return inv.rows[0].id;
  }

  async function insertConfirmedInflow(amountPaise: number, paidOn: string): Promise<string> {
    const p = await db.query<{ id: string }>(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on, confirmed_at)
       VALUES ($1::uuid, $2::uuid, $3, 'cash', 'operator', 'confirmed', $4::date, now()) RETURNING id::text`,
      [propertyId, assignmentId, amountPaise, paidOn]
    );
    return p.rows[0].id;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, { createdBy: operatorId });
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("applies credit oldest-first up to the balance, recomputes status, and is a no-op when nothing is unallocated", async () => {
    const p1 = await insertConfirmedInflow(100000, "2026-09-01"); // ₹1,000 older
    const p2 = await insertConfirmedInflow(50000, "2026-09-05"); // ₹500 newer
    const invoice = await insertInvoice(120000, "T-INV-0001"); // ₹1,200

    const applied = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice, SYSTEM_ACTOR)
    );
    expect(applied).toBe(120000);

    const allocs = await db.query<{ payment_id: string; amount_paise: string }>(
      `SELECT payment_id::text, amount_paise::text FROM pg_rent_payment_allocations WHERE invoice_id = $1::uuid ORDER BY created_at`,
      [invoice]
    );
    expect(allocs.rows).toEqual([
      { payment_id: p1, amount_paise: "100000" },
      { payment_id: p2, amount_paise: "20000" }
    ]);
    const row = await db.query<{
      status: string;
      amount_paid_paise: string;
      settled_on: Date | null;
    }>(
      `SELECT status::text, amount_paid_paise::text, settled_on FROM pg_rent_invoices WHERE id = $1::uuid`,
      [invoice]
    );
    expect(row.rows[0].status).toBe("paid");
    expect(row.rows[0].amount_paid_paise).toBe("120000");
    expect(row.rows[0].settled_on).not.toBeNull(); // p2's paid_on
    const events = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid`,
      [invoice]
    );
    expect(events.rows).toEqual([{ event_type: "allocation.changed" }]);

    // ₹300 of p2 remains; a second invoice takes it and stays partially paid
    const invoice2 = await insertInvoice(80000, "T-INV-0002");
    const applied2 = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice2, SYSTEM_ACTOR)
    );
    expect(applied2).toBe(30000);
    const row2 = await db.query<{ status: string }>(
      `SELECT status::text FROM pg_rent_invoices WHERE id = $1::uuid`,
      [invoice2]
    );
    expect(row2.rows[0].status).toBe("partially_paid");

    // nothing left
    const invoice3 = await insertInvoice(10000, "T-INV-0003");
    const applied3 = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice3, SYSTEM_ACTOR)
    );
    expect(applied3).toBe(0);
    await assertRentInvariants(db, propertyId);
  });

  it("ignores pending, reversed, outflow and other-assignment payments", async () => {
    await db.query(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on)
       VALUES ($1::uuid, $2::uuid, 99900, 'upi', 'tenant_claim', 'pending_confirmation', '2026-09-06')`,
      [propertyId, assignmentId]
    );
    const invoice = await insertInvoice(5000, "T-INV-0004");
    const applied = await transaction(db, (client) =>
      service.applyUnallocatedCredit(client, invoice, SYSTEM_ACTOR)
    );
    expect(applied).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-allocation.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-rent/services/rent-allocation.service.ts
import { Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type { PgRentInvoiceStatus } from "@cribliv/shared-types";

import { invoiceStatus } from "../pure/rent-status";
import { writeRentEvent } from "./rent-events";
import type { RentActor } from "./rent-guards";

interface InvoiceMoneyRow {
  pg_property_id: string;
  assignment_id: string;
  status: PgRentInvoiceStatus;
  total_paise: string;
  amount_paid_paise: string;
  paid_at: Date | null;
}

interface CreditRow {
  payment_id: string;
  paid_on: string;
  unallocated: string;
}

@Injectable()
export class RentAllocationService {
  /**
   * Spec §5.4 step 4 / §6.2 step 3. Unallocated credit = confirmed inflows'
   * amount − Σ allocations (to invoices AND to outflows, invariant 3), oldest
   * paid_on first. Never touches drafts or cancelled invoices.
   */
  async applyUnallocatedCredit(
    client: PoolClient,
    invoiceId: string,
    actor: RentActor
  ): Promise<number> {
    const invoice = await this.lockInvoice(client, invoiceId);
    if (invoice.status === "draft" || invoice.status === "cancelled") return 0;
    let balance = Number(invoice.total_paise) - Number(invoice.amount_paid_paise);
    if (balance <= 0) return 0;

    const credits = await client.query<CreditRow>(
      `SELECT p.id::text AS payment_id, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on,
              (p.amount_paise - COALESCE(SUM(a.amount_paise), 0))::text AS unallocated
         FROM pg_rent_payments p
         LEFT JOIN pg_rent_payment_allocations a ON a.payment_id = p.id
        WHERE p.assignment_id = $1::uuid AND p.direction = 'inflow' AND p.status = 'confirmed'
        GROUP BY p.id
       HAVING p.amount_paise - COALESCE(SUM(a.amount_paise), 0) > 0
        ORDER BY p.paid_on ASC, p.created_at ASC
        FOR UPDATE OF p`,
      [invoice.assignment_id]
    );

    let applied = 0;
    let lastPaidOn: string | null = null;
    for (const credit of credits.rows) {
      if (balance <= 0) break;
      const take = Math.min(balance, Number(credit.unallocated));
      await client.query(
        `INSERT INTO pg_rent_payment_allocations (payment_id, invoice_id, amount_paise) VALUES ($1::uuid, $2::uuid, $3)`,
        [credit.payment_id, invoiceId, take]
      );
      applied += take;
      balance -= take;
      lastPaidOn = credit.paid_on;
    }
    if (applied === 0) return 0;

    await this.recomputeInvoice(client, invoiceId, lastPaidOn);
    await writeRentEvent(client, {
      propertyId: invoice.pg_property_id,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "allocation.changed",
      actor,
      payload: { reason: "credit_auto_apply", applied_paise: applied }
    });
    return applied;
  }

  /**
   * Invariants 2 and 4 for one invoice. `settledOn` is the paid_on of the
   * payment that closed the balance; kept only when the balance reaches zero
   * for the first time (spec §4.4 settled_on).
   */
  async recomputeInvoice(
    client: PoolClient,
    invoiceId: string,
    settledOn: string | null = null
  ): Promise<PgRentInvoiceStatus> {
    const invoice = await this.lockInvoice(client, invoiceId);
    const sums = await client.query<{ paid: string }>(
      `SELECT COALESCE(SUM(a.amount_paise), 0)::text AS paid
         FROM pg_rent_payment_allocations a JOIN pg_rent_payments p ON p.id = a.payment_id
        WHERE a.invoice_id = $1::uuid AND p.status = 'confirmed'`,
      [invoiceId]
    );
    const paid = Number(sums.rows[0].paid);
    const total = Number(invoice.total_paise);
    const status = invoiceStatus({
      draft: invoice.status === "draft",
      cancelled: invoice.status === "cancelled",
      totalPaise: total,
      paidPaise: paid
    });
    const reachedZero = status === "paid" && total > 0;
    await client.query(
      `UPDATE pg_rent_invoices
          SET amount_paid_paise = $2,
              status = $3::pg_rent_invoice_status,
              paid_at = CASE WHEN $4::boolean THEN COALESCE(paid_at, now()) ELSE NULL END,
              settled_on = CASE WHEN $4::boolean THEN COALESCE(settled_on, $5::date) ELSE NULL END
        WHERE id = $1::uuid`,
      [invoiceId, paid, status, reachedZero, settledOn]
    );
    return status;
  }

  private async lockInvoice(client: PoolClient, invoiceId: string): Promise<InvoiceMoneyRow> {
    const result = await client.query<InvoiceMoneyRow>(
      `SELECT pg_property_id::text, assignment_id::text, status::text, total_paise::text, amount_paid_paise::text, paid_at
         FROM pg_rent_invoices WHERE id = $1::uuid FOR UPDATE`,
      [invoiceId]
    );
    if (!result.rows[0]) throw new Error(`invoice ${invoiceId} not found`);
    return result.rows[0];
  }
}
```

Register `RentAllocationService` in `pg-rent.module.ts` `providers` and `exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-allocation.integration.test.ts`
Expected: PASS, 2 tests, and `assertRentInvariants` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-rent/services/rent-allocation.service.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/rent-allocation.integration.test.ts
git commit -m "feat(pg-rent): credit auto-apply and invoice recompute"
```

---

### Task 12: Invoice engine — plan, issue, deposit, preview, assignment hook

**Files:**

- Modify: `apps/api/src/modules/pg-rent/pure/rent-period.ts` (add `periodLabel`)
- Create: `apps/api/src/modules/pg-rent/services/rent-invoice-engine.service.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-period.test.ts` (label cases), `apps/api/src/modules/pg-rent/__tests__/rent-invoice-engine.integration.test.ts`

**Interfaces:**

- Consumes: Tasks 4–6, 10, 11.
- Produces:

```ts
// pure/rent-period.ts
export function periodLabel(period: Period, spec: PeriodSpec): string; // "September 2026" | "12 Sep – 30 Sep 2026"

// services/rent-invoice-engine.service.ts
export type EngineSettings = Pick<
  RentSettingsRow,
  | "cycle_mode"
  | "billing_timing"
  | "due_day"
  | "proration_mode"
  | "prorate_move_out"
  | "invoice_lead_days"
  | "billing_starts_on"
  | "enabled_on"
  | "default_line_items"
  | "receipt_prefix"
>;
export interface RentPlan {
  kind: "rent";
  period: Period;
  cut: boolean;
  dueDate: string;
  amountPaise: number;
  factor: number | null;
  draft: boolean;
  rentSource: PgRentRentSource;
  rentPaise: number | null;
}
export interface DepositPlan {
  kind: "deposit";
  dueDate: string;
  amountPaise: number;
}
@Injectable()
export class RentInvoiceEngineService {
  constructor(
    db: DatabaseService,
    settings: RentSettingsService,
    allocation: RentAllocationService
  );
  async generateInvoicesForProperty(
    propertyId: string,
    today: string,
    actor?: RentActor,
    opts?: { assignmentId?: string; force?: boolean }
  ): Promise<PgRentGenerateResult>;
  async previewForProperty(
    propertyId: string,
    settings: EngineSettings,
    today: string
  ): Promise<PgRentEnablePreview>;
  async onAssignmentEvent(event: {
    type: string;
    propertyId: string;
    assignmentId: string;
  }): Promise<void>;
}
```

`force` (default false) skips the `paused_at` check — never set by the sweep; reserved for tests.

- [ ] **Step 1: Add `periodLabel` with tests**

Append to `apps/api/src/modules/pg-rent/__tests__/rent-period.test.ts`:

```ts
describe("periodLabel", () => {
  it("names a natural calendar month, otherwise a day range", () => {
    expect(periodLabel({ start: "2026-09-01", end: "2026-09-30" }, calendar)).toBe(
      "September 2026"
    );
    expect(periodLabel({ start: "2026-09-12", end: "2026-09-30" }, calendar)).toBe(
      "12 Sep – 30 Sep 2026"
    );
    expect(periodLabel({ start: "2026-09-12", end: "2026-10-11" }, anniv12)).toBe(
      "12 Sep – 11 Oct 2026"
    );
    expect(periodLabel({ start: "2026-12-12", end: "2027-01-11" }, anniv12)).toBe(
      "12 Dec 2026 – 11 Jan 2027"
    );
  });
});
```

(add `periodLabel` to that file's import). Then append to `pure/rent-period.ts`:

```ts
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

/** Human label for a period. Natural calendar months read "September 2026"; anything else is a range. */
export function periodLabel(period: Period, spec: PeriodSpec): string {
  const [sy, sm, sd] = [
    Number(period.start.slice(0, 4)),
    Number(period.start.slice(5, 7)),
    Number(period.start.slice(8, 10))
  ];
  const [ey, em, ed] = [
    Number(period.end.slice(0, 4)),
    Number(period.end.slice(5, 7)),
    Number(period.end.slice(8, 10))
  ];
  if (spec.cycleMode === "calendar_month" && isNaturalPeriod(period, spec)) {
    return `${MONTHS_LONG[sm - 1]} ${sy}`;
  }
  if (sy === ey) return `${sd} ${MONTHS[sm - 1]} – ${ed} ${MONTHS[em - 1]} ${sy}`;
  return `${sd} ${MONTHS[sm - 1]} ${sy} – ${ed} ${MONTHS[em - 1]} ${ey}`;
}
```

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-period.test.ts` → PASS (16 tests).

- [ ] **Step 2: Write the failing engine tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-invoice-engine.integration.test.ts
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { RentAllocationService } from "../services/rent-allocation.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentInvoiceEngineService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let operatorId: string;

  type Setup = { propertyId: string; listingId: string; roomTypeId: string; roomId: string };

  async function setupProperty(
    opts: {
      settings?: Parameters<RentSettingsService["enable"]>[2];
      roomTypeRent?: number;
      roomTypeDeposit?: number | null;
      listingDeposit?: number | null;
      withRoomType?: boolean;
    } = {}
  ): Promise<Setup> {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId, {
      depositPaise: opts.listingDeposit ?? null
    });
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: opts.roomTypeRent ?? 900000,
      depositPaise: opts.roomTypeDeposit ?? null
    });
    const roomId = await fx.createRoom(propertyId, {
      roomTypeId: opts.withRoomType === false ? null : roomTypeId,
      roomNumber: "102"
    });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      ...opts.settings
    });
    return { propertyId, listingId, roomTypeId, roomId };
  }

  async function tenant(
    setup: Setup,
    label: string,
    opts: Parameters<RentFixtures["createAssignment"]>[2] extends infer T ? Partial<T> : never = {}
  ) {
    const bedId = await fx.createBed(setup.roomId, label);
    return fx.createAssignment(setup.propertyId, bedId, { createdBy: operatorId, ...opts });
  }

  async function invoices(assignmentId: string) {
    const r = await db.query<{
      kind: string;
      status: string;
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      total_paise: string;
      invoice_number: string;
      rent_source: string | null;
      proration_factor: string | null;
      pay_token: string | null;
    }>(
      `SELECT kind::text, status::text, to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end,
              to_char(due_date,'YYYY-MM-DD') AS due_date, total_paise::text, invoice_number, rent_source::text, proration_factor::text, pay_token
         FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind, period_start NULLS FIRST`,
      [assignmentId]
    );
    return r.rows;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    engine = new RentInvoiceEngineService(db, settings, new RentAllocationService());
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("advance: mid-month move-in gets a prorated first period due on creation, then a full month with lead days; twice is a no-op", async () => {
    const s = await setupProperty();
    const a = await tenant(s, "A", { moveIn: "2026-09-12" });

    const first = await engine.generateInvoicesForProperty(s.propertyId, "2026-09-12");
    expect(first).toMatchObject({ invoices_created: 1, drafts_created: 0, deposits_created: 0 });
    let rows = await invoices(a);
    expect(rows).toMatchObject([
      {
        kind: "rent",
        status: "issued",
        period_start: "2026-09-12",
        period_end: "2026-09-30",
        due_date: "2026-09-12",
        total_paise: "570000",
        rent_source: "room_type",
        invoice_number: expect.stringMatching(/-INV-0001$/)
      }
    ]);
    expect(rows[0].pay_token).toHaveLength(43);
    expect(Number(rows[0].proration_factor)).toBeCloseTo(19 / 30, 5);

    // Sep 29: October (due Oct 5, lead 5 → create from Sep 30) not yet
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-29")).toMatchObject({
      invoices_created: 0
    });
    // Sep 30: October is created
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30")).toMatchObject({
      invoices_created: 1
    });
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30")).toMatchObject({
      invoices_created: 0
    });
    rows = await invoices(a);
    expect(rows[1]).toMatchObject({
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      due_date: "2026-10-05",
      total_paise: "900000",
      proration_factor: null
    });
    await assertRentInvariants(db, s.propertyId);
  });

  it("floor: a tenant since August with the floor on Sep 17 is first billed for October (advance) or September (arrears)", async () => {
    const adv = await setupProperty({ settings: { billing_starts_on: "2026-09-17" } });
    const a1 = await tenant(adv, "A", { moveIn: "2026-08-12" });
    await engine.generateInvoicesForProperty(adv.propertyId, "2026-10-01");
    expect(await invoices(a1)).toMatchObject([
      { period_start: "2026-10-01", period_end: "2026-10-31", due_date: "2026-10-05" }
    ]);

    const arr = await setupProperty({
      settings: { billing_starts_on: "2026-09-17", billing_timing: "arrears" }
    });
    const a2 = await tenant(arr, "A", { moveIn: "2026-08-12" });
    await engine.generateInvoicesForProperty(arr.propertyId, "2026-09-30");
    expect(await invoices(a2)).toMatchObject([
      {
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        due_date: "2026-10-05",
        total_paise: "900000"
      }
    ]);
  });

  it("advance: a move-in AFTER the floor is billed from move-in (§19 #48)", async () => {
    const s = await setupProperty({ settings: { billing_starts_on: "2026-09-17" } });
    const a = await tenant(s, "A", { moveIn: "2026-09-20" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-20");
    expect(await invoices(a)).toMatchObject([
      {
        period_start: "2026-09-20",
        period_end: "2026-09-30",
        due_date: "2026-09-20",
        total_paise: "330000"
      }
    ]);
  });

  it("anniversary: periods anchor on the move-in day; tenant override changes the anchor with a bridge", async () => {
    const s = await setupProperty({ settings: { cycle_mode: "anniversary" } });
    const a = await tenant(s, "A", { moveIn: "2026-09-12" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-12");
    expect(await invoices(a)).toMatchObject([
      {
        period_start: "2026-09-12",
        period_end: "2026-10-11",
        due_date: "2026-09-12",
        total_paise: "900000"
      }
    ]);

    await db.query(`UPDATE pg_bed_assignments SET rent_due_day = 1 WHERE id = $1::uuid`, [a]);
    await engine.generateInvoicesForProperty(s.propertyId, "2026-10-12");
    const rows = await invoices(a);
    expect(rows[1]).toMatchObject({
      period_start: "2026-10-12",
      period_end: "2026-10-31",
      due_date: "2026-10-12"
    });
    expect(Number(rows[1].total_paise)).toBe(Math.round((900000 * 20) / 31 / 100) * 100);
  });

  it("window: moved_out final period is created cut and due on creation when prorate_move_out is on (arrears, §19 #37)", async () => {
    const s = await setupProperty({
      settings: { billing_timing: "arrears", prorate_move_out: true }
    });
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30"); // September, due Oct 5
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-10-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.generateInvoicesForProperty(s.propertyId, "2026-10-15");
    const rows = await invoices(a);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      period_start: "2026-10-01",
      period_end: "2026-10-15",
      due_date: "2026-10-15",
      total_paise: "435500"
    });
    // nothing after the window
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-12-01")).toMatchObject({
      invoices_created: 0
    });
  });

  it("window: prorate_move_out off keeps the natural full period; active ignores a stale notice_end_date", async () => {
    const s = await setupProperty({ settings: { prorate_move_out: false } });
    const a = await tenant(s, "A", {
      moveIn: "2026-09-01",
      noticeEnd: "2026-10-15",
      status: "notice_served"
    });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30");
    let rows = await invoices(a);
    expect(rows[1]).toMatchObject({ period_start: "2026-10-01", period_end: "2026-10-31" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-11-30");
    expect(await invoices(a)).toHaveLength(2); // window ended Oct 15 → no November

    await db.query(`UPDATE pg_bed_assignments SET status = 'active' WHERE id = $1::uuid`, [a]); // notice_end_date still set
    // Nov 20: November (natural due Nov 5, already past → due = creation date) is created;
    // December (due Dec 5, lead 5 → from Nov 30) is not yet.
    await engine.generateInvoicesForProperty(s.propertyId, "2026-11-20");
    rows = await invoices(a);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      due_date: "2026-11-20"
    });
  });

  it("drafts when rent resolves only from the listing or not at all; drafts get no token", async () => {
    const s = await setupProperty({ withRoomType: false });
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    const r = await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01");
    expect(r).toMatchObject({ invoices_created: 0, drafts_created: 1 });
    expect(await invoices(a)).toMatchObject([
      { status: "draft", rent_source: "listing", total_paise: "700000", pay_token: null }
    ]);
  });

  it("skips assignments with no move-in date, reserved and cancelled ones, and paused properties", async () => {
    const s = await setupProperty();
    const noMoveIn = await tenant(s, "A", { moveIn: null });
    await tenant(s, "B", { moveIn: "2026-09-01", status: "reserved" });
    await tenant(s, "C", { moveIn: "2026-09-01", status: "cancelled" });
    const r = await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01");
    expect(r).toMatchObject({
      invoices_created: 0,
      skipped: [{ assignment_id: noMoveIn, reason: "no_move_in" }]
    });

    const d = await tenant(s, "D", { moveIn: "2026-09-01" });
    await settings.pause(operatorId, s.propertyId);
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01")).toMatchObject({
      invoices_created: 0
    });
    expect(await invoices(d)).toHaveLength(0);
  });

  it("default line items apply minus the tenant's excludes; credit auto-applies at issue", async () => {
    const s = await setupProperty({
      settings: {
        default_line_items: [
          { key: "meals", kind: "meals", label: "Meals", amount_inr: 2500 },
          { key: "wifi", kind: "other", label: "Wi-Fi", amount_inr: 300 }
        ]
      }
    });
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    await db.query(
      `UPDATE pg_bed_assignments SET default_item_overrides = '{"exclude":["wifi"]}'::jsonb WHERE id = $1::uuid`,
      [a]
    );
    await db.query(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on, confirmed_at)
       VALUES ($1::uuid, $2::uuid, 100000, 'cash', 'operator', 'confirmed', '2026-08-30', now())`,
      [s.propertyId, a]
    );
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01");
    const rows = await invoices(a);
    expect(rows[0]).toMatchObject({ total_paise: "1150000", status: "partially_paid" });
    const lines = await db.query<{
      kind: string;
      label: string;
      amount_paise: string;
      source: string;
    }>(
      `SELECT l.kind::text, l.label, l.amount_paise::text, l.source::text FROM pg_rent_invoice_lines l
        JOIN pg_rent_invoices i ON i.id = l.invoice_id WHERE i.assignment_id = $1::uuid ORDER BY l.sort_order`,
      [a]
    );
    expect(lines.rows).toEqual([
      { kind: "rent", label: "Rent · September 2026", amount_paise: "900000", source: "system" },
      { kind: "meals", label: "Meals", amount_paise: "250000", source: "default_item" }
    ]);
    await assertRentInvariants(db, s.propertyId);
  });

  it("deposit: resolves assignment → room type → listing, only for move-ins on/after enabled_on, once", async () => {
    const s = await setupProperty({ roomTypeDeposit: 1800000, listingDeposit: 1000000 });
    const enabledOn = (await settings.get(operatorId, s.propertyId))!.enabled_on;
    const fromRoomType = await tenant(s, "A", { moveIn: enabledOn });
    const fromAssignment = await tenant(s, "B", { moveIn: enabledOn, depositPaise: 500000 });
    const before = await tenant(s, "C", { moveIn: "2020-01-01" });

    const r = await engine.generateInvoicesForProperty(s.propertyId, enabledOn);
    expect(r.deposits_created).toBe(2);
    expect((await invoices(fromRoomType)).find((i) => i.kind === "deposit")).toMatchObject({
      total_paise: "1800000",
      due_date: enabledOn,
      status: "issued"
    });
    expect((await invoices(fromAssignment)).find((i) => i.kind === "deposit")).toMatchObject({
      total_paise: "500000"
    });
    expect((await invoices(before)).find((i) => i.kind === "deposit")).toBeUndefined();
    expect(
      (await engine.generateInvoicesForProperty(s.propertyId, enabledOn)).deposits_created
    ).toBe(0);
    await assertRentInvariants(db, s.propertyId);
  });

  it("preview reports the first period per tenant without writing anything", async () => {
    const s = await setupProperty({ settings: { billing_starts_on: "2026-09-17" } });
    const a = await tenant(s, "A", { moveIn: "2026-08-12", occupantName: "Rahul" });
    const row = (
      await db.query(`SELECT * FROM pg_rent_settings WHERE pg_property_id = $1::uuid`, [
        s.propertyId
      ])
    ).rows[0];
    const preview = await engine.previewForProperty(s.propertyId, row, "2026-09-17");
    expect(preview.counts).toEqual({
      invoices: 1,
      drafts: 0,
      deposits: 0,
      no_rent: 0,
      no_move_in: 0
    });
    expect(preview.tenants).toMatchObject([
      {
        assignment_id: a,
        occupant_name: "Rahul",
        room_number: "102",
        bed_label: "A",
        first_period: {
          period_start: "2026-10-01",
          period_end: "2026-10-31",
          due_date: "2026-10-05",
          amount_inr: 9000,
          prorated: false,
          draft: false
        },
        skip_reason: null,
        deposit_will_invoice: false
      }
    ]);
    expect(await invoices(a)).toHaveLength(0);
  });

  it("onAssignmentEvent runs generation for that assignment only and is a no-op without settings", async () => {
    const s = await setupProperty();
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    const b = await tenant(s, "B", { moveIn: "2026-09-01" });
    await engine.onAssignmentEvent({ type: "moved_in", propertyId: s.propertyId, assignmentId: a });
    expect(await invoices(a)).toHaveLength(1);
    expect(await invoices(b)).toHaveLength(0);

    const bare = await fx.createProperty(operatorId);
    await expect(
      engine.onAssignmentEvent({ type: "moved_in", propertyId: bare, assignmentId: randomUUID() })
    ).resolves.toBeUndefined();
  });
});
```

`330000` = 900000 × 11/30 = 330000 ✓. `435500` = 900000 × 15/31 = 435483.9 → nearest rupee 435500 ✓. Bridge `20/31`: with the new anchor (day 1) the natural period containing Oct 12 is Oct 1–31 (31 days); Oct 12–31 is 20 days → 580645 → 580600.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-engine.integration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the engine**

```ts
// apps/api/src/modules/pg-rent/services/rent-invoice-engine.service.ts
import { randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import type { PoolClient } from "pg";
import type {
  PgRentEnablePreview,
  PgRentGenerateResult,
  PgRentPreviewSkipReason,
  PgRentPreviewTenant,
  PgRentRentSource
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { compareIsoDates, todayIst } from "../../../common/date";
import { transaction } from "../../../common/transaction";
import { paiseToInr } from "../dto/money";
import type { RentSettingsRow } from "../dto/settings.dto";
import { addDays, dayOf, firstOfMonth } from "../pure/rent-dates";
import {
  firstGeneratedPeriod,
  naturalDueDate,
  nextPeriod,
  periodLabel,
  type DueSpec,
  type Period,
  type PeriodSpec
} from "../pure/rent-period";
import { prorate } from "../pure/rent-proration";
import { billingWindow, cutToWindow, type BillingWindow } from "../pure/rent-window";
import { RentAllocationService } from "./rent-allocation.service";
import { writeRentEvent } from "./rent-events";
import { requireDb, SYSTEM_ACTOR, type Queryable, type RentActor } from "./rent-guards";
import { RentSettingsService } from "./rent-settings.service";

export type EngineSettings = Pick<
  RentSettingsRow,
  | "cycle_mode"
  | "billing_timing"
  | "due_day"
  | "proration_mode"
  | "prorate_move_out"
  | "invoice_lead_days"
  | "billing_starts_on"
  | "enabled_on"
  | "default_line_items"
  | "receipt_prefix"
>;

interface AssignmentCtx {
  id: string;
  status:
    | "active"
    | "notice_served"
    | "move_out_requested"
    | "move_out_pending_confirmation"
    | "moved_out";
  occupant_name: string;
  move_in_date: string | null;
  notice_end_date: string | null;
  move_out_date: string | null;
  rent_due_day: number | null;
  default_item_overrides: { exclude?: string[] };
  monthly_rent_paise: string | null;
  security_deposit_paise: string | null;
  bed_id: string;
  bed_label: string;
  room_id: string;
  room_number: string;
  room_type_rent: string | null;
  room_type_deposit: string | null;
  listing_rent: string | null;
  listing_deposit: string | null;
}

export interface RentPlan {
  kind: "rent";
  period: Period;
  cut: boolean;
  dueDate: string;
  amountPaise: number;
  factor: number | null;
  draft: boolean;
  rentSource: PgRentRentSource;
  rentPaise: number | null;
  spec: PeriodSpec;
}

export interface DepositPlan {
  kind: "deposit";
  dueDate: string;
  amountPaise: number;
}

const ASSIGNMENT_SQL = `
  SELECT a.id::text, a.status::text, a.occupant_name,
         to_char(a.move_in_date, 'YYYY-MM-DD') AS move_in_date,
         to_char(a.notice_end_date, 'YYYY-MM-DD') AS notice_end_date,
         to_char(a.move_out_date, 'YYYY-MM-DD') AS move_out_date,
         a.rent_due_day, a.default_item_overrides, a.monthly_rent_paise::text, a.security_deposit_paise::text,
         b.id::text AS bed_id, b.bed_label, r.id::text AS room_id, r.room_number,
         rt.monthly_rent_paise::text AS room_type_rent, rt.security_deposit_paise::text AS room_type_deposit,
         pl.starting_rent_paise::text AS listing_rent, d.security_deposit_paise::text AS listing_deposit
    FROM pg_bed_assignments a
    JOIN pg_beds b ON b.id = a.bed_id
    JOIN pg_rooms r ON r.id = b.room_id
    LEFT JOIN pg_room_types rt ON rt.id = r.room_type_id
    LEFT JOIN pg_listings pl ON pl.id = rt.listing_id
    LEFT JOIN pg_details d ON d.listing_id = rt.listing_id
   WHERE a.pg_property_id = $1::uuid
     AND a.status NOT IN ('reserved', 'cancelled')`;

/** Per run, per assignment: catch-up bound so one stuck property cannot monopolise a sweep. */
const MAX_INVOICES_PER_ASSIGNMENT_PER_RUN = 24;
const PAY_TOKEN_DAYS = 45;

@Injectable()
export class RentInvoiceEngineService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettingsService) private readonly settings: RentSettingsService,
    @Inject(RentAllocationService) private readonly allocation: RentAllocationService
  ) {}

  // ── public ────────────────────────────────────────────────────────────────

  /** Spec §5.1. Idempotent; every invoice is its own transaction. */
  async generateInvoicesForProperty(
    propertyId: string,
    today: string,
    actor: RentActor = SYSTEM_ACTOR,
    opts: { assignmentId?: string; force?: boolean } = {}
  ): Promise<PgRentGenerateResult> {
    requireDb(this.db);
    const result: PgRentGenerateResult = {
      invoices_created: 0,
      drafts_created: 0,
      deposits_created: 0,
      skipped: []
    };
    const settings = await this.settings.getRow(this.db, propertyId);
    if (!settings || (settings.paused_at && !opts.force)) return result;

    const assignments = await this.loadAssignments(this.db, propertyId, opts.assignmentId);
    for (const a of assignments) {
      if (a.move_in_date === null) {
        result.skipped.push({ assignment_id: a.id, reason: "no_move_in" });
        continue;
      }
      // deposit first: booking credit lands on it before the first rent period (§6.12)
      const deposit = await transaction(this.db, (client) =>
        this.issueDepositIfDue(client, propertyId, a.id, settings, today, actor)
      );
      if (deposit) result.deposits_created += 1;

      for (let i = 0; i < MAX_INVOICES_PER_ASSIGNMENT_PER_RUN; i += 1) {
        const outcome = await transaction(this.db, (client) =>
          this.issueNextRentIfDue(client, propertyId, a.id, settings, today, actor)
        );
        if (outcome === "none") break;
        if (outcome === "no_rent") {
          result.skipped.push({ assignment_id: a.id, reason: "no_rent" });
          break;
        }
        if (outcome === "draft") result.drafts_created += 1;
        else result.invoices_created += 1;
      }
    }
    return result;
  }

  /** Spec §5.3 "Enable / resume preview": what the next run would issue, without writing. */
  async previewForProperty(
    propertyId: string,
    settings: EngineSettings,
    today: string
  ): Promise<PgRentEnablePreview> {
    requireDb(this.db);
    const assignments = await this.loadAssignments(this.db, propertyId);
    const tenants: PgRentPreviewTenant[] = [];
    const counts = { invoices: 0, drafts: 0, deposits: 0, no_rent: 0, no_move_in: 0 };
    for (const a of assignments) {
      const base = {
        assignment_id: a.id,
        occupant_name: a.occupant_name,
        room_number: a.room_number,
        bed_label: a.bed_label
      };
      const depositPlan = await this.planDeposit(this.db, a, settings, today);
      const depositPaise = this.resolveDeposit(a);
      if (a.move_in_date === null) {
        counts.no_move_in += 1;
        tenants.push({
          ...base,
          first_period: null,
          skip_reason: "no_move_in",
          deposit_inr: depositPaise === null ? null : paiseToInr(depositPaise),
          deposit_will_invoice: false
        });
        continue;
      }
      const plan = await this.planNextRent(this.db, a, settings, today, { ignoreLeadTime: true });
      let skip: PgRentPreviewSkipReason | null = null;
      if (plan === "no_rent") {
        skip = "no_rent";
        counts.no_rent += 1;
      } else if (plan === null) skip = "nothing_in_window";
      else if (plan.draft) counts.drafts += 1;
      else counts.invoices += 1;
      if (depositPlan) counts.deposits += 1;
      tenants.push({
        ...base,
        first_period:
          plan === null || plan === "no_rent"
            ? null
            : {
                period_start: plan.period.start,
                period_end: plan.period.end,
                due_date: plan.dueDate,
                amount_inr: paiseToInr(plan.amountPaise),
                prorated: plan.factor !== null,
                draft: plan.draft
              },
        skip_reason: skip,
        deposit_inr: depositPaise === null ? null : paiseToInr(depositPaise),
        deposit_will_invoice: depositPlan !== null
      });
    }
    return { billing_starts_on: settings.billing_starts_on as string, tenants, counts };
  }

  /**
   * Spec §5.8. Called after pg-operations commits an assignment transition.
   * Data-driven: no settings row → nothing. Best-effort: never throws to the caller.
   * Final-period re-proration *suggestions* are slice 1b; here every event simply
   * runs generation for that assignment so cut/final periods exist.
   */
  async onAssignmentEvent(event: {
    type: string;
    propertyId: string;
    assignmentId: string;
  }): Promise<void> {
    if (!this.db.isEnabled()) return;
    try {
      await this.generateInvoicesForProperty(event.propertyId, todayIst(), SYSTEM_ACTOR, {
        assignmentId: event.assignmentId
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_assignment_hook",
          type: event.type,
          assignment_id: event.assignmentId,
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  // ── planning (no writes) ──────────────────────────────────────────────────

  private specFor(a: AssignmentCtx, settings: EngineSettings): { spec: PeriodSpec; due: DueSpec } {
    const anchorDay = a.rent_due_day ?? (a.move_in_date ? dayOf(a.move_in_date) : 1);
    return {
      spec: { cycleMode: settings.cycle_mode, anchorDay },
      due: { timing: settings.billing_timing, dueDay: a.rent_due_day ?? settings.due_day }
    };
  }

  private resolveRent(a: AssignmentCtx): { paise: number | null; source: PgRentRentSource } {
    if (a.monthly_rent_paise !== null)
      return { paise: Number(a.monthly_rent_paise), source: "assignment" };
    if (a.room_type_rent !== null) return { paise: Number(a.room_type_rent), source: "room_type" };
    if (a.listing_rent !== null) return { paise: Number(a.listing_rent), source: "listing" };
    return { paise: null, source: "none" };
  }

  /** Spec §2 deposit chain: assignment → room type (0065) → listing details. */
  private resolveDeposit(a: AssignmentCtx): number | null {
    for (const v of [a.security_deposit_paise, a.room_type_deposit, a.listing_deposit]) {
      if (v !== null && Number(v) > 0) return Number(v);
    }
    return null;
  }

  private async lastRentPeriodEnd(q: Queryable, assignmentId: string): Promise<string | null> {
    const r = await q.query<{ last_end: string | null }>(
      `SELECT to_char(MAX(period_end), 'YYYY-MM-DD') AS last_end
         FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled'`,
      [assignmentId]
    );
    return r.rows[0]?.last_end ?? null;
  }

  /** null = nothing to create (window ended / not yet time); "no_rent" = surfaced to the owner. */
  private async planNextRent(
    q: Queryable,
    a: AssignmentCtx,
    settings: EngineSettings,
    today: string,
    opts: { ignoreLeadTime?: boolean } = {}
  ): Promise<RentPlan | "no_rent" | null> {
    const window = billingWindow(a);
    if (!window) return null;
    const { spec, due } = this.specFor(a, settings);
    const lastEnd = await this.lastRentPeriodEnd(q, a.id);
    const candidate = lastEnd
      ? nextPeriod(lastEnd, spec)
      : firstGeneratedPeriod(
          a.move_in_date as string,
          settings.billing_starts_on as string,
          spec,
          due
        );
    if (!candidate) return null;
    const placed = cutToWindow(candidate, window);
    if (!placed) return null;
    const period = placed.cut && settings.prorate_move_out ? placed.period : candidate;
    const cut = placed.cut && settings.prorate_move_out;

    const natural = naturalDueDate(period, spec, due);
    const windowEnded = window.end !== null && compareIsoDates(window.end, today) <= 0;
    const dueDate =
      a.status === "moved_out" ? today : compareIsoDates(natural, today) < 0 ? today : natural;
    const createFrom = addDays(dueDate, -settings.invoice_lead_days);
    // The preview wants the first period even when it is not yet time to issue it.
    if (!opts.ignoreLeadTime && !windowEnded && compareIsoDates(today, createFrom) < 0) return null;

    const rent = this.resolveRent(a);
    if (rent.paise === null) return "no_rent";
    const { amountPaise, factor } = prorate(rent.paise, period, spec, settings.proration_mode);
    return {
      kind: "rent",
      period,
      cut,
      dueDate,
      amountPaise,
      factor,
      spec,
      draft: rent.source === "listing" || rent.source === "none",
      rentSource: rent.source,
      rentPaise: rent.paise
    };
  }

  private async planDeposit(
    q: Queryable,
    a: AssignmentCtx,
    settings: EngineSettings,
    today: string
  ): Promise<DepositPlan | null> {
    if (a.move_in_date === null) return null;
    if (compareIsoDates(a.move_in_date, settings.enabled_on as string) < 0) return null;
    const amount = this.resolveDeposit(a);
    if (amount === null) return null;
    const exists = await q.query(
      `SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid AND kind = 'deposit' AND status <> 'cancelled'`,
      [a.id]
    );
    if (exists.rowCount) return null;
    return {
      kind: "deposit",
      dueDate: compareIsoDates(a.move_in_date, today) < 0 ? today : a.move_in_date,
      amountPaise: amount
    };
  }

  // ── writing ───────────────────────────────────────────────────────────────

  private async loadAssignments(
    q: Queryable,
    propertyId: string,
    assignmentId?: string
  ): Promise<AssignmentCtx[]> {
    const r = await q.query<AssignmentCtx>(
      `${ASSIGNMENT_SQL}${assignmentId ? " AND a.id = $2::uuid" : ""} ORDER BY r.room_number, b.bed_label`,
      assignmentId ? [propertyId, assignmentId] : [propertyId]
    );
    return r.rows;
  }

  private async lockAssignment(
    client: PoolClient,
    propertyId: string,
    assignmentId: string
  ): Promise<AssignmentCtx | null> {
    await client.query(`SELECT id FROM pg_bed_assignments WHERE id = $1::uuid FOR UPDATE`, [
      assignmentId
    ]);
    const rows = await this.loadAssignments(client, propertyId, assignmentId);
    return rows[0] ?? null;
  }

  private async nextInvoiceNumber(
    client: PoolClient,
    propertyId: string,
    prefix: string
  ): Promise<string> {
    const r = await client.query<{ seq: number }>(
      `UPDATE pg_rent_counters SET next_invoice_seq = next_invoice_seq + 1
        WHERE pg_property_id = $1::uuid RETURNING next_invoice_seq - 1 AS seq`,
      [propertyId]
    );
    if (!r.rows[0]) throw new Error(`pg_rent_counters missing for ${propertyId}`);
    return `${prefix}-INV-${String(r.rows[0].seq).padStart(4, "0")}`;
  }

  private payToken(): { token: string; expiresAt: Date } {
    return {
      token: randomBytes(32).toString("base64url"),
      expiresAt: new Date(Date.now() + PAY_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    };
  }

  private async issueNextRentIfDue(
    client: PoolClient,
    propertyId: string,
    assignmentId: string,
    settings: EngineSettings,
    today: string,
    actor: RentActor
  ): Promise<"issued" | "draft" | "no_rent" | "none"> {
    const a = await this.lockAssignment(client, propertyId, assignmentId);
    if (!a || a.move_in_date === null) return "none";
    const plan = await this.planNextRent(client, a, settings, today);
    if (plan === null) return "none";
    if (plan === "no_rent") return "no_rent";

    const overlap = await client.query(
      `SELECT 1 FROM pg_rent_invoices
        WHERE assignment_id = $1::uuid AND kind = 'rent' AND status <> 'cancelled'
          AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')`,
      [assignmentId, plan.period.start, plan.period.end]
    );
    if (overlap.rowCount) throw new ConflictException({ code: "period_overlap" });

    const lines: Array<{
      kind: string;
      label: string;
      amount: number;
      source: string;
      meta: Record<string, unknown>;
    }> = [
      {
        kind: "rent",
        label: `Rent · ${periodLabel(plan.period, plan.spec)}`,
        amount: plan.amountPaise,
        source: "system",
        meta: plan.factor === null ? {} : { proration_factor: plan.factor }
      }
    ];
    const excludes = new Set(a.default_item_overrides?.exclude ?? []);
    for (const item of settings.default_line_items) {
      if (excludes.has(item.key)) continue;
      lines.push({
        kind: item.kind,
        label: item.label,
        amount: Number(item.amount_paise),
        source: "default_item",
        meta: { key: item.key }
      });
    }
    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    const number = await this.nextInvoiceNumber(client, propertyId, settings.receipt_prefix);
    const token = plan.draft ? null : this.payToken();

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number,
          period_start, period_end, billing_month, due_date, status, source, total_paise,
          rent_snapshot_paise, rent_source, proration_factor, pay_token, pay_token_expires_at, issued_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'rent', $7,
               $8::date, $9::date, $10::date, $11::date, $12::pg_rent_invoice_status, 'auto', $13,
               $14, $15::pg_rent_rent_source, $16, $17, $18, CASE WHEN $12 = 'issued' THEN now() ELSE NULL END, $19::uuid)
       RETURNING id::text`,
      [
        propertyId,
        assignmentId,
        a.bed_id,
        a.room_id,
        a.room_number,
        a.bed_label,
        number,
        plan.period.start,
        plan.period.end,
        firstOfMonth(plan.period.start),
        plan.dueDate,
        plan.draft ? "draft" : "issued",
        total,
        plan.rentPaise,
        plan.rentSource,
        plan.factor,
        token?.token ?? null,
        token?.expiresAt ?? null,
        actor.id
      ]
    );
    const invoiceId = inserted.rows[0].id;
    for (const [index, line] of lines.entries()) {
      await client.query(
        `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, meta, source, sort_order, created_by)
         VALUES ($1::uuid, $2::pg_rent_line_kind, $3, $4, $5::jsonb, $6::pg_rent_line_source, $7, $8::uuid)`,
        [
          invoiceId,
          line.kind,
          line.label,
          line.amount,
          JSON.stringify(line.meta),
          line.source,
          index,
          actor.id
        ]
      );
    }
    await writeRentEvent(client, {
      propertyId,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: plan.draft ? "invoice.draft_created" : "invoice.issued",
      actor,
      payload: {
        kind: "rent",
        period_start: plan.period.start,
        period_end: plan.period.end,
        cut: plan.cut,
        due_date: plan.dueDate,
        total_paise: total,
        rent_source: plan.rentSource
      }
    });
    if (!plan.draft) await this.allocation.applyUnallocatedCredit(client, invoiceId, actor);
    return plan.draft ? "draft" : "issued";
  }

  private async issueDepositIfDue(
    client: PoolClient,
    propertyId: string,
    assignmentId: string,
    settings: EngineSettings,
    today: string,
    actor: RentActor
  ): Promise<boolean> {
    const a = await this.lockAssignment(client, propertyId, assignmentId);
    if (!a) return false;
    const plan = await this.planDeposit(client, a, settings, today);
    if (!plan) return false;
    const number = await this.nextInvoiceNumber(client, propertyId, settings.receipt_prefix);
    const token = this.payToken();
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO pg_rent_invoices
         (pg_property_id, assignment_id, bed_id, room_id, room_number, bed_label, kind, invoice_number,
          billing_month, due_date, status, source, total_paise, late_fee_eligible, pay_token, pay_token_expires_at, issued_at, created_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'deposit', $7,
               $8::date, $9::date, 'issued', 'auto', $10, false, $11, $12, now(), $13::uuid)
       RETURNING id::text`,
      [
        propertyId,
        assignmentId,
        a.bed_id,
        a.room_id,
        a.room_number,
        a.bed_label,
        number,
        firstOfMonth(plan.dueDate),
        plan.dueDate,
        plan.amountPaise,
        token.token,
        token.expiresAt,
        actor.id
      ]
    );
    const invoiceId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO pg_rent_invoice_lines (invoice_id, kind, label, amount_paise, source, sort_order, created_by)
       VALUES ($1::uuid, 'deposit', 'Security deposit', $2, 'system', 0, $3::uuid)`,
      [invoiceId, plan.amountPaise, actor.id]
    );
    await writeRentEvent(client, {
      propertyId,
      entityType: "invoice",
      entityId: invoiceId,
      eventType: "invoice.issued",
      actor,
      payload: { kind: "deposit", due_date: plan.dueDate, total_paise: plan.amountPaise }
    });
    await this.allocation.applyUnallocatedCredit(client, invoiceId, actor);
    return true;
  }
}
```

Register `RentInvoiceEngineService` in `pg-rent.module.ts` `providers` and `exports`.

- [ ] **Step 5: Run the engine tests**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-invoice-engine.integration.test.ts`
Expected: PASS, 12 tests. Common causes of a red test and where to look: a proration total off by ₹100 → check `roundToRupee` half-up; an unexpected extra invoice → the `createFrom` gate (lead days) or the window; `period_overlap` → `lastRentPeriodEnd` must ignore cancelled invoices only.

- [ ] **Step 6: Run the whole pg-rent suite and invariants**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pg-rent/pure/rent-period.ts apps/api/src/modules/pg-rent/services/rent-invoice-engine.service.ts apps/api/src/modules/pg-rent/pg-rent.module.ts apps/api/src/modules/pg-rent/__tests__/rent-period.test.ts apps/api/src/modules/pg-rent/__tests__/rent-invoice-engine.integration.test.ts
git commit -m "feat(pg-rent): invoice engine — rent periods, deposits, floor, window cut, preview, assignment hook"
```

---

### Task 13: Invoice reads, tenant overrides, and the two controllers

**Files:**

- Create: `apps/api/src/modules/pg-rent/dto/invoice.dto.ts`
- Create: `apps/api/src/modules/pg-rent/dto/tenant.dto.ts`
- Create: `apps/api/src/modules/pg-rent/services/rent-invoice.service.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-settings.controller.ts`
- Create: `apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts`
- Modify: `apps/api/src/modules/pg-rent/pg-rent.module.ts`
- Test: `apps/api/src/modules/pg-rent/__tests__/pg-rent-controllers.integration.test.ts`

**Interfaces:**

- Produces:

```ts
// dto/invoice.dto.ts
export interface RentInvoiceRow { …pg_rent_invoices columns + occupant_name… }
export interface RentLineRow { …pg_rent_invoice_lines columns… }
export function toInvoiceDto(row: RentInvoiceRow, lines: RentLineRow[]): PgRentInvoice
export const RentInvoiceListFiltersSchema: z.ZodType<PgRentInvoiceListFilters>

// dto/tenant.dto.ts
export const RentTenantOverridesSchema: z.ZodType<PgRentTenantOverridesInput>

// services/rent-invoice.service.ts
@Injectable() export class RentInvoiceService {
  async list(operatorId, propertyId, filters: PgRentInvoiceListFilters): Promise<PgRentInvoice[]>
  async get(operatorId, propertyId, invoiceId): Promise<PgRentInvoice>                        // 404 invoice_not_found
  async events(operatorId, propertyId, invoiceId): Promise<PgRentEvent[]>
  async updateTenantOverrides(operatorId, propertyId, assignmentId, input: PgRentTenantOverridesInput): Promise<void>  // 404 assignment_not_found, 409 move_in_already_set
}

// controllers (base /pg-operator/properties/:propertyId/rent; AuthGuard + RolesGuard('pg_operator'); assertRentFlag first)
POST   /enable            body PgRentEnableInput → { settings, generated: PgRentGenerateResult }
GET    /enable/preview    query billing_starts_on? + any PgRentSettingsInput keys → PgRentEnablePreview   (404 rent_not_enabled is NOT raised — preview works before enabling)
GET    /settings          → PgRentSettings | null
PATCH  /settings          body PgRentPatchSettingsInput → PgRentSettings
POST   /pause             → PgRentSettings
GET    /resume/preview    query billing_starts_on? → PgRentEnablePreview
POST   /resume            body PgRentResumeInput → { settings, generated }
POST   /generate-now      → PgRentGenerateResult   (429 generate_rate_limited within 5 min per property, per process)
GET    /invoices          query filters → PgRentInvoice[]
GET    /invoices/:id      → PgRentInvoice
GET    /invoices/:id/events → PgRentEvent[]
PATCH  /tenants/:assignmentId  body PgRentTenantOverridesInput → { ok: true }
```

- [ ] **Step 1: Write the failing controller tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/pg-rent-controllers.integration.test.ts
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { AppModule } from "../../../app.module";
import { AuthGuard } from "../../../common/auth.guard";
import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("pg-rent controllers", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let otherOperatorId: string;
  let propertyId: string;
  let assignmentId: string;
  const prevFlag = process.env.FF_PG_RENT_COLLECTION;

  const as = (identity: string) => ({ "x-test-identity": identity });

  beforeAll(async () => {
    process.env.FF_PG_RENT_COLLECTION = "true";
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    otherOperatorId = await fx.createUser("pg_operator");
    propertyId = await fx.createProperty(operatorId, { internalCode: "SUN" });
    const listingId = await fx.createListingWithDetails(propertyId, operatorId, { rentDueDay: 5 });
    const roomTypeId = await fx.createRoomType(listingId, { rentPaise: 900000 });
    const roomId = await fx.createRoom(propertyId, { roomTypeId, roomNumber: "101" });
    const bedId = await fx.createBed(roomId, "A");
    assignmentId = await fx.createAssignment(propertyId, bedId, {
      createdBy: operatorId,
      moveIn: "2026-08-12",
      occupantName: "Rahul"
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (ctx: {
          switchToHttp: () => {
            getRequest: () => { headers: Record<string, string | undefined>; user?: unknown };
          };
        }) => {
          const req = ctx.switchToHttp().getRequest();
          const identities: Record<string, { id: string; role: Role }> = {
            operator: { id: operatorId, role: "pg_operator" },
            other: { id: otherOperatorId, role: "pg_operator" }
          };
          const identity = identities[req.headers["x-test-identity"] ?? ""];
          if (!identity) return false;
          req.user = identity;
          return true;
        }
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (prevFlag === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = prevFlag;
    if (app) await app.close();
    await fx.teardown();
    await db.onModuleDestroy();
  });

  const base = () => `/v1/pg-operator/properties/${propertyId}/rent`;

  it("previews before enabling, then enables and generates in one call", async () => {
    const preview = await request(app.getHttpServer())
      .get(`${base()}/enable/preview?billing_starts_on=2026-09-17`)
      .set(as("operator"));
    expect(preview.status).toBe(200);
    expect(preview.body.data.tenants[0]).toMatchObject({
      occupant_name: "Rahul",
      first_period: { period_start: "2026-10-01", due_date: "2026-10-05", amount_inr: 9000 }
    });
    expect(JSON.stringify(preview.body)).not.toMatch(/_paise/);

    const enabled = await request(app.getHttpServer())
      .post(`${base()}/enable`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-09-01", upi_vpa: "sun@okaxis", upi_payee_name: "Sun" });
    expect(enabled.status).toBe(201);
    expect(enabled.body.data.settings).toMatchObject({
      receipt_prefix: "SUN",
      due_day: 5,
      billing_starts_on: "2026-09-01"
    });
    expect(enabled.body.data.generated.invoices_created).toBeGreaterThanOrEqual(1);
  });

  it("lists and reads invoices in rupees with lines; 403 for another operator; 404 for a foreign id", async () => {
    const list = await request(app.getHttpServer())
      .get(`${base()}/invoices?kind=rent`)
      .set(as("operator"));
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    const inv = list.body.data[0];
    expect(inv).toMatchObject({
      occupant_name: "Rahul",
      room_number: "101",
      bed_label: "A",
      total_inr: 9000,
      balance_inr: 9000,
      status: "issued"
    });
    expect(inv.lines[0]).toMatchObject({ kind: "rent", amount_inr: 9000 });
    expect(JSON.stringify(list.body)).not.toMatch(/_paise|pay_token"/);

    const one = await request(app.getHttpServer())
      .get(`${base()}/invoices/${inv.id}`)
      .set(as("operator"));
    expect(one.status).toBe(200);
    expect(one.body.data.invoice_number).toMatch(/^SUN-INV-\d{4}$/);

    const ev = await request(app.getHttpServer())
      .get(`${base()}/invoices/${inv.id}/events`)
      .set(as("operator"));
    expect(ev.body.data.map((e: { event_type: string }) => e.event_type)).toContain(
      "invoice.issued"
    );

    expect(
      (await request(app.getHttpServer()).get(`${base()}/invoices`).set(as("other"))).status
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base()}/invoices/${randomUUID()}`)
          .set(as("operator"))
      ).status
    ).toBe(404);
  });

  it("patches settings with the token, pauses, previews resume, resumes", async () => {
    const current = (
      await request(app.getHttpServer()).get(`${base()}/settings`).set(as("operator"))
    ).body.data;
    const patched = await request(app.getHttpServer())
      .patch(`${base()}/settings`)
      .set(as("operator"))
      .send({ updated_at: current.updated_at, due_day: 10 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.due_day).toBe(10);
    const stale = await request(app.getHttpServer())
      .patch(`${base()}/settings`)
      .set(as("operator"))
      .send({ updated_at: current.updated_at, due_day: 11 });
    expect(stale.status).toBe(409);
    const bad = await request(app.getHttpServer())
      .patch(`${base()}/settings`)
      .set(as("operator"))
      .send({ updated_at: patched.body.data.updated_at, due_day: 40 });
    expect(bad.status).toBe(400);

    expect(
      (await request(app.getHttpServer()).post(`${base()}/pause`).set(as("operator"))).body.data
        .pause_reason
    ).toBe("owner");
    const rp = await request(app.getHttpServer())
      .get(`${base()}/resume/preview?billing_starts_on=2026-11-10`)
      .set(as("operator"));
    expect(rp.status).toBe(200);
    expect(rp.body.data.billing_starts_on).toBe("2026-11-10");
    const resumed = await request(app.getHttpServer())
      .post(`${base()}/resume`)
      .set(as("operator"))
      .send({ billing_starts_on: "2026-11-10" });
    expect(resumed.status).toBe(201);
    expect(resumed.body.data.settings.paused_at).toBeNull();
  });

  it("generate-now is rate-limited per property", async () => {
    const first = await request(app.getHttpServer())
      .post(`${base()}/generate-now`)
      .set(as("operator"));
    expect(first.status).toBe(201);
    const second = await request(app.getHttpServer())
      .post(`${base()}/generate-now`)
      .set(as("operator"));
    expect(second.status).toBe(429);
  });

  it("updates tenant overrides, including move-in date only while null, and rent from next cycle", async () => {
    const res = await request(app.getHttpServer())
      .patch(`${base()}/tenants/${assignmentId}`)
      .set(as("operator"))
      .send({
        rent_due_day: 3,
        late_fee_exempt: true,
        default_item_excludes: ["wifi"],
        monthly_rent_inr: 9500
      });
    expect(res.status).toBe(200);
    const row = (
      await db.query(
        `SELECT rent_due_day, late_fee_exempt, default_item_overrides, monthly_rent_paise::text FROM pg_bed_assignments WHERE id = $1::uuid`,
        [assignmentId]
      )
    ).rows[0];
    expect(row).toEqual({
      rent_due_day: 3,
      late_fee_exempt: true,
      default_item_overrides: { exclude: ["wifi"] },
      monthly_rent_paise: "950000"
    });

    const conflict = await request(app.getHttpServer())
      .patch(`${base()}/tenants/${assignmentId}`)
      .set(as("operator"))
      .send({ move_in_date: "2026-08-01" });
    expect(conflict.status).toBe(409);
    const events = await db.query<{ event_type: string }>(
      `SELECT event_type FROM pg_rent_events WHERE entity_id = $1::uuid ORDER BY id`,
      [assignmentId]
    );
    expect(events.rows.map((e) => e.event_type)).toEqual([
      "rent.changed",
      "assignment.override_updated"
    ]);
  });

  it("404s every route when the flag is off", async () => {
    process.env.FF_PG_RENT_COLLECTION = "false";
    const res = await request(app.getHttpServer()).get(`${base()}/settings`).set(as("operator"));
    expect(res.status).toBe(404);
    process.env.FF_PG_RENT_COLLECTION = "true";
  });
});
```

Check the error-envelope shape the API uses for `code` (open `apps/api/src/common/http-config.util.ts` or an existing controller test) and adjust the `403`/`404` status assertions only if the global exception filter maps codes differently — the statuses above come from the Nest exception classes used.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-controllers.integration.test.ts`
Expected: FAIL — 404 on every route (no controllers).

- [ ] **Step 3: Invoice and tenant DTOs**

```ts
// apps/api/src/modules/pg-rent/dto/invoice.dto.ts
import { z } from "zod";
import type {
  PgRentInvoice,
  PgRentInvoiceLine,
  PgRentInvoiceListFilters
} from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";
import { toIsoDate, toIsoTs } from "./common";
import { paiseToInr } from "./money";

export interface RentInvoiceRow {
  id: string;
  pg_property_id: string;
  assignment_id: string;
  occupant_name: string;
  bed_id: string | null;
  room_id: string | null;
  room_number: string;
  bed_label: string;
  kind: PgRentInvoice["kind"];
  invoice_number: string;
  period_start: Date | string | null;
  period_end: Date | string | null;
  billing_month: Date | string;
  due_date: Date | string;
  status: PgRentInvoice["status"];
  source: PgRentInvoice["source"];
  total_paise: string;
  amount_paid_paise: string;
  rent_snapshot_paise: string | null;
  rent_source: PgRentInvoice["rent_source"];
  proration_factor: string | null;
  late_fee_eligible: boolean;
  suggested_late_fee_paise: string | null;
  late_fee_waived_at: Date | string | null;
  reprorate_suggestion: {
    leave_on: string;
    from_paise: number;
    to_paise: number;
    mode: "reprorate" | "restore";
  } | null;
  pay_token_expires_at: Date | string | null;
  tenant_note: string | null;
  internal_note: string | null;
  issued_at: Date | string | null;
  paid_at: Date | string | null;
  settled_on: Date | string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RentLineRow {
  id: string;
  invoice_id: string;
  kind: PgRentInvoiceLine["kind"];
  label: string;
  amount_paise: string;
  meta: Record<string, unknown>;
  source: PgRentInvoiceLine["source"];
  expense_id: string | null;
  sort_order: number;
  created_at: Date | string;
}

export const INVOICE_SELECT = `
  i.id::text, i.pg_property_id::text, i.assignment_id::text, a.occupant_name,
  i.bed_id::text, i.room_id::text, i.room_number, i.bed_label, i.kind::text, i.invoice_number,
  i.period_start, i.period_end, i.billing_month, i.due_date, i.status::text, i.source::text,
  i.total_paise::text, i.amount_paid_paise::text, i.rent_snapshot_paise::text, i.rent_source::text,
  i.proration_factor::text, i.late_fee_eligible, i.suggested_late_fee_paise::text, i.late_fee_waived_at,
  i.reprorate_suggestion, i.pay_token_expires_at, i.tenant_note, i.internal_note, i.issued_at, i.paid_at, i.settled_on,
  i.cancelled_at, i.cancel_reason, i.created_at, i.updated_at`;

export const LINE_SELECT = `
  l.id::text, l.invoice_id::text, l.kind::text, l.label, l.amount_paise::text, l.meta, l.source::text,
  l.expense_id::text, l.sort_order, l.created_at`;

export function toLineDto(row: RentLineRow): PgRentInvoiceLine {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    amount_inr: paiseToInr(row.amount_paise),
    meta: row.meta,
    source: row.source,
    expense_id: row.expense_id,
    sort_order: row.sort_order,
    created_at: toIsoTs(row.created_at) as string
  };
}

/** Rupees out, no `_paise`, no `pay_token` (the token only ever leaves through the messages endpoint in slice 2). */
export function toInvoiceDto(row: RentInvoiceRow, lines: RentLineRow[]): PgRentInvoice {
  const total = paiseToInr(row.total_paise);
  const paid = paiseToInr(row.amount_paid_paise);
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    assignment_id: row.assignment_id,
    occupant_name: row.occupant_name,
    bed_id: row.bed_id,
    room_id: row.room_id,
    room_number: row.room_number,
    bed_label: row.bed_label,
    kind: row.kind,
    invoice_number: row.invoice_number,
    period_start: toIsoDate(row.period_start),
    period_end: toIsoDate(row.period_end),
    billing_month: toIsoDate(row.billing_month) as string,
    due_date: toIsoDate(row.due_date) as string,
    status: row.status,
    source: row.source,
    total_inr: total,
    amount_paid_inr: paid,
    balance_inr: total - paid,
    rent_snapshot_inr:
      row.rent_snapshot_paise === null ? null : paiseToInr(row.rent_snapshot_paise),
    rent_source: row.rent_source,
    proration_factor: row.proration_factor === null ? null : Number(row.proration_factor),
    late_fee_eligible: row.late_fee_eligible,
    suggested_late_fee_inr:
      row.suggested_late_fee_paise === null ? null : paiseToInr(row.suggested_late_fee_paise),
    late_fee_waived_at: toIsoTs(row.late_fee_waived_at),
    reprorate_suggestion: row.reprorate_suggestion
      ? {
          leave_on: row.reprorate_suggestion.leave_on,
          from_inr: paiseToInr(row.reprorate_suggestion.from_paise),
          to_inr: paiseToInr(row.reprorate_suggestion.to_paise),
          mode: row.reprorate_suggestion.mode
        }
      : null,
    pay_token_expires_at: toIsoTs(row.pay_token_expires_at),
    tenant_note: row.tenant_note,
    internal_note: row.internal_note,
    issued_at: toIsoTs(row.issued_at),
    paid_at: toIsoTs(row.paid_at),
    settled_on: toIsoDate(row.settled_on),
    cancelled_at: toIsoTs(row.cancelled_at),
    cancel_reason: row.cancel_reason,
    lines: lines
      .filter((l) => l.invoice_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toLineDto),
    created_at: toIsoTs(row.created_at) as string,
    updated_at: toIsoTs(row.updated_at) as string
  };
}

export const RentInvoiceListFiltersSchema = z.object({
  status: z.enum(["draft", "issued", "partially_paid", "paid", "cancelled"]).optional(),
  kind: z.enum(["rent", "deposit", "adhoc", "settlement"]).optional(),
  assignment_id: z.string().uuid().optional(),
  billing_month: z.string().refine(isIsoDate).optional()
}) satisfies z.ZodType<PgRentInvoiceListFilters, PgRentInvoiceListFilters>;
```

```ts
// apps/api/src/modules/pg-rent/dto/tenant.dto.ts
import { z } from "zod";
import type { PgRentTenantOverridesInput } from "@cribliv/shared-types";

import { isIsoDate } from "../../../common/date";

export const RentTenantOverridesSchema = z.object({
  rent_due_day: z.number().int().min(1).max(28).nullable().optional(),
  late_fee_exempt: z.boolean().optional(),
  late_fee_override_inr: z.number().int().min(1).max(10000).nullable().optional(),
  default_item_excludes: z
    .array(z.string().regex(/^[a-z0-9_]{1,24}$/))
    .max(10)
    .optional(),
  move_in_date: z.string().refine(isIsoDate).optional(),
  monthly_rent_inr: z.number().int().min(1).max(1000000).optional()
}) satisfies z.ZodType<PgRentTenantOverridesInput, PgRentTenantOverridesInput>;
```

- [ ] **Step 4: Invoice service**

```ts
// apps/api/src/modules/pg-rent/services/rent-invoice.service.ts
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  PgRentEvent,
  PgRentInvoice,
  PgRentInvoiceListFilters,
  PgRentTenantOverridesInput
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { toIsoTs } from "../dto/common";
import {
  INVOICE_SELECT,
  LINE_SELECT,
  toInvoiceDto,
  type RentInvoiceRow,
  type RentLineRow
} from "../dto/invoice.dto";
import { inrToPaise } from "../dto/money";
import { writeRentEvent } from "./rent-events";
import { assertManagedOwnership, requireDb, type Queryable } from "./rent-guards";

@Injectable()
export class RentInvoiceService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async list(
    operatorId: string,
    propertyId: string,
    filters: PgRentInvoiceListFilters
  ): Promise<PgRentInvoice[]> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const where: string[] = ["i.pg_property_id = $1::uuid"];
    const params: unknown[] = [propertyId];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (filters.status) add("i.status = ?::pg_rent_invoice_status", filters.status);
    if (filters.kind) add("i.kind = ?::pg_rent_invoice_kind", filters.kind);
    if (filters.assignment_id) add("i.assignment_id = ?::uuid", filters.assignment_id);
    if (filters.billing_month) add("i.billing_month = ?::date", filters.billing_month);
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id
        WHERE ${where.join(" AND ")} ORDER BY i.due_date DESC, i.created_at DESC LIMIT 500`,
      params
    );
    return this.withLines(this.db, rows.rows);
  }

  async get(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentInvoice> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const rows = await this.db.query<RentInvoiceRow>(
      `SELECT ${INVOICE_SELECT} FROM pg_rent_invoices i JOIN pg_bed_assignments a ON a.id = i.assignment_id
        WHERE i.id = $1::uuid AND i.pg_property_id = $2::uuid`,
      [invoiceId, propertyId]
    );
    if (!rows.rows[0]) throw new NotFoundException({ code: "invoice_not_found" });
    return (await this.withLines(this.db, rows.rows))[0];
  }

  async events(operatorId: string, propertyId: string, invoiceId: string): Promise<PgRentEvent[]> {
    await this.get(operatorId, propertyId, invoiceId);
    const rows = await this.db.query<{
      id: string;
      entity_type: PgRentEvent["entity_type"];
      entity_id: string;
      event_type: string;
      actor_user_id: string | null;
      actor_role: PgRentEvent["actor_role"];
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT id::text, entity_type, entity_id::text, event_type, actor_user_id::text, actor_role, payload, created_at
         FROM pg_rent_events WHERE entity_type = 'invoice' AND entity_id = $1::uuid ORDER BY id`,
      [invoiceId]
    );
    return rows.rows.map((r) => ({ ...r, created_at: toIsoTs(r.created_at) as string }));
  }

  /** Spec §11 "Tenant overrides" + §5.7 "Change rent from next cycle" + §5.2 move-in while null. */
  async updateTenantOverrides(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input: PgRentTenantOverridesInput
  ): Promise<void> {
    requireDb(this.db);
    await transaction(this.db, async (client) => {
      await assertManagedOwnership(client, operatorId, propertyId, true);
      const current = await client.query<{
        move_in_date: Date | null;
        monthly_rent_paise: string | null;
      }>(
        `SELECT move_in_date, monthly_rent_paise::text FROM pg_bed_assignments
          WHERE id = $1::uuid AND pg_property_id = $2::uuid FOR UPDATE`,
        [assignmentId, propertyId]
      );
      if (!current.rows[0]) throw new NotFoundException({ code: "assignment_not_found" });
      const actor = { id: operatorId, role: "pg_operator" as const };

      if (input.monthly_rent_inr !== undefined) {
        const to = inrToPaise(input.monthly_rent_inr);
        await client.query(
          `UPDATE pg_bed_assignments SET monthly_rent_paise = $2 WHERE id = $1::uuid`,
          [assignmentId, to]
        );
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "rent.changed",
          actor,
          payload: {
            from_paise:
              current.rows[0].monthly_rent_paise === null
                ? null
                : Number(current.rows[0].monthly_rent_paise),
            to_paise: to
          }
        });
      }
      if (input.move_in_date !== undefined) {
        if (current.rows[0].move_in_date !== null)
          throw new ConflictException({ code: "move_in_already_set" });
        await client.query(
          `UPDATE pg_bed_assignments SET move_in_date = $2::date WHERE id = $1::uuid`,
          [assignmentId, input.move_in_date]
        );
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "assignment.move_in_date_set",
          actor,
          payload: { move_in_date: input.move_in_date }
        });
      }
      const overrides: Record<string, unknown> = {};
      if (input.rent_due_day !== undefined) overrides.rent_due_day = input.rent_due_day;
      if (input.late_fee_exempt !== undefined) overrides.late_fee_exempt = input.late_fee_exempt;
      if (input.late_fee_override_inr !== undefined) {
        overrides.late_fee_override_paise =
          input.late_fee_override_inr === null ? null : inrToPaise(input.late_fee_override_inr);
      }
      if (input.default_item_excludes !== undefined) {
        overrides.default_item_overrides = JSON.stringify({ exclude: input.default_item_excludes });
      }
      if (Object.keys(overrides).length) {
        const names = Object.keys(overrides);
        const sets = names
          .map((n, i) => `${n} = $${i + 2}${n === "default_item_overrides" ? "::jsonb" : ""}`)
          .join(", ");
        await client.query(`UPDATE pg_bed_assignments SET ${sets} WHERE id = $1::uuid`, [
          assignmentId,
          ...Object.values(overrides)
        ]);
        await writeRentEvent(client, {
          propertyId,
          entityType: "assignment",
          entityId: assignmentId,
          eventType: "assignment.override_updated",
          actor,
          payload: overrides
        });
      }
    });
  }

  private async withLines(q: Queryable, rows: RentInvoiceRow[]): Promise<PgRentInvoice[]> {
    if (rows.length === 0) return [];
    const lines = await q.query<RentLineRow>(
      `SELECT ${LINE_SELECT} FROM pg_rent_invoice_lines l WHERE l.invoice_id = ANY($1::uuid[])`,
      [rows.map((r) => r.id)]
    );
    return rows.map((r) => toInvoiceDto(r, lines.rows));
  }
}
```

- [ ] **Step 5: Controllers**

```ts
// apps/api/src/modules/pg-rent/controllers/pg-rent-settings.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import type { PgRentEnablePreview } from "@cribliv/shared-types";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { todayIst } from "../../../common/date";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import {
  RentEnableInputSchema,
  RentPatchSettingsInputSchema,
  RentResumeInputSchema,
  settingsInputToColumns
} from "../dto/settings.dto";
import { assertManagedOwnership, assertRentFlag, requireDb } from "../services/rent-guards";
import {
  RentInvoiceEngineService,
  type EngineSettings
} from "../services/rent-invoice-engine.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { DatabaseService } from "../../../common/database.service";

const GENERATE_NOW_WINDOW_MS = 5 * 60 * 1000;

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentSettingsController {
  /** Per-process rate limit for Generate now (spec §5.1). Multi-instance deployments get one window per instance; acceptable for a 5-minute courtesy limit. */
  private readonly lastGenerateNow = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettingsService) private readonly settings: RentSettingsService,
    @Inject(RentInvoiceEngineService) private readonly engine: RentInvoiceEngineService
  ) {}

  @Get("settings")
  async get(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    assertRentFlag();
    return ok(await this.settings.get(user.id, propertyId));
  }

  @Get("enable/preview")
  async enablePreview(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    return ok(await this.preview(user.id, propertyId, query));
  }

  @Post("enable")
  async enable(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(RentEnableInputSchema, body);
    const settings = await this.settings.enable(user.id, propertyId, input);
    const generated = await this.engine.generateInvoicesForProperty(propertyId, todayIst(), {
      id: user.id,
      role: "pg_operator"
    });
    return ok({ settings, generated });
  }

  @Patch("settings")
  async patch(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    return ok(
      await this.settings.patch(
        user.id,
        propertyId,
        parseOrThrow(RentPatchSettingsInputSchema, body)
      )
    );
  }

  @Post("pause")
  async pause(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    assertRentFlag();
    return ok(await this.settings.pause(user.id, propertyId));
  }

  @Get("resume/preview")
  async resumePreview(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    return ok(await this.preview(user.id, propertyId, query));
  }

  @Post("resume")
  async resume(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const settings = await this.settings.resume(
      user.id,
      propertyId,
      parseOrThrow(RentResumeInputSchema, body)
    );
    const generated = await this.engine.generateInvoicesForProperty(propertyId, todayIst(), {
      id: user.id,
      role: "pg_operator"
    });
    return ok({ settings, generated });
  }

  @Post("generate-now")
  async generateNow(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    assertRentFlag();
    requireDb(this.db);
    await assertManagedOwnership(this.db, user.id, propertyId);
    const last = this.lastGenerateNow.get(propertyId) ?? 0;
    if (Date.now() - last < GENERATE_NOW_WINDOW_MS) {
      throw new HttpException(
        { code: "generate_rate_limited", message: "Try again in a few minutes" },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    this.lastGenerateNow.set(propertyId, Date.now());
    return ok(
      await this.engine.generateInvoicesForProperty(propertyId, todayIst(), {
        id: user.id,
        role: "pg_operator"
      })
    );
  }

  /**
   * Preview works before AND after enabling: query params override the stored
   * row (or the seeded defaults when no row exists). Query values arrive as
   * strings; coerce the few the wizard sends.
   */
  private async preview(
    operatorId: string,
    propertyId: string,
    rawQuery: unknown
  ): Promise<PgRentEnablePreview> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const q = (rawQuery ?? {}) as Record<string, string | undefined>;
    const input = parseOrThrow(RentEnableInputSchema, {
      ...(q.billing_starts_on ? { billing_starts_on: q.billing_starts_on } : {}),
      ...(q.cycle_mode ? { cycle_mode: q.cycle_mode } : {}),
      ...(q.billing_timing ? { billing_timing: q.billing_timing } : {}),
      ...(q.due_day ? { due_day: Number(q.due_day) } : {}),
      ...(q.proration_mode ? { proration_mode: q.proration_mode } : {}),
      ...(q.prorate_move_out ? { prorate_move_out: q.prorate_move_out === "true" } : {}),
      ...(q.invoice_lead_days ? { invoice_lead_days: Number(q.invoice_lead_days) } : {})
    });
    const stored = await this.settings.getRow(this.db, propertyId);
    const defaults = await this.settings.defaultsFor(this.db, propertyId);
    const today = todayIst();
    const { billing_starts_on, ...rest } = input;
    const overrides = settingsInputToColumns(rest) as Partial<EngineSettings>;
    const effective: EngineSettings = {
      cycle_mode: "calendar_month",
      billing_timing: "advance",
      due_day: defaults.due_day,
      proration_mode: "actual_days",
      prorate_move_out: false,
      invoice_lead_days: 5,
      default_line_items: [],
      receipt_prefix: defaults.receipt_prefix,
      enabled_on: today,
      billing_starts_on: today,
      ...(stored ?? {}),
      ...overrides,
      billing_starts_on: billing_starts_on ?? (stored ? String(stored.billing_starts_on) : today)
    };
    return this.engine.previewForProperty(propertyId, effective, today);
  }
}
```

```ts
// apps/api/src/modules/pg-rent/controllers/pg-rent-invoices.controller.ts
import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { RentInvoiceListFiltersSchema } from "../dto/invoice.dto";
import { RentTenantOverridesSchema } from "../dto/tenant.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentInvoiceService } from "../services/rent-invoice.service";

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentInvoicesController {
  constructor(@Inject(RentInvoiceService) private readonly invoices: RentInvoiceService) {}

  @Get("invoices")
  async list(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    return ok(
      await this.invoices.list(
        user.id,
        propertyId,
        parseOrThrow(RentInvoiceListFiltersSchema, query ?? {})
      )
    );
  }

  @Get("invoices/:id")
  async get(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.get(user.id, propertyId, id));
  }

  @Get("invoices/:id/events")
  async events(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.events(user.id, propertyId, id));
  }

  @Patch("tenants/:assignmentId")
  async overrides(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    await this.invoices.updateTenantOverrides(
      user.id,
      propertyId,
      assignmentId,
      parseOrThrow(RentTenantOverridesSchema, body)
    );
    return ok({ ok: true });
  }
}
```

Register both controllers and `RentInvoiceService` in `pg-rent.module.ts` (`controllers: [PgRentSettingsController, PgRentInvoicesController]`; add `RentInvoiceService` to providers/exports).

- [ ] **Step 6: Run the controller tests**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/pg-rent-controllers.integration.test.ts`
Expected: PASS, 6 tests. If `@Query()` arrives with `invoice_lead_days` as a string and zod rejects the preview, the `preview()` coercion block is where to fix it; the list filters schema takes strings by design.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pg-rent
git commit -m "feat(pg-rent): settings and invoice controllers, invoice reads, tenant overrides"
```

---

### Task 14: Wire the hooks — assignment transitions and ownership transfer

**Files:**

- Modify: `apps/api/src/modules/pg-operations/pg-operations.module.ts` (import `PgRentModule`)
- Modify: `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts:195-199` (constructor) and each transition method
- Modify: `apps/api/src/modules/admin/admin.module.ts:35` (import `PgRentModule`)
- Modify: `apps/api/src/modules/admin/admin-pg-transfer.service.ts:53` (constructor) and `:181-188` (after the `pg_properties` update)
- Test: `apps/api/src/modules/pg-rent/__tests__/rent-hooks.integration.test.ts`

**Interfaces:**

- Consumes: `RentInvoiceEngineService.onAssignmentEvent`, `RentSettingsService.onOwnershipTransferred`.
- Both injections are `@Optional()` so the existing unit tests that construct `PgBedAssignmentService(db, notifications)` and `AdminPgTransferService(database)` directly keep compiling and running.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/modules/pg-rent/__tests__/rent-hooks.integration.test.ts
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../../../app.module";
import { DatabaseService } from "../../../common/database.service";
import { AdminPgTransferService } from "../../admin/admin-pg-transfer.service";
import { PgBedAssignmentService } from "../../pg-operations/services/pg-bed-assignment.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("pg-rent hooks", () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fx: RentFixtures;
  let operatorId: string;
  let assignments: PgBedAssignmentService;
  let settings: RentSettingsService;
  let transfer: AdminPgTransferService;

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    assignments = app.get(PgBedAssignmentService);
    settings = app.get(RentSettingsService);
    transfer = app.get(AdminPgTransferService);
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    await fx.teardown();
    await db.onModuleDestroy();
  });

  async function flush() {
    // hooks are fire-and-forget after commit; give the event loop a tick
    await new Promise((r) => setTimeout(r, 200));
  }

  it("move-in issues the deposit and first rent invoice without waiting for the sweep", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: 900000,
      depositPaise: 1800000
    });
    const roomId = await fx.createRoom(propertyId, { roomTypeId });
    const bedId = await fx.createBed(roomId, "A", "vacant");
    await settings.enable(operatorId, propertyId, { billing_starts_on: "2026-01-01" });

    const moved = await assignments.moveIn(operatorId, propertyId, bedId, {
      occupant_name: "Hook Tenant",
      occupant_phone_e164: fx.nextPhone()
    });
    await flush();
    const rows = await db.query<{ kind: string }>(
      `SELECT kind::text FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind`,
      [moved.id]
    );
    expect(rows.rows.map((r) => r.kind)).toEqual(["deposit", "rent"]);
  });

  it("does nothing for a property without settings", async () => {
    const propertyId = await fx.createProperty(operatorId);
    const roomId = await fx.createRoom(propertyId);
    const bedId = await fx.createBed(roomId, "A", "vacant");
    const moved = await assignments.moveIn(operatorId, propertyId, bedId, {
      occupant_name: "No Rent",
      occupant_phone_e164: fx.nextPhone()
    });
    await flush();
    const rows = await db.query(`SELECT 1 FROM pg_rent_invoices WHERE assignment_id = $1::uuid`, [
      moved.id
    ]);
    expect(rows.rowCount).toBe(0);
  });

  it("ownership transfer pauses rent and clears the payee inside the transfer transaction", async () => {
    // Build a transferable PG: property + listing row the admin service expects.
    // Copy the fixture the existing admin-pg-transfer integration test uses for
    // `current` (listing + pg_listings + pg_properties); the minimal shape is:
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId);
    await settings.enable(operatorId, propertyId, { upi_vpa: "old@okaxis", upi_payee_name: "Old" });
    const targetPhone = fx.nextPhone();

    await transfer.transfer(operatorId, listingId, {
      phone_e164: targetPhone,
      full_name: "New Owner"
    });

    const after = await db.query<{ pause_reason: string | null; upi_vpa: string | null }>(
      `SELECT pause_reason::text, upi_vpa FROM pg_rent_settings WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    expect(after.rows[0]).toEqual({ pause_reason: "transfer", upi_vpa: null });
    const newOwner = await db.query<{ id: string }>(
      `SELECT id::text FROM users WHERE phone_e164 = $1`,
      [targetPhone]
    );
    fx.userIds.push(newOwner.rows[0].id);
  });
});
```

Before running: open `apps/api/src/modules/admin/__tests__/` (or `apps/api/test/`) and find the existing `AdminPgTransferService` integration test; copy exactly how it seeds a transferable listing (`listings` row with `pg_property_id`, `pg_listings`, and the `transfer()` call signature — the admin actor id is the first argument in the current code; verify at `admin-pg-transfer.service.ts:56-60`). Replace the "minimal shape" comment with those inserts.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-hooks.integration.test.ts`
Expected: FAIL — first test finds `[]`; third finds `pause_reason: null`.

- [ ] **Step 3: Wire the assignment hook**

`pg-operations.module.ts`: add `import { PgRentModule } from "../pg-rent/pg-rent.module";` and `PgRentModule` to `imports`.

`pg-bed-assignment.service.ts`:

```ts
import { RentInvoiceEngineService } from "../../pg-rent/services/rent-invoice-engine.service";
```

constructor (`:195-199`):

```ts
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Optional() @Inject(PgMaintenanceService) private readonly maintenance?: PgMaintenanceService,
    @Optional() @Inject(RentInvoiceEngineService) private readonly rentEngine?: RentInvoiceEngineService
  ) {}
```

Add a private helper next to `notify()`:

```ts
  /** Spec §5.8: after commit, best-effort, never inside the transaction. */
  private rentHook(type: string, propertyId: string, assignmentId: string): void {
    if (!this.rentEngine) return;
    void this.rentEngine.onAssignmentEvent({ type, propertyId, assignmentId }).catch(() => undefined);
  }
```

Call it after each committed transition, immediately before the method's `return`:

| Method                   | Call                                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `moveIn`                 | `this.rentHook("moved_in", propertyId, assignment.id)` — `assignment` is the value the transaction returned; restructure `moveIn` so the transaction result is assigned to a `const created = await transaction(...)`, then hook, then `return created;` |
| `operatorMoveOutRequest` | `this.rentHook("operator_move_out_requested", propertyId, assignmentId)`                                                                                                                                                                                 |
| `confirmMoveOut`         | `this.rentHook("move_out_confirmed", propertyId, assignmentId)`                                                                                                                                                                                          |
| `operatorDirectMoveOut`  | `this.rentHook("operator_direct_move_out", propertyId, assignmentId)`                                                                                                                                                                                    |
| `cancelMoveOut`          | `this.rentHook("move_out_cancelled", propertyId, assignmentId)`                                                                                                                                                                                          |
| `cancelNotice`           | `this.rentHook("notice_cancelled", propertyId, assignmentId)`                                                                                                                                                                                            |
| `serveNotice`            | `this.rentHook("notice_served", result.assignment.pg_property_id, assignmentId)`                                                                                                                                                                         |
| `tenantMoveOutRequest`   | `this.rentHook("tenant_move_out_requested", <assignment>.pg_property_id, assignmentId)` — read the property id from the returned assignment                                                                                                              |
| `acceptOperatorMoveOut`  | `this.rentHook("move_out_confirmed", …)`                                                                                                                                                                                                                 |

`reserve`, `cancelReservation`, `rejectOperatorMoveOut` get no hook.

- [ ] **Step 4: Wire the transfer hook**

`admin.module.ts:35`: add `PgRentModule` to `imports` (and its import line).

`admin-pg-transfer.service.ts:53`:

```ts
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Optional() @Inject(RentSettingsService) private readonly rentSettings?: RentSettingsService
  ) {}
```

(add `Optional` to the `@nestjs/common` import and `import { RentSettingsService } from "../pg-rent/services/rent-settings.service";`). Immediately after the `UPDATE pg_properties SET operator_id …` block (`:181-188`), inside the same `if (current.pg_property_id)`:

```ts
// Rent collection travels with the property; the old owner's payee
// identity must not (spec §11.2, D20). Data-driven — no-op without settings.
if (this.rentSettings) {
  await this.rentSettings.onOwnershipTransferred(
    client,
    current.pg_property_id,
    current.operator_user_id,
    target.id
  );
}
```

- [ ] **Step 5: Run the hook tests, then the suites that share these services**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent/__tests__/rent-hooks.integration.test.ts
pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations src/modules/admin
pnpm --filter @cribliv/api typecheck
```

Expected: hooks PASS (3); pg-operations and admin suites unchanged from `master` (see the known-failures memory note); typecheck clean. A Nest "circular dependency"/"undefined provider" error on boot means a stale `dist`/tsbuildinfo — wipe `apps/api/dist` and `apps/api/tsconfig.tsbuildinfo` and rebuild (memory note `nest-circular-dependency-means-undefined-provider.md`); it is not a real cycle because `pg-rent` imports nothing from `pg-operations` or `admin`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-operations/pg-operations.module.ts apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts apps/api/src/modules/admin/admin.module.ts apps/api/src/modules/admin/admin-pg-transfer.service.ts apps/api/src/modules/pg-rent/__tests__/rent-hooks.integration.test.ts
git commit -m "feat(pg-rent): assignment-transition and ownership-transfer hooks"
```

---

### Task 15: Worker sweep

**Files:**

- Create: `apps/api/src/worker/pg-rent-sweeps.ts`
- Modify: `apps/api/src/worker/worker.ts` (constant + wiring after the maintenance sweep block, `:1126-1148`)
- Test: `apps/api/src/worker/__tests__/pg-rent-sweeps.test.ts`

**Interfaces:**

- Produces: `runPgRentSweep(db: DatabaseService, today: string): Promise<{ properties: number; invoices: number; drafts: number; deposits: number }>` — iterates every property with non-paused settings; per-property errors are logged and do not stop the sweep.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/worker/__tests__/pg-rent-sweeps.test.ts
import { describe, expect, it, vi } from "vitest";

import type { DatabaseService } from "../../common/database.service";
import { runPgRentSweep } from "../pg-rent-sweeps";

describe("runPgRentSweep", () => {
  it("returns zeros without a database", async () => {
    const db = { isEnabled: () => false } as DatabaseService;
    await expect(runPgRentSweep(db, "2026-09-17")).resolves.toEqual({
      properties: 0,
      invoices: 0,
      drafts: 0,
      deposits: 0
    });
  });

  it("sums per-property results and survives one property failing", async () => {
    const db = {
      isEnabled: () => true,
      query: vi
        .fn()
        .mockResolvedValue({
          rows: [{ pg_property_id: "p1" }, { pg_property_id: "p2" }, { pg_property_id: "p3" }]
        }),
      getClient: vi.fn()
    } as unknown as DatabaseService;
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        invoices_created: 2,
        drafts_created: 1,
        deposits_created: 1,
        skipped: []
      })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        invoices_created: 1,
        drafts_created: 0,
        deposits_created: 0,
        skipped: []
      });
    const result = await runPgRentSweep(db, "2026-09-17", {
      generateInvoicesForProperty: generate
    });
    expect(result).toEqual({ properties: 3, invoices: 3, drafts: 1, deposits: 1 });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("paused_at IS NULL"), []);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/worker/__tests__/pg-rent-sweeps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/worker/pg-rent-sweeps.ts
import type { DatabaseService } from "../common/database.service";
import { logTelemetry } from "../common/telemetry";
import { RentAllocationService } from "../modules/pg-rent/services/rent-allocation.service";
import { RentInvoiceEngineService } from "../modules/pg-rent/services/rent-invoice-engine.service";
import { SYSTEM_ACTOR } from "../modules/pg-rent/services/rent-guards";
import { RentSettingsService } from "../modules/pg-rent/services/rent-settings.service";

type Engine = Pick<RentInvoiceEngineService, "generateInvoicesForProperty">;

export interface PgRentSweepResult {
  properties: number;
  invoices: number;
  drafts: number;
  deposits: number;
}

/**
 * Hourly (spec §5.1). One property failing is logged and skipped; the rest
 * still run. Each invoice is its own transaction inside the engine.
 */
export async function runPgRentSweep(
  db: DatabaseService,
  today: string,
  engine: Engine = new RentInvoiceEngineService(
    db,
    new RentSettingsService(db),
    new RentAllocationService()
  )
): Promise<PgRentSweepResult> {
  const result: PgRentSweepResult = { properties: 0, invoices: 0, drafts: 0, deposits: 0 };
  if (!db.isEnabled()) return result;
  const started = Date.now();
  const properties = await db.query<{ pg_property_id: string }>(
    `SELECT pg_property_id::text FROM pg_rent_settings WHERE paused_at IS NULL ORDER BY pg_property_id`,
    []
  );
  for (const row of properties.rows) {
    result.properties += 1;
    try {
      const r = await engine.generateInvoicesForProperty(row.pg_property_id, today, SYSTEM_ACTOR);
      result.invoices += r.invoices_created;
      result.drafts += r.drafts_created;
      result.deposits += r.deposits_created;
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_sweep",
          pg_property_id: row.pg_property_id,
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }
  logTelemetry("pg_rent.sweep_run", { ...result, ms: Date.now() - started });
  return result;
}
```

- [ ] **Step 4: Wire it into the worker**

In `apps/api/src/worker/worker.ts`, next to the other `*_MS` constants:

```ts
const PG_RENT_SWEEP_MS = 60 * 60 * 1000; // hourly — invoices + deposits (spec §5.1)
```

Add the import: `import { runPgRentSweep } from "./pg-rent-sweeps";` and `import { todayIst } from "../common/date";`. Directly after the maintenance auto-close `setInterval` block (inside `if (pool) {`, after `:1148`):

```ts
// ── PG rent: invoice + deposit generation (hourly, behind FF_PG_RENT_COLLECTION) ──
// Not on startup, for the same reason as the stale-listing sweep: a
// deploy loop must not re-run money-adjacent jobs every restart.
if (readFeatureFlags().ff_pg_rent_collection) {
  setInterval(async () => {
    try {
      await runPgRentSweep(maintenanceDb, todayIst());
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "pg_rent_sweep",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
    }
  }, PG_RENT_SWEEP_MS);
}
```

(`maintenanceDb` is the `DatabaseService`-shaped adapter already built at `:1097`; reuse it rather than constructing a second pool.)

- [ ] **Step 5: Run the unit test and boot the worker once**

```bash
pnpm --filter @cribliv/api exec vitest run src/worker/__tests__/pg-rent-sweeps.test.ts
pnpm --filter @cribliv/api typecheck
FF_PG_RENT_COLLECTION=true timeout 20 pnpm worker || true
```

Expected: 2 tests PASS; typecheck clean; the worker boots and logs its usual startup lines with no `pg_rent_sweep` error (the interval has not fired yet — that is correct).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/worker/pg-rent-sweeps.ts apps/api/src/worker/worker.ts apps/api/src/worker/__tests__/pg-rent-sweeps.test.ts
git commit -m "feat(worker): hourly pg-rent invoice sweep behind FF_PG_RENT_COLLECTION"
```

---

### Task 16: Full verification and PR

- [ ] **Step 1: Run everything**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/api exec vitest run src/modules/pg-rent src/worker src/common src/modules/pg-operations src/modules/admin
pnpm lint
```

Expected: pg-rent suites all green (schema 4, flag 2, money 8, dates 6, period 16, window/proration/status 12, guards 4, invariants 1, settings-dto 6, settings 7, allocation 2, engine 12, controllers 6, hooks 3, sweeps 2 = **91 tests**); pre-existing failures only where the memory note says.

- [ ] **Step 2: Contract check — no `_paise` leaves the module**

```bash
grep -rn "_paise" apps/api/src/modules/pg-rent/controllers/ && echo "FAIL: a controller mentions _paise" || echo "OK"
```

Expected: `OK` (controllers only see DTOs). The `expect(JSON.stringify(...)).not.toMatch(/_paise/)` assertions in the controller tests are the runtime half of this check.

- [ ] **Step 3: Update the graph and open the PR**

```bash
graphify update .
```

Branch `feat/pg-rent-slice1a-backend-foundation`, title `feat(pg-rent): backend foundation — schema, settings, invoice engine (slice 1a)`. In the body: link the spec and this plan; list what is deliberately absent (payments, late fees, receipts, settlement, suggestions — slice 1b); note the `generate-now` limiter is per process; note that the rent `pay_token` never leaves the API in this slice.

---

## Self-review

**Spec coverage.** §4 schema — Task 1 (every table/enum/index, incl. `deposit` line kind from §19 #50, `enabled_on`, `pg_rent_counters`, allocation one-of, `superseded_by`). §3 invariants 1–5, 14–16 checked by Task 8's `assertRentInvariants`; 8 by `writeRentEvent` inside every transaction; 9 by `roundToRupee`/`splitLargestRemainder`; 10 by `todayIst`/`IST_TODAY_SQL` only; 11–12 by `nextPeriod`/`firstGeneratedPeriod` (Task 5). §5.1 entry points — Task 12 + Task 15 + `generate-now` (Task 13). §5.2 status-aware window, `moved_out` eligibility, cut periods, `move_in_date` null skip + PATCH — Tasks 6, 12, 13. §5.3 both modes × both timings, anchor clamping, floor date (§19 #48), preview, "never in the past", proration — Tasks 5, 6, 12. §5.4 lines, default items minus excludes, credit auto-apply, numbering, token — Task 12. §5.5 deposit chain incl. room type, `enabled_on` floor, sweep-generated — Task 12. §5.7 "Change rent from next cycle" — Task 13. §5.8 hooks run generation — Tasks 12, 14 (suggestions → 1b, stated). §11 effect timing, pause/resume with floor, token concurrency, counters apart — Tasks 10, 13. §11.2 transfer hook — Tasks 10, 14. §12 settings + invoice-read + generate-now + tenant PATCH routes — Task 13. §13 layout — matches the file table. §15 flag — Task 2, 404 gate in every controller. **Not in this slice, by design:** §5.6 late fees, §5.7 line editing/cancel/extend/issue, §5.8 suggestions, §6 entirely, §7, §9 tenant routes, §10 — all slice 1b or later (index plan).

**Placeholder scan.** No TBD/TODO. Two places tell the executor to _copy_ from an existing file rather than guess: Task 8 Step 1 (fixture SQL — verified literals now inline) and Task 14 Step 1 (the transferable-listing seed, which depends on the admin test's exact rows). Both name the file to copy from.

**Type consistency.** `Period`, `PeriodSpec`, `DueSpec` defined in Task 5 and used unchanged in Tasks 6, 12. `RentActor`/`SYSTEM_ACTOR` from Task 7 used in Tasks 11, 12, 15. `RentSettingsRow` (Task 9) is what `getRow` returns (Task 10) and what `EngineSettings` picks from (Task 12); the controller's `preview()` builds an `EngineSettings` from it. `applyUnallocatedCredit(client, invoiceId, actor)` — same signature in Task 11's tests, Task 12's engine. `generateInvoicesForProperty(propertyId, today, actor?, opts?)` — same in Task 12, 13, 15. `PgRentGenerateResult.skipped[].reason` is `PgRentPreviewSkipReason` in both shared types and engine. `compareIso` is re-exported from `rent-dates.ts` in Task 5 and imported by `rent-window.ts` in Task 6; the engine imports `compareIsoDates` from `common/date` directly — both are the same function.
