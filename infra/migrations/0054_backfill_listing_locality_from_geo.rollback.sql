-- Rollback for 0054_backfill_listing_locality_from_geo.sql
--
-- This migration is a heuristic DATA backfill — it fills listing_locations.
-- locality_id where it was NULL by snapping each listing to its nearest
-- locality. There is no provenance column recording which rows it touched, so
-- it cannot be reversed precisely: a blanket "set locality_id = NULL" would also
-- wipe localities set legitimately by owners or by later imports.
--
-- Intentional no-op. If you must undo the backfill, do it deliberately against a
-- known snapshot/backup, or scope a manual UPDATE to the affected listings (e.g.
-- the v1-migrated rows) yourself. The migration runner never runs *.rollback.sql
-- automatically.

SELECT 1;
