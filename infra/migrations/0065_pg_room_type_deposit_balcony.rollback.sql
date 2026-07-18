ALTER TABLE pg_room_types DROP CONSTRAINT IF EXISTS pg_room_types_identity_uniq;
ALTER TABLE pg_room_types
  ADD CONSTRAINT pg_room_types_listing_id_sharing_ac_bathroom_kind_furnishing_key
  UNIQUE (listing_id, sharing, ac, bathroom_kind, furnishing);
ALTER TABLE pg_room_types
  DROP COLUMN IF EXISTS has_balcony,
  DROP COLUMN IF EXISTS security_deposit_paise,
  DROP COLUMN IF EXISTS deposit_refundable_pct;
