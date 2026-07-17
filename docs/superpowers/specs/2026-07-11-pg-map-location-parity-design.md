# PG Map Location Parity — Design Spec (Revised)

- **Date:** 2026-07-11
- **Status:** Approved design of record. Supersedes the original codex draft of the
  same date. No implementation has started.
- **Repository:** `/Users/satviksarthak/Developer/Cribliv_v2_final`
- **Scope:** PG browse map parity (mirror Homes `/search`) and PG detail-page
  location map backed by real coordinates with honest provenance.

## 0. What changed from the original codex draft (and why)

> **Revision 2 (post over-engineering review): NO DATABASE MIGRATION.**
> The provenance column and `cities.lat/lng` seed are **dropped**. Exactness is
> derived at read time; the city fallback is derived web-side. See §0a. The
> migration-based text in later sections is retained only as rejected-alternative
> context — the **§0a approach is authoritative**.

This revision keeps the codex draft's two best calls — **reuse the existing map
foundation** and be honest about exact-vs-fallback location — but corrects the
approach after verifying every claim against the live codebase with parallel
research agents.

### 0a. Authoritative approach (no migration)

- **Exactness is derived at read time, not stored.** `projectGeo()` writes the
  locality centroid _verbatim_ into `listing_locations.lat/lng` when there is no
  operator pin (`lat = Number(localities.lat)`, both `numeric(9,6)`). So a
  locality-sourced row has `ll.lat == localities.lat` exactly, and an operator pin
  essentially never does. The PG detail loader selects `ll.lat/lng` **and**
  `loc.lat/lng` (already joined) and a pure resolver labels the point `'locality'`
  when they match (`< 1e-6`), else `'exact'`. Reliable, because the fallback copies
  the centroid value. No column, no backfill, no `projectGeo` change.
- **The `'city'` tier is derived web-side** via the existing `cityCentroid()` in
  `apps/web/lib/city-bboxes.ts` (the same source `/map` and `SearchResultsMap`
  use). `PgDetailLocationMap` falls back to it when `location_point` is null. No
  `cities` schema change.
- **`has_exact_geo` is left untouched.** Its `(ll.lat IS NOT NULL)` bug feeds the
  edit-wizard score meter — a different feature. Flag separately; do not bundle.

### 0b. Historical (rejected) alternative: stored provenance

The following sub-points describe the migration-based design that was considered
and rejected as over-engineered. Kept for traceability only.

1. **(rejected)** `location_source` column on `listing_locations`. Correct for new
   writes, but adds a column + backfill + `projectGeo` change for a gain the
   read-time compare already delivers reliably.

2. **(rejected)** `cities.lat/lng` + seed for a DB-backed `'city'` tier. The web
   already has `cityCentroid()` for all 8 cities; a schema change is unnecessary
   for a rare fallback.

3. **Browse-map coordinates already exist for the full CriblMap; the in-page
   preview mirrors `/search` with `SearchResultsMap`.** The full CriblMap
   (`/[locale]/map`) is already fully PG-capable (viewport fetch of
   `/listings/search/map?listing_type=pg`, PG pin styling, grid clustering,
   click→`/pg/{city}/{id}`). We do **not** rebuild it. The `/pg` in-page map
   mirrors Homes `/search` exactly: a lightweight `SearchResultsMap` preview of
   the current page's cards, plus an "Open full CriblMap" link to
   `/map?city=<city>&listing_type=pg`.

4. **Locality coordinates are already broadly seeded.** Not Lucknow-only. The SQL
   migration `0012` seeds only Lucknow, but `pnpm db:seed` (`data/seeds/seed.ts`)
   inserts **538 localities with lat/lng** across delhi, jaipur, lucknow,
   noida(191), gurugram(221), faridabad(70), ghaziabad(53). So `projectGeo()`'s
   locality-centroid fallback already works everywhere PG operates. No locality
   seed work is in scope.

## 1. Current-state facts (all verified against code)

### Homes map foundation (reuse targets)

