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
