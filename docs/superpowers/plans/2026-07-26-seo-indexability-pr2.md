# SEO Indexability PR 2 — Make Supply Count

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (or subagent-driven-development). Steps use checkbox (`- [ ]`) syntax.
>
> **This plan is condensed** relative to `2026-07-26-seo-indexability-pr1.md`: task boundaries, interfaces and test intent are specified, but not every keystroke, because it is being executed inline by an agent that already holds the codebase context. A fresh agent should read the spec sections referenced per task before starting.

**Goal:** Make incoming NCR supply actually promote pages into the index, and stop the remaining honesty gaps between what a page claims and what it renders.

**Architecture:** A locality's listing count becomes "self plus all descendants" via one recursive CTE, applied identically in the aggregates query (which drives `indexable`) **and** in the search filter (which drives the rendered grid). Everything else in this PR removes a place where metadata contradicts content.

**Tech Stack:** NestJS + raw SQL, Postgres, Next.js 14 App Router, Vitest.

**Base branch:** `claude/programmatic-seo-page-25814e` (PR #121). This PR is stacked on it — merge #121 first.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-26-programmatic-seo-indexability-design.md` §4.2, §5 items 7–13.
- **The consistency invariant is the whole point.** If the rollup makes a parent indexable, the parent's page must render those listings. Count semantics and search-filter semantics must be byte-identical in depth behaviour. A test must assert this directly, not by inspection.
- **One depth rule, expressed once.** Both call sites use the same recursive CTE shape: seed on `slug`, recurse on `parent_locality_id`. Never let one side become parent-only.
- `COUNT(DISTINCT l.id)` over the subtree — a listing must not be counted twice.
- DB dual-mode: safe empty return when `isEnabled()` is false; `try/catch` → empty on SQL failure.
- Threshold comes from `INDEXABLE_MIN_LISTINGS` (`@cribliv/shared-types`) only.
- Do **not** run the full API suite against a real DB (migration 0045's rollback drops `keyword_rankings` / `seo_indexing_queue`).
- Commit after every task.

---

### Task 1: Hierarchy rollup in the locality count

**Files:** `apps/api/src/modules/seo/seo-aggregates.service.ts`; test `apps/api/test/seo-aggregates.rollup.test.ts`

**Produces:** `localitiesForCity` rows gain `own_listing_count: number`; `listing_count` becomes the rolled-up total.

- [ ] Write failing tests: parent with two children holding 2 each → parent `listing_count: 4`, `own_listing_count: 0`, children `2`; SQL contains `WITH RECURSIVE` and `COUNT(DISTINCT`.
- [ ] Implement the recursive CTE (spec §4.2). Keep `ORDER BY listing_count DESC, name_en ASC`.
- [ ] Verify pass; `pnpm typecheck`.
- [ ] Commit.

### Task 2: Matching rollup in the search locality filter

**Files:** `apps/api/src/modules/search/search.service.ts` (filter ~L450, count-join ~L607); test `apps/api/test/search-locality-rollup.test.ts`

**Interfaces:** consumes nothing; the `locality=` filter must select `ll.locality_id IN (subtree of slug)`.

- [ ] Write failing test: `locality=<parent>` produces SQL whose predicate is a `WITH RECURSIVE` subtree over `ll.locality_id`, **not** `loc.slug = $n`.
- [ ] Write the invariant test: the depth expression used by the search filter and by `localitiesForCity` are the same shape (assert both SQL strings contain the same recursive seed/recurse clauses).
- [ ] Implement. The `LEFT JOIN localities loc` in `countFromSql` is no longer needed for filtering — only keep joins that output columns.
- [ ] Verify pass; run the full search test suite (it is large and load-bearing).
- [ ] Commit.

### Task 3: Intent pages use their filtered count for `noindex`

**Files:** `apps/web/app/[locale]/city/[citySlug]/[locality]/[intent]/page.tsx` (~L66), `.../metro/[station]/[intent]/page.tsx` (~L71), `.../near/[landmark]/[intent]/page.tsx` (~L71)

Today each inherits the **parent's unfiltered** total, so `/gomti-nagar/under-5000` claims `index` while rendering an empty grid — ~520 URLs whose metadata contradicts their content.

- [ ] Write failing tests asserting `noindex` when the intent-filtered total is below threshold even though the parent's total is above it.
- [ ] Implement: metadata must derive from the same filtered count the page renders. Where `generateMetadata` cannot see the filtered count without a second fetch, fetch it — correctness over one request.
- [ ] Verify; commit.

### Task 4: City hubs stop being unconditionally indexable

**Files:** `apps/web/app/[locale]/city/[citySlug]/page.tsx` (generateMetadata ~L62, `CITIES` ~L44, `CITY_LOCALITIES` fallback ~L226), `apps/web/app/sitemap.ts` (`HUB_CITIES` ~L24)

- [ ] Write failing tests: a hub for a city with no inventory is `noindex`; `HUB_CITIES` derives from the enabled set, not a literal array; the invented `["Sector 1","Sector 2","Central"]` fallback is gone.
- [ ] Implement. Hub threshold is **city-wide** active inventory (hubs legitimately aggregate), not per-locality.
- [ ] Verify; commit.

### Task 5: City hub rails stop linking to phantom metro stations (spec 11b)

**Files:** `apps/web/app/[locale]/city/[citySlug]/page.tsx`, `.../[locality]/page.tsx`, `.../metro/[station]/page.tsx`

PR 1 removed `/map/metro` from the sitemap but these rails still call `fetchMetroStationsForCity`, so Faridabad's hub keeps internally linking to `/metro/kashmere-gate`. Google follows internal links.

- [ ] Write failing test: the hub's metro rail renders only stations present in `fetchCityPlaces`.
- [ ] Repoint the rails at `fetchCityPlaces`. Decide per rail whether to show only `indexable` stations or all real ones — real-but-thin is acceptable for an internal rail; phantom is not.
- [ ] Verify; commit.

### Task 6: Title double-brand and duplicate robots tag

**Files:** `apps/web/lib/seo.ts` (`buildPageMetadata`, robots ~L39), `apps/web/app/layout.tsx:54` (`title.template = "%s | Cribliv"`), the six page templates

Confirmed mechanism: page titles already end in `— Cribliv` and the template appends `| Cribliv`.

- [ ] Write failing tests: a built title contains `Cribliv` exactly once; a not-found page emits exactly one `robots` meta.
- [ ] Implement: strip the brand from page-level titles, let the template add it once.
- [ ] Verify; commit.

### Task 7: Admin metrics become decision-grade

**Files:** `apps/web/components/admin/tabs/SeoProgrammaticPages.tsx` (~L54), `apps/api/src/modules/seo/seo-city-config.service.ts` (`computeCounts`, `setEnabled` ~L146)

- [ ] Write failing tests: the `INDEXABLE` headline excludes draft cities; a "noindex URLs in sitemap" figure exists; `enabled_at` survives a disable→enable cycle.
- [ ] Implement: count indexable **URLs** (qualifying localities × (1 + their intents) + qualifying metro + qualifying landmarks, × 2 locales) rather than localities; preserve `enabled_at` with `COALESCE` on re-enable.
- [ ] Verify; commit.

### Task 8: `pnpm seo:audit` recurrence guard

**Files:** `apps/web/package.json`, `apps/web/scripts/seo-audit.ts` (create); test for the assertion logic

Samples N URLs from a sitemap index and asserts each returns 200, is not `noindex`, has a non-empty `<h1>`, and has a self-referential canonical. Every defect in the spec would have failed this on day one.

- [ ] Write failing unit tests for the per-URL verdict function (pure, no network).
- [ ] Implement the verdict function plus a thin CLI that fetches and reports; non-zero exit on any failure.
- [ ] Verify; commit.

### Task 9: Full verification

- [ ] `pnpm --filter @cribliv/shared-types build && pnpm typecheck`
- [ ] `pnpm --filter @cribliv/api test` and `pnpm --filter @cribliv/web test` — both fully green.
- [ ] Open PR with base `claude/programmatic-seo-page-25814e`, stating the rollup invariant and that the hub threshold is city-wide.

---

## Deliberately out of scope

- The HTTP-200 soft-404 root cause (spec §4.3) — its own task, hypothesis unverified.
- The 67% "other file type" crawl share (spec §8) — needs Vercel log verification first.
- Inventory-independent page content (rent benchmarks, commute, guides) — the next slice after PR 3.
