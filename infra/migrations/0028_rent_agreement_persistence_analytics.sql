-- ─── Migration 0028: Rent Agreement persistence + analytics indexes ──────────
-- Indexes only — no new tables, no schema changes.
--
-- The rent-agreement module is being wired from in-memory storage to Postgres
-- (migration 0024 already created the 8 tables). These indexes support the admin
-- analytics dashboard read paths. PDF bytes go to Azure Blob, so no DB blob
-- table is needed here.
--
-- Spec: docs/superpowers/specs/2026-05-21-rent-agreement-admin-analytics-design.md §A.2

BEGIN;

-- Admin agreement list: filter by status, newest first.
CREATE INDEX IF NOT EXISTS idx_rent_agreements_admin_list
  ON rent_agreements (status, created_at DESC);

-- Plan split (count + revenue grouped by plan).
CREATE INDEX IF NOT EXISTS idx_rent_agreements_plan_status
  ON rent_agreements (plan_id, status);

-- Abandoned-draft scan: status='draft' AND updated_at < cutoff.
CREATE INDEX IF NOT EXISTS idx_rent_agreements_abandoned
  ON rent_agreements (updated_at)
  WHERE status = 'draft';

-- Global time-series (daily new drafts / completions over a window).
CREATE INDEX IF NOT EXISTS idx_rent_agreements_created_at
  ON rent_agreements (created_at);

-- Session counting: distinct users who triggered ra.session_started.
CREATE INDEX IF NOT EXISTS idx_ra_event_log_session
  ON rent_agreement_event_log (user_id, created_at)
  WHERE event_name = 'ra.session_started';

-- Funnel aggregation across all agreements (step + outcome over a window).
CREATE INDEX IF NOT EXISTS idx_ra_step_audit_funnel_agg
  ON rent_agreement_step_audit (step, outcome, created_at);

COMMIT;
