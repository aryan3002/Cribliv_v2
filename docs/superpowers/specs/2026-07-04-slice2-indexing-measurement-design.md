# Slice 2 — Indexing + Measurement — Design Spec

- **Date:** 2026-07-04
- **Status:** Design (for review) → spec → plan → build
- **Slice:** 2 of the SEO program ([roadmap](../2026-07-04-seo-program-roadmap.md))
- **Depends on:** live site (activates at the v1→v2 cutover, ~mid-July 2026); coordinates with the data migration + [cutover runbook](2026-07-04-cutover-seo-runbook-design.md)

---

## 1. Context & goal

Slice 1 built a programmatic surface; **nothing yet gets it indexed or measures it.** This slice adds the layer that (a) tells Google about our URLs fast (Indexing API + sitemap), and (b) measures what Google does with them (Search Console rank/impression data) — so slice 3 (blog) and every later slice are **aimed by real query data instead of guesses**.

**Build now, behind flags; activate at cutover.** All code is domain-agnostic (reads `GSC_SITE_URL` from env), so it's built and tested this week and simply flipped on when v2 goes live on cribliv.com.

**Success = :** sitemap submitted + coverage climbing in GSC; `keyword_rankings` populating weekly; new/enabled/published URLs auto-submitted to the Indexing API; admin can see quick-wins (queries at position 11–30) and indexing status.

## 2. Scope

**In:** `seo_indexing_queue` + Indexing-API submitter job; GSC poller → `keyword_rankings`; a shared Google service-account auth helper; admin "Search Performance" API + tab; sitemap-submission documentation; two feature flags.

