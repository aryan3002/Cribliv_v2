# SEO City Review Console — Implementation Plan

> **For agentic workers:** implement task-by-task; each task ends with tests + a commit. TDD, no placeholders.

**Goal:** Turn the admin Programmatic SEO tab into a review-and-approve console — always-accurate counts, a per-city drill-in showing real localities/landmarks/metro, admin-only page preview, and approve-with-notes.

**Spec:** `docs/superpowers/specs/2026-07-04-seo-review-console-design.md`

## Global Constraints

- Next.js 14.2.13; NestJS; DB-only SEO services (guard on `DatabaseService.isEnabled()`).
- Reuse existing endpoints for drill-in data: `GET /seo/localities/:city`, `GET /landmarks/:city`, `GET /map/metro?city=`. No new data endpoints.
- Admin API routes stay `@UseGuards(AuthGuard, RolesGuard) @Roles("admin")`.
- DB safety: never run migrate/seed/tests against the Azure prod DATABASE_URL; local DEV = `postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2`, TEST = `...cribliv_test` (see `docs/superpowers/HANDOFF-codex.md`).
- Vitest tests end in `.test.ts(x)`; integration tests `describe.runIf(!!TEST_DATABASE_URL)`, run one file at a time.
- The admin-preview bypass MUST verify the admin session server-side. A bare `?adminPreview=1` from a non-admin/logged-out user MUST still 404.

---

## Task 1: API — live per-city counts in `listAllWithCounts`

**Files:**

- Modify `apps/api/src/modules/seo/seo-city-config.service.ts` (`listAllWithCounts`)
- Modify `apps/api/test/seo-city-config.service.test.ts`

**Approach:** keep the existing `cities LEFT JOIN seo_city_config` query for the base rows (name, status, enabled_at, notes), but replace the stored COALESCE count columns with **live** counts computed via the already-tested `computeCounts(citySlug)` merged in JS (`Promise.all` over the returned cities). Cities count is small (≤ tens) so O(cities) is fine. Result rows keep the same `SeoCityConfigWithCity` shape; only the count values become live.

- [ ] **Step 1:** Update the test `"lists every city with config defaults and refreshed count columns"` (and add a focused test) so that `listAllWithCounts` returns **live** counts: mock `aggregates.localitiesForCity`/`metroStationsForCity` + the landmark-count query, and assert the returned row's `locality_count`/`landmark_count`/`metro_count`/`indexable_count` come from `computeCounts`, not the stored columns. Assert the base query still selects `FROM cities` / `LEFT JOIN seo_city_config`.
- [ ] **Step 2:** Run it — expect FAIL. `pnpm --filter @cribliv/api exec vitest run test/seo-city-config.service.test.ts`
- [ ] **Step 3:** Implement: fetch base rows (name/status/enabled_at/notes) via the existing query (drop the reliance on stored count columns), then `const withCounts = await Promise.all(rows.map(async (r) => ({ ...r, ...(await this.computeCounts(r.city_slug)) })))`; return `withCounts`. Keep DB-disabled guard returning `[]`.
- [ ] **Step 4:** Run — expect PASS. Also run the full service test file (existing tests green).
- [ ] **Step 5:** Commit.

---

## Task 2: Web — admin preview gate (`isAdminPreview` + 6 templates); fixes soft-404

**Files:**

- Create `apps/web/lib/admin-preview.ts`
- Create `apps/web/lib/__tests__/admin-preview.test.ts`
- Modify all 6 templates under `apps/web/app/[locale]/city/[citySlug]/` (both `generateMetadata` and the default component)

**Interfaces (produce):** `isAdminPreview(searchParams: { adminPreview?: string | string[] } | undefined): Promise<boolean>` — returns `false` immediately unless `adminPreview === "1"`; otherwise calls NextAuth `auth()` and returns `session?.user?.role === "admin"`. Never throws (auth failure → false).

