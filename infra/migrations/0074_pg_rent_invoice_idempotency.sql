-- infra/migrations/0074_pg_rent_invoice_idempotency.sql
-- Store the Idempotency-Key of POST /rent/invoices (manual + backfill) on the
-- invoice row, the same way pg_rent_payments.idempotency_key does (0072).
--
-- The controller already requires the header and wraps the call in
-- IdempotencyService.run, but that cache is check-then-act: two truly
-- concurrent first requests both miss it and both insert. The partial unique
-- index is what makes the second insert fail (23505 → 409 duplicate_invoice),
-- mirroring uq_pg_rent_payment_idem.
--
-- Engine-generated (source 'auto'), settlement and forfeit invoices carry no
-- key; NULL rows are outside the partial index. Additive only: the table ships
-- with the pg-rent feature branch, so the index build is instant.
ALTER TABLE pg_rent_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pg_rent_invoice_idem
  ON pg_rent_invoices(pg_property_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
