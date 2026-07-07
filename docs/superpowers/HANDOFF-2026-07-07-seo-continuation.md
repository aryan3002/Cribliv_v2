# SEO Program — Continuation Handoff (2026-07-07)

Hand this to a fresh chat to continue the Cribliv v2 SEO work. It's self-contained.

---

## TL;DR — where things stand

All three planned SEO slices are **built, reviewed, merged to `master`, and deployed**. The **prod DB is migrated to `0049`** (the user ran it 2026-07-07). Everything new is **dormant behind OFF feature flags** and will only start driving traffic at the **v1→v2 cutover to cribliv.com** (not done yet). The deployed admin (Search Performance, Blog Review) now loads cleanly with **empty data** — correct, because no blog content has been generated yet.

**The immediate open thread:** the user wants to _see the deployed blog populated_. Two options were offered and the user hasn't picked (see §5).

---

## 1. What's built + merged + deployed

| Slice      | What                                                                                                                                                                                                         | PRs     | State                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------- |
| 1          | Programmatic city pages (`seo_city_config`, 6 templates, thin-content noindex, sitemap)                                                                                                                      | #4 etc. | live                                                    |
| 2          | Indexing + measurement — GSC poller → `keyword_rankings`, Indexing API submitter → `seo_indexing_queue`, `GoogleServiceAuth`, admin **Search Performance** tab                                               | #19     | deployed, behind `FF_SEO_INDEXING` / `FF_SEO_GSC` (off) |
| 3 (engine) | Blog engine — migrations 0046–0049, `ApiKeyGuard`, DB-only `BlogService`, anti-slop quality gate, multi-step data-grounded generator, atomic-claim briefs, topic planner, embeddings, worker jobs, admin API | #21     | deployed, behind `FF_SEO_BLOG` (off)                    |
| 3 (web)    | **CRIBLIV TIMES** — hub/article/author/desk pages, serif "Cribliv Times" nav chip, blog sitemap chunk, admin **Blog Review** queue, Article/FAQPage/Breadcrumb/Person JSON-LD                                | #22     | deployed                                                |

