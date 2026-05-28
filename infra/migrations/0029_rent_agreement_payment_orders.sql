-- ─── Migration 0029: rent_agreement_payment_orders ───────────────────────────
-- Production-grade persistence for rent-agreement payment orders.
--
-- The payment *provider* stays dev-based for now (MockPaymentProvider mints the
-- provider_order_id; the dev auto-capture flow mints a mock provider_payment_id).
-- This table stores those orders with the exact shape a real provider integration
-- (Razorpay) will use — so attaching the real payment interface later is a
-- provider swap only, with no schema or repository change.
--
-- Spec: docs/superpowers/specs/2026-05-21-rent-agreement-admin-analytics-design.md
-- Mirrors the in-memory CheckoutService state machine (checkout.service.ts):
--   status ∈ {'pending_payment','paid'}, idempotent on (user_id, idempotency_key).

BEGIN;

CREATE TABLE IF NOT EXISTS rent_agreement_payment_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  draft_id            uuid NOT NULL REFERENCES rent_agreements(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('razorpay', 'upi')),
  idempotency_key     text NOT NULL,
  provider_order_id   text NOT NULL,
  provider_payment_id text,
  amount_paise        integer NOT NULL CHECK (amount_paise >= 0),
  status              text NOT NULL DEFAULT 'pending_payment'
                        CHECK (status IN ('pending_payment', 'paid')),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

-- Webhook lookup: a captured-payment event carries the provider order id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ra_payment_orders_provider_order
  ON rent_agreement_payment_orders (provider_order_id);

-- Admin: the payment order behind an agreement.
CREATE INDEX IF NOT EXISTS idx_ra_payment_orders_draft
  ON rent_agreement_payment_orders (draft_id);

-- Admin analytics: revenue time-series over a window.
CREATE INDEX IF NOT EXISTS idx_ra_payment_orders_created_at
  ON rent_agreement_payment_orders (created_at DESC);

COMMIT;
