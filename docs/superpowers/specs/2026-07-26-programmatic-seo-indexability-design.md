# Programmatic SEO — Indexability Correctness & City Buildout

**Date:** 2026-07-26
**Status:** design, awaiting approval
**Supersedes nothing.** Extends `docs/seo/city-expansion-runbook.md` and
`docs/superpowers/2026-07-04-seo-program-roadmap.md` (slices 1–2).

---

## 1. Problem

The programmatic SEO surface submits 33,176 URLs to Google. **540 of them can be
indexed.** The rest are soft 404s, cross-city duplicates, or ungated thin pages.
Google has already responded by cutting its crawl rate 93%.

Every number below was measured on production (cribliv.com) on 2026-07-25/26, not
inferred from code.

### 1.1 Sitemap composition

Five live city chunks, 32,864 URLs (plus core 72, listings 190, blog 50):

| City | Total | Locality | Metro | Landmark |
| ---------- | -----: | -------: | -----: | -------: |
| faridabad | 4,060 | 0 | 2,916 | 1,144 |
| ghaziabad | 7,358 | 0 | 6,318 | 1,040 |
| gurugram | 5,348 | 0 | 2,592 | 2,756 |
| lucknow | 5,886 | **540** | 1,134 | 4,212 |
| noida | 10,212 | 0 | 8,964 | 1,248 |
| **Total** | **32,864** | **540** | **21,924** | **10,400** |

Locality URLs are correctly inventory-gated (`sitemap-chunks.ts:77`). Metro and
landmark URLs are **not gated at all** — `buildCityMetroEntries`
(`sitemap-chunks.ts:92`) and `buildCityLandmarkEntries` (`:114`) never receive a
listing count. The existing test (`apps/web/app/__tests__/sitemap-chunks.test.ts:78`)
asserts thin *localities* are excluded and has no equivalent assertion for metro or
landmark, which is why the leak survived review.

### 1.2 The metro URLs are wrong, not merely thin

`apps/web/app/sitemap.ts:158` sources stations from `fetchMetroStationsForCity`,
which calls **`/map/metro?city=…`** (`apps/web/lib/seo-api.ts:240`). That endpoint
returns whole metro **lines** that touch a city — correct for drawing a map,
incorrect as a URL namespace. The admin panel instead uses
`SeoAggregatesService.metroStationsForCity` (exact city match). The two disagree:

| City | Stations per sitemap | Stations per admin |
| ---------- | -------------------: | -----------------: |
| faridabad | 54 | **0** |
| ghaziabad | 117 | **0** |
| gurugram | 48 | 11 |
| noida | 166 | 21 |
| lucknow | 21 | 21 |

Consequences, verified:

- `/en/city/faridabad/metro/kashmere-gate` → **HTTP 200**, `x-vercel-cache: HIT`,
  30,801-byte HTML with **no `<h1>` and no visible body text**, metadata title
  `Metro station not found | Cribliv`. A textbook soft 404.
- The same holds for `/en/city/ghaziabad/metro/kashmere-gate` and for a fabricated
  slug `/en/city/faridabad/near/definitely-not-a-real-landmark-xyz`.
- Noida's chunk contains the entire Delhi Blue + Aqua line (`rajiv-chowk`,
  `karol-bagh`, `kashmere-gate`, `old-faridabad`, `raja-nahar-singh`). Gurugram's
  contains the Yellow Line from `samaypur-badli`. So one station exists as a live
  page under four different cities.

Root cause of the 200: the page calls `notFound()` (`metro/[station]/page.tsx`), but
there is **no `not-found.tsx` anywhere in `apps/web/app`**, and the empty result is
ISR-cached and served as 200.

Structural cause of the data asymmetry: `metro_stations.city` is a bare `TEXT`
column with no FK to `cities` (`infra/migrations/0015_metro_stations.sql:5`), and
`data/seeds/seed.ts:166` globs every `metro-stations*.json` file. `load-city.ts`
deliberately never touches metro, so metro coverage is fully decoupled from
locality coverage.