- `apps/web/app/[locale]/search/SearchResultsMap.tsx` — lightweight preview.
  Per-listing contract is `SearchMapListing` (lines 11–22):
  `{ id, title, city, city_name?, locality?, lat?, lng?, listing_type:"flat_house"|"pg",
monthly_rent:number, verification_status:"unverified"|"pending"|"verified"|"failed",
cover_photo? }`. There is **no** `rent`, `bhk`, or `verified` field.
  - `validCoord` (lines 51–68) rejects non-finite coords, coords outside the India
    bbox (`lat<6||lat>38||lng<68||lng>98`), and coords outside `CITY_BBOXES[city]`
    (±0.08°). Unknown city slug → city-bounds check is skipped.
  - `center` (lines 106–121) = centroid of valid pins, else `cityCentroid(city)`,
    else hardcoded Lucknow `{26.825, 80.95}`.
  - Fallback UI (no Maps key / no valid pins / load error): decorative CSS map.
  - Active-card href uses `listingHref` (lines 222–228) which already routes PG to
    `/{locale}/pg/{city}/{id}`. Marker color already branches PG green (line 185).
    **The component needs no change to serve PG.**
- `apps/web/app/[locale]/search/page.tsx` passes `response.items` (a superset of
  `SearchMapListing`) straight in (lines 487–496); hardcodes
  `listing_type:"flat_house"` (line 210) and redirects `listing_type=pg` to `/pg`
  (lines 181–196). Both must remain unchanged.
- Full CriblMap (`/[locale]/map`, `map-client` → `useMapPins`) fetches
  `GET /listings/search/map?sw_lat&sw_lng&ne_lat&ne_lng&limit=500&listing_type=pg…`
  viewport-driven; PG is first-class. `map/page.tsx` parses `?city` + `?listing_type`
  - `?lat/lng/zoom/listing`. **Already works for PG — link target only.**
- `apps/web/lib/city-bboxes.ts` — `CITY_BBOXES` covers exactly 8 cities: delhi,
  gurugram, noida, ghaziabad, faridabad, chandigarh, jaipur, lucknow. `cityCentroid`
  derives centroid from the bbox. **These 8 == the seeded PG cities**, so no
  mis-centering gap today; any _new_ city must be added here too.
- Maps key env var: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (`apps/web/lib/google-maps.ts:7`).

### PG browse gaps

- `apps/web/app/[locale]/pg/page.tsx` (lines 180–204) renders a decorative
  `tenant-map-card` aside with hardcoded pins. Exact label strings (for RED tests):
  **`PG · ₹9.5k`** (middot + ₹ glyph), **`Food`**, **`Verified PG`**. City label is
  dynamic (`filters.city` title-cased or literal `"PG clusters"`).
- `apps/web/app/[locale]/pg/[city]/page.tsx` (line 104) has only a decorative
  `aria-hidden` blob `pg-city-hero__map` (no pins). Fetches
  `searchPgListings({ city, page_size:"12" })`.
- `apps/web/lib/pg-public-api.ts` — `PgCard` (lines 3–16) has **no** lat/lng/
  location_source/locality_slug. `PgPublicDetail` (lines 25–58) has `city_slug` +
  `locality_slug` (slugs only) and **no** coordinates.
- `apps/api/src/modules/pg-operator/services/pg-search.service.ts` — SELECT
  (lines 209–232) joins `listing_locations ll` but projects no coordinate, no
  locality slug, no location source.

### PG detail + geo projection

- `apps/api/.../pg-listing.service.ts`:
  - `PgListingDetail` (lines 48–97) exposes `has_exact_geo:boolean`, `city_slug`,
    `locality_slug` — **no numeric lat/lng**.
  - Detail loader (lines 743–793) derives `(ll.lat IS NOT NULL) AS has_exact_geo`
    (line 777) and never selects `ll.lat/ll.lng`. **This is the core bug**: a
    locality-centroid fallback reads as "exact".
  - `projectGeo()` (lines 354–396): effective coord = operator pin if present,
    else locality centroid (from `localities.lat/lng`); writes the effective coord
    to **both** `listing_locations` and `pg_properties`, so the two are always
    equal afterward and the exact-vs-fallback distinction is lost. → provenance
    field is genuinely required.
- `apps/web/components/pg/PgDetailClient.tsx` — Location section (lines 816–842)
  is a `MapPin` icon + slug text only. No map. Sections use the `ld-section` /
  `ld-section__head` / `ld-section__title` / icon-span / `<h2>` pattern; Location
  uses `ld-section__icon--slate`. A map section slots into `detail-layout__content`.
