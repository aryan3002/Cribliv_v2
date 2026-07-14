-- 0058_admin_action_verification_artifact_view.sql
-- Adds an admin_action_type enum value used to durably audit when an admin
-- mints a read-only SAS link to view a verification artifact (liveness clip
-- / electricity bill photo) via AdminReviewService.getVerificationArtifactLink.
-- Additive only.
--
-- Transaction safety: the migration runner (infra/migrations/run-migrations.js)
-- wraps each file in BEGIN/COMMIT. On Postgres 12+, ALTER TYPE ... ADD VALUE
-- is allowed inside a transaction as long as the new enum value is not used
-- within that same transaction. This migration only adds the value and does
-- not reference it in any DML, so it is safe to run inside the runner's
-- transaction wrapper.

ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'verification_artifact_view';
