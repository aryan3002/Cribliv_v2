-- 0065: per-sharing security deposit + balcony on pg_room_types.
-- security_deposit_paise/deposit_refundable_pct were accepted by the DTO but had
-- no column (silent data loss); has_balcony is net-new. balcony becomes part of the
-- room-type identity so "double w/ balcony" and "double w/o" are distinct offerings.
ALTER TABLE pg_room_types
  ADD COLUMN IF NOT EXISTS has_balcony boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS security_deposit_paise bigint,
  ADD COLUMN IF NOT EXISTS deposit_refundable_pct smallint;

-- Rebuild the uniqueness to include has_balcony. Old auto-named constraint:
ALTER TABLE pg_room_types
  DROP CONSTRAINT IF EXISTS pg_room_types_listing_id_sharing_ac_bathroom_kind_furnishing_key;
ALTER TABLE pg_room_types
  ADD CONSTRAINT pg_room_types_identity_uniq
  UNIQUE (listing_id, sharing, ac, bathroom_kind, furnishing, has_balcony);
