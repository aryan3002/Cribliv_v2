# Design: Admin SEO Copy Control + Blog Property Embeds

Date: 2026-07-17
Status: Approved (brainstorm), implementing
Delivery: two features, one PR each, both branched off `origin/master`. TDD. No direct master push.

---

## Feature 1 — Admin control of locality SEO copy

**Goal:** let an admin generate, override, and revert the AI SEO copy for programmatic **locality** pages entirely from the Programmatic SEO city drawer — no curl/tokens. Copy status is visible at a glance; edits go live immediately (on-demand revalidation).

**Scope (confirmed):** localities only for v1 (landmarks/metro are a later fast-follow using the same pattern). Meta fields (`meta_title`/`meta_description`) are editable **and** wired into `generateMetadata` so they actually render.

### Existing building blocks (do not rebuild)

- `SeoCopyService` (`apps/api/src/modules/seo/seo-copy.service.ts`): `getOrGenerate(CopyInputs)`, `getStored`, `hasFreshCopy`, `deleteCopy(pagePath, locale)`, `writeCache` (upsert pattern), `readOverride`/`readCache` (private).
- `SeoAggregatesService`: `localitiesForCity(citySlug)` → `LocalityRow[]` (ordered listing_count DESC), `aggregatesForLocality(citySlug, localitySlug)` → `PageAggregates`.
- `AdminSeoController` (`apps/api/src/modules/admin/admin-seo.controller.ts`): already `@UseGuards(AuthGuard, RolesGuard) @Roles("admin")`; `AdminModule` imports `SeoModule`; existing PATCH writes an `admin_actions` audit row + `logTelemetry`.
- Tables (migration `0026_seo_page_copy.sql`): `seo_page_copy` (AI cache, PK `(page_path, locale)`, `aggregates_hash`, `expires_at`), `seo_page_overrides` (manual, PK `(page_path, locale)`, nullable copy columns + `notes`, `created_at`, `updated_at`; **no writer exists yet** — we add the first).
- Copy shape (`GeneratedCopy` / `SeoCopy`): `h1, meta_title, meta_description, intro_paragraph, nearby_blurb?, faq_items[{q,a}]`.
- Page path convention: `/city/{citySlug}/{localitySlug}`. Locales: strictly `"en" | "hi"`.
- Web: `SeoCityReviewDrawer.tsx` (localities tab), `admin-api.ts` (`authHeaders(accessToken)` + `fetchApi`), `StatusPill` primitive (`admin-pill`, tones brand/trust/warn/danger/muted), `Drawer` primitive, `fetchSeoCopy` (public `GET /seo/copy`), `coalesceCopy` in `programmatic-page.tsx`.

### New `SeoCopyService` methods (logic lives here; controller stays thin)

1. `getProvenance(pagePath, locale): Promise<"override" | "ai" | "template">` — override row present → `override`; else fresh cache row (`expires_at > now()`) → `ai`; else `template`. (Distinct from `getStored`, which collapses provenance.)
2. `generateAndCache(inputs: CopyInputs): Promise<GeneratedCopy | null>` — `deleteCopy` + `generate` + `writeCache`, **bypassing the override-first short-circuit** so Regenerate refreshes the AI cache even when an override is live. Returns null on generation failure (never throws).
3. `upsertOverride(pagePath, locale, copy, notes?): Promise<void>` — `INSERT INTO seo_page_overrides (...) VALUES (...) ON CONFLICT (page_path, locale) DO UPDATE SET ..., updated_at = now()`, `faq_items` cast `::jsonb`. No-op if DB disabled.
4. `deleteOverride(pagePath, locale): Promise<void>` — `DELETE FROM seo_page_overrides WHERE page_path=$1 AND locale=$2`.
5. `generateMissingForCity(citySlug, {limit=25, force=false, minListings=3}): Promise<{generated, skipped}>` — loops `localitiesForCity`, skips `listing_count < minListings` and (unless `force`) localities with fresh copy in both locales, otherwise `getOrGenerate` per locale. Extracted so the existing public batch can delegate later.

