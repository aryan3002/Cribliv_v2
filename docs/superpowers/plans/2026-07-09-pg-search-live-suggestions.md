# PG Search Live Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PG search suggestions and preview cards use live DB-backed city/locality data only, matching the Homes search behavior, so zero-inventory seeded places show as `0 listings` instead of hardcoded fake counts.

**Architecture:** Keep the public search bar as the single UI for Homes and PG. Change PG backend suggest queries to mirror the Homes suggest pattern: seeded active cities/localities are returned with live aggregate counts, including zero. Remove frontend Cribliv fallback data and pass `city` to preview requests for locality rows so duplicate locality slugs resolve correctly.

**Tech Stack:** Next.js 14 App Router, React Testing Library/Vitest for web unit tests, NestJS, PostgreSQL SQL queries through `DatabaseService`, Vitest for API tests.

## Global Constraints

- Do not implement demo or hardcoded inventory counts anywhere in the live search UI.
- Preserve existing route shape for Homes and PG search results.
- Keep all public listing suggestions scoped to active listings only.
- Keep preview endpoint changes backward compatible: existing callers with only `type` and `value` must still work.
- Follow the repo DB dual-mode rule: services must not throw when `DatabaseService.isEnabled()` is false.
- Use `rtk` before shell commands in this repository.
- Use TDD: write failing regression tests before changing implementation.

---

## File Structure

- Modify `apps/api/src/modules/pg-operator/services/pg-search.service.ts`
  - Owns PG public search, suggest, and preview data.
  - Change `suggest()` city/locality aggregate SQL to return seeded places with zero active PG listings.
  - Change `preview()` locality resolution to accept optional city slug and use selected locality id for stats.

- Modify `apps/api/src/modules/pg-operator/pg-public.controller.ts`
  - Extend `/v1/pg/preview` query handling with optional `city`.

- Modify `apps/api/src/modules/search/search.service.ts`
  - Extend Homes preview locality resolution with optional city slug for duplicate locality slugs.
  - Preserve the existing Homes suggestion behavior.

- Modify `apps/api/src/modules/search/search.controller.ts`
  - Extend `/v1/listings/search/preview` query handling with optional `city`.

- Modify `apps/api/test/pg-search.service.test.ts`
  - Add PG suggest regression tests for zero-count seeded places.
  - Add PG preview regression test for city-scoped locality preview.

- Create `apps/api/test/search-preview.service.test.ts`
  - Add Homes preview regression test for city-scoped locality preview.

- Modify `apps/web/components/search-hero.tsx`
  - Remove hardcoded Cribliv fallback suggestions.
  - Keep Google Places predictions as a separate fallback source when enabled.
  - Pass locality `city_slug` to preview endpoints.
  - Remove fake seed preview values such as `verified_pct: 100`, `avg_bhk: 2.3`, and PG sharing defaults.

- Modify `apps/web/components/__tests__/search-hero-toggle.test.tsx`
  - Add regression tests that the PG search bar does not render hardcoded counts.
  - Add regression test that locality preview requests include `city`.

---

### Task 1: PG Suggest Returns Seeded Places With Zero Inventory

**Files:**

- Modify: `apps/api/test/pg-search.service.test.ts`
- Modify: `apps/api/src/modules/pg-operator/services/pg-search.service.ts`

**Interfaces:**

- Consumes: `PgSearchService.suggest(q: string, limit?: number): Promise<PgSuggestRow[]>`
- Produces: PG city/locality suggestions with live `listing_count`, including `0`, and optional `rent_band` only when live rent data exists.

- [ ] **Step 1: Add the failing API regression test**

In `apps/api/test/pg-search.service.test.ts`, add this test inside `describe("PgSearchService.search", () => { ... })`, near the existing suggest tests:

