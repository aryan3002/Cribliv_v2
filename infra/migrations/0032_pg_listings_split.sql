-- Migration 0032: PG ⊥ Property hard split (Phase B).
-- Introduces pg_listings as the PG-owned listing head (source of truth). The
-- shared listings row becomes a denormalized public READ PROJECTION that PG
-- writes with the SAME id (1:1), so maps / analytics / search keep reading it
-- unchanged. Adds lat/lng to pg_properties for map-pin geocoding (projection
-- falls back to locality centroid when null). Backfills existing PG listings.
-- Idempotent: IF NOT EXISTS / ON CONFLICT guards throughout.
-- Spec: docs/superpowers/specs/2026-05-31-pg-property-hard-split-design.md

-- 1. PG-owned listing head (source of truth). id == listings.id (1:1 projection).
CREATE TABLE IF NOT EXISTS pg_listings (
  id                  uuid PRIMARY KEY,
  operator_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pg_property_id      uuid NOT NULL REFERENCES pg_properties(id) ON DELETE CASCADE,
  title               text NOT NULL,
  starting_rent_paise bigint NOT NULL,
  status              listing_status NOT NULL DEFAULT 'draft',
  verification_status verification_status NOT NULL DEFAULT 'unverified',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pg_listings_operator ON pg_listings(operator_user_id);
CREATE INDEX IF NOT EXISTS idx_pg_listings_property ON pg_listings(pg_property_id);

-- 2. Property coordinates: precise geocode cache. When null, projection uses the
--    locality centroid (same fallback owner listings use). numeric(9,6) matches
--    listing_locations / localities.
ALTER TABLE pg_properties
  ADD COLUMN IF NOT EXISTS lat numeric(9,6),
  ADD COLUMN IF NOT EXISTS lng numeric(9,6);

-- 3. Backfill: every existing PG listings row gets a pg_listings head with the
--    SAME id. pg_property_id is recovered from the row, else the operator's
--    primary property (orphaning bug left some at NULL). starting_rent from the
--    cheapest room type (paise), else listings.monthly_rent (rupees -> paise).
INSERT INTO pg_listings
  (id, operator_user_id, pg_property_id, title, starting_rent_paise,
   status, verification_status, created_at, updated_at)
SELECT
  l.id,
  l.owner_user_id,
  COALESCE(
    l.pg_property_id,
    (SELECT p.id FROM pg_properties p
      WHERE p.operator_id = l.owner_user_id
      ORDER BY p.is_primary DESC, p.created_at ASC
      LIMIT 1)
  ) AS pg_property_id,
  COALESCE(NULLIF(l.title_en, ''), 'PG') AS title,
  COALESCE(
    (SELECT MIN(rt.monthly_rent_paise) FROM pg_room_types rt WHERE rt.listing_id = l.id),
    (l.monthly_rent::bigint * 100),
    0
  ) AS starting_rent_paise,
  l.status,
  l.verification_status,
  l.created_at,
  now()
FROM listings l
WHERE l.listing_type = 'pg'
  AND COALESCE(
    l.pg_property_id,
    (SELECT p.id FROM pg_properties p
      WHERE p.operator_id = l.owner_user_id
      ORDER BY p.is_primary DESC, p.created_at ASC
      LIMIT 1)
  ) IS NOT NULL
ON CONFLICT (id) DO NOTHING;

-- 4. updated_at trigger (reuse trigger_set_updated_at from 0005).
DROP TRIGGER IF EXISTS set_updated_at ON pg_listings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pg_listings
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
