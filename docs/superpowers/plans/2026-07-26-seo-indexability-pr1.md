# SEO Indexability PR 1 — Stop the Bleeding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop submitting ~32,300 broken URLs to Google by making the sitemap consume a single server-computed `indexable` flag instead of re-deriving indexability from the wrong data source.

**Architecture:** Add one read endpoint, `GET /seo/cities/:citySlug/places`, that returns every locality, metro station and landmark in a city with its live listing count and a server-computed `indexable` boolean. The sitemap consumes that endpoint and filters on `indexable`. This removes the sitemap's dependency on `/map/metro` (which returns whole metro _lines_, not a city's stations) and removes its local copy of the listing threshold. The threshold moves to `packages/shared-types` so API and web cannot drift.

**Tech Stack:** NestJS + raw SQL (`DatabaseService.query`), Postgres + PostGIS, Next.js 14 App Router, Vitest, pnpm workspaces + Turborepo.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-26-programmatic-seo-indexability-design.md`. This plan implements **PR 1 only** (spec §5 items 1–6). PR 2 and PR 3 get their own plans.
- **The invariant:** a page appears in the sitemap iff the content it renders clears the threshold. Never reintroduce a second definition of indexability.
- **Threshold value stays `3`.** Only its home changes. Exported as `INDEXABLE_MIN_LISTINGS`.
- **No rollup in this PR.** Locality counts stay exact-match (`ll.locality_id = loc.id`). Hierarchy rollup is PR 2. Do not add it here.
- **DB dual-mode is mandatory.** Every new service method must return a safe empty value when `this.database.isEnabled()` is false, and must `try/catch` SQL failures and return empty — matching every existing method in `seo-aggregates.service.ts`.
- **`packages/shared-types` runtime-export gotcha.** `main` is `dist/index.js`. A `const` (runtime value) added to a new module MUST get an explicit re-export in `src/index.ts` (`export { X } from "./seo";`) in addition to `export * from "./seo";` — a bare `export *` compiles to `__exportStar`, which Next's bundler cannot statically analyse, and the import resolves to `undefined` at runtime. See the comment block at `packages/shared-types/src/index.ts:11-21`.
- **Build order.** `packages/shared-types` must be rebuilt before web/api typecheck or tests resolve the new constant: `pnpm --filter @cribliv/shared-types build`.
- **Metro slug must round-trip.** The slug the sitemap emits must be byte-identical to what `SeoAggregatesService.findMetroStation` resolves, which is `LOWER(REGEXP_REPLACE(station_name, '[^a-zA-Z0-9]+', '-', 'g'))` (`seo-aggregates.service.ts:235`). Compute the slug **in SQL with that exact expression** so it cannot drift. Note there is deliberately **no hyphen trim** — `"Bhootnath Market!"` → `"bhootnath-market-"` (documented at `apps/web/app/__tests__/sitemap-chunks.test.ts:52-58`).
- **Commands:** API tests `pnpm --filter @cribliv/api test`, web tests `pnpm --filter @cribliv/web test`, typecheck `pnpm typecheck`.
- **Do not run the full API suite against a real DB.** Migration 0045's rollback drops `keyword_rankings` and `seo_indexing_queue`. Run targeted test files only.
- Commit after every task.

---

### Task 1: Move the listing threshold into `packages/shared-types`

Removes the four independent copies of `3` identified in spec §1.5.

**Files:**

- Create: `packages/shared-types/src/seo.ts`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/api/src/modules/seo/seo-city-config.service.ts:7`
- Modify: `apps/api/src/modules/admin/admin-seo.controller.ts:32`
- Modify: `apps/web/app/sitemap-chunks.ts:7`
- Modify: `apps/web/components/admin/tabs/SeoCityReviewDrawer.tsx:278`
- Test: `apps/api/test/seo-city-config.service.test.ts` (update import)
- Test: `apps/web/app/__tests__/sitemap-chunks.test.ts` (add assertion)

**Interfaces:**

- Consumes: nothing.
- Produces: `INDEXABLE_MIN_LISTINGS: number` (value `3`) exported from `@cribliv/shared-types`. Every later task imports the threshold from here and nowhere else.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/app/__tests__/sitemap-chunks.test.ts` — extend the existing import block and add one test:

```typescript
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";

import { THIN_LISTING_THRESHOLD } from "../sitemap-chunks";

