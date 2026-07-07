-- Rollback for 0046_blog_categories.sql
DROP TRIGGER IF EXISTS trg_blog_categories_touch ON blog_categories;
DROP FUNCTION IF EXISTS blog_categories_touch_updated_at();
DROP TABLE IF EXISTS blog_categories;