Codex built slice 2 + the slice-3 engine (Tasks 1–18); Claude reviewed/fixed/merged each and built the slice-3 web (Tasks 19–24). Review found + fixed 2 MAJOR engine defects (non-data posts couldn't pass the gate; a claimed brief could orphan in `generating`) + minors; all documented in the PRs.

---

## 2. Deployment topology (important)

- **API** — NestJS, deployed to **Azure Container Apps** app `cribliv-api` (resource group `Cribliv`, ACR `criblivacr`). Auto-deploys on **every push to `master`** via `.github/workflows/ci.yml` → `deploy-api` job (`az acr build` → `az containerapp update`). Confirmed `success` on #21 + #22. The API queries the DB fresh per request (no restart needed after a migration).
- **Web** — Next.js 14, deployed to **Vercel** project `cribliv-v2-web` (auto-deploys `master`). URL: `cribliv-v2-web.vercel.app` — **this is an SEO DEAD-END**; SEO only counts after cutover to cribliv.com.
- **Prod DB** — Azure Postgres, **at migration `0049`**. Has postgis + pgcrypto but **NOT `vector`** (so `blog_embeddings` from 0049 was skipped gracefully — related-posts falls back to non-vector). Standalone **worker** (`pnpm --filter @cribliv/api worker`) runs the periodic jobs incl. blog planner/generator — deployment of the worker is NOT covered by `deploy-api` (verify separately if the blog jobs need to run on a schedule).

---

## 3. CRITICAL constraints & safety (do NOT violate)

- **`apps/api/.env` `DATABASE_URL` = Azure PRODUCTION.** NEVER run migrate/seed/DB-tests against it from the sandbox. The Claude Code **prod-write guard hard-blocks** it (correctly) — **the USER must run all prod writes** (they run the command; you prepare it). Read-only prod checks (e.g. `psql ... -tAc "SELECT to_regclass(...)"`) are allowed and useful for diagnosis.
- **Local DB overrides:** DEV `postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2`, TEST `postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test`. For a clean DB test, create a throwaway DB and drop it.
- **v2 prod DB users are TEST accounts** (~43), not real traction — real traction is on **v1**. Still: additive/idempotent migrations only; never `db:seed` prod (it inserts dev users).
- **PR flow required:** branch → PR → **squash-merge** (guard blocks direct `master` push). End commits with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Next.js `typedRoutes: true`** — local `pnpm --filter @cribliv/web typecheck` is flaky (stale `.next/types` when the dev server is running; dynamic `Link` hrefs to not-yet-compiled routes error). **CI (`next build`) is the source of truth.** Google Fonts (Fraunces) don't load in the sandbox → the nameplate falls back to Georgia locally but loads real Fraunces in prod. The preview screenshot tool glitched into a 1px loading-bar this session; use DOM snapshots/`preview_eval` to verify instead.
- Migration runner (`infra/migrations/run-migrations.js`) is **idempotent** (tracks applied files in `schema_migrations`, per-file `BEGIN/COMMIT`, rollback-on-error) — safe to re-run. **Next free migration number: `0050`.**

---

## 4. Key files & docs map

**Blog web (CRIBLIV TIMES):**

- `apps/web/app/[locale]/blog/page.tsx` (hub), `[slug]/page.tsx` (article), `author/[authorSlug]/page.tsx`, `category/[categorySlug]/page.tsx`
- `apps/web/app/[locale]/blog/_components/Masthead.tsx` + `blog-format.ts`, `cribliv-times.module.css`
- `apps/web/lib/blog-api.ts` (client), `blog-author.ts` (editorial persona = "Aditi Sharma"), `structured-data.ts` (`buildArticle`)
- Header chip: `apps/web/components/header.tsx` (`nav-times`) + `apps/web/app/globals.css` (`.nav-times`)
- Admin: `apps/web/components/admin/tabs/BlogReviewTab.tsx`, registered in `admin/shell/AdminSidebar.tsx` + `AdminShell.tsx`; client fns in `apps/web/lib/admin-api.ts` (`fetchAdminBlogPosts`, `approve/publish/archiveBlogPost`)
- Sitemap: `apps/web/app/sitemap.ts` (blog chunk, kind `"blog"`, is LAST in `resolveChunks`)

**Blog engine (API):**

- `apps/api/src/modules/blog/**` — `blog.service.ts`, `blog-generator.service.ts`, `quality-gate.ts`, `blog-llm.ts`, `blog-topic-planner.service.ts`, `blog-brief.service.ts`, `blog-embedding.service.ts`, `blog.controller.ts` (public), `blog-internal.controller.ts` (worker-write, `ApiKeyGuard`), `admin-blog.controller.ts` (`@Roles("admin")`), `evergreen-seeds.ts`
- `apps/api/src/worker/blog-worker.ts` — `runBlogTopicPlanner`, `runBlogGenerator`, `runBlogEmbedSweep` (gated by `FF_SEO_BLOG`)
- Migrations `0046_blog_categories` … `0049_blog_embeddings` (+ slice 2's `0045`), `apps/api/src/modules/seo/seo-urls.ts`

**Docs:**

- Roadmap: `docs/superpowers/2026-07-04-seo-program-roadmap.md`
- CRIBLIV TIMES design spec: `docs/superpowers/specs/2026-07-07-cribliv-times-blog-design.md` (concept mock: claude.ai/code/artifact/92838bcc-39ea-4105-8772-52e7bf5256d7)
- Slice-3 plan: `docs/superpowers/plans/2026-07-04-slice3-blog-engine-plan.md`
- **Cutover runbook: `docs/superpowers/specs/2026-07-04-cutover-seo-runbook-design.md`**

---

## 5. THE OPEN THREAD — populate the deployed blog (pick up here)

The deployed blog is empty (0 posts) — expected, no content generated. User wants to _see it populated_. Two options offered, **user hasn't chosen**:

**Option 1 — generate real content (the intended flow; recommended).**

- Requires `AZURE_OPENAI_ENDPOINT` / `_API_KEY` / `_DEPLOYMENT` set on the **API** (Azure Container App) pointing to a chat deployment. User has a Microsoft Foundry with many models (gpt-5.x, claude, etc.). Slice-1 SEO copy likely already set these — verify via `readAiConfig`.
- Admin endpoints already exist: `POST /v1/admin/blog/plan` (planner → briefs), `POST /v1/admin/blog/generate-now` (generate a post — check `GenerateNowBody` shape in `admin-blog.controller.ts`), plus review actions.
- **Suggested build:** add a "Generate a post" button to `BlogReviewTab.tsx` + a `generateBlogNow` client fn in `admin-api.ts` hitting `generate-now`, so the user clicks → gets a real AI draft → Approve → Publish → live on `/en/blog`. Small, high-payoff.
- Fast-follows to know about (from the engine review, non-blocking, behind the flag): the generator does **2× LLM passes per post** (should generate-once + re-score — `blog-worker.ts` loop); the gate counts numeric tokens rather than asserting they equal the injected medians. Fix before heavy generation.

**Option 2 — quick demo seed (instant, no AI).**

- Insert a few `status='published'` rows into `blog_posts` (referencing `blog_categories` by slug) so `/blog` + Blog Review show content immediately. This is a **prod write → the USER runs it** (prepare the SQL; they execute, like the migration). A local example was used earlier (7 posts: Noida rents, near-Amity, Model Tenancy Act, etc.).

---

## 6. Working commands

```bash
# Tests (API, CI-mirror — never hits prod):
CI=1 DATABASE_URL= TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test" pnpm --filter @cribliv/api test
pnpm --filter @cribliv/web test           # web unit tests
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/web typecheck      # flaky w/ dev server running; trust CI

# Local blog integration (throwaway DB, apply full chain first):
#   createdb → DATABASE_URL=<throwaway> node infra/migrations/run-migrations.js → TEST_DATABASE_URL=<throwaway> vitest run test/blog-*.integration.test.ts → dropdb

# Read-only prod check (allowed):
PRODURL=$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')
PGCONNECT_TIMEOUT=8 psql "$PRODURL" -tAc "SELECT max(filename) FROM schema_migrations;"
```

Local preview earlier ran the API on local `cribliv_v2` (seeded) + web dev on port 3100; those servers may no longer be running.

---

## 7. The eventual cutover (the real activation — NOT done)

When v2 replaces v1 on **cribliv.com** (planned ~mid-July 2026), follow the **cutover runbook**. Essentials:

1. The v1→v2 data migration **MUST persist an old→new URL map** (irreversible prerequisite) → build the **301 redirect map**.
2. Point cribliv.com at v2; homepage stays `200` (protects brand traffic); 301s live at DNS flip.
3. Set API env: flip `FF_SEO_INDEXING`, `FF_SEO_GSC`, `FF_SEO_BLOG` **on**; add `GSC_SITE_URL=sc-domain:cribliv.com`, `GSC_SERVICE_ACCOUNT_JSON`, `GOOGLE_INDEXING_DAILY_QUOTA=200`, `SEO_SITE_BASE_URL=https://cribliv.com`.
4. Submit `https://cribliv.com/sitemap_index.xml` in GSC.
5. **Vercel/web needs NO new env** (`NEXT_PUBLIC_SITE_URL` defaults to `https://cribliv.com`).

---

## 8. Memory

Auto-memory carries context across chats (loaded via system-reminders): `seo-domain-cutover.md`, `seo-program-sequencing.md`, `cribliv-v2-rebuild-context.md`, `v2-prod-db-test-accounts.md`, `api-env-precedence-azure.md`, `prefers-pr-flow-for-integration.md`. Update these as work progresses.
