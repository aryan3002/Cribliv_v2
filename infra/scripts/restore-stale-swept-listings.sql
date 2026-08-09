-- ═══════════════════════════════════════════════════════════════════════════
--  Restore listings auto-paused by the 2026-08-09 stale_listing_sweep wipe.
--
--  Context: the worker paused every active listing whose last_owner_activity_at
--  was >30 days old. That column only advances when an OWNER edits their own
--  listing, so migrated v1 inventory and admin-created homes went stale on a
--  timer and the whole catalogue was pulled from search in one run.
--
--  Run:  psql "$PROD_DATABASE_URL" -f infra/scripts/restore-stale-swept-listings.sql
--
--  Safe to run twice. Wrapped in a transaction with a guard that ABORTS if the
--  restore would touch listings the sweep did not pause.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

BEGIN;

-- ── 1. Before ──────────────────────────────────────────────────────────────
\echo '── Status breakdown BEFORE ──'
SELECT status, count(*) AS listings
  FROM listings
 GROUP BY status
 ORDER BY listings DESC;

-- ── 2. Scope ───────────────────────────────────────────────────────────────
-- Restore only listings the sweep itself flagged, so anything an admin paused
-- deliberately is left alone. The sweep writes a fraud_flags row per pause.
CREATE TEMP TABLE stale_swept ON COMMIT DROP AS
SELECT DISTINCT l.id
  FROM listings l
  JOIN fraud_flags f ON f.listing_id = l.id
 WHERE l.status = 'paused'
   AND f.flag_type = 'stale'
   AND f.created_at > now() - interval '3 days';

\echo '── Listings that will be restored ──'
SELECT count(*) AS to_restore FROM stale_swept;

-- Sanity guard. The sweep's fraud_flags inserts were fire-and-forget
-- (`.catch(() => {})`), so an empty scope means the audit trail is missing —
-- NOT that there is nothing to restore. Stop and investigate rather than
-- silently committing a no-op and declaring the outage fixed.
DO $$
DECLARE
  scoped   int;
  paused   int;
BEGIN
  SELECT count(*) INTO scoped FROM stale_swept;
  SELECT count(*) INTO paused FROM listings WHERE status = 'paused';

  IF scoped = 0 AND paused > 0 THEN
    RAISE EXCEPTION
      'No stale-flagged listings found but % are paused. The fraud_flags trail is incomplete — widen the scope manually after reviewing which listings were admin-paused.', paused;
  END IF;
END
$$;

-- ── 3. Restore ─────────────────────────────────────────────────────────────
-- Resetting last_owner_activity_at is REQUIRED. Without it these rows are still
-- >30 days stale and the next sweep run re-pauses them immediately.
UPDATE listings l
   SET status                 = 'active',
       last_owner_activity_at = now(),
       updated_at             = now()
  FROM stale_swept s
 WHERE l.id = s.id;

-- Close out the flags so the admin Fraud Feed does not keep showing them.
UPDATE fraud_flags f
   SET resolved_at = now()
  FROM stale_swept s
 WHERE f.listing_id = s.id
   AND f.flag_type = 'stale'
   AND f.resolved_at IS NULL;

-- ── 4. After ───────────────────────────────────────────────────────────────
\echo '── Status breakdown AFTER ──'
SELECT status, count(*) AS listings
  FROM listings
 GROUP BY status
 ORDER BY listings DESC;

\echo '── Active listings by city ──'
SELECT c.slug AS city, count(*) AS active
  FROM listings l
  JOIN listing_locations ll ON ll.listing_id = l.id
  JOIN cities c ON c.id = ll.city_id
 WHERE l.status = 'active'
 GROUP BY c.slug
 ORDER BY active DESC;

COMMIT;

\echo 'Done. Verify: curl -s "$API_BASE_URL/listings/search?limit=200" | jq ".data.total"'
