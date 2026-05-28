-- ─── Migration 0030: re-point rent_agreements.payment_order_id FK ────────────
-- Migration 0024 declared `rent_agreements.payment_order_id uuid REFERENCES
-- payment_orders(id)` — the generic app-wide payment_orders table. But the
-- rent-agreement module runs its own CheckoutService and persists orders to
-- `rent_agreement_payment_orders` (migration 0029). The back-pointer must
-- reference that table, not the generic one.
--
-- Safe: the rent-agreement module was in-memory until now, so no persisted
-- rent_agreements row has payment_order_id set.

BEGIN;

ALTER TABLE rent_agreements
  DROP CONSTRAINT IF EXISTS rent_agreements_payment_order_id_fkey;

ALTER TABLE rent_agreements
  ADD CONSTRAINT rent_agreements_payment_order_id_fkey
  FOREIGN KEY (payment_order_id)
  REFERENCES rent_agreement_payment_orders (id);

COMMIT;
