# Codex Handoff — Slice 2: Indexing + Measurement

You are building **Slice 2 (Indexing + Measurement)** of the Cribliv SEO program, task-by-task. This file is the operational context the plan does not contain.

## 1. Read first (all on `master`)
1. **This file.**
2. `docs/superpowers/plans/2026-07-04-slice2-indexing-measurement-plan.md` — **THE plan** (15 tasks, TDD with full code per step). Always read its header + **Global Constraints**, then work task-by-task.
3. `docs/superpowers/specs/2026-07-04-slice2-indexing-measurement-design.md` — the "why" (optional).
4. `docs/superpowers/specs/2026-07-04-cutover-seo-runbook-design.md` — how this slice *activates* at the v1→v2 cutover (context only; not part of the build).
5. **Reference implementation — slice 1 is on `master`, copy its patterns:** DB-only SEO service (`apps/api/src/modules/seo/seo-city-config.service.ts`), admin controller (`apps/api/src/modules/admin/admin-seo.controller.ts` — `@Roles("admin")`, `admin_actions` audit, `deterministicUuid`), the worker (`apps/api/src/worker/worker.ts` — periodic `setInterval` jobs + `outbound_events` handlers), feature flags (`apps/api/src/config/feature-flags.ts`), admin tab registration (`apps/web/components/admin/shell/AdminSidebar.tsx` + `AdminShell.tsx`), admin API client (`apps/web/lib/admin-api.ts`).

## 2. Branch + current state
- Work on a **NEW branch off `master`** (e.g. `feat/seo-slice2-indexing`). Do **NOT** push to `master` (a hook blocks it); open a PR when done.
- `master` is current through **PR #17**. Slice 1 (city expansion) shipped; Noida + NCR city data merged; the highest migration is **`0044`** (PostGIS).
- **One agent per working tree.** If another agent is active in this repo, use your own branch/worktree — never share a branch (that caused collisions before).

## 3. ⚠️ DATABASE SAFETY — READ BEFORE ANY DB COMMAND
- `apps/api/.env` `DATABASE_URL` = **Azure PRODUCTION**. NEVER run migrate / seed / DB-tests against it.
- There is no root `.env`, and the migration runner reads the shell `DATABASE_URL`, so a bare `pnpm db:migrate` / `db:seed` **ERRORS** ("DATABASE_URL is required") — that's the safety net. Always pass a LOCAL override:
  - **DEV:** `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2'`
  - **TEST:** `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test'`
- Local Postgres (PG16 + PostGIS + pgvector) is running; both DBs are migrated; `node_modules` installed. Do NOT edit `apps/api/.env`.

## 4. Slice-2-specific rules
- **Build behind flags, mock all Google calls.** `FF_SEO_INDEXING` + `FF_SEO_GSC` default **OFF**. You do NOT need live Google credentials to build slice 2 — **every Google API call (Search Console + Indexing) is MOCKED in tests**. The service account + `GSC_SERVICE_ACCOUNT_JSON` get wired at the cutover, not now.
- **Migration numbering:** highest on master is `0044`. Before writing each migration, run `ls infra/migrations/ | sort | tail -5` and use the **next-free** number. Slice 2 adds two migrations (`seo_indexing_queue`, `keyword_rankings`) → likely `0045`, `0046`. Ship a paired `.rollback.sql` for each, and update every `readFileSync`/filename reference in the tests to the real numbers.
- **Do NOT** submit the sitemap, wire live creds, or run anything against prod — those are one-time manual **cutover** steps (in the runbook), not build tasks.

## 5. Running tests
- **Unit (no DB):** `pnpm --filter @cribliv/api exec vitest run test/<file>.test.ts`
- **Integration (needs DB):** prefix with `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test'`. **Run migration-applying integration files ONE AT A TIME** (a pre-existing cross-file race under vitest's threaded pool). Integration files live at `apps/api/test/*.integration.test.ts`, end in `.test.ts`, and are `describe.runIf(!!TEST_DATABASE_URL)`.
- **Typecheck / build:** `pnpm --filter @cribliv/api typecheck`, `pnpm --filter @cribliv/web typecheck`, `pnpm --filter @cribliv/web build`.

## 6. Known PRE-EXISTING failures — ignore, not yours
Full API suite has ~9 pre-existing failures (`auth-d7`, `pg-funnel`, `voice-agent-pg` — external-service/env deps). Web unit has ~7 (`ListingHealthCard`, `FunnelConversion` — PG dashboard). None relate to slice 2. Your bar: your new tests pass and you add **no new** failures.

## 7. Per-task loop
1. Read §3 (DB safety) + the plan's Global Constraints + your task.
2. Follow the task's TDD steps exactly (test first → red → implement → green). Local DB overrides only; mock Google.
3. Commit per the task's commit step (end with the `Co-Authored-By` trailer used on this repo).
4. When all tasks + the final verification are green, open a PR into `master`. Do not push `master` directly.

## 8. Quality note
Slice 1 was built with an independent reviewer after each task — it caught a binary-file defect and a missing interface field that TDD alone missed. Codex self-tests via the TDD steps, but consider a review pass (a `git diff` review, or `/code-review`) before merging — especially the worker jobs (quota gating / backoff) and the service-account auth.