`CopyInputs` assembly mirrors the existing `generate-batch`: `aggregatesForLocality` → spread + `nearest_metro: null` + `parent_locality`, per locale, `pagePath = /city/{citySlug}/{localitySlug}`.

### New API endpoints (all on `AdminSeoController`, admin-guarded, audit + telemetry)

- `GET /admin/seo/copy-status?citySlug=` → `{ items: [{ slug, en: provenance, hi: provenance }] }` for every active locality (loops localities; per-locale provenance).
- `POST /admin/seo/copy/generate-one` `{ citySlug, localitySlug, force? }` → `{ en, hi }` (uses `generateAndCache` when `force`, else `getOrGenerate`).
- `PUT /admin/seo/copy/override` `{ citySlug, localitySlug, locale, copy: {h1, meta_title, meta_description, intro_paragraph, nearby_blurb, faq_items[]}, notes? }` → validated DTO (class-validator), `faq_items` ≤ 6, string length caps → `upsertOverride`.
- `DELETE /admin/seo/copy/override?path=&locale=` → `deleteOverride`.
- `POST /admin/seo/copy/generate-batch` `{ citySlug, limit?, force? }` → `{ generated, skipped }` via `generateMissingForCity`.

### Web

- `admin-api.ts`: `fetchSeoCopyStatus`, `generateSeoCopyOne`, `upsertSeoCopyOverride`, `deleteSeoCopyOverride`, `generateSeoCopyBatchForCity`, and `revalidateSeoPaths(paths[])` (POSTs the Next route below).
- `apps/web/app/api/revalidate/route.ts` (new): `POST { paths: string[] }` with `Authorization: Bearer <adminToken>`; verifies admin via `GET /auth/me` (role === "admin"); calls `revalidatePath(p)` for each localized path (`/en/...`, `/hi/...`). Returns `{ revalidated, paths }`. 401/403 on non-admin.
- `SeoCityReviewDrawer.tsx` (localities tab): new column with two `StatusPill` chips (EN, HI: Override=brand, AI=trust, Template=muted); per-row **Generate/Regenerate** + **Edit** buttons (`admin-btn admin-btn--ghost admin-btn--sm`); an **Edit-copy modal** (reuse `Drawer`) with locale toggle, the six copy fields, a "currently live" preview (from `GET /seo/copy`), Save → `upsertSeoCopyOverride`, Revert → `deleteSeoCopyOverride`; a drawer-level **"Generate all missing (≥3 listings)"** with a live `generated/skipped` readout. Every mutation → `revalidateSeoPaths` + refetch `copy-status` + toast.
- `generateMetadata` in the programmatic `page.tsx` files (localities first) reads override/AI `meta_title`/`meta_description` (via `fetchSeoCopy`) and prefers them over template metadata.

### Tests (TDD, both suites)

- API Vitest: `SeoCopyService` unit (fake-DB routing on SQL) for the 5 methods; `AdminSeoController` supertest (admin 200 / tenant 403 / 400 on bad override / audit INSERT asserted); cheap guard-metadata check on new routes.
- Web Vitest: extend `SeoCityReviewDrawer.test.tsx` (chips per status, Generate busy+refetch, Edit save flips chip to Override, batch counts, revalidate called); `generateMetadata` precedence unit test; `revalidate` route handler test (admin vs non-admin).
- Playwright: override/revert happy-path only (no LLM). Generate is LLM-backed → covered via mocked component tests, not CI E2E (documented, not pretended).

---

## Feature 2 — Embed live listing/PG cards in blog posts

**Goal:** blog authors insert live property/PG cards anywhere in a post via a token; readers get SSR, crawlable cards (current price, cover, beds, verified) linking to the listing/PG page. Dead embeds render nothing.

### Existing building blocks