### 1.3 Google's response (Search Console crawl stats, 90 days to 2026-07-24)

| Metric | Value |
| --------------------------- | -----------------------------: |
| Total crawl requests | 158,043 (+1,002 on `www`) |
| Requests in 12–24 Jul window | 153,898 (**97%**) |
| Peak day (16 Jul) | 40,745 |
| Latest day (24 Jul) | 2,758 (**−93%** from peak) |
| Purpose: refresh / discovery | 87.08% / 12.92% |
| Response: `OK (200)` | **98.80%** |
| Response: `404` | 0.32% |
| File type: HTML | 21.25% |
| File type: other | **67.05%** |
| Googlebot: desktop / smartphone | 72.42% / 8.48% |

Reading:

1. **The 12 Jul cutover bought a one-time crawl surge** — ~65 req/day to 40,745
   req/day in four days. Google asked to see everything.
2. **It sampled, then demoted.** 40,745 → 2,758 in eight days is crawl-budget
   withdrawal in progress, not a plateau.
3. **Discovery is starving.** 12.92% of 158,043 ≈ 20,400 discovery requests against
   33,176 submitted URLs — Google has not finished discovering the sitemap once,
   and the budget to do so is collapsing.
4. **The report is misleading by construction.** 98.8% `OK (200)` and a "No
   problems" host status exist *because* the broken pages return 200. Google gets no
   error signal to act on, so it devalues the domain instead of purging the URLs. If
   these returned 404, this table would show ~58% not-found and Google would drop
   them within days.

### 1.4 Scattered supply currently yields zero indexable pages

`SeoAggregatesService.localitiesForCity` (`seo-aggregates.service.ts:142`) counts
listings with `ll.locality_id = loc.id` — exact match, **no hierarchy rollup**.
Migration `0054_backfill_listing_locality_from_geo.sql` assigns each listing to its
*nearest* locality, frequently a micro-locality with `parent_locality_id` set.

So a parent locality with two micro-localities holding 2 listings each shows a count
of 0; each child shows 2; the threshold is 3; **six real listings produce zero
indexable pages.** Under the confirmed broad-NCR owner-acquisition push, this is the
default outcome — supply would land and the indexable count would stay flat.

This also inverts the SEO intent: "flats in Gomti Nagar" is the query with volume,
not "flats in Vipul Khand".

### 1.5 Threshold duplicated four times

`3` is independently hardcoded at:

- `apps/api/src/modules/seo/seo-city-config.service.ts:7` (`INDEXABLE_MIN`)
- `apps/api/src/modules/admin/admin-seo.controller.ts:32` (`MIN_LISTINGS`)
- `apps/web/app/sitemap-chunks.ts:7` (`THIN_LISTING_THRESHOLD`)
- `apps/web/components/admin/tabs/SeoCityReviewDrawer.tsx:278` (bare literal)

plus a bare literal in each of the six page templates' `generateMetadata`. Nothing
in `packages/shared-types` covers SEO, which is why the constant drifted.

### 1.6 Smaller confirmed defects

- **Double-branded titles.** Production returns
  `Rent Flats in Gomti Nagar, Lucknow — Cribliv | Cribliv`. A page-level title
  already carrying the brand is passed through a metadata template that appends it
  again. Directly suppresses non-brand CTR.
- **Duplicate `robots` tags.** Not-found pages emit both
  `<meta name="robots" content="noindex, follow">` and
  `<meta name="robots" content="noindex">`.
- **Admin metrics are not decision-grade.** `SeoProgrammaticPages.tsx:54` sums
  `indexableCount` across **draft** cities too; `indexable_count` counts only
  *localities* clearing the threshold and ignores metro, landmark and all 26 intent
  variants; "Cities configured" is `rows.length`, i.e. every row in `cities`.
- **Disabling a city wipes `enabled_at`** (`seo-city-config.service.ts:146`),
  destroying enablement history on any toggle-off.
- **`HUB_CITIES` is hardcoded twice** (`sitemap.ts:24`, `[citySlug]/page.tsx:44`)
  and ignores `seo_city_config`, so draft cities' hubs are in the sitemap.
