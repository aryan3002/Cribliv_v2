DROP INDEX IF EXISTS uq_pg_rent_invoice_idem;
ALTER TABLE pg_rent_invoices DROP COLUMN IF EXISTS idempotency_key;
DELETE FROM schema_migrations WHERE filename = '0074_pg_rent_invoice_idempotency.sql';
