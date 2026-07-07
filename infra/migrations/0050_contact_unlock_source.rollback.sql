-- Rollback 0050: remove the contact-unlock source attribution column + index.
DROP INDEX IF EXISTS idx_contact_unlocks_source;
ALTER TABLE contact_unlocks DROP COLUMN IF EXISTS source;