- **City hubs have no `noindex` rule at all** (`[citySlug]/page.tsx:62`), and unknown
  cities render an invented locality list `["Sector 1", "Sector 2", "Central"]`
  (`:226`).
- **RSC crawl share unexplained.** HTML is 21% of crawl while "other file type" is
  67% (≈106,000 requests). Leading hypothesis is Next.js RSC payloads (`?_rsc=`)
  crawled as distinct URLs; `robots.txt` has no disallow for them. **Unverified** —
  see §8.

---

## 2. Goal & non-goals

**Goal.** Make the programmatic surface truthful, so that Google's remaining crawl
budget is spent on pages that can rank, and so that incoming NCR supply
automatically promotes pages into the index.

**Non-goals for this spec:**

- Making zero-inventory pages rank on informational intent (rent benchmarks,
  commute data, locality guides, demand capture). That is the natural next slice and
  is the only way to rank in a city *before* supply lands — but it depends on this
  spec's invariant holding first, and on a separately-tracked defect where SSR calls
  the `AuthGuard`-gated `POST /seo/copy` unauthenticated, so every programmatic page
  silently falls back to template copy instead of AI copy. Verify that before
  starting the content slice. Deliberately deferred.
- The admin-panel generation automation (`city-expansion-runbook.md` §6, Phases
  A–C). Deferred until NCR supply justifies more cities than the four here.
- Backfilling real per-listing `updated_at` for sitemap `lastmod`.

---

## 3. The invariant

> **A page appears in the sitemap and is indexable if and only if the content it
> renders clears the listing threshold.**

Every defect in §1 is a violation:

| Violation | Where |
| --- | --- |
| In sitemap, renders nothing | metro/landmark for cities with no such places |
| In sitemap, ungated | all metro + landmark entries |
| `index` from a count the page doesn't render | intent pages use the parent's unfiltered total |
| Indexable with zero inventory | city hubs |
| Would render listings it isn't credited for | parent localities, after rollup |

The design therefore does not patch five call sites. **The API computes
`indexable` once and returns it; the sitemap and the page templates consume it.**

---

## 4. Architecture

### 4.1 One source of truth for a city's places

Add a single read endpoint:

```
GET /seo/cities/:citySlug/places
→ { localities: Place[], metro_stations: Place[], landmarks: Place[] }

Place = {
  slug: string
  name_en: string
  name_hi: string | null
  listing_count: number       // rolled up; drives indexability
  own_listing_count: number   // directly assigned; for display/debug
  indexable: boolean          // server-computed, single definition
}
```

Backed by one service method so all three consumers agree:

- `apps/web/app/sitemap.ts` → filters `.filter((p) => p.indexable)`. It no longer
  imports a threshold and no longer calls `/map/metro`.
- `SeoCityConfigService.computeCounts` → counts `indexable === true` per place kind,
  replacing the locality-only definition.
- Page templates → keep using their existing per-place aggregate call, which is
  refactored to share the same count SQL.

`/map/metro` remains untouched and continues to serve the map. It is simply no
longer an SEO input.

### 4.2 Hierarchy rollup

Recursive CTE so depth is not assumed:

```sql
WITH RECURSIVE subtree AS (
  SELECT id AS root_id, id AS node_id
    FROM localities WHERE city_id = $1
  UNION ALL
  SELECT s.root_id, l.id
    FROM localities l JOIN subtree s ON l.parent_locality_id = s.node_id
)
SELECT s.root_id,
       COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'active') AS listing_count
  FROM subtree s
  LEFT JOIN listing_locations ll ON ll.locality_id = s.node_id
  LEFT JOIN listings l ON l.id = ll.listing_id
 GROUP BY s.root_id
```

**Consistency requirement.** If a parent is indexable via rollup, its page must
render those listings. So `SearchService`'s `locality=` filter
(`search.service.ts:450`) must roll up identically: resolve the slug to a locality
id, then match `ll.locality_id` against that node's subtree. Without this, PR 2
would create indexable pages showing empty grids — reintroducing the very defect
being fixed. The locality facet and top-localities aggregations
(`search.service.ts:1063`, `:1089`) use INNER joins on `locality_id` and are
reviewed in the same change.

