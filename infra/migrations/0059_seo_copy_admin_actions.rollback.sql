-- Rollback for 0059_seo_copy_admin_actions.sql
--
-- Postgres cannot DROP a value from an enum type once added, and other rows may
-- already reference these values. There is nothing safe to undo here: the added
-- admin_target_type / admin_action_type values are inert unless written, and the
-- application simply stops writing them when Feature 1 is reverted. No-op.
SELECT 1;
