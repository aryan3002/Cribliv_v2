-- Rollback 0070: restore the persona byline and default.

ALTER TABLE blog_posts
  ALTER COLUMN author SET DEFAULT 'Aditi Sharma';

UPDATE blog_posts
SET author = 'Aditi Sharma'
WHERE author = 'Cribliv Data Desk';