it("uses the shared threshold rather than a local copy", () => {
  expect(INDEXABLE_MIN_LISTINGS).toBe(3);
  expect(THIN_LISTING_THRESHOLD).toBe(INDEXABLE_MIN_LISTINGS);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test sitemap-chunks`
Expected: FAIL — cannot resolve `INDEXABLE_MIN_LISTINGS` from `@cribliv/shared-types`.

- [ ] **Step 3: Create the shared module**

Create `packages/shared-types/src/seo.ts`:

```typescript
/**
 * Minimum active listings a programmatic SEO place must have before its page is
 * allowed into the sitemap and permitted to be indexed. Below this the page
 * renders with `robots: noindex, follow` and is excluded from the sitemap.
 *
 * Single source of truth — API (indexable computation) and web (sitemap filter)
 * both import this. It previously existed as four independent copies which
 * silently drifted; do not reintroduce a local constant.
 */
export const INDEXABLE_MIN_LISTINGS = 3;
```

- [ ] **Step 4: Wire both export forms in the barrel**

In `packages/shared-types/src/index.ts`, add the type barrel line alongside the other `export *` lines:

```typescript
export * from "./seo";
```

and add the explicit runtime re-export in the value-export block at the bottom, next to `export { computePgListingScore }`:

```typescript
export { INDEXABLE_MIN_LISTINGS } from "./seo";
```

Both lines are required. The first gives types; the second is what makes the value resolvable through Next's bundler.

- [ ] **Step 5: Build shared-types**

Run: `pnpm --filter @cribliv/shared-types build`
Expected: exits 0, `packages/shared-types/dist/seo.js` and `dist/seo.d.ts` exist.

- [ ] **Step 6: Replace the web copy**

In `apps/web/app/sitemap-chunks.ts`, replace line 7:

```typescript
export const THIN_LISTING_THRESHOLD = 3;
```

with:

```typescript
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";

/** @deprecated Import INDEXABLE_MIN_LISTINGS directly. Kept as a local alias
 * only so existing call sites in this module read naturally. */
export const THIN_LISTING_THRESHOLD = INDEXABLE_MIN_LISTINGS;
```

- [ ] **Step 7: Run the web test to verify it passes**

Run: `pnpm --filter @cribliv/web test sitemap-chunks`
Expected: PASS, all tests green.

- [ ] **Step 8: Replace the API copies**

In `apps/api/src/modules/seo/seo-city-config.service.ts`, delete line 7 (`export const INDEXABLE_MIN = 3;`) and add to the imports:

```typescript
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
```

Then update the single usage inside `computeCounts`, so the whole return block reads:

```typescript
return {
  locality_count: localities.length,
  landmark_count: landmarkCount,
  metro_count: metros.length,
  indexable_count: localities.filter((locality) => locality.listing_count >= INDEXABLE_MIN_LISTINGS)
    .length
};
```

In `apps/api/src/modules/admin/admin-seo.controller.ts`, delete line 32:

```typescript
const MIN_LISTINGS = 3;
```

add `import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";` to the imports, and change line 330 from:

```typescript
if (loc.listing_count < MIN_LISTINGS) break;
```

to:

```typescript
if (loc.listing_count < INDEXABLE_MIN_LISTINGS) break;
```

In `apps/web/components/admin/tabs/SeoCityReviewDrawer.tsx`, add `import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";` and change line 278. This is an object property inside a column definition, not a standalone statement — apply it as a diff:

```diff
-      render: (r) => (r.listing_count >= 3 ? "✓" : "✗")
+      render: (r) => (r.listing_count >= INDEXABLE_MIN_LISTINGS ? "✓" : "✗")
```

- [ ] **Step 9: Update the API test import**

In `apps/api/test/seo-city-config.service.test.ts`, change line 3 from:

```typescript
import { INDEXABLE_MIN, SeoCityConfigService } from "../src/modules/seo/seo-city-config.service";
```

to:

```typescript
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { SeoCityConfigService } from "../src/modules/seo/seo-city-config.service";
```

and replace both `INDEXABLE_MIN` usages at lines 30–31 with `INDEXABLE_MIN_LISTINGS`.

- [ ] **Step 10: Verify no duplicate remains**

Run: `grep -rn 'THIN_LISTING_THRESHOLD = 3\|INDEXABLE_MIN = 3\|MIN_LISTINGS = 3' apps packages`
Expected: no output.

- [ ] **Step 11: Run both suites and typecheck**

Run: `pnpm --filter @cribliv/api test seo-city-config && pnpm --filter @cribliv/web test sitemap-chunks && pnpm typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 12: Commit**

```bash
git add packages/shared-types apps/api apps/web
git commit -m "refactor(seo): single INDEXABLE_MIN_LISTINGS in shared-types

Replaces four independent copies of the listing threshold (API city-config
service, admin controller, web sitemap chunks, admin review drawer) with one
exported constant. Explicit runtime re-export in the barrel so Next's bundler
resolves the value."
```

---

### Task 2: Per-place listing counts for metro stations and landmarks

The API can currently count listings for a _locality_, and can count _how many_
metro stations and landmarks exist, but cannot say how many listings are near a
given station or landmark. That is exactly what gating needs.

**Files:**

- Modify: `apps/api/src/modules/seo/seo-aggregates.service.ts`
- Test: `apps/api/test/seo-aggregates.places.test.ts` (create)

**Interfaces:**

- Consumes: `INDEXABLE_MIN_LISTINGS` from Task 1 (not used here — counting only).
- Produces, on `SeoAggregatesService`:
  - `metroStationsWithCountsForCity(citySlug: string, radiusKm?: number): Promise<MetroStationWithCount[]>` — default radius `1.5`
  - `landmarksWithCountsForCity(citySlug: string, radiusKm?: number): Promise<LandmarkWithCount[]>` — default radius `2`
  - `interface MetroStationWithCount extends MetroStationRow { slug: string; listing_count: number }`
  - `interface LandmarkWithCount { id: number; slug: string; name_en: string; name_hi: string; listing_count: number }`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/seo-aggregates.places.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeoAggregatesService } from "../src/modules/seo/seo-aggregates.service";

describe("SeoAggregatesService place counts", () => {
  let query: ReturnType<typeof vi.fn>;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    query = vi.fn();
    database = { isEnabled: () => true, query };
  });

  it("returns [] without querying when the DB is disabled", async () => {
    database = { isEnabled: () => false, query };
    const service = new SeoAggregatesService(database as never);

    await expect(service.metroStationsWithCountsForCity("lucknow")).resolves.toEqual([]);
    await expect(service.landmarksWithCountsForCity("lucknow")).resolves.toEqual([]);

    expect(query).not.toHaveBeenCalled();
  });

  it("counts listings within 1.5 km of each metro station and derives the slug in SQL", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          station_name: "Bhootnath Market",
          slug: "bhootnath-market",
          line_name: "Red",
          line_color: "#f00",
          lat: 26.8,
          lng: 80.9,
          sequence: 4,
          listing_count: 5
        }
      ]
    });
    const service = new SeoAggregatesService(database as never);

    const rows = await service.metroStationsWithCountsForCity("lucknow");

    expect(rows[0]).toMatchObject({ slug: "bhootnath-market", listing_count: 5 });

    const [sql, params] = query.mock.calls[0];
    // Slug must be derived with the SAME expression findMetroStation resolves,
    // otherwise the sitemap emits URLs the page cannot resolve.
    expect(sql).toContain("REGEXP_REPLACE(ms.station_name, '[^a-zA-Z0-9]+', '-', 'g')");
    expect(sql).toContain("ST_DWithin");
    expect(params).toEqual(["lucknow", 1500]);
  });

  it("counts listings within 2 km of each landmark", async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 7, slug: "kgmu", name_en: "KGMU", name_hi: "केजीएमयू", listing_count: 0 }]
    });
    const service = new SeoAggregatesService(database as never);

    const rows = await service.landmarksWithCountsForCity("lucknow");

    expect(rows[0]).toMatchObject({ slug: "kgmu", listing_count: 0 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM landmarks");
    expect(sql).toContain("lm.is_active = true");
    expect(params).toEqual(["lucknow", 2000]);
  });

  it("returns [] rather than throwing when PostGIS is unavailable", async () => {
    query.mockRejectedValueOnce(new Error("function st_dwithin does not exist"));
    const service = new SeoAggregatesService(database as never);

    await expect(service.metroStationsWithCountsForCity("lucknow")).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test seo-aggregates.places`
Expected: FAIL — `service.metroStationsWithCountsForCity is not a function`.

- [ ] **Step 3: Add the interfaces**

In `apps/api/src/modules/seo/seo-aggregates.service.ts`, after the existing `MetroStationRow` interface (line 41):

```typescript
export interface MetroStationWithCount extends MetroStationRow {
  /** Derived in SQL with the same expression findMetroStation resolves. */
  slug: string;
  listing_count: number;
}

export interface LandmarkWithCount {
  id: number;
  slug: string;
  name_en: string;
  name_hi: string;
  listing_count: number;
}
```

- [ ] **Step 4: Implement both methods**

Add to the `SeoAggregatesService` class, after `findMetroStation`:

```typescript
  /**
   * Every metro station in a city with the number of active listings within
   * `radiusKm`. Used to gate metro pages out of the sitemap when there is
   * nothing to show. The slug is derived in SQL using the identical expression
   * `findMetroStation` matches on, so a URL we emit always resolves.
   */
  async metroStationsWithCountsForCity(
    citySlug: string,
    radiusKm = 1.5
  ): Promise<MetroStationWithCount[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<MetroStationWithCount>(
        `SELECT ms.id, ms.station_name, ms.line_name, ms.line_color,
                ms.lat::float8 AS lat, ms.lng::float8 AS lng, ms.sequence,
                LOWER(REGEXP_REPLACE(ms.station_name, '[^a-zA-Z0-9]+', '-', 'g')) AS slug,
                COALESCE(cnt.listing_count, 0)::int AS listing_count
         FROM metro_stations ms
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS listing_count
           FROM listing_locations ll
           JOIN listings l ON l.id = ll.listing_id
           JOIN cities c ON c.id = ll.city_id
           WHERE l.status = 'active'
             AND c.slug = $1
             AND ll.geo_point IS NOT NULL
             AND ST_DWithin(
               ll.geo_point,
               ST_SetSRID(ST_MakePoint(ms.lng::float8, ms.lat::float8), 4326)::geography,
               $2::float8
             )
         ) cnt ON true
         WHERE ms.city = $1
         ORDER BY ms.line_name, ms.sequence`,
        [citySlug, radiusKm * 1000]
      );
      return rows;
    } catch (err) {
      this.logger.debug(
        `metroStationsWithCountsForCity failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }

  /**
   * Every active landmark in a city with the number of active listings within
   * `radiusKm`. Mirrors the 2 km radius the landmark page itself renders.
   */
  async landmarksWithCountsForCity(
    citySlug: string,
    radiusKm = 2
  ): Promise<LandmarkWithCount[]> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<LandmarkWithCount>(
        `SELECT lm.id, lm.slug, lm.name_en, lm.name_hi,
                COALESCE(cnt.listing_count, 0)::int AS listing_count
         FROM landmarks lm
         JOIN cities c ON c.id = lm.city_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::int AS listing_count
           FROM listing_locations ll
           JOIN listings l ON l.id = ll.listing_id
           WHERE l.status = 'active'
             AND ll.city_id = c.id
             AND ll.geo_point IS NOT NULL
             AND ST_DWithin(
               ll.geo_point,
               ST_SetSRID(ST_MakePoint(lm.lng::float8, lm.lat::float8), 4326)::geography,
               $2::float8
             )
         ) cnt ON true
         WHERE c.slug = $1 AND lm.is_active = true
         ORDER BY listing_count DESC, lm.name_en ASC`,
        [citySlug, radiusKm * 1000]
      );
      return rows;
    } catch (err) {
      this.logger.debug(
        `landmarksWithCountsForCity failed: ${err instanceof Error ? err.message : err}`
      );
      return [];
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test seo-aggregates.places`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/seo/seo-aggregates.service.ts apps/api/test/seo-aggregates.places.test.ts
git commit -m "feat(seo): per-station and per-landmark listing counts

Adds metroStationsWithCountsForCity (1.5km) and landmarksWithCountsForCity
(2km), each one set-based query with a LATERAL count rather than N spatial
queries. Metro slug is derived in SQL with the same expression
findMetroStation resolves, so emitted URLs always resolve."
```

---

### Task 3: `GET /seo/cities/:citySlug/places` with server-computed `indexable`

The single source of truth. After this task, no consumer needs to know the threshold.

**Files:**

- Create: `apps/api/src/modules/seo/seo-places.service.ts`
- Modify: `apps/api/src/modules/seo/seo.module.ts`
- Modify: `apps/api/src/modules/seo/seo.controller.ts`
- Test: `apps/api/test/seo-places.service.test.ts` (create)

**Interfaces:**

- Consumes: `metroStationsWithCountsForCity`, `landmarksWithCountsForCity` (Task 2); `localitiesForCity` (existing); `INDEXABLE_MIN_LISTINGS` (Task 1).
- Produces:
  - `SeoPlace = { slug: string; name_en: string; name_hi: string | null; listing_count: number; indexable: boolean }`
  - `CityPlaces = { city_slug: string; localities: SeoPlace[]; metro_stations: SeoPlace[]; landmarks: SeoPlace[] }`
  - `SeoPlacesService.placesForCity(citySlug: string): Promise<CityPlaces>`
  - Route `GET /seo/cities/:citySlug/places` returning `ok(CityPlaces)`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/seo-places.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { SeoPlacesService } from "../src/modules/seo/seo-places.service";

describe("SeoPlacesService", () => {
  let aggregates: {
    localitiesForCity: ReturnType<typeof vi.fn>;
    metroStationsWithCountsForCity: ReturnType<typeof vi.fn>;
    landmarksWithCountsForCity: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    aggregates = {
      localitiesForCity: vi.fn(async () => [
        { slug: "gomti-nagar", name_en: "Gomti Nagar", name_hi: "गोमती नगर", listing_count: 4 },
        { slug: "aliganj", name_en: "Aliganj", name_hi: "अलीगंज", listing_count: 2 }
      ]),
      metroStationsWithCountsForCity: vi.fn(async () => [
        { slug: "munshipulia", station_name: "Munshipulia", listing_count: 3 },
        { slug: "ccs-airport", station_name: "CCS Airport", listing_count: 0 }
      ]),
      landmarksWithCountsForCity: vi.fn(async () => [
        { slug: "kgmu", name_en: "KGMU", name_hi: "केजीएमयू", listing_count: 9 }
      ])
    };
  });

  it("marks a place indexable only at or above the shared threshold", async () => {
    const service = new SeoPlacesService(aggregates as never);

    const places = await service.placesForCity("lucknow");

    expect(INDEXABLE_MIN_LISTINGS).toBe(3);
    expect(places.city_slug).toBe("lucknow");
    expect(places.localities).toEqual([
      {
        slug: "gomti-nagar",
        name_en: "Gomti Nagar",
        name_hi: "गोमती नगर",
        listing_count: 4,
        indexable: true
      },
      {
        slug: "aliganj",
        name_en: "Aliganj",
        name_hi: "अलीगंज",
        listing_count: 2,
        indexable: false
      }
    ]);
  });

  it("gates metro stations and landmarks on their own counts, not the city's", async () => {
    const service = new SeoPlacesService(aggregates as never);

    const places = await service.placesForCity("lucknow");

    expect(places.metro_stations.map((p) => [p.slug, p.indexable])).toEqual([
      ["munshipulia", true],
      ["ccs-airport", false]
    ]);
    expect(places.landmarks[0]).toMatchObject({ slug: "kgmu", indexable: true });
  });

  it("uses the metro station name when no separate display name exists", async () => {
    const service = new SeoPlacesService(aggregates as never);

    const places = await service.placesForCity("lucknow");

    expect(places.metro_stations[0].name_en).toBe("Munshipulia");
  });

  it("returns empty place lists for a city with nothing configured", async () => {
    aggregates.localitiesForCity = vi.fn(async () => []);
    aggregates.metroStationsWithCountsForCity = vi.fn(async () => []);
    aggregates.landmarksWithCountsForCity = vi.fn(async () => []);
    const service = new SeoPlacesService(aggregates as never);

    await expect(service.placesForCity("chandigarh")).resolves.toEqual({
      city_slug: "chandigarh",
      localities: [],
      metro_stations: [],
      landmarks: []
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test seo-places`
Expected: FAIL — cannot resolve `../src/modules/seo/seo-places.service`.

- [ ] **Step 3: Create the service**

Create `apps/api/src/modules/seo/seo-places.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { SeoAggregatesService } from "./seo-aggregates.service";

/**
 * The single source of truth for "which programmatic pages may be indexed".
 *
 * The sitemap, the page templates and the admin panel all previously derived
 * this independently, which is how the sitemap ended up submitting ~32,300
 * URLs that could never be indexed. Consumers must read `indexable` from here
 * and must not re-apply a threshold of their own.
 */

export interface SeoPlace {
  slug: string;
  name_en: string;
  name_hi: string | null;
  listing_count: number;
  indexable: boolean;
}

export interface CityPlaces {
  city_slug: string;
  localities: SeoPlace[];
  metro_stations: SeoPlace[];
  landmarks: SeoPlace[];
}

@Injectable()
export class SeoPlacesService {
  constructor(private readonly aggregates: SeoAggregatesService) {}

  async placesForCity(citySlug: string): Promise<CityPlaces> {
    const [localities, metros, landmarks] = await Promise.all([
      this.aggregates.localitiesForCity(citySlug),
      this.aggregates.metroStationsWithCountsForCity(citySlug),
      this.aggregates.landmarksWithCountsForCity(citySlug)
    ]);

    return {
      city_slug: citySlug,
      localities: localities.map((row) =>
        toPlace(row.slug, row.name_en, row.name_hi, row.listing_count)
      ),
      metro_stations: metros.map((row) =>
        toPlace(row.slug, row.station_name, null, row.listing_count)
      ),
      landmarks: landmarks.map((row) =>
        toPlace(row.slug, row.name_en, row.name_hi, row.listing_count)
      )
    };
  }
}

function toPlace(
  slug: string,
  nameEn: string,
  nameHi: string | null,
  listingCount: number
): SeoPlace {
  return {
    slug,
    name_en: nameEn,
    name_hi: nameHi,
    listing_count: listingCount,
    indexable: listingCount >= INDEXABLE_MIN_LISTINGS
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test seo-places`
Expected: PASS, 4 tests.

- [ ] **Step 5: Register the provider**

In `apps/api/src/modules/seo/seo.module.ts`, add the import after line 3:

```typescript
import { SeoPlacesService } from "./seo-places.service";
```

then add `SeoPlacesService,` to both arrays so they read:

```typescript
  providers: [
    SeoAggregatesService,
    SeoPlacesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService,
    GscService,
    SeoSearchService
  ],
  exports: [
    SeoAggregatesService,
    SeoPlacesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService,
    GscService,
    SeoSearchService
  ]
```

- [ ] **Step 6: Add the route**

In `apps/api/src/modules/seo/seo.controller.ts`, add `import { SeoPlacesService } from "./seo-places.service";` and extend the constructor so it reads in full:

```typescript
  constructor(
    @Inject(SeoAggregatesService) private readonly aggregates: SeoAggregatesService,
    @Inject(SeoPlacesService) private readonly places: SeoPlacesService,
    @Inject(SeoCityConfigService) private readonly cityConfig: SeoCityConfigService,
    @Inject(SeoCopyService) private readonly copy: SeoCopyService
  ) {}
```

Then add the route immediately after the existing `@Get("cities")` handler:

```typescript
  /**
   * Every place in a city with its live listing count and a server-computed
   * `indexable` flag. The sitemap consumes this and filters on `indexable` —
   * it must never re-derive the threshold itself.
   */
  @Get("cities/:citySlug/places")
  async listCityPlaces(@Param("citySlug") citySlug: string) {
    return ok(await this.places.placesForCity(citySlug));
  }
```

- [ ] **Step 7: Verify the route resolves and does not shadow `GET /seo/cities`**

Run: `pnpm --filter @cribliv/api test seo-cities.controller && pnpm typecheck`
Expected: PASS — the existing `/seo/cities` tests still green, typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/seo apps/api/test/seo-places.service.test.ts
git commit -m "feat(seo): GET /seo/cities/:citySlug/places with server-computed indexable

One endpoint returns every locality, metro station and landmark with its live
listing count and an indexable flag computed from INDEXABLE_MIN_LISTINGS.
Consumers stop deriving indexability independently."
```

---

### Task 4: Web client for the places endpoint

**Files:**

- Modify: `apps/web/lib/seo-api.ts`
- Test: `apps/web/lib/__tests__/seo-api.places.test.ts` (create)

**Interfaces:**

- Consumes: `GET /seo/cities/:citySlug/places` (Task 3).
- Produces:
  - `SeoPlace` and `CityPlaces` types mirroring the API shape
  - `fetchCityPlaces(citySlug: string, opts?: { revalidate?: number }): Promise<CityPlaces>` — returns empty place lists on any failure, matching every other helper in this file.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/seo-api.places.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  fetchApi: vi.fn(),
  buildSearchQuery: vi.fn(() => "")
}));

import { fetchApi } from "../api";
import { fetchCityPlaces } from "../seo-api";

const mockFetchApi = vi.mocked(fetchApi);

afterEach(() => {
  vi.resetAllMocks();
});

describe("fetchCityPlaces", () => {
  it("requests the places endpoint and passes the caller's revalidate through", async () => {
    mockFetchApi.mockResolvedValueOnce({
      city_slug: "lucknow",
      localities: [
        {
          slug: "gomti-nagar",
          name_en: "Gomti Nagar",
          name_hi: null,
          listing_count: 4,
          indexable: true
        }
      ],
      metro_stations: [],
      landmarks: []
    });

    const places = await fetchCityPlaces("lucknow", { revalidate: 86400 });

    expect(places.localities[0].indexable).toBe(true);
    expect(mockFetchApi).toHaveBeenCalledWith("/seo/cities/lucknow/places", undefined, {
      server: true,
      revalidate: 86400
    });
  });

  it("returns empty place lists when the API is unreachable", async () => {
    mockFetchApi.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(fetchCityPlaces("lucknow")).resolves.toEqual({
      city_slug: "lucknow",
      localities: [],
      metro_stations: [],
      landmarks: []
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test seo-api.places`
Expected: FAIL — `fetchCityPlaces` is not exported.

- [ ] **Step 3: Implement the client**

Add to `apps/web/lib/seo-api.ts`, after `fetchEnabledCities`:

```typescript
export interface SeoPlace {
  slug: string;
  name_en: string;
  name_hi: string | null;
  listing_count: number;
  indexable: boolean;
}

export interface CityPlaces {
  city_slug: string;
  localities: SeoPlace[];
  metro_stations: SeoPlace[];
  landmarks: SeoPlace[];
}

/**
 * Every place in a city with a server-computed `indexable` flag. This is the
 * sitemap's only source for which programmatic URLs may be submitted — do not
 * re-apply a listing threshold on the web side.
 */
export async function fetchCityPlaces(
  citySlug: string,
  opts: { revalidate?: number } = {}
): Promise<CityPlaces> {
  try {
    const res = await fetchApi<CityPlaces>(
      `/seo/cities/${encodeURIComponent(citySlug)}/places`,
      undefined,
      { server: true, revalidate: opts.revalidate }
    );
    return {
      city_slug: res.city_slug ?? citySlug,
      localities: res.localities ?? [],
      metro_stations: res.metro_stations ?? [],
      landmarks: res.landmarks ?? []
    };
  } catch {
    return { city_slug: citySlug, localities: [], metro_stations: [], landmarks: [] };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test seo-api.places`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/seo-api.ts apps/web/lib/__tests__/seo-api.places.test.ts
git commit -m "feat(seo): fetchCityPlaces client for the places endpoint"
```

---

### Task 5: Gate metro and landmark sitemap entries

The actual leak. `buildCityMetroEntries` and `buildCityLandmarkEntries` currently
accept no listing count, so every station and landmark ships regardless.

**Files:**

- Modify: `apps/web/app/sitemap-chunks.ts:92-133`
- Test: `apps/web/app/__tests__/sitemap-chunks.test.ts`

**Interfaces:**

- Consumes: `THIN_LISTING_THRESHOLD` (Task 1).
- Produces (changed signatures — Task 6 depends on these):
  - `buildCityMetroEntries(baseUrl: string, citySlug: string, stations: Array<{ slug: string; listing_count?: number | null }>): MetadataRoute.Sitemap`
  - `buildCityLandmarkEntries(baseUrl: string, citySlug: string, landmarks: Array<{ slug: string; listing_count?: number | null }>): MetadataRoute.Sitemap`

Note the metro signature changes from `station_name` to a pre-computed `slug`.
The API now derives the slug in SQL, so `metroSlug()` is no longer applied here.
Keep `metroSlug` exported — its test documents the no-hyphen-trim rule and PR 2
may still need it.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/__tests__/sitemap-chunks.test.ts`, replace the two existing
`buildCityMetroEntries` / `buildCityLandmarkEntries` tests (lines 88–104) with:

```typescript
it("buildCityMetroEntries emits hub and intent URLs for an indexable station", () => {
  const rows = buildCityMetroEntries(BASE_URL, "lucknow", [
    { slug: "bhootnath-market", listing_count: 3 }
  ]);

  expect(rows).toHaveLength((1 + METRO_INTENTS.length) * 2);
  expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/metro/bhootnath-market"))).toBe(
    true
  );
});

it("buildCityMetroEntries fully excludes thin stations", () => {
  const rows = buildCityMetroEntries(BASE_URL, "lucknow", [
    { slug: "thin-station", listing_count: 2 },
    { slug: "kept-station", listing_count: 4 }
  ]);

  expect(rows.some((row) => row.url.includes("thin-station"))).toBe(false);
  expect(rows.some((row) => row.url.includes("kept-station"))).toBe(true);
});

it("buildCityMetroEntries treats a missing count as thin", () => {
  expect(buildCityMetroEntries(BASE_URL, "faridabad", [{ slug: "kashmere-gate" }])).toEqual([]);
});

it("buildCityLandmarkEntries emits hub and intent URLs for an indexable landmark", () => {
  const rows = buildCityLandmarkEntries(BASE_URL, "lucknow", [
    { slug: "charbagh-station", listing_count: 5 }
  ]);

  expect(rows).toHaveLength((1 + LANDMARK_INTENTS.length) * 2);
  expect(rows.some((row) => row.url.endsWith("/en/city/lucknow/near/charbagh-station"))).toBe(true);
});

it("buildCityLandmarkEntries fully excludes thin landmarks", () => {
  const rows = buildCityLandmarkEntries(BASE_URL, "lucknow", [
    { slug: "thin-landmark", listing_count: 1 }
  ]);

  expect(rows).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cribliv/web test sitemap-chunks`
Expected: FAIL — the "excludes thin" and "missing count" tests fail because no gating exists.

- [ ] **Step 3: Add the gate to both builders**

In `apps/web/app/sitemap-chunks.ts`, replace `buildCityMetroEntries` and
`buildCityLandmarkEntries` (lines 92–133) with:

```typescript
export function buildCityMetroEntries(
  baseUrl: string,
  citySlug: string,
  stations: Array<{ slug: string; listing_count?: number | null }>
): MetadataRoute.Sitemap {
  const rows: MetadataRoute.Sitemap = [];

  for (const station of stations) {
    // Same inventory gate as localities. Without this, every station on every
    // metro line touching the city shipped — including stations the city does
    // not have, which render as soft 404s.
    if ((station.listing_count ?? 0) < THIN_LISTING_THRESHOLD) continue;

    rows.push(...entry(baseUrl, `/city/${citySlug}/metro/${station.slug}`, { priority: 0.7 }));
    for (const intent of METRO_INTENTS) {
      rows.push(
        ...entry(baseUrl, `/city/${citySlug}/metro/${station.slug}/${intent.slug}`, {
          priority: 0.55
        })
      );
    }
  }

  return rows;
}

export function buildCityLandmarkEntries(
  baseUrl: string,
  citySlug: string,
  landmarks: Array<{ slug: string; listing_count?: number | null }>
): MetadataRoute.Sitemap {
  const rows: MetadataRoute.Sitemap = [];

  for (const landmark of landmarks) {
    if ((landmark.listing_count ?? 0) < THIN_LISTING_THRESHOLD) continue;

    rows.push(...entry(baseUrl, `/city/${citySlug}/near/${landmark.slug}`, { priority: 0.7 }));
    for (const intent of LANDMARK_INTENTS) {
      rows.push(
        ...entry(baseUrl, `/city/${citySlug}/near/${landmark.slug}/${intent.slug}`, {
          priority: 0.55
        })
      );
    }
  }

  return rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test sitemap-chunks`
Expected: PASS, all tests including the three new exclusion tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sitemap-chunks.ts apps/web/app/__tests__/sitemap-chunks.test.ts
git commit -m "fix(seo): gate metro and landmark sitemap entries on listing count

buildCityMetroEntries and buildCityLandmarkEntries took no listing count, so
every station and landmark shipped regardless of inventory — 32,324 of 32,864
city-chunk URLs. Metro now takes a pre-derived slug from the API instead of a
station name. Adds the exclusion assertions the suite was missing."
```

---

### Task 6: Repoint the sitemap off `/map/metro`

**Files:**

- Modify: `apps/web/app/sitemap.ts:154-173`
- Test: `apps/web/app/__tests__/sitemap-city-chunk.test.ts` (create)

**Interfaces:**

- Consumes: `fetchCityPlaces` (Task 4), the gated builders (Task 5).
- Produces: `buildCityChunk` sourcing all three place kinds from one call.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/__tests__/sitemap-city-chunk.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/seo-api", () => ({
  fetchCityPlaces: vi.fn(),
  fetchEnabledCities: vi.fn(async () => new Set(["lucknow"]))
}));
vi.mock("../../lib/blog-api", () => ({ fetchAllBlogSlugs: vi.fn(async () => []) }));

import { fetchCityPlaces } from "../../lib/seo-api";
import sitemap, { resolveChunks } from "../sitemap";

const mockFetchCityPlaces = vi.mocked(fetchCityPlaces);

afterEach(() => {
  vi.resetAllMocks();
});

describe("city sitemap chunk", () => {
  it("submits only indexable places and never calls /map/metro", async () => {
    mockFetchCityPlaces.mockResolvedValue({
      city_slug: "lucknow",
      localities: [
        { slug: "gomti-nagar", name_en: "G", name_hi: null, listing_count: 4, indexable: true },
        { slug: "thin-loc", name_en: "T", name_hi: null, listing_count: 1, indexable: false }
      ],
      metro_stations: [
        { slug: "munshipulia", name_en: "M", name_hi: null, listing_count: 3, indexable: true },
        { slug: "kashmere-gate", name_en: "K", name_hi: null, listing_count: 0, indexable: false }
      ],
      landmarks: [{ slug: "kgmu", name_en: "K", name_hi: null, listing_count: 7, indexable: true }]
    });

    const chunks = await resolveChunks();
    const cityIndex = chunks.findIndex((c) => c.kind === "city");
    const rows = await sitemap({ id: cityIndex });
    const urls = rows.map((r) => r.url);

    expect(urls.some((u) => u.includes("/gomti-nagar"))).toBe(true);
    expect(urls.some((u) => u.includes("/metro/munshipulia"))).toBe(true);
    expect(urls.some((u) => u.includes("/near/kgmu"))).toBe(true);

    expect(urls.some((u) => u.includes("thin-loc"))).toBe(false);
    expect(urls.some((u) => u.includes("kashmere-gate"))).toBe(false);

    expect(mockFetchCityPlaces).toHaveBeenCalledWith("lucknow", { revalidate: 86400 });
  });

  it("emits an empty chunk for a city with no places rather than failing", async () => {
    mockFetchCityPlaces.mockResolvedValue({
      city_slug: "chandigarh",
      localities: [],
      metro_stations: [],
      landmarks: []
    });

    const chunks = await resolveChunks();
    const cityIndex = chunks.findIndex((c) => c.kind === "city");

    await expect(sitemap({ id: cityIndex })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test sitemap-city-chunk`
Expected: FAIL — `fetchCityPlaces` is not used by `buildCityChunk`; the mock is never called.

- [ ] **Step 3: Rewrite `buildCityChunk`**

In `apps/web/app/sitemap.ts`, replace `buildCityChunk` (lines 154–173) with:

```typescript
async function buildCityChunk(citySlug: string): Promise<MetadataRoute.Sitemap> {
  // One call, one definition of `indexable`. Metro stations used to come from
  // /map/metro, which returns whole metro LINES touching the city — that is why
  // Faridabad shipped 2,916 metro URLs while having zero stations of its own.
  const places = await fetchCityPlaces(citySlug, { revalidate: 86400 });

  const indexable = (list: SeoPlace[]) => list.filter((place) => place.indexable);

  return [
    ...buildCityLocalityEntries(BASE_URL, citySlug, indexable(places.localities)),
    ...buildCityMetroEntries(BASE_URL, citySlug, indexable(places.metro_stations)),
    ...buildCityLandmarkEntries(BASE_URL, citySlug, indexable(places.landmarks))
  ];
}
```

Then fix the imports at the top of the file: replace the `fetchLandmarks`,
`fetchLocalities`, `fetchMetroStationsForCity`, `LandmarkRow`, `LocalityRow` and
`MetroStationRow` imports from `../lib/seo-api` with:

```typescript
import { fetchCityPlaces, fetchEnabledCities, type SeoPlace } from "../lib/seo-api";
```

`buildCityLocalityEntries` already gates on `listing_count`, and `SeoPlace`
carries `listing_count`, so passing pre-filtered lists is belt-and-braces: the
filter and the builder agree.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test sitemap-city-chunk`
Expected: PASS, 2 tests.

- [ ] **Step 5: Verify `/map/metro` is gone from the SEO path**

Run: `grep -rn 'map/metro' apps/web/app apps/web/lib`
Expected: only `fetchMetroStationsForCity` in `apps/web/lib/seo-api.ts` still
references it. That helper is still used by the metro **page** for its
"other stations on this line" rail, which is correct — it is no longer a sitemap
input. Confirm `apps/web/app/sitemap.ts` contains no reference.

- [ ] **Step 6: Run the full web suite and typecheck**

Run: `pnpm --filter @cribliv/web test && pnpm typecheck`
Expected: all PASS. If any test referenced the old `buildCityChunk` fetchers, update it.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/sitemap.ts apps/web/app/__tests__/sitemap-city-chunk.test.ts
git commit -m "fix(seo): source sitemap places from /seo/cities/:slug/places

The sitemap sourced metro stations from /map/metro, which returns whole metro
lines touching a city rather than the city's own stations. Faridabad and
Ghaziabad therefore shipped 9,234 metro URLs while having zero stations, all
returning HTTP 200 with an empty body. Now one call returns localities, metro
stations and landmarks with a server-computed indexable flag."
```

---

### Task 7: Real 404s for unresolvable places

Spec §4.3. `notFound()` is already called by the page templates, but production
returns **HTTP 200** with an empty body — there is no `not-found.tsx` anywhere in
`apps/web/app`, and the empty render is ISR-cached and served as 200.

**Files:**

- Create: `apps/web/app/[locale]/not-found.tsx`
- Test: manual verification against a production build (documented below)

**Interfaces:**

- Consumes: nothing.
- Produces: a 404 boundary for every route under `[locale]`.

- [ ] **Step 1: Reproduce the defect against a production build**

`next dev` and `next start` differ here — Vercel runs the production build, so
verify against that.

```bash
pnpm --filter @cribliv/web build
pnpm --filter @cribliv/web start
```

In a second shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/city/faridabad/metro/kashmere-gate
```

Expected: `200` — reproducing the production defect. Record the actual value; if
it is already `404` locally, the cause is Vercel-side ISR caching rather than the
missing boundary, and that finding must be reported before continuing.

- [ ] **Step 2: Add the not-found boundary**

Create `apps/web/app/[locale]/not-found.tsx`:

```tsx
import Link from "next/link";

/**
 * 404 boundary for every localised route. Its absence meant `notFound()` calls
 * in the SEO page templates produced an empty 200 response — a soft 404, the
 * worst possible crawl signal, and the reason Search Console reported 98.8%
 * "OK (200)" while most submitted URLs were broken.
 */
export default function LocaleNotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground">
        This page does not exist. It may have been removed, or the address may be incorrect.
      </p>
      <div className="flex gap-3">
        <Link className="underline" href="/en">
          Go to homepage
        </Link>
        <Link className="underline" href="/en/search">
          Browse rentals
        </Link>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Rebuild and verify the status is now 404**

```bash
pnpm --filter @cribliv/web build
pnpm --filter @cribliv/web start
```

Then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/city/faridabad/metro/kashmere-gate
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/en/city/lucknow/gomti-nagar
```

Expected: `404` for the first, `200` for the second. If the first is still `200`,
stop and report — the remaining cause is the ISR cache path and needs its own
diagnosis rather than a guess.

- [ ] **Step 4: Confirm the body is non-empty**

```bash
curl -s http://localhost:3000/en/city/faridabad/metro/kashmere-gate | grep -c '<h1'
```

Expected: `1` — the previous behaviour rendered zero `<h1>` elements.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/not-found.tsx"
git commit -m "fix(seo): add locale not-found boundary so notFound() returns a real 404

apps/web/app had no not-found.tsx, so notFound() in the SEO templates produced
an empty HTTP 200 — a soft 404. Verified locally: the metro page for a station
the city does not have now returns 404 with a rendered body."
```

---

### Task 8: End-to-end verification

**Files:**

- Modify: `docs/superpowers/specs/2026-07-26-programmatic-seo-indexability-design.md` (record measured results)

**Interfaces:**

- Consumes: every prior task.
- Produces: measured before/after numbers for the PR description.

- [ ] **Step 1: Run everything**

Run: `pnpm --filter @cribliv/shared-types build && pnpm typecheck && pnpm --filter @cribliv/api test && pnpm --filter @cribliv/web test`
Expected: all green. Note that API DB-backed tests skip without `TEST_DATABASE_URL` — that is expected, not a failure.

- [ ] **Step 2: Count the local sitemap**

With `pnpm --filter @cribliv/web start` running against an API pointed at a
populated DB:

```bash
for i in 0 1 2 3 4 5 6 7; do
  n=$(curl -s "http://localhost:3000/sitemap/$i.xml" | grep -oE '<loc>' | wc -l)
  echo "chunk $i: $n URLs"
done
```

Expected: city chunks drop from thousands to low hundreds; chunks for cities with
no qualifying places are empty.

- [ ] **Step 3: Assert the invariant holds on a sample**

For 20 URLs sampled from the local sitemap, each must return 200 and must not be
`noindex`:

```bash
curl -s http://localhost:3000/sitemap/2.xml \
  | grep -oE '<loc>[^<]+</loc>' | sed 's/<[^>]*>//g' | head -20 \
  | while read -r u; do
      p=${u#http://localhost:3000}
      code=$(curl -s -o /tmp/p.html -w '%{http_code}' "http://localhost:3000$p")
      ni=$(grep -c 'name="robots" content="noindex' /tmp/p.html || true)
      echo "$code noindex=$ni $p"
    done
```

Expected: every line `200 noindex=0`. Any `noindex=1` is a violation of the
invariant and must be fixed before the PR opens.

- [ ] **Step 4: Record results in the spec**

Append the measured chunk counts and sample results to spec §7.3 under a
"PR 1 measured results" heading, replacing estimates with real numbers.

- [ ] **Step 5: Commit and open the PR**

```bash
git add docs/superpowers/specs/2026-07-26-programmatic-seo-indexability-design.md
git commit -m "docs(seo): record PR 1 measured sitemap results"
git push -u origin HEAD
gh pr create --base master --title "fix(seo): stop submitting 32k unindexable URLs to Google" --fill
```

The PR body must state that the submitted URL count drops ~97% **by design**, and
that success is measured by rising 404s and rising Discovery share in Search
Console — not by URL count. Link the spec.

---

## Post-merge (not part of this plan)

1. Deploy, then re-run the production sitemap count and confirm zero metro URLs
   for `faridabad` and `ghaziabad`.
2. Confirm `https://cribliv.com/en/city/faridabad/metro/kashmere-gate` returns 404.
3. Watch Search Console for ~2 weeks: `404` share should spike then decay;
   Discovery share should rise from 12.92%.
4. Then write the PR 2 plan (hierarchy rollup + search rollup + city hubs +
   admin metrics + `seo:audit`). PR 3 (four cities' data) comes after PR 2.
