# Top Navigation Redesign — Slice 1 (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and fully test the pure data layer behind the new top navigation — a canonical city list, an extracted rent-city content module, and a `nav-model` that turns existing constants into panel link data — without changing a single rendered pixel.

**Architecture:** Everything in this slice is pure, synchronous, and dependency-free at runtime. `nav-model.ts` reads existing constants (`intent-filters.ts`, `rent-city-content.ts`, `PG_CITY_CONTENT`, `DESKS`, the Lucknow micro-locality seed) and returns plain data describing each menu panel. Because it performs no I/O and renders nothing, every link-correctness rule from the spec is unit-testable in isolation. Slice 2 consumes this model; nothing in slice 1 imports React.

**Tech Stack:** TypeScript, Next.js 14 App Router (typed routes enabled), Vitest + jsdom (`apps/web/vitest.config.ts`), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-25-top-nav-redesign-design.md`

## Global Constraints

- **No server fetch may be added to anything the root layout renders.** All slice-1 modules are pure and synchronous. (Spec §C1)
- **Never emit `/search?listing_type=pg`.** `apps/web/app/[locale]/search/page.tsx:205` redirects it. (Spec §C2)
- **Never emit a `/city/{citySlug}/{locality}` URL for a locality slug that is not known-good.** Only Lucknow slugs from `data/seeds/lucknow/micro-localities.json` qualify. (Spec §3.3)
- **Every emitted href must begin with `/{locale}/`** where locale is `en` or `hi`.
- **Hindi must use `label_hi`** from `IntentDefinition` and the `hi` field from `DESKS`.
- Typed routes are on — composed hrefs need `as Route` at the call site (slice 2), but `nav-model` returns plain `string` hrefs.
- Run tests with: `pnpm --filter @cribliv/web test`
- Existing regression gate (must stay green all slice): `components/__tests__/header.post-property-gating.test.tsx`, `components/__tests__/header-menu.pg-split.test.tsx`, `components/__tests__/header.pg-operator.test.tsx`

## Verified facts this plan depends on

These were checked against the source on 2026-07-25. Do not re-derive them; do not assume the opposite.

| Fact                                                                                                                                                                                                                                                                                                   | Evidence                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `/listings/search` accepts `q, city, locality, listing_type, min_rent, max_rent, bhk, furnishing, verified_only, sort, page, page_size, source, lat, lng, radius_km, min_deposit, max_deposit, preferred_tenant, availability, occupancy_type, food_included, gender_policy, tenant_type, sharing, ac` | `apps/api/src/modules/search/search.controller.ts:40-73`                 |
| `/pg/listings` accepts `city, locality, q, min_rent, max_rent, gender_policy, tenant_type, food_included, sharing, ac, sort, page, page_size`                                                                                                                                                          | `apps/api/src/modules/pg-operator/services/pg-search.service.ts:115-186` |
| `apps/api/src/modules/pg/` is a legacy 308-redirect stub, **not** the PG search                                                                                                                                                                                                                        | `apps/api/src/modules/pg/pg.controller.ts`                               |
| `rooms` is in the `property-type` category but its filter is `{"listing_type":"pg"}`                                                                                                                                                                                                                   | `data/seeds/lucknow/intents.json`                                        |
| Intent filter keys `tag`, `amenity`, `max_area_sqft` are **not** accepted by either endpoint                                                                                                                                                                                                           | the two tables above                                                     |
| `CITIES` in `rent-in/[city]/page.tsx` is module-private (`const`, not exported)                                                                                                                                                                                                                        | `apps/web/app/[locale]/rent-in/[city]/page.tsx:20`                       |
| `popularLocalities` entries are display names (`"Gomti Nagar"`), not slugs                                                                                                                                                                                                                             | same file                                                                |
| The homepage city grid has 9 entries including `Varanasi`, keyed by `city.name.toLowerCase()`                                                                                                                                                                                                          | `apps/web/app/[locale]/page.tsx:100`, `:629-640`                         |
| `CITY_ALIASES` in `search-segment.ts` is an alias map, not a plain city list                                                                                                                                                                                                                           | `apps/web/lib/search-segment.ts:18-29`                                   |

---

## File Structure

**Create:**

- `apps/web/lib/nav/cities.ts` — canonical hub-city list. Two exports, no logic.
- `apps/web/lib/nav/surface-params.ts` — the accepted-param allowlists and the intent-filter → surface-param translation. This is the file that enforces spec §C2.
- `apps/web/lib/nav/localities.ts` — locality link resolution (Lucknow seed slugs vs display-name fallback).
- `apps/web/lib/nav/nav-model.ts` — assembles panel data. Imports the three above plus existing constants.
- `apps/web/lib/rent-city-content.ts` — `CITIES` extracted out of the rent-in page.
- `apps/web/lib/nav/__tests__/cities.test.ts`
- `apps/web/lib/nav/__tests__/surface-params.test.ts`
- `apps/web/lib/nav/__tests__/localities.test.ts`
- `apps/web/lib/nav/__tests__/nav-model.test.ts`

**Modify:**

- `apps/web/app/[locale]/rent-in/[city]/page.tsx` — delete the inline `CITIES`, import it instead.
- `apps/web/app/sitemap.ts:23-32` — use `HUB_CITY_SLUGS`.
- `apps/web/app/[locale]/city/[citySlug]/page.tsx:44-53` — use `HUB_CITY_SLUGS`.
- `apps/web/app/[locale]/search/page.tsx:53-62` — use `HUB_CITIES`.

Split rationale: `surface-params.ts` is separated from `nav-model.ts` because it encodes the API contract (which params each endpoint honours) while `nav-model.ts` encodes product decisions (which columns exist). They change for different reasons — a new API filter touches only the former, a new menu column only the latter.

---

### Task 1: Canonical city list

**Files:**

- Create: `apps/web/lib/nav/cities.ts`
- Test: `apps/web/lib/nav/__tests__/cities.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `HUB_CITIES: ReadonlyArray<{ slug: string; label: string }>` (8 entries) and `HUB_CITY_SLUGS: ReadonlyArray<string>`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/nav/__tests__/cities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { HUB_CITIES, HUB_CITY_SLUGS } from "../cities";
import { PG_CITY_CONTENT } from "../../pg-city-content";

