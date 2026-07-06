-- Rollback for 0047_blog_posts.sql
DROP TRIGGER IF EXISTS trg_blog_posts_touch ON blog_posts;
DROP FUNCTION IF EXISTS blog_posts_touch_updated_at();
DROP INDEX IF EXISTS idx_blog_posts_published;
DROP INDEX IF EXISTS idx_blog_posts_city_slug;
DROP INDEX IF EXISTS idx_blog_posts_target_keyword;
DROP INDEX IF EXISTS idx_blog_posts_status;
DROP TABLE IF EXISTS blog_posts;
