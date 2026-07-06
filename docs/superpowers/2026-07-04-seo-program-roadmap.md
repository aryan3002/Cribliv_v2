# Cribliv SEO Program — End-to-End Roadmap

- **Date:** 2026-07-04
- **Owner:** Aryan Tripathi
- **Status of this doc:** living roadmap (program-level, not a task plan). Each slice gets its own spec → plan → build cycle.
- **Legend:** ✅ done · 🔧 in progress · ▶️ next · ⏭️ queued

---

## 1. North star & the funnel that governs sequencing

**Goal:** organic traffic → contact-unlocks (the monetization model). Master traffic targets: 15K (mo 3) → 75K (mo 6) → 250K (mo 9) → 600K (mo 12).

**The funnel — why order matters.** A programmatic page only earns traffic if it clears every stage:

```
built  →  deployed  →  crawled  →  indexed  →  ranked  →  clicked  →  unlock
```

We are strong on **built** (slice 1) but have **nothing** on crawled/indexed/measured. Adding more _built_ surface (blog, more cities) before fixing crawl→index→measure is pushing rope. So the roadmap front-loads the **indexing + measurement** layer, then scales content **aimed by real data**.

## 2. Where we are today

- ✅ **Slice 1 — City expansion** (merged, PR #4): DB-driven `seo_city_config` gate, 6 programmatic templates, `SeoCityConfigService` + public/admin endpoints, thin-content `noindex`, DB-driven sitemap index, admin toggle, Noida seed data (disabled). Prod DB migrated to `0043`.
- 🔧 **Slice 1.5 — City review console** (in progress, separate branch): admin review UI, live counts, hard-404 for the public + admin-only preview of disabled cities, city-hub linking. _This closes the quality/ops gaps found in slice-1 review._
- ⚠️ **Reality:** live but **not indexed / not measured** — no Google Search Console, no sitemap submission, no Indexing API, no rank data. Lucknow serves; Noida is seeded but disabled.

## 3. Guiding principles

1. **Reuse, don't rebuild** — the worker (`outbound_events` queue), `SeoCopyService`, `SeoAggregatesService`, `EmbeddingService`, admin primitives, agent-markdown already exist.
2. **DB-driven + no-redeploy toggles** — control via tables + admin, not code (the slice-1 pattern).
3. **Thin-content discipline** — never index a page with < 3 listings; inventory × pages is the real traffic equation.
4. **Ship → measure → iterate** — every slice defines "done-when" success metrics; measurement (slice 2) exists precisely so later slices are aimed, not guessed.
5. **DB-only SEO services** (no AppStateService), Azure OpenAI read per-service, flags `FF_*`, migrations raw SQL (next free ≥ `0044` — coordinate with the console branch).

## 4. The slice sequence

| #     | Slice                                            | Effort      | Depends on     | Leverage                         |
| ----- | ------------------------------------------------ | ----------- | -------------- | -------------------------------- |
| 1     | City expansion                                   | —           | —              | ✅ shipped                       |
| 1.5   | City review console                              | —           | 1              | 🔧 in progress                   |
| **2** | **Indexing + Measurement**                       | **Low–Med** | live site      | ▶️ **next — unlocks everything** |
| 3     | Blog / content engine                            | High        | 2 (topic data) | ⏭️ durable flywheel              |
| 4     | NCR city rollout                                 | Low (data)  | 1.5            | ⏭️ parallelizable                |
| 5     | Listing-level SEO                                | Med         | 1              | ⏭️ per-listing depth             |
| 6     | Market reports (data moat)                       | Med         | 2              | ⏭️ links + authority             |
| 7     | AEO / GEO (llms.txt)                             | Med         | 3/6            | ⏭️ AI-search bet                 |
| 8     | Regional / Hindi / Hinglish                      | Med         | 3              | ⏭️ language moat                 |
| 9     | Link building (admin-gated)                      | Med         | 6              | ⏭️ off-page authority            |
| 10    | Topical clustering + internal linking + PageRank | Med         | 3              | ⏭️ compounding on-page           |

### ▶️ Slice 2 — Indexing + Measurement (NEXT)

**Goal:** get the live pages crawled + indexed fast, and start measuring rank/impressions so every later slice is data-aimed.
**Components (all reuse the existing worker + admin):**

- **Sitemap submission + robots** — confirm `sitemap_index.xml` + per-city chunks are reachable and referenced; submit to GSC.
- **Google Indexing API submitter** — new `seo_indexing_queue` table; a worker job drains it → `urlNotifications:publish` (respect daily quota). Enqueue on listing approval + city enable + blog publish.
- **GSC poller** — weekly `searchanalytics.query` (28-day, dims `[query,page]`) → `keyword_rankings` table (keyword, page, position, impressions, clicks, ctr).
- **Admin "Search Performance" panel** — rankings table, quick-wins view (pos 11–30), indexing queue + manual submit/retry, coverage counts. Reuses `DataTable`.
- **Env/flags:** `GSC_SITE_URL`, `GSC_SERVICE_ACCOUNT_JSON`, `GOOGLE_INDEXING_DAILY_QUOTA`; `FF_SEO_GSC`, `FF_SEO_INDEXING` (default off).
  **Done-when:** sitemap submitted + coverage climbing in GSC; `keyword_rankings` populating weekly; new/enabled URLs auto-submitted to Indexing API; admin can see quick-wins.

### ⏭️ Slice 3 — Blog / content engine

`BlogModule` + `blog_posts`, hub+detail routes, worker `blog_topic_planner` (fed by slice-2 GSC quick-wins + content gaps) + `blog_generator` (Azure OpenAI, reuse `SeoCopyService` conventions), admin blog queue, `ApiKeyGuard` for worker writes, sitemap inclusion. **Done-when:** a steady cadence of drafts → reviewed → published, ranking for quick-win queries.

### ⏭️ Slice 4 — NCR city rollout

Pure data via the `generate-city` CLI (Gurugram/Ghaziabad/Faridabad/Delhi) → review → admin toggle. No new code. Can run in parallel with 2/3. **Done-when:** each city seeded, reviewed, enabled, and its non-thin pages indexing.

### ⏭️ Slice 5 — Listing-level SEO

`listings.seo_slug` (+ UUID→slug 301), `seo_faq_schema` (FAQPage JSON-LD on listing pages), AI photo alt text, `twitter:card=summary_large_image`; fired as `outbound_events` on listing approval. **Done-when:** listing pages have slugs, FAQ schema, alt text; old UUIDs 301.

### ⏭️ Slice 6 — Market reports (data moat)

`MarketReportService` (reuse `SeoAggregatesService` percentiles) → monthly rental index; worker generates → CSV to Azure Blob → AI summary → `market_reports`; web `market-reports/[slug]` with `Dataset`+`Article` JSON-LD + recharts + "cite this report." **Done-when:** first report published + earning reference links.

### ⏭️ Slice 7 — AEO / GEO

`/llms.txt` + `/llms-full.txt` (fact blocks from market-report data), `<dl>` fact-blocks in `ProgrammaticPage`, markdown alternates (extend `markdown-for-agents.ts`), open rental-index JSON endpoint. **Done-when:** AI engines can cite live medians; markdown alternates served.

### ⏭️ Slice 8 — Regional / Hindi / Hinglish

Hinglish blog seeds (`kiraye par flat {city}`), audit `i18n.ts` completeness, thin regional hubs (ta/kn/mr/te/bn) outside `[locale]` linking into `/en`, `regional_seo_copy`. **Done-when:** Hindi/Hinglish content indexing; regional hubs live with hreflang.

### ⏭️ Slice 9 — Link building (admin-gated)

Worker drafts HARO / data-PR / Reddit-Quora answers → `link_building_opportunities` (nothing auto-posts); admin approves/sends (audited). **Done-when:** a pipeline of drafted, human-approved outreach.

### ⏭️ Slice 10 — Topical clustering + internal linking + PageRank

`BlogEmbeddingService` + `blog_embeddings`, `findSimilarContent` for contextual internal links, monthly pillar posts, weekly internal-PageRank snapshot + admin "under-linked pages." **Done-when:** internal-link graph strengthens; pillars rank.

## 5. Sequencing rationale

- **2 before 3:** the blog topic engine is _fed by_ GSC quick-wins — building blog first means guessing topics.
- **4 anytime after 1.5:** data-only, no code; slot it whenever inventory justifies a city.
- **6 before 7 & 9:** reports produce the fact-data for llms.txt and the assets for link building.
- **5 is independent** — can slot whenever listing-page polish is worth it.

## 6. Open decisions (revisit as we go)

1. **CWV / Unlighthouse gate** — the original plan assumed it exists; it doesn't on master. Rebuild as a quality gate, or rely on manual discipline? (Not blocking slice 2.)
2. **Inventory strategy** — thin-content guard means traffic needs listings. Is there a plan to grow inventory per city, or is expansion demand-led/build-ahead?
3. **Deployment cadence** — how do merged slices reach prod (pipeline vs. manual)? Slice 2's Indexing API only helps once pages are deployed + crawlable.
4. **v1 → v2** — does organic traffic target the v2 domain only, or is there v1 legacy SEO to migrate/redirect?

## 7. Immediate next → design Slice 2

To turn this into a spec + implementation plan, Slice 2 needs two external prerequisites confirmed (they're Google-account actions, not code):

- **Google Search Console**: is the production domain a **verified GSC property**?
- **Google Cloud service account**: is there (or can you create) a service account with **Search Console API + Indexing API** enabled, whose JSON key we can put in `GSC_SERVICE_ACCOUNT_JSON`?

Once confirmed, Slice 2 goes through: brainstorm specifics → spec → implementation plan → build (same flow as slice 1).

---

## Appendix — mapping to the original 9-phase plan

Original Phase 1 (blog) → **Slice 3**; Phase 2 (listing SEO) → **Slice 5**; Phase 3 (city expansion) → **Slice 1 ✅**; Phase 4 (GSC/Indexing) → **Slice 2 ▶️**; Phase 5 (market reports) → **Slice 6**; Phase 6 (AEO) → **Slice 7**; Phase 7 (regional) → **Slice 8**; Phase 8 (link building) → **Slice 9**; Phase 9 (clustering/PageRank) → **Slice 10**. Nothing dropped — only reordered so measurement comes before more content.
