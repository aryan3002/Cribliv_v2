-- Rollback 0041: restore the one-primary-per-operator constraint shape ONLY.
--
-- WARNING: The per-listing property split performed by 0041 is NOT auto-reversible.
-- The cloned pg_property rows cannot be safely re-merged automatically. This
-- rollback is ONLY for fresh/empty databases where no split data exists.
--
-- This ALTER will FAIL with an exclusion violation if the database has >1
-- is_primary property for any operator (i.e. after the 0041 split has run on
-- real data). That is expected and correct — do not force it.
ALTER TABLE pg_properties
  ADD CONSTRAINT pg_props_one_primary_per_operator
  EXCLUDE (operator_id WITH =) WHERE (is_primary = true);
