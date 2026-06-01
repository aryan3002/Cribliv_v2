-- Migration 0033: complete the pg_listings backfill, then re-point the PG
-- detail tables to the PG aggregate root.
--
-- WHY: pg_details / pg_room_types are children of the PG-owned aggregate
-- (pg_listings), NOT of the public read projection (listings). Their FKs were
-- created (0031 and earlier) against listings(id) because PG used to BE a
-- listings row. After the split (0032) the aggregate root is pg_listings and
-- the listings row is a derived projection written LAST in publish — so a FK to
-- listings fired before the projection existed and raised the constraint error.
--
-- 0032's backfill only covered PG listings whose pg_property_id resolved (the
-- orphaning bug left some unlinked, and pg_property_id was NOT NULL), so some
-- detail rows have no parent in pg_listings yet. This migration:
--   (a) relaxes pg_listings.pg_property_id to nullable (legacy orphans),
--   (b) backfills a head for EVERY listing that has PG detail children,
--   (c) re-points both detail FKs to pg_listings(id).
-- Atomic (the runner wraps each file in a transaction) and idempotent.

-- (a) Legacy/orphaned PG listings may have no property link.
ALTER TABLE pg_listings ALTER COLUMN pg_property_id DROP NOT NULL;

-- (b) Ensure every listing that owns PG detail children has a pg_listings head.
--     id stays 1:1 with the listings projection row (same id). pg_property_id is
--     recovered from the row, else the operator's primary property, else NULL.
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
WHERE l.id IN (
        SELECT listing_id FROM pg_details
        UNION
        SELECT listing_id FROM pg_room_types
      )
  AND NOT EXISTS (SELECT 1 FROM pg_listings pl WHERE pl.id = l.id)
ON CONFLICT (id) DO NOTHING;

-- (c) Every detail child now has a parent in pg_listings → re-point the FKs.
ALTER TABLE pg_details
  DROP CONSTRAINT IF EXISTS pg_details_listing_id_fkey;
ALTER TABLE pg_details
  ADD CONSTRAINT pg_details_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES pg_listings(id) ON DELETE CASCADE;

ALTER TABLE pg_room_types
  DROP CONSTRAINT IF EXISTS pg_room_types_listing_id_fkey;
ALTER TABLE pg_room_types
  ADD CONSTRAINT pg_room_types_listing_id_fkey
    FOREIGN KEY (listing_id) REFERENCES pg_listings(id) ON DELETE CASCADE;