```ts
it("suggest keeps seeded PG cities and localities visible when inventory is zero", async () => {
  const calls: string[] = [];
  const database = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      if (/FROM cities c/.test(sql)) {
        return {
          rows: [
            {
              slug: "noida",
              name_en: "Noida",
              listing_count: 0,
              min_rent: null,
              max_rent: null
            }
          ],
          rowCount: 1
        };
      }
      if (/FROM localities loc/.test(sql)) {
        return {
          rows: [
            {
              slug: "sector-62",
              name_en: "Sector 62",
              city_slug: "noida",
              listing_count: 0,
              min_rent: null,
              max_rent: null
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    })
  };
  const svc = new PgSearchService(database as never);

  const rows = await svc.suggest("noi", 6);
  const citySql = calls.find((sql) => /FROM cities c/.test(sql)) ?? "";
  const localitySql = calls.find((sql) => /FROM localities loc/.test(sql)) ?? "";

  expect(citySql).toMatch(/LEFT JOIN LATERAL/);
  expect(citySql).not.toMatch(/stats\.listing_count > 0/);
  expect(localitySql).toMatch(/LEFT JOIN LATERAL/);
  expect(localitySql).not.toMatch(/stats\.listing_count > 0/);
  expect(rows).toEqual([
    { type: "city", label: "Noida", value: "noida", listing_count: 0 },
    {
      type: "locality",
      label: "Sector 62, noida",
      value: "sector-62",
      city_slug: "noida",
      listing_count: 0
    }
  ]);
});
```

- [ ] **Step 2: Run the focused failing API test**

Run:

```bash
rtk pnpm --filter @cribliv/api test -- pg-search.service.test.ts
```

Expected: FAIL because PG suggest SQL still uses `JOIN LATERAL` and `stats.listing_count > 0` for city/locality suggestions.

- [ ] **Step 3: Change PG suggest city SQL to match Homes zero-count behavior**

In `apps/api/src/modules/pg-operator/services/pg-search.service.ts`, replace the city suggestion query inside `runSuggest()` with:

```ts
this.db.query<{
  slug: string;
  name_en: string;
  listing_count: number;
  min_rent: number | null;
  max_rent: number | null;
}>(
  `SELECT c.slug, c.name_en,
              COALESCE(stats.listing_count, 0)::int AS listing_count,
              stats.min_rent::int AS min_rent,
              stats.max_rent::int AS max_rent,
              similarity(c.name_en, $1) AS sim
       FROM cities c
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS listing_count, min(l.monthly_rent) AS min_rent, max(l.monthly_rent) AS max_rent
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE ll.city_id = c.id AND l.status = 'active' AND l.listing_type = 'pg'
       ) stats ON true
       WHERE c.is_active = true
         AND (similarity(c.name_en, $1) > 0.15 OR c.name_en ILIKE '%' || $1 || '%' OR c.name_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
  [term]
);
```

- [ ] **Step 4: Change PG suggest locality SQL to match Homes zero-count behavior**

In the same method, replace the locality suggestion query with:

```ts
this.db.query<{
  slug: string;
  name_en: string;
  city_slug: string;
  listing_count: number;
  min_rent: number | null;
  max_rent: number | null;
}>(
  `SELECT loc.slug, loc.name_en, c.slug AS city_slug,
              COALESCE(stats.listing_count, 0)::int AS listing_count,
              stats.min_rent::int AS min_rent,
              stats.max_rent::int AS max_rent,
              similarity(loc.name_en, $1) AS sim
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       LEFT JOIN LATERAL (
         SELECT count(DISTINCT l.id)::int AS listing_count, min(l.monthly_rent) AS min_rent, max(l.monthly_rent) AS max_rent
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active' AND l.listing_type = 'pg' AND ll.locality_id = loc.id
       ) stats ON true
       WHERE c.is_active = true
         AND (similarity(loc.name_en, $1) > 0.15 OR loc.name_en ILIKE '%' || $1 || '%' OR loc.name_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
  [term]
);
```

- [ ] **Step 5: Update the PG suggest method comment**

Replace the comment above `suggest()` in `apps/api/src/modules/pg-operator/services/pg-search.service.ts` with:

```ts
/**
 * Tenant-facing PG autocomplete. Returns seeded active cities/localities with
 * live PG aggregates, including zero-count places, plus active PG listings.
 * Drafts, pending, paused, and archived listings never leak.
 */
```

- [ ] **Step 6: Run the focused API test again**

Run:

```bash
rtk pnpm --filter @cribliv/api test -- pg-search.service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
rtk git add apps/api/test/pg-search.service.test.ts apps/api/src/modules/pg-operator/services/pg-search.service.ts
rtk git commit -m "fix: return zero-count PG place suggestions"
```

---

### Task 2: City-Scoped Locality Preview For PG And Homes

**Files:**

- Modify: `apps/api/test/pg-search.service.test.ts`
- Create: `apps/api/test/search-preview.service.test.ts`
- Modify: `apps/api/src/modules/pg-operator/pg-public.controller.ts`
- Modify: `apps/api/src/modules/pg-operator/services/pg-search.service.ts`
- Modify: `apps/api/src/modules/search/search.controller.ts`
- Modify: `apps/api/src/modules/search/search.service.ts`

**Interfaces:**

- Consumes: `GET /v1/pg/preview?type=locality&value=<locality>&city=<city>`
- Consumes: `GET /v1/listings/search/preview?type=locality&value=<locality>&city=<city>`
- Produces: Backward-compatible preview APIs. `city` is optional; when provided, duplicate locality slugs resolve inside that city.
- Produces: `PgSearchService.preview(type: string, value: string, citySlug?: string): Promise<PgPreview | null>`
- Produces: `SearchService.getSearchPreview(type: "city" | "locality", slug: string, citySlug?: string): Promise<SearchPreview | null>`

- [ ] **Step 1: Add the failing PG locality preview test**

In `apps/api/test/pg-search.service.test.ts`, add this test near the existing preview tests:

```ts
it("preview scopes duplicate PG locality slugs by city when city is provided", async () => {
  const calls: string[] = [];
  const params: unknown[][] = [];
  const database = {
    isEnabled: () => true,
    query: vi.fn(async (sql: string, p: unknown[] = []) => {
      calls.push(sql);
      params.push(p);
      if (/FROM localities loc JOIN cities c/.test(sql)) {
        return {
          rows: [{ id: 42, name_en: "Sector 62", city_slug: "noida" }],
          rowCount: 1
        };
      }
      if (/count\(DISTINCT l\.id\)::int AS listing_count/.test(sql)) {
        return {
          rows: [
            {
              listing_count: 0,
              min_rent: null,
              max_rent: null,
              verified_count: 0,
              sharing: null
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    })
  };
  const svc = new PgSearchService(database as never);

  const out = await svc.preview("locality", "sector-62", "noida");

  expect(calls[0]).toMatch(/c\.slug = \$2/);
  expect(params[0]).toEqual(["sector-62", "noida"]);
  expect(calls[1]).toMatch(/ll\.locality_id = \$1/);
  expect(params[1]).toEqual([42]);
  expect(out).toMatchObject({
    type: "locality",
    slug: "sector-62",
    name: "Sector 62",
    city_slug: "noida",
    listing_count: 0,
    rent_band: null,
    verified_pct: null,
    avg_bhk: null,
    sharing: []
  });
});
```

- [ ] **Step 2: Add the failing Homes locality preview test**

Create `apps/api/test/search-preview.service.test.ts` with:

```ts
import { describe, expect, it, vi } from "vitest";
import { SearchService } from "../src/modules/search/search.service";

function makeService(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>
) {
  const database = {
    isEnabled: () => true,
    query: vi.fn(query)
  };
  const service = new SearchService(
    {} as any,
    database as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { service, database };
}

describe("SearchService.getSearchPreview", () => {
  it("scopes duplicate locality slugs by city when city is provided", async () => {
    const calls: string[] = [];
    const params: unknown[][] = [];
    const { service } = makeService(async (sql: string, p: unknown[] = []) => {
      calls.push(sql);
      params.push(p);
      if (/FROM localities loc\s+JOIN cities c/.test(sql)) {
        return {
          rows: [
            { id: 42, city_id: 7, slug: "sector-62", name_en: "Sector 62", city_slug: "noida" }
          ],
          rowCount: 1
        };
      }
      if (/count\(DISTINCT l\.id\)::int AS listing_count/.test(sql)) {
        return {
          rows: [
            {
              listing_count: 0,
              min_rent: null,
              max_rent: null,
              verified_count: 0,
              avg_bhk: null
            }
          ],
          rowCount: 1
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const out = await service.getSearchPreview("locality", "sector-62", "noida");

    expect(calls[0]).toMatch(/c\.slug = \$2/);
    expect(params[0]).toEqual(["sector-62", "noida"]);
    expect(calls[1]).toMatch(/ll\.city_id = \$2/);
    expect(params[1]).toEqual([42, 7, "Sector 62"]);
    expect(out).toMatchObject({
      type: "locality",
      slug: "sector-62",
      name: "Sector 62",
      city_slug: "noida",
      listing_count: 0,
      rent_band: null,
      verified_pct: null,
      avg_bhk: null
    });
  });
});
```

- [ ] **Step 3: Run the focused failing API tests**

Run:

```bash
rtk pnpm --filter @cribliv/api test -- pg-search.service.test.ts search-preview.service.test.ts
```

Expected: FAIL because both preview methods currently ignore the extra `city` argument and locality preview resolves by bare slug.

- [ ] **Step 4: Extend the PG preview controller**

In `apps/api/src/modules/pg-operator/pg-public.controller.ts`, replace the preview method with:

```ts
  @Get("preview")
  async preview(@Query() query: { type?: string; value?: string; city?: string }) {
    return ok(await this.search.preview(query.type ?? "city", query.value ?? "", query.city));
  }
```

- [ ] **Step 5: Extend `PgSearchService.preview()` signature and cache key**

In `apps/api/src/modules/pg-operator/services/pg-search.service.ts`, replace the preview method signatures with:

```ts
  async preview(type: string, value: string, citySlug?: string): Promise<PgPreview | null> {
    const slug = (value ?? "").trim().toLowerCase();
    const normalizedCitySlug = citySlug?.trim().toLowerCase() || null;
    if (!slug || !this.db.isEnabled()) return null;
    return this.cached(`preview:${type}:${slug}:${normalizedCitySlug ?? ""}`, () =>
      this.runPreview(type, slug, normalizedCitySlug)
    );
  }

  private async runPreview(
    type: string,
    slug: string,
    citySlug: string | null
  ): Promise<PgPreview | null> {
```

- [ ] **Step 6: Replace the PG locality preview branch**

In `runPreview()`, replace the locality branch from the `const locRows = ...` line through the returned locality object with:

```ts
const locParams: unknown[] = [slug];
const cityPredicate = citySlug ? ` AND c.slug = $2` : "";
if (citySlug) locParams.push(citySlug);

const locRows = await this.db.query<{ id: number; name_en: string; city_slug: string }>(
  `SELECT loc.id, loc.name_en, c.slug AS city_slug
       FROM localities loc JOIN cities c ON c.id = loc.city_id
       WHERE loc.slug = $1${cityPredicate}
       ORDER BY c.slug
       LIMIT 1`,
  locParams
);
const loc = locRows.rows[0];
if (!loc) return null;

const stats = await this.db.query<{
  listing_count: number;
  min_rent: number | null;
  max_rent: number | null;
  verified_count: number;
  sharing: string[] | null;
}>(
  `SELECT
         count(DISTINCT l.id)::int AS listing_count,
         min(l.monthly_rent)::int AS min_rent,
         max(l.monthly_rent)::int AS max_rent,
         sum(CASE WHEN l.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_count,
         (SELECT array_agg(DISTINCT rt.sharing::text)
            FROM pg_room_types rt
            JOIN listings l2 ON l2.id = rt.listing_id
            JOIN listing_locations ll2 ON ll2.listing_id = l2.id
            WHERE ll2.locality_id = $1 AND l2.status = 'active' AND l2.listing_type = 'pg') AS sharing
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       WHERE ll.locality_id = $1 AND l.status = 'active' AND l.listing_type = 'pg'`,
  [loc.id]
);
const row = stats.rows[0];

const photos = await this.db.query<{ blob_path: string }>(
  `SELECT lp.blob_path
       FROM listing_photos lp
       JOIN listings l ON l.id = lp.listing_id
       JOIN listing_locations ll ON ll.listing_id = l.id
       WHERE ll.locality_id = $1 AND l.status = 'active' AND l.listing_type = 'pg'
         AND lp.is_cover = true
       ORDER BY l.created_at DESC
       LIMIT 4`,
  [loc.id]
);

const count = row?.listing_count ?? 0;
return {
  type: "locality",
  slug,
  name: loc.name_en,
  city_slug: loc.city_slug,
  listing_count: count,
  rent_band: buildBand(row?.min_rent ?? null, row?.max_rent ?? null),
  verified_pct: count > 0 ? Math.round(((row?.verified_count ?? 0) / count) * 100) : null,
  avg_bhk: null,
  sharing: row?.sharing ?? [],
  sample_photos: photos.rows
    .map((r) => this.toPhotoUrl(r.blob_path))
    .filter((u): u is string => Boolean(u))
};
```

- [ ] **Step 7: Extend the Homes preview controller**

In `apps/api/src/modules/search/search.controller.ts`, replace the preview method with:

```ts
  @Get("listings/search/preview")
  async preview(@Query() query: { type?: string; value?: string; city?: string }) {
    if (query.type !== "city" && query.type !== "locality") return ok(null);
    if (!query.value) return ok(null);
    return ok(await this.searchService.getSearchPreview(query.type, query.value, query.city));
  }
```

- [ ] **Step 8: Extend `SearchService.getSearchPreview()` signature and cache key**

In `apps/api/src/modules/search/search.service.ts`, change the method signature and cache key setup to:

```ts
  async getSearchPreview(
    type: "city" | "locality",
    slug: string,
    citySlug?: string
  ): Promise<{
    type: "city" | "locality";
    slug: string;
    name: string;
    city_slug?: string;
    listing_count: number;
    rent_band: { min: number; max: number } | null;
    verified_pct: number | null;
    avg_bhk: number | null;
    sample_photos: string[];
  } | null> {
    const normalizedCitySlug = citySlug?.trim().toLowerCase() || null;
    if (!this.database.isEnabled() || !slug) return null;

    const cacheKey = `${type}:${slug}:${normalizedCitySlug ?? ""}`;
```

- [ ] **Step 9: Replace the Homes locality lookup and stats/photo queries**

In the locality branch of `getSearchPreview()`, replace the `locRows`, `stats`, and `photoRows` queries with:

```ts
const locParams: unknown[] = [slug];
const cityPredicate = normalizedCitySlug ? ` AND c.slug = $2` : "";
if (normalizedCitySlug) locParams.push(normalizedCitySlug);

const locRows = await this.database.query<{
  id: number;
  city_id: number;
  slug: string;
  name_en: string;
  city_slug: string;
}>(
  `SELECT loc.id, loc.city_id, loc.slug, loc.name_en, c.slug AS city_slug
         FROM localities loc
         JOIN cities c ON c.id = loc.city_id
         WHERE loc.slug = $1${cityPredicate}
         ORDER BY c.slug
         LIMIT 1`,
  locParams
);
const loc = locRows.rows[0];
if (!loc) return null;

const stats = await this.database.query<{
  listing_count: number;
  min_rent: number | null;
  max_rent: number | null;
  verified_count: number;
  avg_bhk: number | null;
}>(
  `SELECT
           count(DISTINCT l.id)::int AS listing_count,
           min(l.monthly_rent)::int AS min_rent,
           max(l.monthly_rent)::int AS max_rent,
           sum(CASE WHEN l.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_count,
           avg(l.bhk)::float AS avg_bhk
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active'
           AND l.listing_type = 'flat_house'
           AND ll.city_id = $2
           AND (
             ll.locality_id = $1
             OR l.title_en ILIKE '%' || $3 || '%'
             OR l.description_en ILIKE '%' || $3 || '%'
           )`,
  [loc.id, loc.city_id, loc.name_en]
);
const row = stats.rows[0] ?? {
  listing_count: 0,
  min_rent: null,
  max_rent: null,
  verified_count: 0,
  avg_bhk: null
};

const photoRows = await this.database.query<{ blob_path: string }>(
  `SELECT DISTINCT lp.blob_path, l.created_at
         FROM listing_photos lp
         JOIN listings l ON l.id = lp.listing_id
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active'
           AND l.listing_type = 'flat_house'
           AND lp.is_cover = true
           AND ll.city_id = $2
           AND (
             ll.locality_id = $1
             OR l.title_en ILIKE '%' || $3 || '%'
             OR l.description_en ILIKE '%' || $3 || '%'
           )
         ORDER BY l.created_at DESC
         LIMIT 4`,
  [loc.id, loc.city_id, loc.name_en]
);
```

Keep the existing `value = { ... }` assignment, but ensure it uses `slug: loc.slug`, `name: loc.name_en`, and `city_slug: loc.city_slug`.

- [ ] **Step 10: Run the focused API tests again**

Run:

```bash
rtk pnpm --filter @cribliv/api test -- pg-search.service.test.ts search-preview.service.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 2**

```bash
rtk git add apps/api/test/pg-search.service.test.ts apps/api/test/search-preview.service.test.ts apps/api/src/modules/pg-operator/pg-public.controller.ts apps/api/src/modules/pg-operator/services/pg-search.service.ts apps/api/src/modules/search/search.controller.ts apps/api/src/modules/search/search.service.ts
rtk git commit -m "fix: scope locality previews by city"
```

---

### Task 3: Remove Frontend Hardcoded Cribliv Inventory Fallback

**Files:**

- Modify: `apps/web/components/__tests__/search-hero-toggle.test.tsx`
- Modify: `apps/web/components/search-hero.tsx`

**Interfaces:**

- Consumes: `CriblivSuggestion.city_slug` for locality suggestions.
- Produces: SearchHero renders only API-sourced Cribliv suggestions. Empty API data means no Cribliv suggestion rows.
- Produces: Preview fetch URL includes `city=<city_slug>` for locality suggestions when available.

- [ ] **Step 1: Add failing web regression tests**

In `apps/web/components/__tests__/search-hero-toggle.test.tsx`, add these tests inside `describe("SearchHero Homes|PG toggle", () => { ... })`:

```tsx
it("does not render hardcoded PG fallback inventory when suggest returns empty", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/pg/suggest")) {
      return { ok: true, json: async () => ({ data: [] }) };
    }
    return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<SearchHero locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
  fireEvent.change(screen.getByLabelText(/agentic search/i), { target: { value: "Noida" } });

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/pg/suggest"))).toBe(true);
  });
  expect(screen.queryByText(/860 listings/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Sector 62/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("requests PG locality preview with the suggestion city slug", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/pg/suggest")) {
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              type: "locality",
              label: "Sector 62, noida",
              value: "sector-62",
              city_slug: "noida",
              listing_count: 0
            }
          ]
        })
      };
    }
    if (u.includes("/pg/preview")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            type: "locality",
            slug: "sector-62",
            name: "Sector 62",
            city_slug: "noida",
            listing_count: 0,
            rent_band: null,
            verified_pct: null,
            avg_bhk: null,
            sharing: [],
            sample_photos: []
          }
        })
      };
    }
    return { ok: true, json: async () => ({ data: { cities: [], localities: [] } }) };
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<SearchHero locale="en" />);
  fireEvent.click(screen.getByRole("button", { name: /^PG$/i }));
  fireEvent.change(screen.getByLabelText(/agentic search/i), { target: { value: "sector 62" } });

  await waitFor(() => {
    expect(
      fetchMock.mock.calls.some(([url]) => {
        const u = String(url);
        return (
          u.includes("/pg/preview") &&
          u.includes("type=locality") &&
          u.includes("value=sector-62") &&
          u.includes("city=noida")
        );
      })
    ).toBe(true);
  });
  expect(screen.queryByText(/72 listings/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused failing web test**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- search-hero-toggle.test.tsx
```

Expected: FAIL because the component still falls back to hardcoded Noida/Sector 62 rows and preview fetches do not include `city`.

- [ ] **Step 3: Remove hardcoded fallback data**

In `apps/web/components/search-hero.tsx`, delete:

```ts
const FALLBACK_SUGGESTIONS: CriblivSuggestion[] = [
  ...
];

function normalizeSuggestionText(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ");
}

function fallbackCriblivSuggestions(q: string, segment: "homes" | "pg"): CriblivSuggestion[] {
  ...
}
```

If `normalizeSuggestionText` has no remaining usages, remove it with the fallback block.

- [ ] **Step 4: Return only live Cribliv suggestion data**

In `fetchCriblivSuggestions`, replace the body after the `fetch()` call with:

```ts
if (res.ok) {
  const body = await res.json();
  return Array.isArray(body.data) ? body.data : [];
}
```

Replace the final fallback return with:

```ts
return [];
```

The full function should keep the existing API base/path selection and should not call any local fallback helper.

- [ ] **Step 5: Track locality city slug in preview hover state**

In `SectionedDropdown`, replace the hovered state type with:

```ts
const [hovered, setHovered] = useState<{
  type: "city" | "locality";
  slug: string;
  citySlug?: string;
} | null>(null);
```

Update the auto-hover effect:

```ts
if (cities[0]) {
  setHovered({ type: "city", slug: cities[0].data.value });
} else if (localities[0]) {
  const slug = localities[0].data.value;
  setHovered({ type: "locality", slug, citySlug: localities[0].data.city_slug });
} else {
  setHovered(null);
  setPreview(null);
}
```

Update `scheduleHover`:

```ts
function scheduleHover(type: "city" | "locality", slug: string, citySlug?: string) {
  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  hoverTimerRef.current = setTimeout(() => {
    setHovered({ type, slug, citySlug });
  }, 180);
}
```

Update locality row hover calls:

```tsx
                onHover={() => scheduleHover("locality", s.data.value, s.data.city_slug)}
```

Keep city row hover calls as:

```tsx
                onHover={() => scheduleHover("city", s.data.value)}
```

- [ ] **Step 6: Include `city` in preview fetch URLs and cache keys**

In the preview effect, replace:

```ts
const key = `${segment}:${hovered.type}:${hovered.slug}`;
```

with:

```ts
const key = `${segment}:${hovered.type}:${hovered.slug}:${hovered.citySlug ?? ""}`;
```

Replace the preview fetch call with:

```ts
const params = new URLSearchParams({ type: hovered.type, value: hovered.slug });
if (hovered.type === "locality" && hovered.citySlug) {
  params.set("city", hovered.citySlug);
}
fetch(`${base}${previewPath}?${params.toString()}`, {
  signal: controller.signal
});
```

- [ ] **Step 7: Match preview seeds by city slug**

Replace the `previewSeed` lookup with:

```ts
const previewSeed = hovered
  ? [...cities, ...localities].find(
      (s) =>
        s.data.type === hovered.type &&
        s.data.value === hovered.slug &&
        (hovered.type === "city" || s.data.city_slug === hovered.citySlug)
    )?.data
  : null;
```

- [ ] **Step 8: Remove fake preview values from suggestion seed data**

Replace `previewFromSuggestion()` with:

```ts
function previewFromSuggestion(
  suggestion: CriblivSuggestion,
  segment: "homes" | "pg"
): PreviewData {
  const labelParts = suggestion.label.split(",");
  const name = labelParts[0]?.trim() || suggestion.label;
  return {
    type: suggestion.type === "city" ? "city" : "locality",
    slug: suggestion.value,
    name,
    city_slug: suggestion.city_slug,
    listing_count: suggestion.listing_count ?? 0,
    rent_band: suggestion.rent_band ?? null,
    verified_pct: null,
    avg_bhk: null,
    sharing: segment === "pg" ? [] : undefined,
    sample_photos: []
  };
}
```

- [ ] **Step 9: Run the focused web test again**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- search-hero-toggle.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

```bash
rtk git add apps/web/components/search-hero.tsx apps/web/components/__tests__/search-hero-toggle.test.tsx
rtk git commit -m "fix: remove hardcoded search suggestion inventory"
```

---

### Task 4: Final Verification And Live Behavior Check

**Files:**

- No new source changes unless verification exposes a regression.

**Interfaces:**

- Verifies all changes from Tasks 1-3.
- Produces a final confidence report with commands run and outcomes.

- [ ] **Step 1: Run focused API tests**

```bash
rtk pnpm --filter @cribliv/api test -- pg-search.service.test.ts search-preview.service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

```bash
rtk pnpm --filter @cribliv/web test -- search-hero-toggle.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typechecks**

```bash
rtk pnpm --filter @cribliv/api typecheck
rtk pnpm --filter @cribliv/web typecheck
```

Expected: both commands PASS.

- [ ] **Step 4: Run broader build or full suite if time allows**

```bash
rtk pnpm test
rtk pnpm build
```

Expected: PASS. If unrelated pre-existing failures appear, record the failing test names and confirm the focused regressions still pass.

- [ ] **Step 5: Check local live API behavior with server running**

If the API server is running on port 4000, run:

```bash
rtk curl -sS 'http://localhost:4000/v1/pg/suggest?q=noi&limit=6'
rtk curl -sS 'http://localhost:4000/v1/pg/preview?type=city&value=noida'
rtk curl -sS 'http://localhost:4000/v1/pg/preview?type=locality&value=sector-62&city=noida'
rtk curl -sS 'http://localhost:4000/v1/listings/search/preview?type=locality&value=sector-62&city=noida'
```

Expected:

```json
{ "type": "city", "label": "Noida", "value": "noida", "listing_count": 0 }
```

for the PG suggest Noida row when there are no active PG listings in Noida. Preview responses should keep `listing_count: 0`, `rent_band: null`, and `city_slug: "noida"` for the city-scoped locality preview.

- [ ] **Step 6: Manual browser check**

Run the app normally:

```bash
rtk pnpm dev
```

Open the home page, switch the search segment to `PG`, type `noi`, and verify:

- No `860 listings` text appears.
- No hardcoded rent band appears for Noida.
- If Noida is seeded but has no active PG listings, the row shows `0 listings`.
- The preview pane shows live zero-state values: `Listings 0`, rent band blank, verified blank, sharing blank.
- Homes search still shows seeded localities with live counts, including zero, as before.

- [ ] **Step 7: Commit final verification notes if source changes were needed**

Only run this if Step 4 or Step 6 required additional source changes:

```bash
rtk git add apps/api apps/web
rtk git commit -m "test: verify live search suggestion parity"
```

---

## Safety Notes

- This plan does not remove Google Places predictions. It removes only hardcoded Cribliv inventory rows.
- This plan does not change search result routing. City suggestions still route to `city=<slug>`, PG locality suggestions still route to `city=<city_slug>&locality=<slug>`.
- This plan keeps `/preview?type=locality&value=<slug>` working. Adding `city=<slug>` only makes duplicate locality slugs deterministic.
- This plan intentionally changes PG suggest to match Homes suggest: places can exist with `listing_count: 0`.
- This plan avoids DB migrations. The schema already supports city-scoped locality slugs through `UNIQUE(city_id, slug)`.

## Self-Review

- Spec coverage: The plan removes fake fallback inventory, keeps seeded places visible with zero counts, scopes duplicate locality previews by city, and verifies both API and web behavior.
- Completion scan: Every task has exact files, code blocks, commands, and expected outcomes.
- Type consistency: `citySlug?: string` is added consistently to PG and Homes preview service methods, and the web uses `city_slug` from `CriblivSuggestion`.
