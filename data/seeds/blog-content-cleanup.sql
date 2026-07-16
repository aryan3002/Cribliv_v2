-- ─────────────────────────────────────────────────────────────────────────────
-- CRIBLIV TIMES — blog content cleanup (run ONCE against PRODUCTION)
--
-- Counterpart to data/seeds/blog-demo-seed.sql. The demo seed inserted four
-- hand-written PUBLISHED placeholder posts (slug `demo-%`) so the blog looked
-- populated at launch. Real generated/edited posts now exist, so the demo posts
-- should stop being served: they are thin, obviously-placeholder ("demo-…"
-- slugs), and currently indexable — they dilute topical authority and read as
-- unfinished to search engines.
--
-- This is NOT a migration (it lives in data/seeds/, which the migration runner
-- ignores) and is NOT auto-applied. Run it deliberately against prod:
--
--   DATABASE_URL="$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '\"')" \
--     psql "$DATABASE_URL" -f data/seeds/blog-content-cleanup.sql
--
-- Everything is wrapped in a transaction and prints affected rows. Review the
-- NOTICE output before it commits.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Retire the four demo posts. ARCHIVE (not DELETE) so the action is
--    reversible and the rows stay for reference. Archived posts are excluded
--    from every published query (blog.service.ts filters status = 'published'),
--    so they immediately drop out of /blog, the sitemap, and search results,
--    and their URLs return 404 (Google then drops them from the index).
--
--    These posts carry negligible SEO equity (placeholder content live only
--    since launch), so a 404 is fine — no redirects needed. If you would rather
--    hard-delete (as blog-demo-seed.sql documents), swap the UPDATE for:
--      DELETE FROM blog_posts WHERE generated_by = 'manual' AND slug LIKE 'demo-%';
--    psql prints each archived slug from the RETURNING clause — review that
--    list (expect the four demo-% posts) before COMMIT.
UPDATE blog_posts
   SET status = 'archived', updated_at = now()
 WHERE generated_by = 'manual'
   AND slug LIKE 'demo-%'
   AND status <> 'archived'
RETURNING slug, status;

-- 2) OPTIONAL — fix the misspelled slug `full-rental-senario` → `…-scenario`.
--    This is REAL content (~1300 words), so we rename rather than remove.
--    ⚠️  A rename makes the OLD indexed URL (/{en,hi}/blog/full-rental-senario)
--        404 unless a 301 redirect is added in the app first. Only uncomment
--        this AFTER the matching redirect is deployed (ask Claude to add it),
--        otherwise leave the slug as-is — a typo in a slug is cosmetic and the
--        page currently serves 200.
--
-- UPDATE blog_posts
--    SET slug = 'full-rental-scenario', updated_at = now()
--  WHERE slug = 'full-rental-senario';

COMMIT;

-- After committing: the blog sitemap (fetchAllBlogSlugs → published only)
-- regenerates on its next ISR revalidate, so the archived URLs leave the
-- sitemap automatically. No app deploy required for step 1.