- No `location_source` column exists anywhere (verified: repo-wide grep = 0).
  Latest migration is `0053_…`; new file is `0054_pg_location_source_and_city_geo.sql`.

### Test + dual-mode patterns

- API unit tests use a fake DB `{ isEnabled:()=>true, query: vi.fn(...) }`, assert
  SQL fragments + row→DTO mapping; count queries matched by `/count\(\*\)/i`
  (`pg-search.service.test.ts` lines 4–18). API integration tests use a real DB
  (`pg-public-search.integration.test.ts`, `pg-listing.controller.integration.test.ts`).
- Web tests `vi.mock` the `pg-public-api` module (e.g. `pg-city.test.tsx` lines 4–6);
  map-page test mocks `next/dynamic` and asserts derived props.
- `PgSearchService` and `searchListingsForMap` **return empty when DB disabled** —
  no AppState fallback. New coordinate fields need only the SQL branch.

## 2. Functional requirements

1. `/[locale]/pg` and `/[locale]/pg?city=<city>` render a real `SearchResultsMap`
   preview of the current page's PG cards when at least one card has a usable point.
2. `/[locale]/pg/[city]` renders the same preview in the live-listings area when
   listings exist; a no-inventory city page shows no fake pins.
3. Browse-map cards route to PG detail via existing `listingHref` behavior.
4. Both pages expose an "Open full CriblMap" link carrying `city` and
   `listing_type=pg`.
5. PG detail renders a location map when `location_point` is available.
6. Detail shows exact operator coordinates when a precise pin was stored
   (`location_source='exact'`).
7. Absent exact, detail shows a locality map when the locality has a seeded centroid
   (`location_source='locality'`).
8. Absent exact and locality, detail shows a city map from `cities.lat/lng`
   (`location_source='city'`).
9. Fallback maps are labeled as area/city maps, never as exact property pins.
10. Public responses expose no precise address text (existing masking preserved).
11. Homes `/search` stays flat/house-only; no PG bleed.
12. Preserve dual-mode: DB-enabled uses Postgres; DB-disabled PG paths return empty
    and never fabricate coordinates.

## 3. Data contract

```ts
// packages/shared-types (or apps/web/lib/pg-public-api.ts + API mirror)
export type PgLocationSource = "exact" | "locality" | "city";

export interface PgMapPoint {
  lat: number;
  lng: number;
  source: PgLocationSource;
  label: string; // e.g. "Gomti Nagar, Lucknow" or "Lucknow"
  city_slug: string;
  locality_slug: string | null;
}

export interface PgCard {
  // …existing fields…
  lat: number | null;
  lng: number | null;
  location_source: PgLocationSource | null; // null when no coord projected
  locality_slug: string | null;
}

export interface PgPublicDetail {
  // …existing fields…
  location_point: PgMapPoint | null;
}
```

- Browse cards keep top-level `lat/lng` because `SearchResultsMap` expects that
  shape. Detail uses a structured `location_point` because the UI needs provenance
  - labeling.
- A single shared resolver `resolvePgMapPoint(row)` builds the point for both card
  and detail paths to prevent drift.

## 4. Persistence & migration (`0054_pg_location_source_and_city_geo.sql`)

```sql
-- 1. Provenance on the generic projection (read by both PG card + detail).
ALTER TABLE listing_locations
  ADD COLUMN IF NOT EXISTS location_source text
  CHECK (location_source IN ('exact', 'locality', 'city'));

-- 2. City centroid columns for the DB-backed city fallback tier.
ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;

-- 3. Seed the 8 supported city centroids (values = cityCentroid() bbox midpoints).
UPDATE cities SET lat = 28.640, lng = 77.095 WHERE slug = 'delhi';
UPDATE cities SET lat = 28.450, lng = 76.985 WHERE slug = 'gurugram';
UPDATE cities SET lat = 28.525, lng = 77.425 WHERE slug = 'noida';
UPDATE cities SET lat = 28.690, lng = 77.415 WHERE slug = 'ghaziabad';
UPDATE cities SET lat = 28.400, lng = 77.335 WHERE slug = 'faridabad';
UPDATE cities SET lat = 30.735, lng = 76.780 WHERE slug = 'chandigarh';
UPDATE cities SET lat = 26.895, lng = 75.815 WHERE slug = 'jaipur';
UPDATE cities SET lat = 26.825, lng = 80.950 WHERE slug = 'lucknow';

-- 4. Backfill provenance for existing PG rows.
--    Non-Lucknow-style rows: a stored coord that does NOT match its locality
--    centroid is necessarily an operator pin (locality centroids only came from
--    the seeded localities table). Coord ≈ locality centroid → 'locality'.
UPDATE listing_locations ll
SET location_source = CASE
  WHEN ll.lat IS NULL OR ll.lng IS NULL THEN NULL
  WHEN loc.lat IS NOT NULL AND loc.lng IS NOT NULL
       AND abs(ll.lat::float8 - loc.lat::float8) < 0.0005
       AND abs(ll.lng::float8 - loc.lng::float8) < 0.0005 THEN 'locality'
  ELSE 'exact'
END
FROM listings l
LEFT JOIN localities loc ON loc.id = ll.locality_id
WHERE ll.listing_id = l.id AND l.listing_type = 'pg';
```

