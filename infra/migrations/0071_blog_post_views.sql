-- 0071: First-party CRIBLIV TIMES readership counts.
--
-- Article pages are ISR-cached, so the API's GET /blog/:slug sees at most one
-- request per cache window — server-side counting would undercount ~everything.
-- Instead the article page fires a client-side POST /blog/:slug/view once per
-- read, and this table stores per-day counts: totals for the admin conversion
-- table, a rolling window for the front page's "Most Read" box.

CREATE TABLE IF NOT EXISTS blog_post_views (
  post_id uuid NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  day     date NOT NULL,
  views   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, day)
);
