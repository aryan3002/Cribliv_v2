-- ─── Migration 0024: Rent Agreement v2 ───────────────────────────────────────
-- Backend-first rewrite of the rent-agreement module.
-- Spec: ObsidianVault/.../Cribliv-v2/Features/rent agrement v2/
--
-- 8 tables: plans catalogue + per-state stamp duty rules + main agreement
-- row + per-step audit + off-row signatures + PDF job queue + download
-- audit + PostHog event mirror. Plans and stamp-duty rules are seeded.
--
-- Folded in: 3 nullable columns on rent_agreements
-- (`e_stamp_reference`, `e_sign_session_id`, `e_sign_completed_at`) so the
-- Phase 15 e-Stamping / Aadhaar eSign stub adapter does not need a follow-up
-- migration.
--
-- Reuses `trigger_set_updated_at()` from 0005_security_indexes_triggers.

BEGIN;

-- ─── 1. Plans catalogue ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rent_agreement_plans (
  plan_id       text PRIMARY KEY,
  tier          text NOT NULL,
  label         text NOT NULL,
  amount_paise  int  NOT NULL CHECK (amount_paise >= 0),
  features      jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. Stamp duty rules per state ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stamp_duty_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code        text NOT NULL,
  state_name        text NOT NULL,
  formula_type      text NOT NULL CHECK (formula_type IN (
                      'percentage_of_annual_rent',
                      'percentage_of_total_rent',
                      'percentage_of_rent_plus_deposit'
                    )),
  percentage        decimal(7,6) NOT NULL,
  min_amount_paise  int NOT NULL DEFAULT 10000,
  includes_deposit  boolean NOT NULL DEFAULT false,
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  effective_until   date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stamp_duty_rules_active
  ON stamp_duty_rules (state_code)
  WHERE effective_until IS NULL;

-- ─── 3. Main agreement row ──────────────────────────────────────────────────
-- Nullable on most step columns because the row starts empty (current_step=1)
-- and gets populated progressively. Wizard state machine enforces completeness
-- in the application layer; the CHECK constraints here guard against impossible
-- values rather than presence (presence is gated per-step).
CREATE TABLE IF NOT EXISTS rent_agreements (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES users(id),
  plan_id                       text NOT NULL REFERENCES rent_agreement_plans(plan_id),
  locale                        text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'hi')),
  idempotency_key               text NOT NULL,
  current_step                  int  NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 7),
  step_validated_at             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                        text NOT NULL DEFAULT 'draft' CHECK (status IN (
                                  'draft',
                                  'pending_payment',
                                  'paid',
                                  'generating_pdf',
                                  'generated',
                                  'expired',
                                  'refunded'
                                )),

  -- Step 1: contract parties (landlord = `owner`, renter = `tenant`).
  -- These are the document's parties — independent of the creating user's app role.
  owner_full_name              text,
  owner_father_name            text,
  owner_age                    int,
  owner_phone                  text,
  owner_email                  text,
  owner_permanent_address      text,
  owner_pan_ct                 bytea,           -- AES-256-GCM ciphertext
  owner_aadhaar_last4          text,
  tenant_full_name             text,
  tenant_father_name           text,
  tenant_age                   int,
  tenant_phone                 text,
  tenant_email                 text,
  tenant_permanent_address     text,
  tenant_pan_ct                bytea,           -- AES-256-GCM ciphertext
  tenant_aadhaar_last4         text,
  tenant_company_name          text,

  -- Step 2: property.
  property_full_address        text,
  property_type                text,
  property_area_sqft           int,
  property_furnishing          text,
  property_purpose             text,
  property_parking             text,
  property_floor_number        int,
  property_total_floors        int,
  property_flat_number         text,
  property_municipal_number    text,
  property_survey_number       text,

  -- Step 3: terms.
  agreement_type               text,
  agreement_date               date,
  commencement_date            date,
  tenure_months                int,
  lock_in_months               int,
  notice_period_months         int,
  rent_amount_paise            int,
  security_deposit_paise       int,
  annual_increment_pct         numeric(5,2),
  state_code                   text,
  city                         text,
  acknowledge_registration_required boolean NOT NULL DEFAULT false,

  -- Step 4: inventory + utilities.
  inventory_items              jsonb NOT NULL DEFAULT '[]'::jsonb,
  rent_due_day                 int,
  rent_payment_method          text,
  maintenance_included         boolean,
  maintenance_paise            int,
  electricity_allocation       text,
  water_allocation             text,
  gas_allocation               text,
  society_charges_allocation   text,
  late_payment_penalty_pct     numeric(5,2),

  -- Step 5: clauses + witnesses.
  pets_allowed                 boolean,
  subletting_allowed           boolean,
  renovation_allowed           boolean,
  commercial_use_allowed       boolean,
  max_occupants                int,
  additional_terms             text[] NOT NULL DEFAULT '{}',
  witness_1                    jsonb,
  witness_2                    jsonb,

  -- Computed at step-3 advance + on stamp-duty rule changes.
  stamp_duty_paise             int NOT NULL DEFAULT 0 CHECK (stamp_duty_paise >= 0),

  -- Payment + delivery.
  payment_order_id             uuid REFERENCES payment_orders(id),
  pdf_blob_path                text,
  pdf_generated_at             timestamptz,
  download_count               int NOT NULL DEFAULT 0,
  max_downloads                int NOT NULL DEFAULT 5,
  expires_at                   timestamptz,

  -- e-Stamping / Aadhaar eSign (Phase 15 adapter pattern; nullable).
  e_stamp_reference            text,
  e_sign_session_id            text,
  e_sign_completed_at          timestamptz,

  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_rent_agreements_tenure_range
    CHECK (tenure_months IS NULL OR tenure_months BETWEEN 1 AND 132),
  CONSTRAINT chk_rent_agreements_lock_in_le_tenure
    CHECK (
      lock_in_months IS NULL OR tenure_months IS NULL
      OR lock_in_months BETWEEN 0 AND tenure_months
    ),
  CONSTRAINT chk_rent_agreements_notice_range
    CHECK (notice_period_months IS NULL OR notice_period_months BETWEEN 1 AND 6),
  CONSTRAINT chk_rent_agreements_rent_positive
    CHECK (rent_amount_paise IS NULL OR rent_amount_paise > 0),
  CONSTRAINT chk_rent_agreements_deposit_nonneg
    CHECK (security_deposit_paise IS NULL OR security_deposit_paise >= 0),
  CONSTRAINT chk_rent_agreements_increment_range
    CHECK (annual_increment_pct IS NULL OR annual_increment_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_rent_agreements_owner_age
    CHECK (owner_age IS NULL OR owner_age BETWEEN 18 AND 120),
  CONSTRAINT chk_rent_agreements_tenant_age
    CHECK (tenant_age IS NULL OR tenant_age BETWEEN 18 AND 120),
  CONSTRAINT chk_rent_agreements_rent_due_day
    CHECK (rent_due_day IS NULL OR rent_due_day BETWEEN 1 AND 28),
  CONSTRAINT chk_rent_agreements_penalty_range
    CHECK (late_payment_penalty_pct IS NULL OR late_payment_penalty_pct BETWEEN 0 AND 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_agreements_user_idem
  ON rent_agreements (user_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_rent_agreements_user_status
  ON rent_agreements (user_id, status);

CREATE INDEX IF NOT EXISTS idx_rent_agreements_state_created
  ON rent_agreements (state_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rent_agreements_payment_order
  ON rent_agreements (payment_order_id)
  WHERE payment_order_id IS NOT NULL;

-- ─── 4. Step audit (drives funnel analytics + abuse detection) ──────────────
CREATE TABLE IF NOT EXISTS rent_agreement_step_audit (
  id              bigserial PRIMARY KEY,
  agreement_id    uuid NOT NULL REFERENCES rent_agreements(id) ON DELETE CASCADE,
  step            int  NOT NULL CHECK (step BETWEEN 1 AND 7),
  outcome         text NOT NULL CHECK (outcome IN ('advanced', 'blocked', 'patched', 'reverted')),
  error_codes     text[] NOT NULL DEFAULT '{}',
  actor_user_id   uuid NOT NULL REFERENCES users(id),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rent_agreement_step_audit_funnel
  ON rent_agreement_step_audit (agreement_id, step, created_at);

-- ─── 5. Signatures (off-row to keep main table thin) ───────────────────────
CREATE TABLE IF NOT EXISTS rent_agreement_signatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id    uuid NOT NULL REFERENCES rent_agreements(id) ON DELETE CASCADE,
  party           text NOT NULL CHECK (party IN ('owner', 'tenant')),
  method          text NOT NULL CHECK (method IN ('canvas', 'upload')),
  content_type    text NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
  image_bytes     bytea NOT NULL,
  sha256          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, party)
);

-- ─── 6. PDF job queue (worker polls via FOR UPDATE SKIP LOCKED) ────────────
CREATE TABLE IF NOT EXISTS rent_agreement_pdf_jobs (
  id              bigserial PRIMARY KEY,
  agreement_id    uuid NOT NULL REFERENCES rent_agreements(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts        int  NOT NULL DEFAULT 0,
  last_error      text,
  locked_until    timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rent_agreement_pdf_jobs_poll
  ON rent_agreement_pdf_jobs (status, locked_until)
  WHERE status IN ('pending', 'failed');

-- ─── 7. Download audit (IP hashed, never stored plaintext) ─────────────────
CREATE TABLE IF NOT EXISTS rent_agreement_downloads (
  id              bigserial PRIMARY KEY,
  agreement_id    uuid NOT NULL REFERENCES rent_agreements(id) ON DELETE CASCADE,
  ip_hash         text NOT NULL,
  user_agent      text,
  sas_expires_at  timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rent_agreement_downloads_lookup
  ON rent_agreement_downloads (agreement_id, created_at DESC);

-- ─── 8. PostHog event mirror (belt-and-braces; admin dashboard source) ─────
CREATE TABLE IF NOT EXISTS rent_agreement_event_log (
  id                bigserial PRIMARY KEY,
  event_name        text NOT NULL,
  agreement_id      uuid REFERENCES rent_agreements(id) ON DELETE SET NULL,
  user_id           uuid REFERENCES users(id) ON DELETE SET NULL,
  properties        jsonb NOT NULL DEFAULT '{}'::jsonb,
  posthog_sent_at   timestamptz,
  posthog_attempts  int  NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rent_agreement_event_log_unsent
  ON rent_agreement_event_log (created_at)
  WHERE posthog_sent_at IS NULL;

-- ─── updated_at triggers (reuse trigger_set_updated_at() from 0005) ────────
DROP TRIGGER IF EXISTS set_updated_at ON rent_agreement_plans;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rent_agreement_plans
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON rent_agreements;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON rent_agreements
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON stamp_duty_rules;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON stamp_duty_rules
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- ─── Seeds: plans ──────────────────────────────────────────────────────────
INSERT INTO rent_agreement_plans (plan_id, tier, label, amount_paise, features, sort_order)
VALUES
  ('basic',    'basic',    'Basic',    9900,
   '["legally-formatted PDF","8-state stamp duty advisory","up to 5 downloads","email delivery"]'::jsonb, 1),
  ('standard', 'standard', 'Standard', 19900,
   '["everything in Basic","notary-ready format","stamp paper value advisory"]'::jsonb, 2),
  ('premium',  'premium',  'Premium',  49900,
   '["everything in Standard","canvas/upload signature capture","Hindi PDF option","up to 10 downloads"]'::jsonb, 3)
ON CONFLICT (plan_id) DO NOTHING;

-- ─── Seeds: stamp duty rules (8 verified states) ───────────────────────────
INSERT INTO stamp_duty_rules
  (state_code, state_name, formula_type, percentage, min_amount_paise, includes_deposit, effective_from, notes)
VALUES
  ('MH', 'Maharashtra',   'percentage_of_rent_plus_deposit', 0.002500, 10000, true,  CURRENT_DATE,
   'Lease <= 5y: 0.25% of (total rent + deposit). Min Rs 100.'),
  ('KA', 'Karnataka',     'percentage_of_annual_rent',      0.010000,  2000, false, CURRENT_DATE,
   '1% of avg annual rent. Min Rs 20.'),
  ('DL', 'Delhi',         'percentage_of_annual_rent',      0.020000, 10000, false, CURRENT_DATE,
   '2% of avg annual rent for tenure < 5y.'),
  ('UP', 'Uttar Pradesh', 'percentage_of_annual_rent',      0.020000,  1000, false, CURRENT_DATE,
   '2% of annual rent. Min Rs 10.'),
  ('TN', 'Tamil Nadu',    'percentage_of_annual_rent',      0.010000,  2000, false, CURRENT_DATE,
   '1% of annual rent. Min Rs 20.'),
  ('RJ', 'Rajasthan',     'percentage_of_total_rent',       0.010000,  2000, false, CURRENT_DATE,
   '1% of total rent. Min Rs 20.'),
  ('GJ', 'Gujarat',       'percentage_of_annual_rent',      0.010000,     0, false, CURRENT_DATE,
   '1% of annual rent amount.'),
  ('HR', 'Haryana',       'percentage_of_annual_rent',      0.015000,     0, false, CURRENT_DATE,
   '1.5% of annual rent.')
ON CONFLICT DO NOTHING;

COMMIT;