- `cities.lat/lng` typed `double precision` to match the newer `pg_properties`
  lat/lng and avoid the `numeric(9,6)` legacy divergence.
- Also update `data/seeds/cities.json` + `data/seeds/seed.ts` cities INSERT to
  carry the same centroids so a fresh `pnpm db:seed` matches the migration.
- Backfill tolerance `0.0005°` (~55 m) biases ambiguous rows toward `'locality'`
  (honest area map) rather than a false `'exact'`.

## 5. Backend implementation

### 5.1 `projectGeo()` — write provenance

Track which branch produced the effective coord and persist it into
`listing_locations.location_source`:

- operator `prop.lat/lng` present → `'exact'`
- else locality centroid used → `'locality'`
- else no coord written → leave `location_source` null (city tier is resolved at
  read time from `cities.lat/lng`, not written into the projection)

Add `location_source` to the existing `UPDATE listing_locations SET lat=$2,lng=$3…`.
`pg_properties` writes are unchanged.

### 5.2 Shared resolver

```ts
// apps/api/src/modules/pg-operator/services/pg-geo.util.ts
export function resolvePgMapPoint(row: {
  ll_lat: number | null;
  ll_lng: number | null;
  location_source: string | null;
  city_lat: number | null;
  city_lng: number | null;
  city_slug: string;
  locality_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
}): PgMapPoint | null;
```

Precedence: `location_source='exact'|'locality'` with `ll_lat/lng` → that point;
else if `city_lat/lng` present → `{source:'city', city coords}`; else `null`.
`label` = `[locality_name, city_name].filter(Boolean).join(", ")` for exact/locality,
`city_name` for city.

### 5.3 PG search SELECT (`pg-search.service.ts`)

Add to the row SELECT (no new joins — `ll`, `loc`, `c` already joined; add
`LEFT JOIN cities`… already `JOIN cities c`):
`ll.lat::float8 AS lat, ll.lng::float8 AS lng, ll.location_source, loc.slug AS locality_slug`.
Map into the card via `resolvePgMapPoint` for `location_source`, and set top-level
`lat/lng` from the resolved point (so locality/city fallbacks also plot). Card also
needs `city.lat/lng` selected for the city tier.

### 5.4 PG detail loader (`pg-listing.service.ts`)

- Replace `(ll.lat IS NOT NULL) AS has_exact_geo` with selecting `ll.lat`, `ll.lng`,
  `ll.location_source`, `c.lat AS city_lat`, `c.lng AS city_lng`, `c.name_en`,
  `loc.name_en`. Derive `has_exact_geo := location_source = 'exact'`.
- Build `location_point` via `resolvePgMapPoint`. Add to `PgListingDetail` and map
  into `PgPublicDetail.location_point`.

## 6. Frontend implementation

### 6.1 Browse adapter + `/pg`

```ts
// apps/web/lib/pg-map-adapter.ts
export function pgCardToSearchMapListing(card: PgCard): SearchMapListing {
  return {
    id: card.id,
    title: card.title,
    city: card.city,
    city_name: card.city_name ?? undefined,
    locality: card.locality,
    lat: card.lat,
    lng: card.lng,
    listing_type: "pg",
    monthly_rent: card.starting_rent ?? 0,
    verification_status: card.verified ? "verified" : "pending",
    cover_photo: card.cover_photo
  };
}
```

