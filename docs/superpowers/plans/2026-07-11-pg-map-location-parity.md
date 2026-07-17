# PG Map Location Parity Implementation Plan (Lean — no migration)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PG browse pages a real `SearchResultsMap` preview (mirroring Homes `/search`) and PG detail pages a location map backed by the coordinates already in the DB, with honest exact/locality/city labeling — and **no database migration**.

**Architecture:** Reuse the existing Homes map foundation; do not rebuild CriblMap. Coordinates already live in `listing_locations.lat/lng` (populated by `projectGeo()` as either the operator pin or the locality centroid). Exactness is derived at read time by comparing the stored coordinate to the locality centroid (the fallback stores the centroid verbatim, so the comparison is reliable). The rare city-level fallback is derived web-side via the existing `cityCentroid()` in `city-bboxes.ts`. No schema change, no backfill.

**Tech Stack:** NestJS + raw SQL (Postgres/PostGIS), Next.js 14 App Router, TypeScript strict, Vitest (API unit), Vitest + @testing-library/react (web), Google Maps JS API.

## Global Constraints

- Package manager `pnpm`; TypeScript strict; match each file's existing style.
- **No DB migration, no `projectGeo` change, no `has_exact_geo` change.** `has_exact_geo` feeds the edit-wizard score meter (a different feature); its pre-existing bug is out of scope — flag separately, do not fix here.
- API dual-mode: PG paths return **empty** when `DatabaseService.isEnabled()` is false — never fabricate coordinates.
- Do not modify `apps/web/app/[locale]/search/page.tsx` (stays `flat_house`-only; keeps redirecting `pg` → `/pg`).
- Do not modify `SearchResultsMap.tsx` behavior — it is already PG-aware (green markers + `listingHref` → `/pg/{city}/{id}`). The only allowed change is adding `export` to its `SearchMapListing` interface if not already exported.
- Public responses expose no street address — only coordinates + coarse locality/city labels.
- Maps key env var `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`; web tests run without it and assert the non-map fallback + labels + links.
- Exact browse-aside label strings to remove (RED assertions): `PG · ₹9.5k`, `Food`, `Verified PG`.
- `PgLocationSource = "exact" | "locality" | "city"`. API detail emits `'exact'|'locality'|null`; `'city'` is added web-side from `cityCentroid()`.
- Locality-fallback detection: `ll.lat` and `ll.lng` both equal the locality centroid within `1e-6` → `'locality'`; otherwise (coords present) → `'exact'`.
- Test commands: `pnpm --filter @cribliv/api test -- <pattern>`, `pnpm --filter @cribliv/web test -- <pattern>`, `pnpm typecheck`.

---

## File Structure

**Create:**

- `apps/api/src/modules/pg-operator/services/pg-geo.util.ts` — `PgMapPoint`, `PgLocationSource`, `resolvePgMapPoint`.
- `apps/api/test/pg-geo.util.test.ts`
- `apps/web/lib/pg-map-adapter.ts` — `pgCardToSearchMapListing`.
- `apps/web/lib/__tests__/pg-map-adapter.test.ts`
- `apps/web/components/pg/PgDetailLocationMap.tsx`
- `apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx`
- `apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx`

**Modify:**

- `apps/api/src/modules/pg-operator/services/pg-listing.service.ts` — detail loader: select coords + locality centroid + names; build `location_point`. (Leave `has_exact_geo` as-is.)
- `apps/api/src/modules/pg-operator/services/pg-search.service.ts` — SELECT + card add `lat`, `lng`.
- `apps/web/lib/pg-public-api.ts` — `PgMapPoint`/`PgLocationSource`; `PgCard` += `lat`,`lng`; `PgPublicDetail` += `location_point`.
- `apps/web/app/[locale]/pg/page.tsx` — replace static aside with `SearchResultsMap`.
- `apps/web/app/[locale]/pg/[city]/page.tsx` — preview in live-listings section.
- `apps/web/components/pg/PgDetailClient.tsx` — mount `PgDetailLocationMap`.
- `apps/web/app/globals.css` — minimal styles for the detail map.
- Existing tests: `apps/api/test/pg-search.service.test.ts`, PG detail service test, `pg-city.test.tsx`.

