-- Migration 0031: PG Operator V1 — properties, room/bed schema, pricing matrix,
-- voice agent sessions (PG variant), voice-mediated listing drafts.
-- Idempotent: IF NOT EXISTS / DO $$ guards throughout.
-- Spec: vault Features/PG Operator Role/03-V1-Data-Model.md

-- 1. Multi-property entity (UI hides switcher in V1; schema ready for V2)
DO $$ BEGIN
  CREATE TYPE pg_property_status AS ENUM ('active','paused','archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_properties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name    text NOT NULL,
  internal_code   text,
  -- Use integer FKs to match existing listing_locations / landmarks pattern.
  -- DTO carries slugs (client-friendly); service resolves slug -> id on write.
  city_id         integer NOT NULL REFERENCES cities(id),
  locality_id     integer REFERENCES localities(id),
  status          pg_property_status NOT NULL DEFAULT 'active',
  is_primary      boolean NOT NULL DEFAULT true,
  total_floors    smallint,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pg_props_one_primary_per_operator
    EXCLUDE (operator_id WITH =) WHERE (is_primary = true)
);
CREATE INDEX IF NOT EXISTS idx_pg_props_operator ON pg_properties(operator_id);

-- 2. Hook listings to a property (nullable: flat_house listings unaffected)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS pg_property_id uuid REFERENCES pg_properties(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_listings_pg_property ON listings(pg_property_id)
  WHERE pg_property_id IS NOT NULL;

-- 3. Extend pg_details to cover the 7-category schema (additive only)
DO $$ BEGIN
  CREATE TYPE pg_gender_policy    AS ENUM ('boys','girls','coed');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE pg_tenant_type      AS ENUM ('students','working','any');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE pg_electricity_mode AS ENUM ('flat','submetered','split_equally');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE pg_details
  ADD COLUMN IF NOT EXISTS gender_policy           pg_gender_policy,
  ADD COLUMN IF NOT EXISTS tenant_type             pg_tenant_type,
  ADD COLUMN IF NOT EXISTS notice_period_days      smallint,
  ADD COLUMN IF NOT EXISTS lock_in_months          smallint,
  ADD COLUMN IF NOT EXISTS security_deposit_paise  bigint,
  ADD COLUMN IF NOT EXISTS deposit_refundable_pct  smallint,
  ADD COLUMN IF NOT EXISTS electricity_mode        pg_electricity_mode,
  ADD COLUMN IF NOT EXISTS maintenance_paise       bigint,
  ADD COLUMN IF NOT EXISTS rent_due_day            smallint,
  ADD COLUMN IF NOT EXISTS payment_modes           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS late_fee_policy         jsonb,
  ADD COLUMN IF NOT EXISTS price_negotiable        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meals                   jsonb,
  ADD COLUMN IF NOT EXISTS meal_charges_paise      bigint,
  ADD COLUMN IF NOT EXISTS amenities               jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS house_rules             jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS nearby                  jsonb,
  ADD COLUMN IF NOT EXISTS schema_version          smallint NOT NULL DEFAULT 1;

-- 4. Room types + pricing matrix (normalized — search-queryable)
DO $$ BEGIN
  CREATE TYPE pg_sharing_kind   AS ENUM ('single','double','triple','quad','dorm');
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE TYPE pg_bathroom_kind  AS ENUM ('attached_western','attached_indian','shared_western','shared_indian');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_room_types (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sharing            pg_sharing_kind NOT NULL,
  ac                 boolean NOT NULL,
  bathroom_kind      pg_bathroom_kind NOT NULL,
  furnishing         furnishing_type NOT NULL,  -- existing enum from 0001_init.sql
  room_size_sqft     smallint,
  monthly_rent_paise bigint NOT NULL,
  vacancy_count      smallint NOT NULL DEFAULT 0,
  available_from     date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, sharing, ac, bathroom_kind, furnishing)
);
CREATE INDEX IF NOT EXISTS idx_pg_room_types_listing ON pg_room_types(listing_id);
CREATE INDEX IF NOT EXISTS idx_pg_room_types_search
  ON pg_room_types(sharing, ac, monthly_rent_paise);

-- 5. Rooms + Beds (schema-from-day-one, NO V1 UI — locked decision #6)
DO $$ BEGIN
  CREATE TYPE pg_bed_status AS ENUM ('vacant','reserved','occupied','blocked');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_rooms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pg_property_id  uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  room_type_id    uuid REFERENCES pg_room_types(id) ON DELETE SET NULL,
  floor           smallint,
  room_number     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pg_property_id, room_number)
);

CREATE TABLE IF NOT EXISTS pg_beds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         uuid NOT NULL REFERENCES pg_rooms(id) ON DELETE CASCADE,
  bed_label       text NOT NULL,
  status          pg_bed_status NOT NULL DEFAULT 'vacant',
  available_from  date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, bed_label)
);
CREATE INDEX IF NOT EXISTS idx_pg_beds_room ON pg_beds(room_id);
CREATE INDEX IF NOT EXISTS idx_pg_beds_status ON pg_beds(status) WHERE status = 'vacant';

-- V1 derives bed totals from pg_room_types (no per-bed rows required to publish a listing).
-- V2 hydrates rooms/beds rows + a UI grid; no migration needed.

-- 6. PG voice-agent sessions (separate from Maya's voice_agent_sessions)
CREATE TABLE IF NOT EXISTS pg_voice_agent_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draft_id              uuid,  -- FK added after pg_listing_drafts created (see below)
  socket_id             text,
  phase                 text NOT NULL DEFAULT 'greeting',
  locale                lang_code NOT NULL DEFAULT 'en',
  system_prompt_version text NOT NULL,
  transcript            jsonb NOT NULL DEFAULT '[]'::jsonb,
  extraction_log        jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at            timestamptz NOT NULL DEFAULT now(),
  ended_at              timestamptz,
  ttl_expires_at        timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS idx_pg_voice_sessions_operator ON pg_voice_agent_sessions(operator_user_id);
CREATE INDEX IF NOT EXISTS idx_pg_voice_sessions_ttl ON pg_voice_agent_sessions(ttl_expires_at);

-- 7. Voice-mediated draft (intermediate state before commit to listings)
DO $$ BEGIN
  CREATE TYPE pg_draft_source AS ENUM ('voice','manual','imported');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS pg_listing_drafts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pg_property_id       uuid REFERENCES pg_properties(id) ON DELETE SET NULL,
  source               pg_draft_source NOT NULL,
  payload              jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_confidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  committed_listing_id uuid REFERENCES listings(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  ttl_expires_at       timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS idx_pg_drafts_operator ON pg_listing_drafts(operator_user_id);
CREATE INDEX IF NOT EXISTS idx_pg_drafts_ttl ON pg_listing_drafts(ttl_expires_at);

-- Add the deferred FK from sessions -> drafts
DO $$ BEGIN
  ALTER TABLE pg_voice_agent_sessions
    ADD CONSTRAINT fk_pg_voice_sessions_draft
    FOREIGN KEY (draft_id) REFERENCES pg_listing_drafts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 8. Updated-at trigger reuse (existing func name is trigger_set_updated_at, defined in 0001).
-- Verified empty triggers on pg_details/pg_properties/pg_beds/pg_listing_drafts before apply.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pg_properties','pg_beds','pg_listing_drafts','pg_details']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I;', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();', t);
  END LOOP;
END $$;