Replace the static aside in `pg/page.tsx` with `<SearchResultsMap locale city={filters.city || firstCard.city || "lucknow"} listings={items.map(pgCardToSearchMapListing)} mapHref={/${locale}/map?city=…&listing_type=pg} />`. Preserve card grid + pagination.

### 6.2 `/pg/[city]`

Same preview in the live-listings section when `listings.items.length > 0`; keep the
decorative hero blob only when there is no inventory (no fake pins).

### 6.3 `PgDetailLocationMap` (new client component)

- Input: `detail.location_point`, `detail.id`, `locale`, `city_slug`.
- Renders a Google map (reuse `apps/web/lib/google-maps.ts` loader) centered on the
  point; zoom by source: exact 15, locality 13, city 12.
- Labels: exact → precise pin; locality → "Approximate area"; city → "City area".
- "Explore on CriblMap" link →
  `/{locale}/map?city={city_slug}&listing_type=pg&lat={lat}&lng={lng}&zoom={zoom}&listing={id}`.
- Null point → keep today's MapPin + text fallback.
- Mount inside the existing Location `ld-section` in `PgDetailClient.tsx`, matching
  the `ld-section__head` design system.

## 7. TDD plan (RED → GREEN per slice)

### API RED

- PG search returns `lat/lng/locality_slug/location_source` when projection has them;
  `location_source='locality'` for a centroid row; empty when DB disabled.
- PG detail returns `location_point.source='exact'` + exact coords for a pinned row;
  `='locality'` for centroid; `='city'` (from `cities.lat/lng`) when only city coord;
  `null` when none. `has_exact_geo` true **only** for `'exact'`.
- `projectGeo` writes `location_source='exact'` for an operator pin, `'locality'`
  for a centroid fallback.
- Migration/backfill (integration): coord ≈ locality centroid → `'locality'`;
  coord ≠ centroid → `'exact'`; null coord → null.

### Web RED

- `/pg` renders `SearchResultsMap` output with PG points; old labels `PG · ₹9.5k`,
  `Food`, `Verified PG` absent; full-map href includes `listing_type=pg` + `city`;
  active card href = `/en/pg/<city>/<id>`.
- `/pg/[city]` renders the preview when listings exist; no pins when empty.
- `PgDetailClient` renders the map section when `location_point` present; exact vs
  locality vs city copy + full-map link with `lat/lng/zoom`; null → text fallback.

### Gates

```bash
pnpm --filter @cribliv/api test -- pg
pnpm --filter @cribliv/web test -- pg
pnpm typecheck
```

## 8. Rollout slices (each stops at RED/GREEN evidence)

1. **Migration + provenance write** — `0054_…`, `cities.lat/lng` seed, seed.ts/json,
   `projectGeo` writes `location_source`, backfill. Tests: projectGeo + backfill.
2. **Shared resolver + PG detail API** — `resolvePgMapPoint`, detail SELECT rewrite,
   `location_point`, `has_exact_geo` fix. Tests: detail unit + integration.
3. **PG search API** — card `lat/lng/location_source/locality_slug`. Tests: search unit.
4. **PG browse preview** — adapter, `/pg` + `/pg/[city]` `SearchResultsMap`. Tests: web.
5. **PG detail map** — `PgDetailLocationMap`. Tests: web.
6. **Regression** — full map/search suites confirm Homes + CriblMap unaffected.

## 9. Risks & mitigations

- **Backfill ambiguity:** biased toward `'locality'`; future writes explicit. Low blast
  radius (only affects exact-pin labeling on legacy rows).
- **Locality-centroid pin stacking in the preview:** current-page cards only (~12–20),
  minor; full clustering already handled by CriblMap. Marker jitter is out of scope.
- **Missing Maps key:** `SearchResultsMap` + detail map both degrade to a non-map
  fallback; tests assert without a real key.
- **New city added later:** must be added to `CITY_BBOXES`, `cities` seed, and
  localities seed together — documented in slice 1.

## 10. Out of scope

Rebuilding CriblMap; mixing PG into `/search`; homepage search; PG commercial-flow
pricing/CTA; blog/SEO; admin map picker; Google Places autocomplete rework; marker
jitter/clustering redesign; persisting `formatted_address` (captured but unused today).