### 4.3 Genuine 404s

Two distinct outcomes, currently conflated:

| Case | Status | Sitemap | Robots |
| --- | --- | --- | --- |
| Place does not exist in this city | **404** | absent | n/a |
| Place exists, below threshold | 200 | absent | `noindex, follow` |

Requires adding `apps/web/app/[locale]/not-found.tsx` (none exists today) and
root-causing why `notFound()` is currently ISR-cached and served as 200. `404` is
chosen over `410`: Google treats them nearly identically for removal, and `410`
would need a route handler or middleware shim in App Router for no material gain.

### 4.4 Threshold as a shared contract

`INDEXABLE_MIN_LISTINGS = 3` moves to `packages/shared-types`, imported by both
apps. The four duplicates listed in §1.5 and the inline literals in the six
templates are deleted. The value stays 3; only its home changes.

---

## 5. Change set, sliced

Ordering is a **hard constraint**. Enabling Delhi before PR 1 lands would push
228 stations × 27 intents × 2 locales = **12,312** URLs into the sitemap.

### PR 1 — Stop the bleeding

1. Add `GET /seo/cities/:citySlug/places` with server-computed `indexable` (no
   rollup yet — exact-match counts, matching today's semantics).
2. Repoint `buildCityChunk` at the new endpoint; delete the `/map/metro` dependency
   from `sitemap.ts`.
3. Gate metro and landmark entries on `indexable`.
4. Add `not-found.tsx`; make unresolvable places return a real 404.
5. Move the threshold to `packages/shared-types`; delete all duplicates.
6. Extend `sitemap-chunks.test.ts` with the missing metro and landmark exclusion
   assertions.

**Expected effect:** sitemap 32,864 → ~1,000 URLs; ~32,000 URLs begin returning 404
instead of empty 200s.

### PR 2 — Make supply count

7. Hierarchy rollup in the places/aggregates SQL (§4.2).
8. Matching rollup in `SearchService`'s `locality=` filter and locality facets.
9. Intent pages compute `noindex` from their **filtered** count.
10. City hubs: `noindex` when city-wide active inventory is below threshold; source
    `HUB_CITIES` from the enabled set in both `sitemap.ts` and `[citySlug]/page.tsx`;
    delete the invented `["Sector 1", "Sector 2", "Central"]` fallback.
11. Fix double-branded titles; remove the duplicate `robots` tag.
12. Admin page: split live vs draft in the `INDEXABLE` card, count indexable **URLs**
    (localities + their intents + qualifying metro + qualifying landmarks) rather
    than localities, and add a "noindex URLs in sitemap" figure — the number that
    should gate the Enable decision. Preserve `enabled_at` on toggle-off.
13. Add `pnpm seo:audit` (§7.2).

### PR 3 — The four cities

14. Add Varanasi to `data/seeds/cities.json` (absent today; it exists in the DB only
    as a v1-migration side effect).
15. Generate locality/micro-locality/landmark data for `delhi`, `jaipur`,
    `chandigarh`, `varanasi` per the runbook, including the phantom-geocode
    collision check.
16. Dry-run, then apply, then enable — commands handed over, run by a human
    (`apps/api/.env` `DATABASE_URL` points at prod; the sandbox cannot read the
    password).

Enabling is safe only after PR 1: a city with no qualifying places contributes an
empty chunk rather than thousands of URLs.

---

## 6. Data flow after the change

```
localities / metro_stations / landmarks  (+ listing_locations.locality_id)
                    │
                    ▼
        one count implementation  ── recursive rollup, status='active'
                    │
        ┌───────────┴────────────┬─────────────────────┐
        ▼                        ▼                     ▼
 GET /seo/cities/:slug/places   page aggregates   admin computeCounts
        │                        │                     │
        ▼                        ▼                     ▼
   sitemap chunk            noindex decision      admin metrics
  (filter indexable)      (same threshold)     (live vs draft split)
```

One arrow into three consumers. No consumer re-derives indexability.

---

## 7. Testing

### 7.1 Unit / integration

- Rollup: parent with children holding 2+2 listings reports `listing_count = 4`,
  `own_listing_count = 0`, `indexable = true`; children report 2 and `false`.
- Search rollup: `locality=<parent>` returns the children's listings, so the
  rendered grid matches the count that made the page indexable.
- Sitemap: metro and landmark entries excluded below threshold (the assertions
  absent today); no entry emitted for a city with zero places.
- 404: unresolvable place slug returns 404; below-threshold place returns 200 +
  `noindex`.
- Threshold: exactly one exported constant, asserted by importing it in both apps'
  tests. (No grep-for-literal-`3` test — too many false positives to be useful.)

Integration tests require `TEST_DATABASE_URL`, which CI does not set — every DB test
is currently skipped. These will be run locally against a targeted file rather than
the full API suite, because the full run drops `keyword_rankings` and
`seo_indexing_queue` via migration 0045's rollback.

### 7.2 `pnpm seo:audit` — the recurrence guard

Samples N URLs from the live sitemap index and asserts each:

- returns HTTP 200,
- is not `noindex`,
- has a non-empty `<h1>`,
- has a self-referential canonical.

Every defect in this spec would have failed this on day one. Run against production
after each deploy and in CI against a preview URL.

### 7.3 Post-deploy verification

- Re-count sitemap chunks; expect ~1,000 URLs, zero metro entries for faridabad and
  ghaziabad.
- Spot-check that `/city/faridabad/metro/kashmere-gate` now returns 404.
- Watch Search Console: `404` share should rise sharply (that is success, not
  regression), and Discovery share should climb as refresh waste falls.

---

## 8. Open item: the 67% "other file type" crawl share

HTML is 21% of crawl; "other" is 67% (≈106,000 requests). The leading hypothesis is
Next.js RSC payloads (`?_rsc=`) being crawled as separate URLs, which `robots.txt`
does not disallow. If confirmed this is a larger budget leak than the sitemap, and
the fix is a one-line `Disallow: /*?_rsc=` (safe — RSC payloads are prefetch
optimisations; Googlebot indexes the HTML).

**This is a hypothesis, not a finding.** Verify against Vercel request logs before
changing `robots.txt`. Tracked here so it is not lost; not part of PR 1–3 scope
until verified.

Also unexplained: desktop Googlebot is 72% of requests against 8.5% smartphone,
which is inverted for mobile-first indexing. Worth a look, no hypothesis yet.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| The programmatic sitemap shrinks ~97% (32,864 → ~1,000) and reads as a regression in GSC | Expected and intended. Communicate before deploy; §7.3 defines success as rising 404s and rising Discovery share, not URL count. |
| Rollup makes a parent indexable while its page renders an empty grid | §4.2 consistency requirement — search filter rolls up in the same PR, with a test asserting count-matches-render. |
| Rollup double-counts a listing across parent and child | `COUNT(DISTINCT l.id)` over the subtree. |
| 404-ing ~32,000 previously-200 URLs loses equity | They were `noindex` and non-ranking; no equity exists to lose. |
| Recursive CTE performance on Gurugram's 267 localities | Counts are already cached behind ISR (`revalidate = 86400`) and the admin's N+1 per-city loop is replaced by one query per city. Benchmark in PR 2. |
| AI-generated city data contains phantom localities | Runbook's coordinate-collision check is mandatory in PR 3; human review gate retained. |

---

## 10. Success criteria

1. Sitemap contains only URLs that render content clearing the threshold — verified
   by `pnpm seo:audit` passing at 100% on a 200-URL sample.
2. Zero URLs in the sitemap return a soft 404.
3. A locality crossing 3 listings (own or rolled up) appears in the sitemap on the
   next revalidation with no manual step.
4. Search Console Discovery share rises from 12.92%; `404` share rises, then falls
   as Google purges.
5. Delhi, Jaipur, Chandigarh and Varanasi are enabled with full locality data and
   contribute zero URLs until they have supply.