**Out (other slices/docs):** the v1→v2 data migration; the 301 redirect map + launch checklist (→ cutover runbook); competitor SERP tracking (needs paid tools — dropped); blog-specific topic engine (slice 3 consumes this slice's data).

## 3. External prerequisites (Google — not code)

1. **GSC**: cribliv.com is a **verified Domain property** (already exists for v1; it carries over at cutover).
2. **GCP service account** with **Search Console API** + **Web Search Indexing API** enabled; its JSON key → `GSC_SERVICE_ACCOUNT_JSON`. The service account email must be added as a **user on the GSC property** (Settings → Users → add as Owner/Full).
3. **Env:** `GSC_SITE_URL` (`sc-domain:cribliv.com`), `GSC_SERVICE_ACCOUNT_JSON` (raw JSON or a path), `GOOGLE_INDEXING_DAILY_QUOTA` (default 200).

## 4. Architecture

Reuses the existing standalone worker (`apps/api/src/worker/worker.ts`) — new `setInterval` jobs + a new `outbound_events` handler — and the DB-only SEO service pattern (guard on `DatabaseService.isEnabled()`, no `AppStateService`). All admin surfaces reuse `DataTable`/`StatCard`.

```
listing approved / city enabled / blog published ──► enqueue seo_indexing_queue
                                                          │
   worker: indexing_submitter (~15 min, quota-gated) ────┴──► Google Indexing API (urlNotifications:publish)
   worker: gsc_poller (weekly) ──► GSC searchanalytics.query (28d, [query,page]) ──► upsert keyword_rankings
                                                          │
        admin "Search Performance" tab ◄── GET /v1/admin/seo/* ◄── SeoSearchService (DB-only)
```

## 5. Components

### 5.1 Migration (next free number — confirm ≥ `0044` against the console branch at build time)

- **`seo_indexing_queue`**: `id`, `url text NOT NULL`, `status` (`pending|submitted|failed|skipped`), `reason text` (why enqueued), `attempts int DEFAULT 0`, `submitted_at timestamptz`, `response jsonb`, `created_at`, `updated_at`. Unique on `(url)` with an upsert that re-queues on content change. Partial index on `status='pending'`.
- **`keyword_rankings`**: `id`, `keyword text`, `page text`, `locale text`, `city_slug text NULL`, `position numeric`, `impressions int`, `clicks int`, `ctr numeric`, `source text DEFAULT 'gsc'`, `captured_at date`, `is_target bool DEFAULT false`, `is_ignored bool DEFAULT false`. Unique on `(keyword, page, locale, captured_at)`. Indexes on `(position)` (quick-wins), `(city_slug)`.
- Paired `.rollback.sql`.

### 5.2 `GoogleServiceAuth` (shared helper, `apps/api/src/modules/seo/google/`)

Mints an OAuth2 access token from the service-account JWT (scopes: `indexing`, `webmasters.readonly`), caches it until ~5 min before expiry. One helper, used by both the indexing + GSC services. No third-party SDK required (sign a JWT, POST to the token endpoint) — keeps deps minimal; reuse the existing `jsonwebtoken`/crypto already in the repo if present, else a small signer.

### 5.3 `IndexingService` + worker job `indexing_submitter`

- `enqueue(url, reason)` — upsert into `seo_indexing_queue`.
- Worker job (`~15 min`, flag `FF_SEO_INDEXING`): drain `pending` where daily count < `GOOGLE_INDEXING_DAILY_QUOTA`; POST `urlNotifications:publish {url, type: URL_UPDATED}`; on success `status='submitted'`; on failure increment `attempts`, backoff, `status='failed'` after N. Records `response`.
- **Enqueue points:** (a) new `outbound_events` handler `seo.queue_indexing` fired from `admin.controller.listingDecision` on approve; (b) `SeoCityConfigService.setEnabled(true)` enqueues the city's newly-indexable URLs; (c) blog publish (slice 3) enqueues the post; (d) admin manual submit.

### 5.4 `GscService` + worker job `gsc_poller`

- Worker job (weekly, flag `FF_SEO_GSC`): call `searchanalytics.query` for `GSC_SITE_URL`, last **28 days**, dimensions `[query, page]`, rowLimit paged; upsert into `keyword_rankings` with `captured_at = today`. Also a light `coverage` fetch (indexed counts) for the dashboard.
- Idempotent per `captured_at` (re-runs update the day's snapshot).

### 5.5 API (admin, `@Roles("admin")`, DB-only `SeoSearchService`)

- `GET /v1/admin/seo/search-performance` → rankings with filters (city, locale, `quick_wins=true` → position 11–30 ordered by impressions), plus totals. CSV export.
- `GET /v1/admin/seo/indexing-queue` → queue rows + counts by status + today's submitted count vs quota.
- `POST /v1/admin/seo/indexing-queue` → manual URL submit (enqueue).
- `POST /v1/admin/seo/indexing-queue/:id/retry` → reset failed → pending. All mutations audited to `admin_actions`.

### 5.6 Web — admin "Search Performance" tab

New tab (reuse the slice-1 tab pattern): **Rankings** table (keyword · page · position · impressions · clicks · ctr · trend) with a **Quick wins** view (pos 11–30 = "one push from page 1"); **Indexing queue** panel (status counts, quota used, manual submit, retry-failed); **Coverage** stat cards. Client fns in `admin-api.ts`.

### 5.7 Sitemap submission

`sitemap_index.xml` already exists (slice 1). This slice documents/automates: at cutover, submit `https://cribliv.com/sitemap_index.xml` in GSC → Sitemaps, and optionally ping on deploy. No new sitemap code.

### 5.8 Feature flags

`FF_SEO_INDEXING`, `FF_SEO_GSC` (both default **off**; flip at cutover). Follow the `ff_x_enabled` pattern.

## 6. Quotas & failure handling

- Indexing API default **200 URLs/day** — the submitter gates on `GOOGLE_INDEXING_DAILY_QUOTA` and prioritizes newest/highest-value URLs; overflow stays `pending` for the next day.
- All Google calls: timeout, retry with backoff, never throw out of the worker loop (log + mark row failed). If auth fails, the job logs and no-ops (flag-gated), never crashes the worker.

## 7. Activation at cutover (ties into the runbook)

1. v2 live on cribliv.com + 301s in place · 2. GSC property confirmed + service account added as user · 3. env vars set · 4. submit sitemap · 5. flip `FF_SEO_INDEXING` on → new/existing URLs drain to the Indexing API · 6. flip `FF_SEO_GSC` on → first weekly poll seeds `keyword_rankings` · 7. watch coverage 1–2 weeks.

## 8. Testing

- **Unit (mocked fetch):** `GoogleServiceAuth` token mint/cache; `IndexingService` quota gating + status transitions; `GscService` response parsing + upsert shaping; quick-wins filter. No live Google calls.
- **Integration (cribliv_test):** migration shape/rollback; `seo_indexing_queue` upsert/idempotency; `keyword_rankings` unique-key upsert.
- **API:** admin endpoints behind `@Roles('admin')`; audit rows written.
- **DB-safety:** all per the repo conventions (local overrides; never Azure prod).

## 9. Open decisions

1. **Indexing API for listings vs sitemap-only** — the Indexing API is officially for Job/Livestream schemas; Google tolerates broader use but doesn't guarantee it. Recommendation: use it for **fast discovery** of high-value new URLs, and rely on the **sitemap** as the durable source of truth. (Low risk; flagged.)
2. **Rank-tracking cadence** — weekly is enough for a young site; revisit to daily for target keywords later.
3. **Bing/IndexNow** — a near-free bonus (IndexNow submits to Bing/Yandex). Optional add-on to the submitter; deferred unless wanted.
