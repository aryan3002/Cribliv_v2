# Slice 3 — Blog / Content Engine — Design Spec

- **Date:** 2026-07-04
- **Status:** Design (for review) → spec → plan → build
- **Slice:** 3 of the SEO program ([roadmap](../2026-07-04-seo-program-roadmap.md))
- **Depends on:** Slice 2 (GSC quick-win data aims the topic engine) · reuses `SeoAggregatesService`, `SeoCopyService` conventions, `EmbeddingService`, the worker, admin primitives.

---

## 1. Context, goal & the thesis

The blog is the **durable content flywheel** — the compounding SEO lever that ranks for the long tail the programmatic pages can't. The user's directive is explicit: **best quality, best blogs.** So this spec is built around one thesis:

> **Generic AI blog content ranks nowhere and is a liability. Cribliv's unfair advantage is proprietary data** — real median rents, real listing counts, real locality/metro/landmark facts (already in the DB via `SeoAggregatesService`). Every post is _grounded in that data_, _aimed at a real query_, _fact-checked_, _quality-gated_, and _human-approved_ before it publishes. That is what makes it "best" — not the model, the **system around the model**.

**Non-goal:** a firehose of thin AI posts. **Goal:** a smaller number of genuinely useful, data-backed, well-linked posts that rank, earn citations, and feed the programmatic surface with internal links.

**Success = :** a steady cadence of posts that (a) pass the automated quality gate, (b) a human approves, (c) rank for their target quick-win query within weeks, (d) drive internal-link clicks into city/locality pages. Zero slop published.

## 2. The quality philosophy (the heart of this slice)

Eight mechanisms, each a concrete part of the build — this is what "best blogs" means in code:

