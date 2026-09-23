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