- [ ] **Step 1:** Write `admin-preview.test.ts`: mock the `auth` module. Assert `isAdminPreview` → `false` when param absent (and `auth` NOT called), `false` for a non-admin session, `false` for null session, `true` only for `adminPreview:"1"` + `role:"admin"`. Handles `adminPreview` as string or `["1"]`.
- [ ] **Step 2:** Run — expect FAIL (missing module).
- [ ] **Step 3:** Implement `apps/web/lib/admin-preview.ts` (import `auth` from `../auth`; short-circuit on the param before calling `auth()`; wrap `auth()` in try/catch → false).
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** In EACH of the 6 templates: add `searchParams` to both `generateMetadata({ params, searchParams })` and the page component signature; change the enabled gate in BOTH to `if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) notFound();`. Putting it in `generateMetadata` makes disabled non-preview requests return a hard 404 (fixes the soft-404). Ensure preview pages remain `noindex` (they are, via existing thin/notFound behavior) — do not add them to the sitemap (unchanged).
- [ ] **Step 6:** `pnpm --filter @cribliv/web typecheck` clean; existing web tests green.
- [ ] **Step 7:** Commit.

---

## Task 3: Web — city review drawer + wiring + notes

**Files:**

- Create `apps/web/components/admin/tabs/SeoCityReviewDrawer.tsx`
- Modify `apps/web/components/admin/tabs/SeoProgrammaticPages.tsx` (row click opens the drawer; pass selected city)
- Add client fetchers to `apps/web/lib/admin-api.ts`: `listCityLocalities`, `listCityLandmarks`, `listCityMetro` (call the public `/seo/localities/:city`, `/landmarks/:city`, `/map/metro?city=` via `fetchApi`)
- Create `apps/web/components/admin/tabs/__tests__/SeoCityReviewDrawer.test.tsx`

**Drawer spec:** opens for a selected `SeoCityConfigVm`. Header: city name, Live/Draft badge, the live counts, enabled date, notes. Three tabs (Localities / Landmarks / Metro), each: a search box + a `DataTable` of the fetched rows. Localities columns: name (en/hi), listing count, **indexable** (✓ when `listing_count >= 3` else ✗), lat/lng, **Preview** (opens `/{locale}/city/{city}/{localitySlug}?adminPreview=1` in a new tab). Landmarks: name, type, lat/lng, Preview (`/near/{slug}?adminPreview=1`). Metro: station, line, lat/lng, Preview (`/metro/{stationSlug}?adminPreview=1`, slug = `name.toLowerCase().replace(/[^a-z0-9]+/g,"-")` — match the existing metroSlug rule, no hyphen trim). Footer: a notes `<textarea>` + Enable/Disable button that calls `setSeoCityEnabled(accessToken, citySlug, nextEnabled, notes)` and closes/refreshes on success. Loading + error states per tab. Accessibility: labelled buttons, Escape closes.

- [ ] **Step 1:** Write `SeoCityReviewDrawer.test.tsx`: given a city + mocked `listCityLocalities/Landmarks/Metro`, renders the localities tab rows, shows indexable ✓/✗ by listing count, a Preview link href contains `?adminPreview=1`, switching tabs fetches landmarks/metro, and clicking Enable with notes calls `setSeoCityEnabled(token, slug, true, "<notes>")`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Add the client fetchers to `admin-api.ts`; implement the drawer; wire `SeoProgrammaticPages` to open it on row click (keep the inline toggle too, or move toggle into the drawer — keep the row toggle for quick actions AND the drawer for review).
- [ ] **Step 4:** Run drawer test + existing `SeoProgrammaticPages`/admin-shell tests — all PASS. `pnpm --filter @cribliv/web typecheck` clean.
- [ ] **Step 5:** Commit.

---

## Task 4: Full verification + local demo

- [ ] `pnpm --filter @cribliv/api typecheck && pnpm --filter @cribliv/web typecheck` — clean.
- [ ] `pnpm --filter @cribliv/api build && pnpm --filter @cribliv/web build` — clean.
- [ ] `pnpm --filter @cribliv/api test` and `pnpm --filter @cribliv/web exec vitest run` — only the known pre-existing failures (API 9, web 7); nothing new.
- [ ] Local run (API on DEV DB + web): admin tab → Lucknow now shows real counts (not 0); click Noida → drawer shows 41 localities / 19 landmarks / 21 metro + indexable flags; a Noida locality **Preview** returns 200 as admin while the same URL (no param) returns **404** to the public; enabling Noida with a note works + is audited.
- [ ] Commit any verification harness; open PR into master.
