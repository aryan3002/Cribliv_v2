-- Rollback for 0048_blog_briefs.sql
DROP TRIGGER IF EXISTS trg_blog_briefs_touch ON blog_briefs;
DROP FUNCTION IF EXISTS blog_briefs_touch_updated_at();
DROP INDEX IF EXISTS uq_blog_briefs_keyword_pending;
DROP INDEX IF EXISTS idx_blog_briefs_status;
DROP TABLE IF EXISTS blog_briefs;
