-- ─── Migration 0013: Owner Subscription Plans ────────────────────────────────
-- Creates subscription_plans (seed data) and owner_subscriptions tables.
-- Supports recurring monthly featured-listing subscriptions for owners.

DO $$ BEGIN
  CREATE TYPE subscription_status AS ENUM ('active', 'expired', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_id            text PRIMARY KEY,
  label              text        NOT NULL,
  amount_paise       int         NOT NULL,
  duration_days      int         NOT NULL DEFAULT 30,
  max_featured_slots int         NOT NULL DEFAULT 0,
  is_active          boolean     NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS owner_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id    uuid               NOT NULL REFERENCES users(id),
  plan_id          text               NOT NULL REFERENCES subscription_plans(plan_id),
  status           subscription_status NOT NULL DEFAULT 'active',
  starts_at        timestamptz        NOT NULL DEFAULT now(),
  expires_at       timestamptz        NOT NULL,
  payment_order_id uuid               REFERENCES payment_orders(id),
  auto_renew       boolean            NOT NULL DEFAULT true,
  created_at       timestamptz        NOT NULL DEFAULT now(),
  updated_at       timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_subscriptions_owner
  ON owner_subscriptions (owner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_owner_subscriptions_expiry
  ON owner_subscriptions (expires_at)
  WHERE status = 'active';

-- Seed plans
INSERT INTO subscription_plans (plan_id, label, amount_paise, duration_days, max_featured_slots)
VALUES
  ('monthly_basic', 'Basic Monthly — 1 featured slot', 49900, 30, 1),
  ('monthly_pro',   'Pro Monthly — 3 featured slots',  99900, 30, 3)
ON CONFLICT (plan_id) DO UPDATE SET
  label              = EXCLUDED.label,
  amount_paise       = EXCLUDED.amount_paise,
  duration_days      = EXCLUDED.duration_days,
  max_featured_slots = EXCLUDED.max_featured_slots;
