# Codex Handoff — City Expansion (resume at Task 8)

You are continuing a partially-executed implementation plan. Tasks 1–7 are done. Start at **Task 8**.

## 1. Read these first (in order)
1. **This file** (the operational context the plan does not contain).
2. `docs/superpowers/plans/2026-07-03-city-expansion-seo.md` — THE plan. ALWAYS read its **header**, **Global Constraints**, and **"Cross-cutting decisions locked by the adversarial reviews"** (7 numbered items). Then read only the task section(s) you are implementing in this chat.
3. `docs/superpowers/specs/2026-07-03-city-expansion-seo-design.md` — optional background ("why"). Skip if context is tight.

## 2. Current state — do NOT redo Tasks 1–7
- Branch: **`feat/seo-city-expansion`**. HEAD after Task 7 = **`b1addf3`**.
- Done & committed: T1 migration `0043_seo_city_config`; T2 its integration test; T3 pure generator helpers; T4 geocode `verifyPlace`; T5 `generate-city` CLI (draft→verify→emit); T6 generalized `seed.ts` loader + `seo_city_config` seed; T7 regression gate.
- Detailed log + per-task base commits + noted findings: **`.superpowers/sdd/progress.md`** (git-ignored working-tree file). Update it after each task.
- Remaining: **T8–T18** (API service + endpoints + flag, web gate + thin-content, sitemap, admin tab, Noida data, full-stack verify).

## 3. ⚠️ DATABASE SAFETY — READ BEFORE ANY DB COMMAND
- `apps/api/.env` `DATABASE_URL` points at **Azure PRODUCTION**. NEVER run migrate / seed / DB tests against it.
- The shell has **no** `DATABASE_URL` and there is **no root `.env`**, so a bare `pnpm db:seed` / `pnpm db:migrate` will simply ERROR ("DATABASE_URL is required") — that is the safety net, not a bug. ALWAYS pass an explicit LOCAL override:
  - **DEV**  → `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2'` (migrated to 0043, seeded with Lucknow)
  - **TEST** → `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test'` (migrated to 0042; integration tests apply 0043 themselves)
- Local Postgres (PG16 + PostGIS + pgvector) is running; both DBs exist and are migrated; `node_modules` are installed. Do NOT edit `apps/api/.env`.

## 4. Running tests
- **Unit (no DB):** `pnpm --filter @cribliv/api exec vitest run test/<file>.test.ts`
- **Integration (needs DB):** prefix with `TEST_DATABASE_URL='...cribliv_test'`. **Run integration files ONE AT A TIME** (separate invocations) — there is a *pre-existing* cross-file race: multiple migration-applying integration files under vitest's threaded pool clobber each other's tables. This is not yours to fix; just isolate.
- **Web:** `pnpm --filter @cribliv/web build` / `pnpm --filter @cribliv/web test` (Playwright).
- Integration test files live at `apps/api/test/*.integration.test.ts`, end in `.test.ts` (never `.spec.ts`), and are `describe.runIf(!!TEST_DATABASE_URL)`.

## 5. Known PRE-EXISTING failures — ignore, they are not yours
Full API suite currently: ~1538 passing, 9 failing. All 9 are pre-existing/unrelated (`auth-d7`, `pg-funnel`, `voice-agent-pg` — external-service/env dependent). None of the plan's code is imported by them. Your only bar: your new tests pass and you add **no new** failures.

## 6. Task dependency order (why you cannot freely reorder)
```
T8  SeoCityConfigService (DB-only) ──► T9  wire into SeoModule + GET /v1/seo/cities
                                   └──► T11 admin GET + audited PATCH /v1/admin/seo/cities
T10 feature flag ff_programmatic_seo_cities_enabled   (independent)
T9/T11 ──► T12 API regression + typecheck + build gate
T13 fetchEnabledCities() (Set<string>, Lucknow fallback) ──► T14 gate + thin-content noindex across the 6 templates
                                                        └──► T15 sitemap (per-city chunks + hand-written <sitemapindex>)
T11 + T13 ──► T16 admin "Programmatic SEO" tab
T17 generate + REVIEW + seed Noida  (HUMAN-IN-LOOP; live Azure + Google; a human reviews the drafted data before commit; never auto-enable a city)
T18 full-stack verification         (LAST — needs everything)
```

## 7. Per-task loop (every chat)
1. Read §3 (DB safety), the plan's Global Constraints, the Cross-cutting decisions, and your task section.
2. Follow the task's TDD steps exactly (test first → red → implement → green). Use LOCAL DB overrides for every DB command.
3. Commit with the task's commit message (end with the `Co-Authored-By` trailer already used on the branch).
4. Append `Task N: complete (commits <base7>..<head7>)` to `.superpowers/sdd/progress.md`, and record the new HEAD so the next chat knows its base.
5. Do NOT push to `master` (a hook blocks it); stay on `feat/seo-city-expansion`.

## 8. Quality note
This plan was executed for T1–7 with an independent reviewer after each task (it caught a binary-file defect and a missing interface field). Codex will self-test via the TDD steps, but there is no second-set-of-eyes review in that loop. Consider running a review pass on each task's diff (a `git diff` review, or hand the diff back to Claude Code / `/code-review`) before moving on — especially for T14 (6 templates), T15 (sitemap), T17 (Noida data).
