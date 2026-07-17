-- Admin SEO copy control (Feature 1): audit-trail enum values for admins
-- generating / overriding / reverting the copy on programmatic SEO pages.
--
-- No new tables — copy writes target the existing seo_page_copy (AI cache) and
-- seo_page_overrides (manual) tables from 0026_seo_page_copy.sql. This only
-- teaches admin_actions how to describe the new admin operations so they show
-- up in the audit log alongside city toggles.
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'seo_copy';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'seo_copy_generate';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'seo_copy_generate_batch';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'seo_copy_override';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'seo_copy_revert';
