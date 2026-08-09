-- 0070: CRIBLIV TIMES byline rebrand — "Aditi Sharma" (invented persona) ->
-- "Cribliv Data Desk" (honest house byline; the reports are AI-assisted and
-- data-driven, and the byline should say so, not fake a journalist).
--
-- Pairs with the web/app constant change (EDITORIAL_AUTHOR in
-- apps/web/lib/blog-author.ts + apps/api/src/modules/blog/blog.types.ts) and a
-- 301 from /blog/author/aditi-sharma to /blog/author/cribliv-data-desk. The web
-- maps legacy names at render time, so deploy order does not matter here.

ALTER TABLE blog_posts
  ALTER COLUMN author SET DEFAULT 'Cribliv Data Desk';

UPDATE blog_posts
SET author = 'Cribliv Data Desk'
WHERE author = 'Aditi Sharma';
