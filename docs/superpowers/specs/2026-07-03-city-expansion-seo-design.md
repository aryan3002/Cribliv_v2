# City Expansion (Programmatic SEO) — Slice 1 Design

- **Date:** 2026-07-03
- **Status:** Approved (design) — implementation plan to follow
- **Owner:** Aryan Tripathi
- **Slice:** 1 of the SEO program (city-by-city expansion). Blog engine is slice 2.

---

## 1. Context

The broader SEO plan (`~/Downloads/...squishy-gem.md`) was written against a **divergent branch** and is ~85% valid but stale in specifics (migrations were at `0027` in the plan; master is at `0042`, next free `0043`. The Core Web Vitals / Unlighthouse gate the plan treats as a shipped foundation does **not** exist on master. An entire PG-operator subsystem shipped that the plan doesn't know about).

Crucially, the **programmatic engine already exists and is production-ready for Lucknow**:

- 6 route templates under `apps/web/app/[locale]/city/[citySlug]/**` (locality, locality/intent, metro/station, metro/station/intent, near/landmark, near/landmark/intent), rendered **on-demand with 24h ISR** (no `generateStaticParams` — so enabling a city is a *runtime* concern, not a build-time rebuild).
- `ProgrammaticPage` component with JSON-LD, breadcrumbs, StatsCard, IntentGrid, ListingsGrid, FaqSection, RelatedLinks.
- `SeoCopyService` (AI copy + `seo_page_copy` cache + `seo_page_overrides`) and `SeoAggregatesService` (median rents via `percentile_cont`, `listing_count` per place).
- Templates already fetch all data through `apps/web/lib/seo-api.ts` → the API's `/v1/seo/*` endpoints.
- Intent registry (`apps/web/lib/intent-filters.ts` → `data/seeds/lucknow/intents.json`): **26 intents** across property-type / audience / budget / lifestyle.

The blocker to more cities is **not code** — it's (a) a hardcoded `SUPPORTED_CITIES = new Set(["lucknow"])` gate in each template, (b) a sitemap that hardcodes Lucknow via direct JSON imports, and (c) the absence of per-city seed data (localities / micro-localities / landmarks with coordinates).

## 2. Goals

1. Turn city expansion into a **repeatable data + config operation**, not a code change.
2. Prove the entire pipeline end-to-end on **Noida** (data → DB → live pages → sitemap → indexable), with **Lucknow** as the working reference.
3. Make Lucknow strictly better along the way (sitemap index, thin-content guard).
4. Leave the **NCR belt** (Gurugram, Ghaziabad, Faridabad, Delhi) as pure "run the generator, review, toggle on."

## 3. Non-goals (explicitly out of this slice)

- Blog engine, GSC/Indexing API, market reports, llms.txt/AEO, link building, pillar/PageRank (later slices).
- Rebuilding the Core Web Vitals / Unlighthouse CI gate (separate decision).
- Per-intent thin-content scoring (v1 uses place-level `listing_count`).
- AI-generated photo alt text / listing `seo_slug` (belongs to the listing-SEO slice).

## 4. Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| City order | Lucknow (reference) → **Noida** (proof) → Delhi-NCR belt | Demand-led, prove-then-scale |
| Data sourcing | **AI draft (Azure OpenAI) + Google Places/Geocoding verify** → reviewed JSON | Scales to all cities; coords authoritative; hallucinations dropped. Places/Geocoding confirmed enabled on `GOOGLE_MAPS_APIKEY`. |
| Enable mechanism | **DB-driven** `seo_city_config` table + admin toggle (no redeploy) | Matches plan intent; reuses existing seo-api fetch pattern; makes sitemap DB-driven |
| Config storage | **Separate `seo_city_config` table** (not a column on `cities`) | Isolates SEO concern; holds counts / notes / enabled_at |
| Thin-content | `noindex` when place `listing_count < 3`; exclude from sitemap | Standard SEO hygiene; field already returned by aggregates |
| Dual-mode | SEO services are **DB-only** (no `AppStateService` fallback) — follow the existing SEO module convention, not the payments convention | Consistency with `SeoCopyService`/`SeoAggregatesService` |

## 5. Architecture & data flow

```
generate-city.ts ──(Azure OpenAI draft)──► locality/landmark candidates
     │──(Google Geocoding/Places: canonical name + lat/lng, drop non-existent)──► data/seeds/noida/*.json
     ▼
human review → git commit → pnpm db:seed (generalized loader) → Postgres (localities/landmarks/metro)
     ▼
admin flips Noida ON → seo_city_config.programmatic_enabled = true  (audited to admin_actions)
     ▼
6 templates gate on fetchEnabledCities()  +  sitemap.generateSitemaps() emits per-city chunk (thin excluded)  +  generateMetadata noindexes thin pages
```

Single source of truth for "which cities are live" = `seo_city_config` (DB), surfaced via `GET /v1/seo/cities`, consumed by both the templates and the sitemap.

## 6. Components

### 6.1 Migration `0043_seo_city_config.sql` (+ `.rollback.sql`)
```sql
CREATE TABLE IF NOT EXISTS seo_city_config (
  city_slug            text PRIMARY KEY REFERENCES cities(slug) ON DELETE CASCADE,
  programmatic_enabled boolean NOT NULL DEFAULT false,
  locality_count       int NOT NULL DEFAULT 0,
  landmark_count       int NOT NULL DEFAULT 0,
  metro_count          int NOT NULL DEFAULT 0,
  indexable_count      int NOT NULL DEFAULT 0,   -- places with listing_count >= 3
  enabled_at           timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- Seed: lucknow enabled=true (behavior unchanged), noida enabled=false until reviewed.
```
Counts are maintained by the admin `PATCH`/refresh path (recomputed from `SeoAggregatesService`), not by the hot page path.

### 6.2 Data generator + seed-loader generalization
- **`data/seeds/generate-city.ts`** (dev script, run like `seed.ts`): `--city <slug>`.
  1. **Draft** — Azure OpenAI (reuse `SeoCopyService`'s `readAiConfig()` env convention) produces candidate parent localities, micro-localities (with `parent_slug`), and landmarks (typed to the `landmark_type` enum) for the city, as structured JSON.
  2. **Verify** — Google Geocoding/Places (`GOOGLE_MAPS_APIKEY`, same key the map module uses) resolves canonical name + `lat`/`lng` for each candidate; entries with no confident match are dropped and logged.
  3. **Emit** — write `data/seeds/<city>/localities.json`, `micro-localities.json`, `landmarks.json` in the exact shapes the loader expects.
- **Generalize `data/seeds/seed.ts`**: today the micro-locality and landmark loaders hardcode `"lucknow"` (`cityBySlug.get("lucknow")`). Change to iterate over every `data/seeds/<citySlug>/` directory, resolving the city per directory. Metro loading is already generalized (globs `metro-stations*.json`). Lucknow load path must remain byte-for-byte equivalent.
- **Data shapes** (unchanged, must match loader):
  - `localities.json`: `{ city_slug, slug, name_en, name_hi, pincode?, lat?, lng? }[]`
  - `<city>/micro-localities.json`: `{ slug, name_en, name_hi, parent_slug, lat?, lng?, seo_aliases? }[]`
  - `<city>/landmarks.json`: `{ slug, name_en, name_hi, type, aka?, lat, lng, primary_locality_slug? }[]` (`type` ∈ college|hospital|mall|market|station|airport|it_park|office|religious|park|stadium|monument)

### 6.3 Noida dataset
Generated → **human-reviewed** (git diff) → committed under `data/seeds/noida/`. Metro already present (`metro-stations-noida.json`).

### 6.4 API endpoints
- **`GET /v1/seo/cities`** (public) → `{ items: [{ city_slug, programmatic_enabled, locality_count, landmark_count, metro_count, indexable_count }] }`. Returns only `programmatic_enabled = true` for the public gate (or all, filtered client-side — decided in plan). New `SeoCityConfigService` (DB-only).
- **`GET /v1/admin/seo/cities`** (`@Roles("admin")`) → all cities + config + live counts.
- **`PATCH /v1/admin/seo/cities/:slug`** (`@Roles("admin")`) → `{ programmatic_enabled, notes? }`; sets `enabled_at`, refreshes counts from `SeoAggregatesService`, writes an `admin_actions` audit row.

### 6.5 Web city gate
- Add `fetchEnabledCities()` to `apps/web/lib/seo-api.ts` (Next `fetch` with `revalidate` so it's cached, not per-request). Returns the enabled slug set.
- Replace `SUPPORTED_CITIES = new Set(["lucknow"])` in all **6** templates with a gate on `fetchEnabledCities()`; disabled/unknown city → `notFound()`.
- **Fallback:** if the API is unreachable at request time, fall back to a hardcoded `["lucknow"]` so the reference city never goes dark.

### 6.6 Thin-content guard
In each of the 6 templates' `generateMetadata`, when the resolved place's `aggregates.listing_count < 3`, pass `noindex: true` to `buildPageMetadata` (already supported). Applies to Lucknow too (correct hygiene). Intent pages use the parent place's count as the v1 proxy.

### 6.7 Sitemap index
Convert `apps/web/app/sitemap.ts` from one monolith to Next's **`generateSitemaps()`**:
- `generateSitemaps()` returns `{ id }` for a `core` chunk, a `listings` chunk, and one chunk **per enabled city** (from `GET /v1/seo/cities`).
- Each city chunk is built from DB data (localities/landmarks/metro via seo-api) × applicable intents, **excluding thin (`listing_count < 3`) places**.
- Removes the hardcoded `lucknow*` JSON imports and `LUCKNOW_PARENT_LOCALITIES`. `robots.txt` already references the sitemap; Next emits the sitemap index automatically.
- Respect the 50k-URL per-chunk cap (per-city chunking keeps us well under).

### 6.8 Admin "Programmatic SEO" tab (13th tab)
- Web: add `"seo"` (label "Programmatic SEO") to the `AdminTab` union (`AdminSidebar.tsx`), a nav item, an `AdminShell.tsx` switch case, and a new `components/admin/tabs/SeoProgrammaticPages.tsx` using `DataTable`: one row per city (enabled toggle, locality/landmark/metro/indexable counts, last-enabled). Toggle → `PATCH`.
- `admin-api.ts` client functions for the two admin endpoints.

### 6.9 Feature flag (optional master kill-switch)
`ff_programmatic_seo_cities_enabled` (env `FF_PROGRAMMATIC_SEO_CITIES_ENABLED`, default **true**). When false → gate falls back to Lucknow-only. The real per-city control is the DB table.

## 7. Backward compatibility & risks

- **Lucknow must not regress.** The gate swap, sitemap refactor, and seed-loader generalization must leave Lucknow's live URLs and sitemap entries equivalent. Verified by diffing Lucknow sitemap output before/after.
- **Thin guard on Lucknow:** some Lucknow localities may currently have `<3` listings and will become `noindex`. This is intended (they shouldn't rank thin), but call it out so it's a conscious change.
- **Build-time coupling:** `sitemap.ts` + `fetchEnabledCities()` must tolerate the API being unavailable during build/ISR (graceful fallback, never throw).
- **Generator quality:** AI hallucination and coordinate accuracy are mitigated by the Places-verify pass + mandatory human review before commit. Never auto-enable a city.

## 8. Verification strategy

- `pnpm --filter @cribliv/api build && pnpm --filter @cribliv/api test` — new services/endpoints compile + pass.
- `pnpm --filter @cribliv/web build` — templates + sitemap compile.
- `pnpm db:migrate && pnpm db:seed` — 0043 applies; Noida data loads without breaking Lucknow.
- `curl localhost:3000/sitemap.xml` → sitemap **index**; `curl .../sitemap/1.xml` (or per-city id) → Noida URLs with thin places excluded; Lucknow chunk equivalent to before.
- Toggle Noida in admin → pages resolve at `/en/city/noida/...`; disabling → `notFound()`.
- A place with `<3` listings → `<meta name="robots" content="noindex">`.
- Generator dry-run on Noida produces verified JSON; committed after review.

## 9. Rollout

1. Ship migration + generator + generalized loader + API + web changes with Noida **disabled**.
2. Run generator, review + commit Noida data, `db:seed`.
3. Flip Noida on in admin; watch indexation as inventory grows.
4. Repeat generator → review → toggle for Gurugram, Ghaziabad, Faridabad, Delhi.