describe("HUB_CITIES", () => {
  it("has the 8 hub cities in a stable order", () => {
    expect(HUB_CITY_SLUGS).toEqual([
      "delhi",
      "gurugram",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur",
      "lucknow"
    ]);
  });

  it("does not include varanasi", () => {
    expect(HUB_CITY_SLUGS).not.toContain("varanasi");
  });

  it("gives every city a human label", () => {
    for (const city of HUB_CITIES) {
      expect(city.label.length).toBeGreaterThan(0);
      expect(city.label).not.toBe(city.slug);
    }
  });

  it("slugs are lowercase and hyphen-safe", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("every hub city has PG content, so /pg/{city} never 404s from a nav link", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(PG_CITY_CONTENT[slug], `PG_CITY_CONTENT missing ${slug}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/cities.test.ts`
Expected: FAIL — `Failed to resolve import "../cities"`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/nav/cities.ts`:

```ts
/**
 * Canonical hub-city list. Before this module the same 8 slugs were repeated in
 * sitemap.ts, city/[citySlug]/page.tsx, search/page.tsx, the homepage grid and
 * (as an alias map) search-segment.ts — in four different shapes.
 *
 * Order is meaningful: it is the order cities appear in the nav's city chip.
 * `varanasi` is deliberately absent — the homepage shows a card for it, but it
 * has no programmatic SEO support, no PG_CITY_CONTENT entry and no rent-in
 * entry, so the nav must not offer it.
 */
export interface HubCity {
  slug: string;
  label: string;
}

export const HUB_CITIES: ReadonlyArray<HubCity> = [
  { slug: "delhi", label: "Delhi" },
  { slug: "gurugram", label: "Gurugram" },
  { slug: "noida", label: "Noida" },
  { slug: "ghaziabad", label: "Ghaziabad" },
  { slug: "faridabad", label: "Faridabad" },
  { slug: "chandigarh", label: "Chandigarh" },
  { slug: "jaipur", label: "Jaipur" },
  { slug: "lucknow", label: "Lucknow" }
];

export const HUB_CITY_SLUGS: ReadonlyArray<string> = HUB_CITIES.map((c) => c.slug);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/cities.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav/cities.ts apps/web/lib/nav/__tests__/cities.test.ts
git commit -m "feat(web): canonical HUB_CITIES constant for the nav"
```

---

### Task 2: Guard the two city lists that stay independent

The homepage grid and `CITY_ALIASES` are **not** replaced — they carry extra data (photos/gradients; aliases). Instead they get drift tests, so a future edit that adds a city to one place and not the other fails CI.

**Files:**

- Modify: `apps/web/lib/nav/__tests__/cities.test.ts`

**Interfaces:**

- Consumes: `HUB_CITY_SLUGS` from Task 1; `resolveCity` from `apps/web/lib/search-segment.ts`.
- Produces: nothing (tests only).

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/nav/__tests__/cities.test.ts`:

```ts
import { resolveCity } from "../../search-segment";

describe("city-list drift guards", () => {
  it("every alias in search-segment resolves to a hub city slug", () => {
    const aliases = [
      "delhi",
      "new delhi",
      "gurugram",
      "gurgaon",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur",
      "lucknow"
    ];
    for (const alias of aliases) {
      const slug = resolveCity(alias);
      expect(slug, `alias "${alias}" did not resolve`).toBeDefined();
      expect(HUB_CITY_SLUGS, `alias "${alias}" resolved to non-hub "${slug}"`).toContain(slug);
    }
  });

  it("resolveCity rejects a city the nav does not offer", () => {
    expect(resolveCity("varanasi")).toBeUndefined();
  });

  it("every hub city is reachable by its own name", () => {
    for (const city of HUB_CITIES) {
      expect(resolveCity(city.label), `no alias for ${city.label}`).toBe(city.slug);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/cities.test.ts`
Expected: PASS — these assert existing correct behaviour. They are regression guards, not new behaviour. If any fails, the two lists have **already** drifted; fix `search-segment.ts` to match `HUB_CITIES` before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/nav/__tests__/cities.test.ts
git commit -m "test(web): guard city-list drift between nav, aliases and hub slugs"
```

---

### Task 3: Extract rent-city content out of the page file

**Files:**

- Create: `apps/web/lib/rent-city-content.ts`
- Modify: `apps/web/app/[locale]/rent-in/[city]/page.tsx` (delete inline `interface CityData` + `const CITIES`, add an import)
- Test: `apps/web/lib/nav/__tests__/localities.test.ts` (first assertions only)

**Interfaces:**

- Consumes: `HUB_CITY_SLUGS` from Task 1.
- Produces: `RENT_CITY_CONTENT: Record<string, RentCityContent>` and `interface RentCityContent` with fields `slug, name, state, heroLine, description, avgRent1BHK, avgRent2BHK, avgRent3BHK, avgPG, popularLocalities: string[], rentTips: string[], faqs: {q,a}[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/nav/__tests__/localities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RENT_CITY_CONTENT } from "../../rent-city-content";
import { HUB_CITY_SLUGS } from "../cities";

describe("RENT_CITY_CONTENT", () => {
  it("covers every hub city", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(RENT_CITY_CONTENT[slug], `missing rent content for ${slug}`).toBeDefined();
    }
  });

  it("gives every city at least 5 popular localities for the nav column", () => {
    for (const slug of HUB_CITY_SLUGS) {
      expect(RENT_CITY_CONTENT[slug].popularLocalities.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("stores localities as display names, not slugs", () => {
    expect(RENT_CITY_CONTENT.lucknow.popularLocalities.some((l) => l.includes(" "))).toBe(true);
    for (const slug of HUB_CITY_SLUGS) {
      for (const loc of RENT_CITY_CONTENT[slug].popularLocalities) {
        expect(loc, `"${loc}" looks like a slug`).not.toMatch(/^[a-z0-9-]+$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/localities.test.ts`
Expected: FAIL — `Failed to resolve import "../../rent-city-content"`.

- [ ] **Step 3: Move the constant**

Create `apps/web/lib/rent-city-content.ts`. Cut `interface CityData` (currently `apps/web/app/[locale]/rent-in/[city]/page.tsx:5-18`) and `const CITIES` (`:20` through its closing `};`) verbatim out of the page and paste them here, renaming and exporting both:

```ts
/**
 * Hand-curated per-city rental content for /rent-in/{city}, extracted out of the
 * page file so non-page consumers (the top nav) can read it without importing
 * from a route module.
 *
 * `popularLocalities` are DISPLAY NAMES, not slugs — they cannot be used to
 * build /city/{city}/{locality} URLs. See lib/nav/localities.ts.
 */
export interface RentCityContent {
  slug: string;
  name: string;
  state: string;
  heroLine: string;
  description: string;
  avgRent1BHK: string;
  avgRent2BHK: string;
  avgRent3BHK: string;
  avgPG: string;
  popularLocalities: string[];
  rentTips: string[];
  faqs: { q: string; a: string }[];
}

export const RENT_CITY_CONTENT: Record<string, RentCityContent> = {
  // ← paste the existing 8-city object literal here, unchanged
};
```

Then in `apps/web/app/[locale]/rent-in/[city]/page.tsx`, replace the deleted block with:

```ts
import { RENT_CITY_CONTENT, type RentCityContent } from "../../../../lib/rent-city-content";

const CITIES = RENT_CITY_CONTENT;
type CityData = RentCityContent;
```

Keeping the local `CITIES` / `CityData` aliases means the rest of that 700-line page — `generateStaticParams`, `generateMetadata`, the component body — needs no edits at all.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/localities.test.ts`
Expected: PASS, 3 tests.

Then verify the page still compiles and nothing else referenced the old symbols:

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/rent-city-content.ts "apps/web/app/[locale]/rent-in/[city]/page.tsx" apps/web/lib/nav/__tests__/localities.test.ts
git commit -m "refactor(web): extract rent-city content out of the rent-in page"
```

---

### Task 4: Converge the three replaceable city lists

**Files:**

- Modify: `apps/web/app/sitemap.ts:23-32`
- Modify: `apps/web/app/[locale]/city/[citySlug]/page.tsx:44-53`
- Modify: `apps/web/app/[locale]/search/page.tsx:53-62`

**Interfaces:**

- Consumes: `HUB_CITIES`, `HUB_CITY_SLUGS` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Replace the sitemap list**

In `apps/web/app/sitemap.ts`, delete the `const HUB_CITIES = [...]` block (lines 23-32, the 8-string array) and add at the top of the imports:

```ts
import { HUB_CITY_SLUGS } from "./../lib/nav/cities";
```

Then replace each use of `HUB_CITIES` in that file with `HUB_CITY_SLUGS`. Leave `FALLBACK_CITIES` alone — it is a different concept (which cities are programmatically enabled when the API is unreachable).

- [ ] **Step 2: Replace the city-hub list**

In `apps/web/app/[locale]/city/[citySlug]/page.tsx`, delete `const CITIES = [...]` (lines 44-53) and add:

```ts
import { HUB_CITY_SLUGS } from "../../../../lib/nav/cities";
```

Then change `generateStaticParams` to iterate `HUB_CITY_SLUGS`:

```ts
export function generateStaticParams() {
  return HUB_CITY_SLUGS.flatMap((city) => [
    { locale: "en", citySlug: city },
    { locale: "hi", citySlug: city }
  ]);
}
```

- [ ] **Step 3: Replace the search-page list**

In `apps/web/app/[locale]/search/page.tsx`, delete `const CITIES = [{slug,label},...]` (lines 53-62) and add:

```ts
import { HUB_CITIES } from "../../../lib/nav/cities";
```

Then replace uses of `CITIES` with `HUB_CITIES`. The shape is already `{slug, label}`, so no call-site changes are needed.

- [ ] **Step 4: Verify nothing broke**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

Run: `pnpm --filter @cribliv/web test`
Expected: PASS. In particular the three header suites and any sitemap tests must be green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sitemap.ts "apps/web/app/[locale]/city/[citySlug]/page.tsx" "apps/web/app/[locale]/search/page.tsx"
git commit -m "refactor(web): point sitemap, city hub and search at HUB_CITIES"
```

---

### Task 5: Surface param translation — the file that enforces §C2

This is the heart of the slice. Intent `filters` use the **search API's** vocabulary; `/pg` uses a different one; and three filter keys (`tag`, `amenity`, `max_area_sqft`) are accepted by neither. Naive pass-through produces links that silently do nothing — or worse, `/search?listing_type=pg`, which redirects.

**Files:**

- Create: `apps/web/lib/nav/surface-params.ts`
- Test: `apps/web/lib/nav/__tests__/surface-params.test.ts`

**Interfaces:**

- Consumes: `IntentDefinition` from `apps/web/lib/intent-filters.ts`.
- Produces:
  - `type NavSurface = "search" | "pg"`
  - `SEARCH_PARAMS: ReadonlySet<string>`, `PG_PARAMS: ReadonlySet<string>`
  - `translateFilters(filters: IntentDefinition["filters"], surface: NavSurface): Record<string, string>`
  - `isPgIntent(intent: IntentDefinition): boolean`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/nav/__tests__/surface-params.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getIntent, ALL_INTENTS } from "../../intent-filters";
import { translateFilters, isPgIntent, SEARCH_PARAMS, PG_PARAMS } from "../surface-params";

function intent(slug: string) {
  const i = getIntent(slug);
  if (!i) throw new Error(`fixture intent missing: ${slug}`);
  return i;
}

describe("isPgIntent", () => {
  it("flags intents whose filter says listing_type=pg", () => {
    expect(isPgIntent(intent("pg"))).toBe(true);
    expect(isPgIntent(intent("pg-for-girls"))).toBe(true);
    expect(isPgIntent(intent("with-food"))).toBe(true);
    expect(isPgIntent(intent("co-living"))).toBe(true);
  });

  it("flags `rooms`, which sits in property-type but is really a PG intent", () => {
    expect(isPgIntent(intent("rooms"))).toBe(true);
  });

  it("does not flag flat/house intents", () => {
    expect(isPgIntent(intent("2bhk"))).toBe(false);
    expect(isPgIntent(intent("family-flats"))).toBe(false);
  });

  it("does not flag budget intents, which carry no listing_type", () => {
    expect(isPgIntent(intent("under-10000"))).toBe(false);
  });
});

describe("translateFilters — search surface", () => {
  it("passes through params the search API accepts", () => {
    expect(translateFilters(intent("2bhk").filters, "search")).toEqual({
      listing_type: "flat_house",
      bhk: "2"
    });
  });

  it("maps amenity=ac to the accepted ac param", () => {
    expect(translateFilters(intent("ac-rooms").filters, "search")).toEqual({ ac: "true" });
  });

  it("maps tag to a free-text q, since neither API has a tag filter", () => {
    expect(translateFilters(intent("pet-friendly").filters, "search")).toEqual({
      q: "pet-friendly"
    });
  });

  it("drops max_area_sqft, which no endpoint accepts, but keeps the rest", () => {
    expect(translateFilters(intent("studio").filters, "search")).toEqual({
      listing_type: "flat_house",
      bhk: "1"
    });
  });

  it("never emits a key the search API does not accept", () => {
    for (const i of ALL_INTENTS) {
      for (const key of Object.keys(translateFilters(i.filters, "search"))) {
        expect(SEARCH_PARAMS, `intent ${i.slug} emitted unknown param ${key}`).toContain(key);
      }
    }
  });
});

describe("translateFilters — pg surface", () => {
  it("drops listing_type entirely, so /search?listing_type=pg can never be built", () => {
    expect(translateFilters(intent("pg").filters, "pg")).toEqual({});
  });

  it("maps occupancy_type to the PG gender_policy vocabulary", () => {
    expect(translateFilters(intent("pg-for-girls").filters, "pg")).toEqual({
      gender_policy: "girls"
    });
    expect(translateFilters(intent("pg-for-boys").filters, "pg")).toEqual({
      gender_policy: "boys"
    });
    expect(translateFilters(intent("co-living").filters, "pg")).toEqual({
      gender_policy: "coed"
    });
  });

  it("passes food_included through", () => {
    expect(translateFilters(intent("with-food").filters, "pg")).toEqual({
      food_included: "true"
    });
  });

  it("passes budget through, which the PG search service does honour", () => {
    expect(translateFilters(intent("under-10000").filters, "pg")).toEqual({ max_rent: "10000" });
    expect(translateFilters(intent("luxury").filters, "pg")).toEqual({ min_rent: "25000" });
  });

  it("drops furnishing and bhk, which mean nothing to the PG endpoint", () => {
    expect(translateFilters(intent("furnished").filters, "pg")).toEqual({});
    expect(translateFilters(intent("2bhk").filters, "pg")).toEqual({});
  });

  it("never emits a key the PG API does not accept", () => {
    for (const i of ALL_INTENTS) {
      for (const key of Object.keys(translateFilters(i.filters, "pg"))) {
        expect(PG_PARAMS, `intent ${i.slug} emitted unknown param ${key}`).toContain(key);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/surface-params.test.ts`
Expected: FAIL — `Failed to resolve import "../surface-params"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/nav/surface-params.ts`:

```ts
import type { IntentDefinition } from "../intent-filters";

/**
 * The SEO intent registry (data/seeds/lucknow/intents.json) speaks the search
 * API's filter vocabulary. The public PG endpoint speaks a different one, and
 * three intent keys (`tag`, `amenity`, `max_area_sqft`) are accepted by neither.
 *
 * Passing filters through untranslated produces links that silently do nothing —
 * and, for any intent carrying listing_type=pg, produces /search?listing_type=pg,
 * which app/[locale]/search/page.tsx redirects. This module is the single place
 * that prevents both.
 */
export type NavSurface = "search" | "pg";

/** GET /listings/search — apps/api/src/modules/search/search.controller.ts */
export const SEARCH_PARAMS: ReadonlySet<string> = new Set([
  "q",
  "city",
  "locality",
  "listing_type",
  "min_rent",
  "max_rent",
  "bhk",
  "furnishing",
  "verified_only",
  "sort",
  "page",
  "page_size",
  "source",
  "lat",
  "lng",
  "radius_km",
  "min_deposit",
  "max_deposit",
  "preferred_tenant",
  "availability",
  "occupancy_type",
  "food_included",
  "gender_policy",
  "tenant_type",
  "sharing",
  "ac"
]);

/** GET /pg/listings — apps/api/src/modules/pg-operator/services/pg-search.service.ts */
export const PG_PARAMS: ReadonlySet<string> = new Set([
  "city",
  "locality",
  "q",
  "min_rent",
  "max_rent",
  "gender_policy",
  "tenant_type",
  "food_included",
  "sharing",
  "ac",
  "sort",
  "page",
  "page_size"
]);

/** occupancy_type (search vocabulary) → gender_policy (PG vocabulary). */
const OCCUPANCY_TO_GENDER: Record<string, string> = {
  female: "girls",
  male: "boys",
  co_living: "coed"
};

export function isPgIntent(intent: IntentDefinition): boolean {
  return intent.filters.listing_type === "pg";
}

export function translateFilters(
  filters: IntentDefinition["filters"],
  surface: NavSurface
): Record<string, string> {
  const accepted = surface === "pg" ? PG_PARAMS : SEARCH_PARAMS;
  const out: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(filters)) {
    const value = String(rawValue);

    // The surface already implies the listing type. Emitting it on /pg is
    // redundant; emitting listing_type=pg on /search triggers a redirect.
    if (key === "listing_type") continue;

    if (key === "occupancy_type" && surface === "pg") {
      const mapped = OCCUPANCY_TO_GENDER[value];
      if (mapped) out.gender_policy = mapped;
      continue;
    }

    // No endpoint has a tag filter; fall back to free text so the link still
    // narrows something rather than silently doing nothing.
    if (key === "tag") {
      out.q = value;
      continue;
    }

    if (key === "amenity") {
      if (value === "ac") out.ac = "true";
      continue;
    }

    if (!accepted.has(key)) continue;

    out[key] = value;
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/surface-params.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav/surface-params.ts apps/web/lib/nav/__tests__/surface-params.test.ts
git commit -m "feat(web): translate SEO intent filters to per-surface query params"
```

---

### Task 6: Locality link resolution

Lucknow gets real SEO-page links from the micro-locality seed; every other city falls back to the proven `/search?city=&q=` shape. This is the rule that keeps 404s out of the navigation.

**Files:**

- Create: `apps/web/lib/nav/localities.ts`
- Modify: `apps/web/lib/nav/__tests__/localities.test.ts` (append)

**Interfaces:**

- Consumes: `RENT_CITY_CONTENT` (Task 3), `data/seeds/lucknow/micro-localities.json`.
- Produces: `interface NavLink { label: string; href: string }` and
  `localityLinks(locale: "en" | "hi", citySlug: string, limit?: number): NavLink[]`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/nav/__tests__/localities.test.ts`:

```ts
import { localityLinks } from "../localities";
import microLocalities from "../../../../../data/seeds/lucknow/micro-localities.json";

const LUCKNOW_PARENTS = new Set(
  (microLocalities as Array<{ parent_slug: string }>).map((m) => m.parent_slug)
);

describe("localityLinks", () => {
  it("links Lucknow localities to real /city/lucknow/{slug} SEO pages", () => {
    const links = localityLinks("en", "lucknow");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.href).toMatch(/^\/en\/city\/lucknow\/[a-z0-9-]+$/);
      const slug = link.href.split("/").pop()!;
      expect(LUCKNOW_PARENTS, `${slug} is not a seeded locality`).toContain(slug);
    }
  });

  it("uses the search fallback for cities with no verified slugs", () => {
    for (const city of ["delhi", "jaipur", "noida"]) {
      const links = localityLinks("en", city);
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.href).toMatch(new RegExp(`^/en/search\\?city=${city}&q=`));
      }
    }
  });

  it("never emits a /city/{city}/{locality} URL for a non-Lucknow city", () => {
    for (const city of [
      "delhi",
      "gurugram",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur"
    ]) {
      for (const link of localityLinks("en", city)) {
        expect(link.href).not.toContain(`/city/${city}/`);
      }
    }
  });

  it("url-encodes locality names in the fallback", () => {
    const links = localityLinks("en", "delhi");
    const multiword = links.find((l) => l.label.includes(" "));
    expect(multiword).toBeDefined();
    expect(multiword!.href).toContain(encodeURIComponent(multiword!.label));
    expect(multiword!.href).not.toMatch(/q=[^&]* /);
  });

  it("honours the locale prefix", () => {
    for (const link of localityLinks("hi", "lucknow"))
      expect(link.href.startsWith("/hi/")).toBe(true);
    for (const link of localityLinks("hi", "delhi"))
      expect(link.href.startsWith("/hi/")).toBe(true);
  });

  it("respects the limit and defaults to 8", () => {
    expect(localityLinks("en", "delhi").length).toBeLessThanOrEqual(8);
    expect(localityLinks("en", "delhi", 3)).toHaveLength(3);
  });

  it("returns an empty list for an unknown city rather than throwing", () => {
    expect(localityLinks("en", "varanasi")).toEqual([]);
    expect(localityLinks("en", "atlantis")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/localities.test.ts`
Expected: FAIL — `Failed to resolve import "../localities"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/nav/localities.ts`:

```ts
import { RENT_CITY_CONTENT } from "../rent-city-content";
import microLocalitiesData from "../../../../data/seeds/lucknow/micro-localities.json";

/**
 * Locality links for the nav's Rent panel.
 *
 * RENT_CITY_CONTENT.popularLocalities holds DISPLAY NAMES ("Gomti Nagar"), not
 * slugs — so it cannot build /city/{city}/{locality} URLs, and that route calls
 * notFound() on an unknown locality. A guessed slug would be a 404 inside the
 * navigation itself.
 *
 * Lucknow is the exception: data/seeds/lucknow/micro-localities.json carries
 * real parent_slug values that populate the DB, so those links resolve. Every
 * other city uses the /search?city=&q= shape that rent-in/[city] already ships.
 */
export interface NavLink {
  label: string;
  href: string;
}

interface MicroLocality {
  slug: string;
  name_en: string;
  name_hi: string;
  parent_slug: string;
}

const MICRO_LOCALITIES = microLocalitiesData as MicroLocality[];

/** Distinct parent localities, first-seen order — these are real /city/lucknow/{slug} pages. */
const LUCKNOW_LOCALITIES: ReadonlyArray<{ slug: string; label: string }> = (() => {
  const seen = new Set<string>();
  const out: Array<{ slug: string; label: string }> = [];
  for (const micro of MICRO_LOCALITIES) {
    if (seen.has(micro.parent_slug)) continue;
    seen.add(micro.parent_slug);
    out.push({ slug: micro.parent_slug, label: titleCaseSlug(micro.parent_slug) });
  }
  return out;
})();

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const DEFAULT_LIMIT = 8;

export function localityLinks(
  locale: "en" | "hi",
  citySlug: string,
  limit: number = DEFAULT_LIMIT
): NavLink[] {
  if (citySlug === "lucknow") {
    return LUCKNOW_LOCALITIES.slice(0, limit).map((loc) => ({
      label: loc.label,
      href: `/${locale}/city/lucknow/${loc.slug}`
    }));
  }

  const city = RENT_CITY_CONTENT[citySlug];
  if (!city) return [];

  return city.popularLocalities.slice(0, limit).map((name) => ({
    label: name,
    href: `/${locale}/search?city=${citySlug}&q=${encodeURIComponent(name)}`
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/localities.test.ts`
Expected: PASS, 10 tests (3 from Task 3 plus 7 here).

If the Lucknow assertion fails because fewer than 8 distinct `parent_slug` values exist in the seed, that is real data — lower `DEFAULT_LIMIT` is wrong; instead assert `length > 0` and let the slice return what exists.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav/localities.ts apps/web/lib/nav/__tests__/localities.test.ts
git commit -m "feat(web): resolve nav locality links, real SEO pages for Lucknow"
```

---

### Task 7: The nav model

**Files:**

- Create: `apps/web/lib/nav/nav-model.ts`
- Test: `apps/web/lib/nav/__tests__/nav-model.test.ts`

**Interfaces:**

- Consumes: everything above, plus `intentsByCategory`/`ALL_INTENTS` from `intent-filters.ts`, `PG_CITY_CONTENT`, and `DESKS` from `app/[locale]/blog/_components/Masthead.tsx`.
- Produces:
  - `interface NavColumn { title: string; links: NavLink[] }`
  - `interface NavPanel { id: "rent" | "pg" | "owners" | "times"; columns: NavColumn[] }`
  - `buildRentPanel(locale, citySlug): NavPanel`
  - `buildPgPanel(locale, citySlug): NavPanel`
  - `buildOwnersPanel(locale): NavPanel`
  - `buildTimesPanel(locale): NavPanel`
  - `cityChipLinks(locale): NavLink[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/nav/__tests__/nav-model.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildRentPanel,
  buildPgPanel,
  buildOwnersPanel,
  buildTimesPanel,
  cityChipLinks
} from "../nav-model";
import { HUB_CITY_SLUGS } from "../cities";

const LOCALES = ["en", "hi"] as const;

function allLinks(panel: { columns: { links: { href: string; label: string }[] }[] }) {
  return panel.columns.flatMap((c) => c.links);
}

function everyPanel(locale: "en" | "hi", city: string) {
  return [
    buildRentPanel(locale, city),
    buildPgPanel(locale, city),
    buildOwnersPanel(locale),
    buildTimesPanel(locale)
  ];
}

describe("spec §C2 — link correctness", () => {
  it("never emits /search?listing_type=pg on any panel, city or locale", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const link of allLinks(panel)) {
            expect(link.href, `${panel.id}/${link.label}`).not.toMatch(
              /\/search\?[^#]*listing_type=pg/
            );
          }
        }
      }
    }
  });

  it("never links to varanasi", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const link of allLinks(panel)) {
            expect(link.href).not.toContain("varanasi");
          }
        }
      }
    }
  });

  it("prefixes every href with the locale", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const link of allLinks(panel)) {
            expect(link.href.startsWith(`/${locale}/`), link.href).toBe(true);
          }
        }
      }
    }
  });

  it("gives every link a non-empty label", () => {
    for (const locale of LOCALES) {
      for (const panel of everyPanel(locale, "lucknow")) {
        for (const link of allLinks(panel)) expect(link.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildRentPanel", () => {
  it("has the five approved columns", () => {
    const panel = buildRentPanel("en", "lucknow");
    expect(panel.id).toBe("rent");
    expect(panel.columns.map((c) => c.title)).toEqual([
      "Property type",
      "By budget",
      "By lifestyle",
      "Popular localities"
    ]);
  });

  it("excludes `rooms`, a PG intent that lives in the property-type category", () => {
    const labels = allLinks(buildRentPanel("en", "lucknow")).map((l) => l.label);
    expect(labels).not.toContain("Single rooms");
    expect(labels).not.toContain("PG accommodations");
  });

  it("includes the flat/house property types", () => {
    const labels = allLinks(buildRentPanel("en", "lucknow")).map((l) => l.label);
    expect(labels).toContain("2 BHK flats");
    expect(labels).toContain("Flats & houses");
  });

  it("points intent links at /search with the city applied", () => {
    const twoBhk = allLinks(buildRentPanel("en", "lucknow")).find((l) => l.label === "2 BHK flats");
    expect(twoBhk).toBeDefined();
    expect(twoBhk!.href).toContain("/en/search?");
    expect(twoBhk!.href).toContain("city=lucknow");
    expect(twoBhk!.href).toContain("bhk=2");
    expect(twoBhk!.href).toContain("listing_type=flat_house");
  });

  it("uses Hindi labels for the hi locale", () => {
    const labels = allLinks(buildRentPanel("hi", "lucknow")).map((l) => l.label);
    expect(labels).toContain("2 बीएचके फ्लैट");
    expect(labels).not.toContain("2 BHK flats");
  });
});

describe("buildPgPanel", () => {
  it("has the approved columns including budget", () => {
    const panel = buildPgPanel("en", "lucknow");
    expect(panel.id).toBe("pg");
    expect(panel.columns.map((c) => c.title)).toEqual([
      "By sharing",
      "By who it's for",
      "By budget",
      "Food & amenities",
      "Popular PG hubs"
    ]);
  });

  it("sends every link to /pg, never /search", () => {
    for (const link of allLinks(buildPgPanel("en", "lucknow"))) {
      expect(link.href).toMatch(/^\/en\/pg(\?|$)/);
    }
  });

  it("offers the four sharing kinds the PG API accepts", () => {
    const sharing = buildPgPanel("en", "lucknow").columns[0];
    expect(sharing.links.map((l) => l.href.match(/sharing=(\w+)/)?.[1])).toEqual([
      "single",
      "double",
      "triple",
      "quad"
    ]);
  });

  it("translates girls/boys/co-living into the gender_policy vocabulary", () => {
    const hrefs = allLinks(buildPgPanel("en", "lucknow")).map((l) => l.href);
    expect(hrefs.some((h) => h.includes("gender_policy=girls"))).toBe(true);
    expect(hrefs.some((h) => h.includes("gender_policy=boys"))).toBe(true);
    expect(hrefs.some((h) => h.includes("gender_policy=coed"))).toBe(true);
    expect(hrefs.some((h) => h.includes("occupancy_type="))).toBe(false);
  });

  it("includes budget links, which pg-search.service.ts does honour", () => {
    const budget = buildPgPanel("en", "lucknow").columns[2];
    expect(budget.links.length).toBeGreaterThan(0);
    expect(budget.links.some((l) => l.href.includes("max_rent=10000"))).toBe(true);
  });

  it("draws PG hubs from PG_CITY_CONTENT", () => {
    const hubs = buildPgPanel("en", "delhi").columns[4];
    expect(hubs.links.map((l) => l.label)).toContain("North Campus");
  });
});

describe("buildOwnersPanel and buildTimesPanel", () => {
  it("owners links point at real static routes", () => {
    const hrefs = allLinks(buildOwnersPanel("en")).map((l) => l.href);
    expect(hrefs).toContain("/en/become-owner");
    expect(hrefs).toContain("/en/pg-operator/become");
    expect(hrefs).toContain("/en/pricing");
    expect(hrefs).toContain("/en/rent-agreement");
    expect(hrefs).toContain("/en/how-it-works");
    expect(hrefs).toContain("/en/faq");
  });

  it("times links point at the four real blog desks", () => {
    const hrefs = allLinks(buildTimesPanel("en")).map((l) => l.href);
    expect(hrefs).toEqual([
      "/en/blog/category/data-reports",
      "/en/blog/category/local-guides",
      "/en/blog/category/tenancy",
      "/en/blog/category/market-updates"
    ]);
  });

  it("times uses Hindi desk labels for hi", () => {
    expect(allLinks(buildTimesPanel("hi")).map((l) => l.label)).toContain("डेटा रिपोर्ट");
  });
});

describe("cityChipLinks", () => {
  it("lists the 8 hub cities pointing at their city hubs", () => {
    const links = cityChipLinks("en");
    expect(links).toHaveLength(8);
    expect(links[0]).toEqual({ label: "Delhi", href: "/en/city/delhi" });
    expect(links.map((l) => l.label)).not.toContain("Varanasi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/nav-model.test.ts`
Expected: FAIL — `Failed to resolve import "../nav-model"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/nav/nav-model.ts`:

```ts
import { ALL_INTENTS, getIntent, type IntentDefinition } from "../intent-filters";
import { PG_CITY_CONTENT } from "../pg-city-content";
import { HUB_CITIES } from "./cities";
import { localityLinks, type NavLink } from "./localities";
import { isPgIntent, translateFilters, type NavSurface } from "./surface-params";

/**
 * Pure, synchronous assembly of the top nav's panel data. No fetch, no React —
 * the header renders in the root layout, and a server fetch there would opt the
 * entire site out of ISR (spec §C1).
 */
export interface NavColumn {
  title: string;
  links: NavLink[];
}

export interface NavPanel {
  id: "rent" | "pg" | "owners" | "times";
  columns: NavColumn[];
}

export type NavLocale = "en" | "hi";

function label(intent: IntentDefinition, locale: NavLocale): string {
  return locale === "hi" ? intent.label_hi : intent.label_en;
}

/** Build a surface URL, always city-scoped, params sorted for stable output. */
function surfaceHref(
  locale: NavLocale,
  surface: NavSurface,
  citySlug: string,
  params: Record<string, string>
): string {
  const path = surface === "pg" ? `/${locale}/pg` : `/${locale}/search`;
  const search = new URLSearchParams({ city: citySlug, ...params });
  return `${path}?${search.toString()}`;
}

function intentLink(
  intent: IntentDefinition,
  locale: NavLocale,
  surface: NavSurface,
  citySlug: string
): NavLink {
  return {
    label: label(intent, locale),
    href: surfaceHref(locale, surface, citySlug, translateFilters(intent.filters, surface))
  };
}

function bySlugs(slugs: string[]): IntentDefinition[] {
  return slugs.map(getIntent).filter((i): i is IntentDefinition => i !== null);
}

function inCategory(category: IntentDefinition["category"]): IntentDefinition[] {
  return ALL_INTENTS.filter((i) => i.category === category);
}

// ── Rent ────────────────────────────────────────────────────────────────────
// Category-derived, then filtered by listing_type so a PG intent can never leak
// in. `rooms` sits in property-type but is listing_type=pg — filtering by slug
// would have missed it and produced /search?listing_type=pg.

export function buildRentPanel(locale: NavLocale, citySlug: string): NavPanel {
  const link = (i: IntentDefinition) => intentLink(i, locale, "search", citySlug);
  const notPg = (i: IntentDefinition) => !isPgIntent(i);

  return {
    id: "rent",
    columns: [
      {
        title: "Property type",
        links: inCategory("property-type").filter(notPg).map(link)
      },
      {
        title: "By budget",
        links: inCategory("budget").filter(notPg).map(link)
      },
      {
        title: "By lifestyle",
        links: [
          ...inCategory("lifestyle").filter(notPg),
          ...bySlugs(["family-flats", "bachelor-flats"])
        ].map(link)
      },
      {
        title: "Popular localities",
        links: localityLinks(locale, citySlug)
      }
    ]
  };
}

// ── PG & Co-living ──────────────────────────────────────────────────────────
// Explicit slug lists rather than category-derived: the PG columns deliberately
// mix categories (audience + lifestyle), and sharing has no intent at all.

const PG_SHARING: ReadonlyArray<{ value: string; en: string; hi: string }> = [
  { value: "single", en: "Single sharing", hi: "सिंगल शेयरिंग" },
  { value: "double", en: "Double sharing", hi: "डबल शेयरिंग" },
  { value: "triple", en: "Triple sharing", hi: "ट्रिपल शेयरिंग" },
  { value: "quad", en: "Four sharing", hi: "चार शेयरिंग" }
];

export function buildPgPanel(locale: NavLocale, citySlug: string): NavPanel {
  const link = (i: IntentDefinition) => intentLink(i, locale, "pg", citySlug);
  const city = PG_CITY_CONTENT[citySlug];

  return {
    id: "pg",
    columns: [
      {
        title: "By sharing",
        links: PG_SHARING.map((s) => ({
          label: locale === "hi" ? s.hi : s.en,
          href: surfaceHref(locale, "pg", citySlug, { sharing: s.value })
        }))
      },
      {
        title: "By who it's for",
        links: bySlugs([
          "pg-for-girls",
          "pg-for-boys",
          "pg-for-students",
          "pg-for-working-professionals"
        ]).map((intent) => {
          // pg-for-students / pg-for-working-professionals carry only
          // listing_type, which the PG surface drops — so their tenant_type is
          // supplied here rather than coming from the intent registry.
          const extra: Record<string, string> =
            intent.slug === "pg-for-students"
              ? { tenant_type: "students" }
              : intent.slug === "pg-for-working-professionals"
                ? { tenant_type: "working" }
                : {};
          return {
            label: label(intent, locale),
            href: surfaceHref(locale, "pg", citySlug, {
              ...translateFilters(intent.filters, "pg"),
              ...extra
            })
          };
        })
      },
      {
        title: "By budget",
        links: inCategory("budget").map(link)
      },
      {
        title: "Food & amenities",
        links: bySlugs(["with-food", "vegetarian-pg", "ac-rooms", "co-living"]).map(link)
      },
      {
        title: "Popular PG hubs",
        links: (city?.hubs ?? []).map((hub) => ({
          label: hub,
          href: surfaceHref(locale, "pg", citySlug, { q: hub })
        }))
      }
    ]
  };
}

// ── For owners ──────────────────────────────────────────────────────────────

export function buildOwnersPanel(locale: NavLocale): NavPanel {
  const hi = locale === "hi";
  const at = (path: string) => `/${locale}${path}`;

  return {
    id: "owners",
    columns: [
      {
        title: hi ? "अपनी प्रॉपर्टी लिस्ट करें" : "List your property",
        links: [
          { label: hi ? "मकान मालिक बनें" : "Become an owner", href: at("/become-owner") },
          { label: hi ? "पीजी ऑपरेटर बनें" : "List your PG", href: at("/pg-operator/become") }
        ]
      },
      {
        title: hi ? "कीमत" : "Pricing",
        links: [{ label: hi ? "प्लान और कीमत" : "Plans and pricing", href: at("/pricing") }]
      },
      {
        title: hi ? "टूल्स" : "Tools",
        links: [{ label: hi ? "रेंट एग्रीमेंट" : "Rent agreement", href: at("/rent-agreement") }]
      },
      {
        title: hi ? "जानें" : "Learn",
        links: [
          { label: hi ? "यह कैसे काम करता है" : "How it works", href: at("/how-it-works") },
          { label: hi ? "सामान्य प्रश्न" : "FAQ", href: at("/faq") }
        ]
      }
    ]
  };
}

// ── Cribliv Times ───────────────────────────────────────────────────────────
// Desk list mirrors DESKS in app/[locale]/blog/_components/Masthead.tsx, minus
// its slug:null "Front Page" entry which is the /blog root, not a category.

const DESKS: ReadonlyArray<{ slug: string; en: string; hi: string }> = [
  { slug: "data-reports", en: "Data Reports", hi: "डेटा रिपोर्ट" },
  { slug: "local-guides", en: "Local Guides", hi: "लोकल गाइड" },
  { slug: "tenancy", en: "Tenancy", hi: "किरायेदारी" },
  { slug: "market-updates", en: "Market Updates", hi: "मार्केट अपडेट" }
];

export function buildTimesPanel(locale: NavLocale): NavPanel {
  return {
    id: "times",
    columns: [
      {
        title: locale === "hi" ? "डेस्क" : "Desks",
        links: DESKS.map((desk) => ({
          label: locale === "hi" ? desk.hi : desk.en,
          href: `/${locale}/blog/category/${desk.slug}`
        }))
      }
    ]
  };
}

// ── City chip ───────────────────────────────────────────────────────────────

export function cityChipLinks(locale: NavLocale): NavLink[] {
  return HUB_CITIES.map((city) => ({
    label: city.label,
    href: `/${locale}/city/${city.slug}`
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/nav-model.test.ts`
Expected: PASS, 20 tests.

If the "Popular localities" column title assertion fails because `buildRentPanel` returned five columns, that is the promo card — the promo card is **presentation**, added in slice 2, not part of the model. Keep four columns here.

- [ ] **Step 5: Run the whole web suite**

Run: `pnpm --filter @cribliv/web test`
Expected: PASS. The three header suites must be green — nothing in this slice touches them.

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/nav/nav-model.ts apps/web/lib/nav/__tests__/nav-model.test.ts
git commit -m "feat(web): nav panel model assembled from existing constants"
```

---

### Task 8: Duplicate the DESKS constant away

Task 7 copied the four desks into `nav-model.ts` to keep it dependency-free. That is a second source of truth. Close it.

**Files:**

- Modify: `apps/web/app/[locale]/blog/_components/Masthead.tsx`
- Modify: `apps/web/lib/nav/nav-model.ts`
- Test: `apps/web/lib/nav/__tests__/nav-model.test.ts` (append)

**Interfaces:**

- Consumes: `DESKS` from `Masthead.tsx`.
- Produces: no signature change to `buildTimesPanel`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/nav/__tests__/nav-model.test.ts`:

```ts
import { DESKS as MASTHEAD_DESKS } from "../../../app/[locale]/blog/_components/Masthead";

describe("desk list has one source of truth", () => {
  it("the Times panel matches the masthead's desks exactly", () => {
    const mastheadSlugs = MASTHEAD_DESKS.filter((d) => d.slug !== null).map((d) => d.slug);
    const panelSlugs = buildTimesPanel("en").columns[0].links.map((l) => l.href.split("/").pop()!);
    expect(panelSlugs).toEqual(mastheadSlugs);
  });

  it("the Times panel labels match the masthead's", () => {
    const mastheadLabels = MASTHEAD_DESKS.filter((d) => d.slug !== null).map((d) => d.en);
    expect(buildTimesPanel("en").columns[0].links.map((l) => l.label)).toEqual(mastheadLabels);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/nav-model.test.ts`
Expected: FAIL — importing a `.tsx` component module from a lib test may pull React/CSS-module imports. If it fails on the CSS-module import rather than the assertion, do not fight it: instead move `DESKS` into a new `apps/web/lib/blog-desks.ts`, re-export it from `Masthead.tsx` for backwards compatibility, and point both the test and `nav-model.ts` at the lib module.

- [ ] **Step 3: Make the desk list shared**

Create `apps/web/lib/blog-desks.ts`:

```ts
/** The four seeded blog_categories, rendered as CRIBLIV TIMES "desks". */
export const BLOG_DESKS: ReadonlyArray<{ slug: string; en: string; hi: string }> = [
  { slug: "data-reports", en: "Data Reports", hi: "डेटा रिपोर्ट" },
  { slug: "local-guides", en: "Local Guides", hi: "लोकल गाइड" },
  { slug: "tenancy", en: "Tenancy", hi: "किरायेदारी" },
  { slug: "market-updates", en: "Market Updates", hi: "मार्केट अपडेट" }
];
```

In `Masthead.tsx`, rebuild the exported `DESKS` from it so the front-page entry stays where it belongs:

```ts
import { BLOG_DESKS } from "../../../../lib/blog-desks";

export const DESKS: Array<{ slug: string | null; en: string; hi: string }> = [
  { slug: null, en: "Front Page", hi: "मुख पृष्ठ" },
  ...BLOG_DESKS
];
```

In `nav-model.ts`, delete the local `DESKS` const and import instead:

```ts
import { BLOG_DESKS } from "../blog-desks";
```

then change `buildTimesPanel` to map over `BLOG_DESKS`.

Update the test's import to `import { BLOG_DESKS } from "../../blog-desks";` and compare against it directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test`
Expected: PASS, whole suite.

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/blog-desks.ts apps/web/lib/nav/nav-model.ts "apps/web/app/[locale]/blog/_components/Masthead.tsx" apps/web/lib/nav/__tests__/nav-model.test.ts
git commit -m "refactor(web): single source of truth for the Cribliv Times desks"
```

---

### Task 9: Slice gate

**Files:** none — verification only.

- [ ] **Step 1: Full quality gate**

```bash
pnpm --filter @cribliv/web typecheck
```

Expected: no errors.

```bash
pnpm --filter @cribliv/web lint
```

Expected: no errors.

```bash
pnpm --filter @cribliv/web test
```

Expected: PASS. Specifically confirm these three are green, as they gate the whole redesign:
`header.post-property-gating`, `header-menu.pg-split`, `header.pg-operator`.

```bash
pnpm --filter @cribliv/web build
```

Expected: build succeeds. Watch the route table for any page flipping from static (`○`/`●`) to dynamic (`ƒ`) — slice 1 adds no fetches, so nothing should change. A flip means an import chain accidentally pulled a server call into a static page.

- [ ] **Step 2: Confirm zero visual change**

`git diff --stat master...HEAD` should show only: new `lib/nav/*`, new `lib/rent-city-content.ts`, new `lib/blog-desks.ts`, tests, and small import-swap edits in `sitemap.ts`, `city/[citySlug]/page.tsx`, `search/page.tsx`, `rent-in/[city]/page.tsx`, `Masthead.tsx`. **No CSS, no component markup.** If any component render output changed, it belongs in slice 2.

---

## Slices 2 and 3 (not yet planned in detail)

Plan these after slice 1 merges, so the model's real shape informs them.

**Slice 2 — the nav itself.** Flex layout replacing `.nav-center`'s absolute centring; CriblMap restyled to match the Times chip (removing `cribmap-drift`, the `::after` sheen, and `cribmap-pulse`); the `.nav-tab--active::after` positioning fix at `globals.css:532`; city chip; `shortlist-count.ts` and the Saved badge; search pill driven by `useSearchParams()`; `nav-menu-bar.tsx` + `nav-panel.tsx` with the hover-intent state machine; Rent/PG/Owners panels; keyboard and ARIA; **and the mobile sheet accordions**, which cannot trail the desktop panels — below 900px the panels never mount, so shipping panels alone would leave phone users with less navigation than today.

**Slice 3 — additive polish.** The Times panel's route handler (`app/api/nav/times/route.ts`) and its client hover-load, plus the intent chip rail on browse pages.

---

## Self-review notes

Checked against the spec on 2026-07-25:

- **Spec coverage.** §6's file structure, §3.1/§3.2/§3.4/§3.5 panel contents, §3.3 locality rule, §3.6 city chip, §3.7 labels, §C1 no-fetch, §C2 route correctness, and §9's six `nav-model` unit tests all map to tasks 1–8. §1 bar anatomy, §1.1 Saved badge, §2 chip language, §4 interaction, §5 mobile, §7 a11y and §8 the CSS fix are all slice 2 or 3 and are deliberately absent here.
- **One deviation from the spec, made deliberately.** §3.1 lists a promo card as a Rent column; the model returns four columns and leaves the promo to slice 2, because a promo card is presentation with no link-correctness rules to test. Task 7 Step 4 calls this out so an implementer does not "fix" it.
- **Two intents need supplementary params.** `pg-for-students` and `pg-for-working-professionals` carry only `listing_type: pg`, which the PG surface drops — leaving them identical to a bare `/pg?city=…`. Task 7 supplies `tenant_type` explicitly. This is a real gap in the intent registry, not a bug in the translation layer.
- **Type consistency.** `NavLink` is declared once in `localities.ts` and re-used by `nav-model.ts`; `NavSurface` once in `surface-params.ts`. `HUB_CITIES` is `{slug,label}[]` everywhere; `HUB_CITY_SLUGS` is `string[]` everywhere.