---

## SLICE 1 — Detail API: resolver + `location_point`

### Task 1: `resolvePgMapPoint` (read-time exactness)

**Files:**

- Create: `apps/api/src/modules/pg-operator/services/pg-geo.util.ts`
- Test: `apps/api/test/pg-geo.util.test.ts`

**Interfaces:**

- Produces:

```ts
export type PgLocationSource = "exact" | "locality" | "city";
export interface PgMapPoint {
  lat: number;
  lng: number;
  source: PgLocationSource;
  label: string;
  city_slug: string;
  locality_slug: string | null;
}
export interface PgGeoRow {
  ll_lat: number | null;
  ll_lng: number | null;
  loc_lat: number | null;
  loc_lng: number | null;
  city_slug: string;
  locality_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
}
export function resolvePgMapPoint(row: PgGeoRow): PgMapPoint | null;
```

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/pg-geo.util.test.ts
import { describe, it, expect } from "vitest";
import { resolvePgMapPoint } from "../src/modules/pg-operator/services/pg-geo.util";

const base = {
  loc_lat: 26.8467,
  loc_lng: 80.9462,
  city_slug: "lucknow",
  locality_slug: "gomti-nagar",
  city_name: "Lucknow",
  locality_name: "Gomti Nagar"
};

describe("resolvePgMapPoint", () => {
  it("coord that differs from the locality centroid → exact", () => {
    const p = resolvePgMapPoint({ ...base, ll_lat: 26.8551, ll_lng: 80.941 });
    expect(p).toMatchObject({
      lat: 26.8551,
      lng: 80.941,
      source: "exact",
      label: "Gomti Nagar, Lucknow",
      city_slug: "lucknow",
      locality_slug: "gomti-nagar"
    });
  });
  it("coord equal to the locality centroid → locality", () => {
    const p = resolvePgMapPoint({ ...base, ll_lat: 26.8467, ll_lng: 80.9462 });
    expect(p!.source).toBe("locality");
    expect(p!.label).toBe("Gomti Nagar, Lucknow");
  });
  it("no projection coord → null (city handled web-side)", () => {
    const p = resolvePgMapPoint({ ...base, ll_lat: null, ll_lng: null });
    expect(p).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- pg-geo.util`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// apps/api/src/modules/pg-operator/services/pg-geo.util.ts
export type PgLocationSource = "exact" | "locality" | "city";

export interface PgMapPoint {
  lat: number;
  lng: number;
  source: PgLocationSource;
  label: string;
  city_slug: string;
  locality_slug: string | null;
}

export interface PgGeoRow {
  ll_lat: number | null;
  ll_lng: number | null;
  loc_lat: number | null;
  loc_lng: number | null;
  city_slug: string;
  locality_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
}

const EPS = 1e-6;

export function resolvePgMapPoint(row: PgGeoRow): PgMapPoint | null {
  if (row.ll_lat == null || row.ll_lng == null) return null;
  const lat = Number(row.ll_lat);
  const lng = Number(row.ll_lng);
  // The locality-centroid fallback stores the centroid value verbatim, so exact
  // equality (within EPS) reliably means "locality", not "operator pin".
  const isLocalityCentroid =
    row.loc_lat != null &&
    row.loc_lng != null &&
    Math.abs(lat - Number(row.loc_lat)) < EPS &&
    Math.abs(lng - Number(row.loc_lng)) < EPS;
  return {
    lat,
    lng,
    source: isLocalityCentroid ? "locality" : "exact",
    label: [row.locality_name, row.city_name].filter(Boolean).join(", ") || row.city_slug,
    city_slug: row.city_slug,
    locality_slug: row.locality_slug
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api test -- pg-geo.util`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-operator/services/pg-geo.util.ts apps/api/test/pg-geo.util.test.ts
git commit -m "feat(pg): read-time PG map point resolver with exact/locality provenance"
```

### Task 2: PG detail loader exposes `location_point`

**Files:**

- Modify: `apps/api/src/modules/pg-operator/services/pg-listing.service.ts` — `PgListingDetail` (~lines 48-97), detail loader SQL + mapping (~lines 743-793)
- Test: `apps/api/test/pg-public-detail.test.ts` (create)

**Interfaces:**

- Consumes: `resolvePgMapPoint`, `PgMapPoint` (Task 1).
- Produces: `PgListingDetail.location_point: PgMapPoint | null`.

- [ ] **Step 1: Write the failing unit test** (fake DB returns one head row; verify the private detail method name is `loadListingDetail` before running — pass unused ctor deps as `{} as never`).

```ts
// apps/api/test/pg-public-detail.test.ts
import { describe, it, expect, vi } from "vitest";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";

function svc(headRow: Record<string, unknown>) {
  const db = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string) =>
      /FROM pg_listings pl/i.test(sql)
        ? { rows: [headRow], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    )
  };
  return new PgListingService(db as never /* other ctor deps: {} as never */);
}

const head = {
  id: "1".repeat(32),
  status: "active",
  title: "PG",
  starting_rent_paise: 900000,
  created_at: null,
  city_slug: "lucknow",
  locality_slug: "gomti-nagar",
  total_beds: 10,
  gender_policy: "coed",
  tenant_type: null,
  security_deposit_paise: 0,
  notice_period_days: 30,
  lock_in_months: 0,
  electricity_mode: null,
  rent_due_day: 1,
  price_negotiable: false,
  payment_modes: [],
  meals: null,
  amenities: {},
  house_rules: {},
  verification_status: "verified",
  has_exact_geo: true,
  composite_score: 50,
  ll_lat: 26.8551,
  ll_lng: 80.941,
  loc_lat: 26.8467,
  loc_lng: 80.9462,
  city_name: "Lucknow",
  locality_name: "Gomti Nagar"
};

describe("PG detail location_point", () => {
  it("distinct coord → exact point", async () => {
    const d = await (svc(head) as any).loadListingDetail("1".repeat(32));
    expect(d.location_point).toMatchObject({ source: "exact", lat: 26.8551, lng: 80.941 });
  });
  it("coord == locality centroid → locality point", async () => {
    const d = await (svc({ ...head, ll_lat: 26.8467, ll_lng: 80.9462 }) as any).loadListingDetail(
      "1".repeat(32)
    );
    expect(d.location_point.source).toBe("locality");
  });
  it("no coord → null point", async () => {
    const d = await (svc({ ...head, ll_lat: null, ll_lng: null }) as any).loadListingDetail(
      "1".repeat(32)
    );
    expect(d.location_point).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- pg-public-detail`
Expected: FAIL (`location_point` undefined).

- [ ] **Step 3: Implement.** Import `PgMapPoint, resolvePgMapPoint` from `./pg-geo.util`. Add `location_point: PgMapPoint | null;` to `PgListingDetail`. In the loader SQL, keep the existing `(ll.lat IS NOT NULL) AS has_exact_geo` line untouched and **add** these columns (no new joins — `ll`, `loc`, `c` already joined):

```sql
  ll.lat::float8   AS ll_lat,
  ll.lng::float8   AS ll_lng,
  loc.lat::float8  AS loc_lat,
  loc.lng::float8  AS loc_lng,
  c.name_en        AS city_name,
  loc.name_en      AS locality_name,
```

In the row→DTO object add:

```ts
location_point: resolvePgMapPoint({
  ll_lat: row.ll_lat, ll_lng: row.ll_lng, loc_lat: row.loc_lat, loc_lng: row.loc_lng,
  city_slug: row.city_slug, locality_slug: row.locality_slug,
  city_name: row.city_name, locality_name: row.locality_name
}),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api test -- pg-public-detail`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-operator/services/pg-listing.service.ts apps/api/test/pg-public-detail.test.ts
git commit -m "feat(pg): expose location_point on public PG detail"
```

---

## SLICE 2 — Search API: card coordinates

### Task 3: PG search cards carry `lat`/`lng`

**Files:**

- Modify: `apps/api/src/modules/pg-operator/services/pg-search.service.ts` — `PgCard`/`PgSearchRow` (~lines 6-19, 58-70), SELECT (~lines 209-232), mapping
- Test: `apps/api/test/pg-search.service.test.ts`

**Interfaces:**

- Produces: API `PgCard` gains `lat: number | null`, `lng: number | null`.

- [ ] **Step 1: Write the failing test** (extend the existing fake-DB test):

```ts
it("maps ll.lat/ll.lng onto the card", async () => {
  const row = {
    id: "1".repeat(32),
    title: "PG",
    city: "lucknow",
    city_name: "Lucknow",
    locality: "Gomti Nagar",
    starting_rent: 9000,
    verification_status: "verified",
    gender_policy: "coed",
    food_included: true,
    sharing_options: ["double"],
    cover_photo: null,
    lat: 26.8551,
    lng: 80.941
  };
  const { svc } = makeService([row]);
  const res = await svc.search({ city: "lucknow" });
  expect(res.items[0]).toMatchObject({ lat: 26.8551, lng: 80.941 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- pg-search.service`
Expected: FAIL (fields undefined).

- [ ] **Step 3: Implement.** Add `lat: number | null; lng: number | null;` to `PgCard` and `PgSearchRow`. Add to the SELECT (no new joins): `ll.lat::float8 AS lat, ll.lng::float8 AS lng,`. In the row→card mapping add `lat: r.lat ?? null, lng: r.lng ?? null`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api test -- pg-search.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/pg-operator/services/pg-search.service.ts apps/api/test/pg-search.service.test.ts
git commit -m "feat(pg): PG search cards carry coordinates"
```

---

## SLICE 3 — Browse preview (frontend)

### Task 4: Web types + adapter

**Files:**

- Modify: `apps/web/lib/pg-public-api.ts` — add `PgMapPoint`/`PgLocationSource`; `PgCard` += `lat`,`lng`; `PgPublicDetail` += `location_point`
- Create: `apps/web/lib/pg-map-adapter.ts`
- Test: `apps/web/lib/__tests__/pg-map-adapter.test.ts`

**Interfaces:**

- Produces: `pgCardToSearchMapListing(card: PgCard): SearchMapListing`.

- [ ] **Step 1: Extend `pg-public-api.ts` types.** Above `PgCard`:

```ts
export type PgLocationSource = "exact" | "locality" | "city";
export interface PgMapPoint {
  lat: number;
  lng: number;
  source: PgLocationSource;
  label: string;
  city_slug: string;
  locality_slug: string | null;
}
```

Add to `PgCard`: `lat: number | null; lng: number | null;`. Add to `PgPublicDetail`: `location_point: PgMapPoint | null;`.

- [ ] **Step 2: Write the failing adapter test**

```ts
// apps/web/lib/__tests__/pg-map-adapter.test.ts
import { describe, it, expect } from "vitest";
import { pgCardToSearchMapListing } from "../pg-map-adapter";
import type { PgCard } from "../pg-public-api";

const card: PgCard = {
  id: "1",
  title: "Cozy PG",
  city: "lucknow",
  city_name: "Lucknow",
  locality: "Gomti Nagar",
  listing_type: "pg",
  starting_rent: 9000,
  sharing_options: ["double"],
  gender_policy: "coed",
  food_included: true,
  verified: true,
  cover_photo: null,
  lat: 26.8551,
  lng: 80.941
};

describe("pgCardToSearchMapListing", () => {
  it("maps starting_rent→monthly_rent and verified→verification_status", () => {
    expect(pgCardToSearchMapListing(card)).toMatchObject({
      id: "1",
      listing_type: "pg",
      monthly_rent: 9000,
      verification_status: "verified",
      lat: 26.8551,
      lng: 80.941,
      city: "lucknow"
    });
  });
  it("defaults null rent to 0 and unverified to pending", () => {
    const m = pgCardToSearchMapListing({ ...card, starting_rent: null, verified: false });
    expect(m.monthly_rent).toBe(0);
    expect(m.verification_status).toBe("pending");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- pg-map-adapter`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `pg-map-adapter.ts`**

```ts
// apps/web/lib/pg-map-adapter.ts
import type { PgCard } from "./pg-public-api";
import type { SearchMapListing } from "../app/[locale]/search/SearchResultsMap";

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

_(If `SearchMapListing` is not exported, add `export` to its interface in `SearchResultsMap.tsx` — type-only, no behavior change.)_

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- pg-map-adapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/pg-public-api.ts apps/web/lib/pg-map-adapter.ts apps/web/lib/__tests__/pg-map-adapter.test.ts apps/web/app/[locale]/search/SearchResultsMap.tsx
git commit -m "feat(web): PG map types + card→SearchMapListing adapter"
```

### Task 5: `/pg` — replace static aside with `SearchResultsMap`

**Files:**

- Modify: `apps/web/app/[locale]/pg/page.tsx:180-204`
- Test: `apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx` (create; mirror `pg-city.test.tsx` mock style)

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../lib/pg-public-api", () => ({
  searchPgListings: async () => ({
    items: [
      {
        id: "a1",
        title: "PG One",
        city: "lucknow",
        city_name: "Lucknow",
        locality: "Gomti Nagar",
        listing_type: "pg",
        starting_rent: 9000,
        sharing_options: ["double"],
        gender_policy: "coed",
        food_included: true,
        verified: true,
        cover_photo: null,
        lat: 26.8551,
        lng: 80.941
      }
    ],
    total: 1,
    page: 1,
    page_size: 20
  })
}));

import PgPage from "../page";

describe("/pg browse map", () => {
  it("does not render the old static-aside labels", async () => {
    render(await PgPage({ params: { locale: "en" }, searchParams: { city: "lucknow" } } as never));
    expect(screen.queryByText("PG · ₹9.5k")).toBeNull();
    expect(screen.queryByText("Verified PG")).toBeNull();
  });
  it("links to full CriblMap with listing_type=pg + city", async () => {
    render(await PgPage({ params: { locale: "en" }, searchParams: { city: "lucknow" } } as never));
    const link = screen.getByRole("link", { name: /criblmap/i });
    expect(link.getAttribute("href")).toContain("listing_type=pg");
    expect(link.getAttribute("href")).toContain("city=lucknow");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- pg-page`
Expected: FAIL (old labels present / no map link).

- [ ] **Step 3: Implement.** Add imports to `pg/page.tsx`:

```tsx
import type { Route } from "next";
import { SearchResultsMap } from "../search/SearchResultsMap";
import { pgCardToSearchMapListing } from "../../../lib/pg-map-adapter";
import { buildSearchQuery } from "../../../lib/search-query"; // reuse the same helper the page already uses for pagination
```

Replace the `<aside className="tenant-results-map-panel">…</aside>` block (lines 180–204) with:

```tsx
<aside className="tenant-results-map-panel" aria-label="PG map preview">
  <SearchResultsMap
    locale={params.locale}
    city={filters.city || response.items[0]?.city || "lucknow"}
    listings={response.items.map(pgCardToSearchMapListing)}
    mapHref={
      `/${params.locale}/map?${buildSearchQuery({
        ...(filters.city ? { city: filters.city } : {}),
        listing_type: "pg"
      })}` as Route
    }
  />
</aside>
```

Preserve the card grid + pagination.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- pg-page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/pg/page.tsx" "apps/web/app/[locale]/pg/__tests__/pg-page.test.tsx"
git commit -m "feat(web): real SearchResultsMap preview on /pg"
```

### Task 6: `/pg/[city]` — preview when inventory exists

**Files:**

- Modify: `apps/web/app/[locale]/pg/[city]/page.tsx:160-171`
- Test: extend `apps/web/app/[locale]/pg/[city]/__tests__/pg-city.test.tsx`

- [ ] **Step 1: Write the failing test** — update the file's top-level `vi.mock` of `pg-public-api` so `searchPgListings` returns one card with `lat/lng`; assert the "Open full CriblMap" link renders. Add a second `describe` where the mock returns `items: []` and assert no such link.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- pg-city`
Expected: FAIL (no map).

- [ ] **Step 3: Implement.** Add the same imports as Task 5. Render the preview only with inventory:

```tsx
{
  listings.items.length > 0 && (
    <aside className="tenant-results-map-panel" aria-label="PG map preview">
      <SearchResultsMap
        locale={params.locale}
        city={c.slug}
        listings={listings.items.map(pgCardToSearchMapListing)}
        mapHref={
          `/${params.locale}/map?${buildSearchQuery({ city: c.slug, listing_type: "pg" })}` as Route
        }
      />
    </aside>
  );
}
```

Keep the decorative `pg-city-hero__map` blob in the hero; add no pins when there is no inventory.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- pg-city`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/pg/[city]/page.tsx" "apps/web/app/[locale]/pg/[city]/__tests__/pg-city.test.tsx"
git commit -m "feat(web): PG city page shows live preview map when inventory exists"
```

---

## SLICE 4 — Detail map (frontend) 

### Task 7: `PgDetailLocationMap` (with web-side city fallback)

**Files:**

- Create: `apps/web/components/pg/PgDetailLocationMap.tsx`
- Test: `apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx`
- Modify: `apps/web/app/globals.css` (minimal styles)

**Interfaces:**

- Consumes: `PgMapPoint` (Task 4); `cityCentroid` from `../../lib/city-bboxes`; the Google Maps loader in `../../lib/google-maps` (mirror `SearchResultsMap.tsx`'s import + init; without a key it renders the CSS fallback).
- Produces: `export function PgDetailLocationMap(props: { point: PgMapPoint | null; citySlug: string | null; listingId: string; locale: string }): JSX.Element`.

- [ ] **Step 1: Write the failing test** (no Maps key → asserts labels + link, not the canvas):

```tsx
// apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PgDetailLocationMap } from "../PgDetailLocationMap";

const pt = {
  lat: 26.8551,
  lng: 80.941,
  source: "exact" as const,
  label: "Gomti Nagar, Lucknow",
  city_slug: "lucknow",
  locality_slug: "gomti-nagar"
};

describe("PgDetailLocationMap", () => {
  it("exact point → 'Exact location' + CriblMap link with coords + zoom 15", () => {
    render(<PgDetailLocationMap point={pt} citySlug="lucknow" listingId="abc" locale="en" />);
    const href = screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")!;
    expect(href).toContain("listing_type=pg");
    expect(href).toContain("city=lucknow");
    expect(href).toContain("lat=26.8551");
    expect(href).toContain("lng=80.941");
    expect(href).toContain("zoom=15");
    expect(href).toContain("listing=abc");
    expect(screen.getByText(/exact location/i)).toBeTruthy();
  });
  it("locality point → 'Approximate area', zoom 13", () => {
    render(
      <PgDetailLocationMap
        point={{ ...pt, source: "locality" }}
        citySlug="lucknow"
        listingId="abc"
        locale="en"
      />
    );
    expect(screen.getByText(/approximate area/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")).toContain(
      "zoom=13"
    );
  });
  it("null point + known city → city fallback map, 'City area', zoom 12", () => {
    render(<PgDetailLocationMap point={null} citySlug="lucknow" listingId="abc" locale="en" />);
    expect(screen.getByText(/city area/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")).toContain(
      "zoom=12"
    );
  });
  it("null point + unknown city → text fallback, no link", () => {
    const { container } = render(
      <PgDetailLocationMap point={null} citySlug="nowhere" listingId="abc" locale="en" />
    );
    expect(container.querySelector("a")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- PgDetailLocationMap`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Mirror `SearchResultsMap.tsx` for the Maps loader + `ref` init (degrade to CSS fallback when `API_KEY` empty). Resolve an effective point: use `point`, else `cityCentroid(citySlug)` as a `city` source, else null → text fallback.

```tsx
"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { MapPin } from "lucide-react";
import type { PgMapPoint } from "../../lib/pg-public-api";
import { cityCentroid } from "../../lib/city-bboxes";
import { API_KEY /*, same loader SearchResultsMap uses */ } from "../../lib/google-maps";

const ZOOM = { exact: 15, locality: 13, city: 12 } as const;
const CAPTION = {
  exact: "Exact location",
  locality: "Approximate area",
  city: "City area"
} as const;

export function PgDetailLocationMap({
  point,
  citySlug,
  listingId,
  locale
}: {
  point: PgMapPoint | null;
  citySlug: string | null;
  listingId: string;
  locale: string;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);

  // Web-side city fallback via the same centroid source /map + SearchResultsMap use.
  const cityPt = !point && citySlug ? cityCentroid(citySlug) : null;
  const effective: PgMapPoint | null = point
    ? point
    : cityPt
      ? {
          lat: cityPt.lat,
          lng: cityPt.lng,
          source: "city",
          label: "",
          city_slug: citySlug!,
          locality_slug: null
        }
      : null;

  useEffect(() => {
    if (!effective || !API_KEY || !mapRef.current) return;
    // Mirror SearchResultsMap init: load Maps, new google.maps.Map(mapRef.current,
    // { center: { lat: effective.lat, lng: effective.lng }, zoom: ZOOM[effective.source] }),
    // add one Marker. Best-effort; swallow load errors → CSS fallback stays.
  }, [effective]);

  if (!effective) {
    return (
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-secondary)" }}
      >
        <MapPin size={18} aria-hidden="true" />
        <span>Location</span>
      </div>
    );
  }

  const zoom = ZOOM[effective.source];
  const href =
    `/${locale}/map?city=${effective.city_slug}&listing_type=pg&lat=${effective.lat}&lng=${effective.lng}&zoom=${zoom}&listing=${listingId}` as Route;

  return (
    <div className="pg-detail-map">
      <div className="pg-detail-map__caption">
        <MapPin size={16} aria-hidden="true" />
        {effective.label && <span>{effective.label}</span>}
        <span className="pg-detail-map__badge">{CAPTION[effective.source]}</span>
      </div>
      {API_KEY ? (
        <div ref={mapRef} className="pg-detail-map__canvas" role="presentation" />
      ) : (
        <div className="tenant-live-map__fallback" aria-hidden="true" />
      )}
      <Link href={href} className="tenant-results-map-btn">
        <MapPin size={15} /> Explore on CriblMap
      </Link>
    </div>
  );
}
```

Add to `apps/web/app/globals.css` (reuse existing tokens): `.pg-detail-map` (column flex, `gap: var(--space-3)`), `.pg-detail-map__caption` (row flex, `gap: var(--space-2)`, `color: var(--text-secondary)`), `.pg-detail-map__badge` (small pill, `background: var(--brand-light)`), `.pg-detail-map__canvas` (`height: 220px; border-radius: var(--radius-lg); overflow: hidden`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- PgDetailLocationMap`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/pg/PgDetailLocationMap.tsx "apps/web/components/pg/__tests__/PgDetailLocationMap.test.tsx" apps/web/app/globals.css
git commit -m "feat(web): PgDetailLocationMap with provenance labels + city fallback + CriblMap deep-link"
```

### Task 8: Mount the map in `PgDetailClient`

**Files:**

- Modify: `apps/web/components/pg/PgDetailClient.tsx:816-842`
- Test: extend the existing `PgDetailClient` test

- [ ] **Step 1: Write the failing test** — render `PgDetailClient` with `detail.location_point` set; assert the CriblMap link appears. A null-point + null-city case keeps the text fallback (no link).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- PgDetailClient`
Expected: FAIL (no map section).

- [ ] **Step 3: Implement.** Import `PgDetailLocationMap`. Inside the Location `ld-section` (lines 816–842), keep the `ld-section__head` exactly; replace the inline MapPin+text body with:

```tsx
<PgDetailLocationMap
  point={detail.location_point}
  citySlug={detail.city_slug}
  listingId={detail.id}
  locale={locale}
/>
```

`PgDetailLocationMap` renders the MapPin+text fallback itself when there is no point and no known city, preserving today's behavior.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- PgDetailClient`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/pg/PgDetailClient.tsx
git commit -m "feat(web): mount location map in PG detail Location section"
```

---

## SLICE 5 — Regression gate

### Task 9: Full suite + typecheck

- [ ] **Step 1:** `pnpm typecheck` → PASS.
- [ ] **Step 2:** `pnpm --filter @cribliv/api test -- pg` → PASS (pg-geo.util, pg-public-detail, pg-search.service).
- [ ] **Step 3:** `pnpm --filter @cribliv/web test -- pg` → PASS (adapter, pg-page, pg-city, PgDetailLocationMap, PgDetailClient).
- [ ] **Step 4:** `pnpm --filter @cribliv/api test -- map-search && pnpm --filter @cribliv/web test -- map-page criblmap` → PASS (Homes + CriblMap unaffected).
- [ ] **Step 5:** Branch ready for PR.

---

## Self-Review (against the spec)

- **Browse (spec req 1–4):** Tasks 3–6. `SearchResultsMap` preview + `listingHref` PG routing (component unchanged) + full-map link with `listing_type=pg`. ✔
- **Detail exact coords (req 5–6):** Tasks 1–2, 7–8. `location_point.source='exact'` when the stored coord differs from the locality centroid. ✔
- **Locality fallback (req 7):** Task 1 — coord == centroid → `'locality'`. Already-populated because `projectGeo` writes the centroid when no pin. ✔
- **City fallback (req 8):** Task 7 — web-side `cityCentroid()`; no DB change. ✔
- **Honest labels (req 9):** Task 7 CAPTION map; fallbacks never labeled "Exact". ✔
- **Privacy (req 10):** only coords + coarse labels added. ✔
- **/search isolation (req 11):** search page untouched. ✔
- **Dual-mode (req 12):** SQL-only reads; PG paths already empty when DB off. ✔
- **Type consistency:** `PgMapPoint`/`PgLocationSource` defined API-side (Task 1) + mirrored web-side (Task 4); `resolvePgMapPoint` signature stable; `SearchMapListing` fields match the verified contract; adapter maps `starting_rent→monthly_rent`, `verified→verification_status`. ✔
- **Placeholder scan:** only non-literal block is the Google-Maps `useEffect` init (Task 7), deliberately delegated to "mirror `SearchResultsMap`" (verified present); tests assert behavior without a key so it is testable regardless. ✔

## Out of scope / flag separately

- **`has_exact_geo` bug** (`(ll.lat IS NOT NULL)` treats a locality fallback as exact) — feeds the edit-wizard score meter, not the map. Fix in its own PR; do not bundle here.
- Marker jitter/clustering for stacked locality-centroid pins (CriblMap already clusters; the preview shows only the current page).
- Persisting `formatted_address` (captured in the wizard, never stored).
- Adding a new city later requires updating `CITY_BBOXES` + `localities.json` seed together.

## Executor notes

- Confirm `PgListingService`'s private detail method name (`loadListingDetail`) and constructor arity before Task 2's test; pass unused ctor deps as `{} as never`.
- If `SearchMapListing` / `SearchResultsMap` aren't exported from `SearchResultsMap.tsx`, add `export` (type + component) — no behavior change.
- Reuse the page's existing query-string helper for `mapHref` (don't introduce a new one).