- Blog body is **HTML** in `blog_posts.body_en` / `body_hi` (text). Rendered in `apps/web/app/[locale]/blog/[slug]/page.tsx` via `prepareBlogBody` (`stripBodyH1` + `localizeBlogBody`, both regex over `<h1>`/`<a>`) then a single `dangerouslySetInnerHTML`. `blog-body.ts` `KNOWN_ROUTES` already whitelists `listing` + `pg`.
- `ListingCardItem` (`apps/web/components/listing-card.tsx`, client) — crawlable Next `<Link>` to `/{locale}/listing/{id}` or `/{locale}/pg/{city}/{id}`; props `{ listing: ListingCardData, locale, heartSlot?, compact? }`.
- `PgListingCard` (`apps/web/components/pg/PgListingCard.tsx`, client) — `PgCard` shape (`starting_rent`, `verified`, `cover_photo`, …); link `/{locale}/pg/{city}/{id}`.
- Single-item fetch: listing `GET /listings/:id`; PG `getPgPublicListing(id)`. Search suggest for the picker: `useSearchSuggestions` → `GET /listings/search/suggest` (homes) + `/pg/suggest` (PG).
- Author editor: `BlogPreviewModal.tsx` has a `<textarea>` "Body (HTML)" bound to `body`; saves via `updateBlogPost` → `PATCH /admin/blog/:id` (`body_en`). `?ref=blog-{slug}` attribution is wired end-to-end.

### Token model

- `{{listing:<uuid>}}` and `{{pg:<citySlug>/<uuid>}}` stored literally in the HTML body. Strict uuid match; anything else stays literal HTML. Survives `stripBodyH1`/`localizeBlogBody` (they touch only `<h1>`/`<a>`).
- `parseBlogEmbeds(html): Segment[]` (pure) — ordered `{type:"html", html}` / `{type:"listing", id}` / `{type:"pg", city, id}`. Unit-tested.

### Render (SSR, crawlable)

- New async server component `BlogBody({ html, locale, slug })`: `prepareBlogBody` → `parseBlogEmbeds` → collect ids → fetch card data server-side in parallel (bounded, e.g. ≤12; dedupe) → render segments in order (`html` via per-fragment `dangerouslySetInnerHTML`, `listing` via `ListingCardItem`, `pg` via `PgListingCard`). Missing/unavailable → render nothing. Replaces the single `dangerouslySetInnerHTML` at `blog/[slug]/page.tsx` (ISR `revalidate=3600`). Cards link with `?ref=blog-{slug}` where feasible (optional `trackingRef` prop on the card, additive; fall back to no-ref).
- Card-data helpers (web): `fetchListingCard(id)` (maps `GET /listings/:id` detail → `ListingCardData`, cover = photos[0]); `fetchPgCard(city, id)` (maps `getPgPublicListing` → `PgCard`). Both return null on failure.

### Author UX

- `BlogPreviewModal`: **Insert property** / **Insert PG** buttons above the body textarea → a small picker using `useSearchSuggestions` (homes/PG) with inline result preview → on select, splice the token at the textarea caret (`selectionStart`). Read-mode preview renders resolved embeds via `BlogBody` so authors see the live card; unresolved → muted "Embed unavailable" placeholder (admin preview only). Editor stays English-body; tokens can also be hand-placed in `body_hi` (render supports both) — expanding the editor to `body_hi` is a non-goal for this PR.

### Guard

- Unavailable/deleted/non-published listing → fetch returns null → segment dropped (production renders nothing; never throws). Malformed token → left as literal text.

### Tests (TDD, both suites)

- Web Vitest: `blog-embeds.test.ts` for `parseBlogEmbeds` (single/multiple/adjacent/malformed/both kinds, order, strict uuid); `BlogBody` component (interleaves html + cards in order, missing → nothing, crawlable href present) with mocked fetch helpers; `BlogPreviewModal` caret insertion (mocked suggestions).
- API Vitest: only if endpoints change (reusing existing endpoints keeps API changes minimal; add tests for any new/extended endpoint or `trackingRef`).
- Playwright: optional light happy-path (seeded listing + published post) — primary coverage is unit/component; note if E2E seeding isn't feasible.

---

## Non-goals

- Landmarks/metro copy control (F1 v1 = localities only).
- Editing `body_hi` in the blog modal (F2).
- Merging either PR (stop at PR for review).