1. **Proprietary-data grounding.** Data-driven posts pull _live_ numbers from `SeoAggregatesService` (median 1/2/3BHK + PG rents, listing counts, nearest-metro, YoY where available) and render them as cited fact-blocks + charts. Uniqueness = ranking + citability. A post about "2BHK rent in Gomti Nagar" quotes the _real_ median, not a hallucination.
2. **Data-driven topic selection.** No random topics. Sources, in priority: (a) **GSC quick-wins** (pos 11–30, high impressions/low CTR — from slice 2), (b) **content-gap** queries (impressions, no page), (c) **data-trend** topics auto-generated from locality/city aggregates ("rent trends in <city>"), (d) an **evergreen tenancy seed list** (rent agreement, security deposit rules, HRA/rent receipts, tenant rights, moving guides, PG vs flat).
3. **Content briefs, not prompts.** Every post starts as a structured `blog_brief` (target keyword, search intent, SERP-informed outline, required data points, mandatory internal links, target word count, E-E-A-T requirements). The generator writes _to a brief_, never "write a blog about X."
4. **Multi-step structured generation** (not one-shot): **outline → section-by-section drafting with real data injected → fact-check/consistency pass → SEO + readability pass**. Each step is a focused Azure OpenAI call (reusing `SeoCopyService`'s `readAiConfig` + JSON conventions). Multi-step beats one-shot on depth, accuracy, and structure.
5. **Automated quality gate before humans see it.** A `qualityScore(post)` check: min word count, ≥N cited data points present, ≥N internal links present, no placeholder/hedge phrases ("as an AI", "in conclusion", "it's important to note"), readability band, target-keyword usage (present, not stuffed), and **uniqueness vs existing posts** (cosine distance over `blog_embeddings` — reuse `EmbeddingService`). Below threshold → auto-regenerate once, then flag `needs_attention`. Slop never reaches the review queue.
6. **Human-in-the-loop, never auto-publish.** AI produces `status='draft'`; a person edits + approves in the admin blog queue; only then `published`. The automated score assists the human, never replaces them.
7. **E-E-A-T signals.** Real author byline (a named editorial persona with a bio page), `published_at` + `updated_at`, cited sources (`sources jsonb`), embedded **real listings** relevant to the topic, and a "data as of <date>" line on data posts.
8. **Internal-linking flywheel.** Posts link _into_ programmatic city/locality/metro/landmark pages (semantic match via `blog_embeddings` → nearest programmatic entities) and those pages surface **related posts**. Links compound authority both directions. On publish → enqueue to slice-2 `seo_indexing_queue`.

## 3. Content strategy

**Post types** (each with its own brief template + generation recipe):

- **Data reports** — "Rent trends in <city>/<locality>" — powered by aggregates + charts; auto-refreshes monthly (regenerate data blocks, keep prose). Highest moat.
- **Local guides** — "Best areas for students/families/professionals in <city>", "PG vs 1BHK in <city>" — mixes data + editorial; heavy internal linking.
- **Evergreen tenancy** — rent agreement, deposit rules, HRA, tenant rights, moving checklists — ranks nationally, builds topical authority.
- **Query-targeted** — one post per high-value GSC quick-win.

**Cadence:** quality-gated, not volume-gated. Target ~3–5 published/week to start (planner enqueues more; the human-review throughput is the real limiter). Never publish to hit a number.

## 4. Scope

**In:** `BlogModule` (API) + data model; the topic planner + multi-step generator worker jobs; the quality-gate scorer; admin blog queue (review/edit/publish) + generate form; web hub + detail (bilingual, ISR, JSON-LD); internal-linking (blog↔programmatic) via embeddings; sitemap + Indexing-API enqueue on publish.

**Out (later slices):** pillar posts + PageRank (slice 10); link-building outreach (slice 9); regional languages beyond Hindi (slice 8); market-report _pages_ (slice 6 — the blog _consumes_ aggregate data but the standalone report product is separate).

## 5. Architecture

Mirrors the slice-1/2 patterns: DB-only services, worker jobs, `outbound_events` handler for embeddings, admin primitives, `ProgrammaticPage`-style rendering + `buildFaqPage`.

```
blog_topic_planner (weekly) ──► blog_briefs (from GSC quick-wins + gaps + data-trends + evergreen)
        │
blog_generator (daily) ──► [outline → sections+data → fact-check → SEO/readability] ──► qualityScore
        │                                                                                    │
        ▼                                                                          pass ──► status='draft'
   Azure OpenAI (readAiConfig)                                                      fail ──► regen once ─► needs_attention
        ▼
   admin blog queue (human edit + approve) ──► status='published'
        │
        ├──► seo.embed_blog (outbound_events) → blog_embeddings (EmbeddingService)
        ├──► seo_indexing_queue enqueue (slice 2)
        └──► sitemap inclusion
   web: /[locale]/blog + /[locale]/blog/[slug] (ISR, Article+FAQ+Breadcrumb JSON-LD, related posts, internal links)
```

- **API `BlogModule`:** public `GET /v1/blog` (paginated, published only), `GET /v1/blog/:slug`; internal `POST /v1/blog/drafts` + `PATCH` behind a new **`ApiKeyGuard`** (header `x-api-key`) so the worker can write; admin endpoints (list all statuses, approve/publish/archive, generate-now, edit) `@Roles('admin')`. DB-only dual pattern.
- **Worker jobs:** `blog_topic_planner` (weekly), `blog_generator` (daily) — feature-flag gated (`FF_SEO_BLOG`).
- **Embeddings/linking:** `BlogEmbeddingService` (thin wrapper reusing `EmbeddingService.callEmbeddingApi`) → `blog_embeddings` (vector 1536, HNSW); `findRelated(post)` (cosine `<=>`) → related posts + nearest programmatic entities for internal links.

## 6. The generation pipeline (detail)

For a brief, the `blog_generator`:

1. **Outline** — LLM produces an H2/H3 outline from the brief + intent + (optionally) the current SERP shape; validated against required sections.
2. **Section drafting** — each section generated with the brief's **required data points injected as facts** (pulled live from `SeoAggregatesService`) so the model _quotes_ real numbers rather than inventing them. Listings relevant to the topic are fetched and embedded as examples.
3. **Fact-check / consistency pass** — a pass that verifies every number in the draft matches the injected data, removes unsupported claims, and flags anything it can't ground.
4. **SEO + readability pass** — title/meta (via `SeoCopyService` conventions), keyword placement (natural, not stuffed), headings, FAQ block (→ `faq_items` for `buildFaqPage`), reading level, alt text for images.
5. **Quality score** (§2.5) — gate. Emits `quality_score` + a breakdown stored on the row for the reviewer.

Bilingual: generate **en**, then a faithful **hi** rendering (not a raw translation — locale-appropriate). `script` field supports `hinglish` later (slice 8).

## 7. Editorial workflow (states)

`brief → generating → draft (passed gate) | needs_attention (failed) → in_review → published | archived`. Admin queue shows the quality breakdown, a live preview, inline edit, and the internal links the generator chose. Approve → publish → embed + index + sitemap. Data posts get a monthly `refresh` job that regenerates data blocks.

## 8. Data model (next free migrations after slice 2 — confirm at build time)

- **`blog_categories`** — slug, name_en/hi, description.
- **`blog_posts`** — `slug` (unique), `title/meta/excerpt/body_en`, `..._hi`, `target_keyword`, `intent`, `city_slug NULL`, `category_id`, `status`, `generated_by` (`planner|manual|refresh|pillar`), `quality_score numeric`, `quality_breakdown jsonb`, `faq_items jsonb`, `hero_image_path`, `author` , `sources jsonb`, `data_asof date NULL`, `script` (`en|hi|hinglish`), `is_pillar bool`, `published_at`, `created_at`, `updated_at`. Indexes on `status`, `target_keyword`, `city_slug`.
- **`blog_briefs`** — `id`, `target_keyword`, `intent`, `outline jsonb`, `required_data jsonb`, `internal_link_targets jsonb`, `source` (`gsc_quickwin|gap|data_trend|evergreen|manual`), `status` (`pending|generating|done|dropped`), `city_slug NULL`, `created_at`.
- **`blog_embeddings`** — `blog_post_id`, `embedding vector(1536)`, HNSW index (mirrors `listing_embeddings` from `0006`).

## 9. Web rendering

- `apps/web/app/[locale]/blog/page.tsx` (hub, ISR) + `[slug]/page.tsx` (detail, ISR). `generateStaticParams` emits `en`+`hi`.
- JSON-LD: **`Article`** (headline, author, datePublished/Modified, image) + **`FAQPage`** (via existing `buildFaqPage`) + **`BreadcrumbList`**. Full `generateMetadata` (canonical, OG, `twitter:card=summary_large_image`).
- Renders data fact-blocks + `recharts` charts (already a dep), embedded real listings, related-posts rail, and internal links into programmatic pages. Reuse the design tokens + fonts (Inter/Manrope/Fraunces) — no new families.
- Add blog slugs to the sitemap (slice-1 `generateSitemaps` — a `blog` chunk).

## 10. Reuse map (do not rebuild)

| Need                               | Reuse                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------- |
| AI copy conventions + Azure config | `SeoCopyService` / `readAiConfig`                                          |
| Real rent/locality data            | `SeoAggregatesService`                                                     |
| Embeddings + semantic linking      | `EmbeddingService` (`callEmbeddingApi`, `listing_embeddings`/HNSW pattern) |
| FAQ JSON-LD                        | `buildFaqPage`                                                             |
| Async jobs + on-publish handlers   | worker + `outbound_events`                                                 |
| Admin UI                           | `DataTable` / `StatCard` / tab pattern                                     |
| Fast indexing on publish           | slice-2 `seo_indexing_queue`                                               |
| Charts                             | `recharts`                                                                 |

## 11. Feature flags

`FF_SEO_BLOG` (worker generation + admin tab), default off. Publishing is always human-gated regardless of flags.

## 12. Testing

- **Unit (mocked LLM/embeddings):** brief validation; each pipeline step's input/output shape; `qualityScore` (each check + threshold); uniqueness via mocked embeddings; internal-link selection.
- **Integration (cribliv_test):** blog tables + rollback; `ApiKeyGuard` (worker write) vs public/admin auth; embed-on-publish handler.
- **Web:** hub/detail build; JSON-LD present + valid; bilingual params.
- **Content-safety:** a golden-set test that known-slop drafts fail the gate and known-good drafts pass.

## 13. Anti-slop guardrails (explicit "done-right" bar)

Never auto-publish · every published post cites ≥N real data points or authoritative sources · every post has ≥N internal links · no placeholder/hedge phrases · uniqueness enforced vs existing corpus · human approves every post · data posts show "data as of" + auto-refresh. If a post can't clear these, it doesn't ship.

## 14. Open decisions (for your review)

1. **Author/byline identity** — a named editorial persona (with a bio/E-E-A-T page) vs. "Cribliv Team". Recommendation: a named persona — stronger E-E-A-T.
2. **Starting cadence** — 3–5/week reviewed, or slower/higher? (Human review is the real throttle.)
3. **Hero images** — AI-generated (Azure) vs. a licensed/stock source vs. reuse listing photos. Recommendation: reuse relevant listing photos + a small branded template; avoid generic AI images.
4. **Quality thresholds** — exact numbers (min words, min data points, min internal links, uniqueness distance) — propose defaults in the plan, tune after the first batch.
5. **Comments / freshness** — out of scope now; note for later.
