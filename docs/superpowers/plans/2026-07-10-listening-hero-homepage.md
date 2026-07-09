# Listening Hero Homepage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag-gated homepage redesign: a voice/NL-first hero that streams AI-parsed filter chips over a static dusk-map backdrop with real listing pins, dims non-matching pins live, shows a live match counter, and hands off into CriblMap on submit.

**Architecture:** All chip parsing is client-side (existing `lib/smart-parser.ts`) — zero LLM calls while typing. The hero backdrop is a static map image with DOM pins projected via Web Mercator math; the Google Maps SDK is never loaded on `/`. The page structure branches server-side on `process.env.NEXT_PUBLIC_FF_LISTENING_HERO`; the old homepage remains byte-identical with the flag off. Submit builds a `/{locale}/map?…` URL from chips and navigates with an exit animation.

**Tech Stack:** Next.js 14 App Router (server components + `"use client"` islands), TypeScript, Vitest (unit, `pnpm --filter @cribliv/web test`), Playwright (E2E, `pnpm --filter @cribliv/web test:e2e`), plain CSS in `apps/web/app/globals.css`, PostHog via `lib/track.ts`.

**Spec:** `docs/superpowers/specs/2026-07-10-listening-hero-homepage-design.md` — read it before starting. Where this plan and the spec disagree, the plan wins (it was written later, grounded in code).

## Global Constraints

- Repo root: run all commands from the monorepo root. Package filter: `pnpm --filter @cribliv/web <script>`.
- The flag-OFF path must remain byte-identical: do not modify existing JSX/behavior in `apps/web/app/[locale]/page.tsx`'s current tree, `search-hero.tsx`, or `smart-parser.ts` beyond what a task explicitly says.
- Copy rule: no user-visible string may mention API, backend, hardcoded, or internal system concepts.
- All new user-visible strings go through `t(locale, key)` from `apps/web/lib/i18n.ts` with both `en` and `hi` values.
- All new analytics use `track()` from `apps/web/lib/track.ts`. NEVER use `trackEvent()` from `lib/analytics.ts` (it's a dead-end dispatcher nothing consumes).
- Animations: `transform` and `opacity` only; every animation collapses under `prefers-reduced-motion: reduce`. Keyframes live in `globals.css` prefixed `hero-listen-`.
- Nothing under `apps/web/components/criblmap/` (or `@googlemaps/js-api-loader`) may be imported by the homepage.
- A pre-commit hook runs prettier via lint-staged — committed files may be reformatted; that's expected, don't fight it.
- Commit after every task (the steps say when). Branch: `feat/listening-hero` off `master`.
- After each task: `pnpm --filter @cribliv/web typecheck` must pass.

---

### Task 0: Branch setup

**Files:** none

- [ ] **Step 1: Create the working branch**

```bash
git fetch origin master && git checkout -b feat/listening-hero origin/master
```

Expected: `branch 'feat/listening-hero' set up to track 'origin/master'`.

---

### Task 1: Geo projection helpers (`lib/geo.ts`)

**Files:**

- Create: `apps/web/lib/geo.ts`
- Test: `apps/web/lib/__tests__/geo.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (used by Tasks 2, 3, 5, 6):
  - `interface GeoPoint { lat: number; lng: number }`
  - `interface GeoBounds { sw: GeoPoint; ne: GeoPoint }`
  - `projectToBounds(lat: number, lng: number, bounds: GeoBounds): { xPct: number; yPct: number }` — Web Mercator projection to percentage coordinates inside an image with known bounds. May return values outside 0–100 (caller filters).
  - `centroidOf(points: GeoPoint[]): GeoPoint | null` — arithmetic mean; `null` for empty input.
  - `boundsFromCenterZoom(center: GeoPoint, zoom: number, widthPx: number, heightPx: number): GeoBounds` — exact bounds of a Web-Mercator tile image.
  - `zoomToFitBounds(bounds: GeoBounds, widthPx: number, heightPx: number, maxZoom?: number): number` — largest integer zoom (≤ maxZoom, default 15) at which `bounds` fits in the given pixel box.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/geo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  boundsFromCenterZoom,
  centroidOf,
  projectToBounds,
  zoomToFitBounds,
  type GeoBounds
} from "../geo";

const LUCKNOW: GeoBounds = {
  sw: { lat: 26.7, lng: 80.8 },
  ne: { lat: 26.95, lng: 81.1 }
};

describe("projectToBounds", () => {
  it("projects the exact SW corner to (0, 100)", () => {
    const p = projectToBounds(26.7, 80.8, LUCKNOW);
    expect(p.xPct).toBeCloseTo(0, 5);
    expect(p.yPct).toBeCloseTo(100, 5);
  });

  it("projects the exact NE corner to (100, 0)", () => {
    const p = projectToBounds(26.95, 81.1, LUCKNOW);
    expect(p.xPct).toBeCloseTo(100, 5);
    expect(p.yPct).toBeCloseTo(0, 5);
  });

  it("projects the horizontal middle to xPct 50", () => {
    const p = projectToBounds(26.8, 80.95, LUCKNOW);
    expect(p.xPct).toBeCloseTo(50, 5);
  });

  it("returns out-of-range values for points outside the bounds", () => {
    const p = projectToBounds(28.6, 77.2, LUCKNOW); // Delhi
    expect(p.xPct).toBeLessThan(0);
  });
});

describe("centroidOf", () => {
  it("returns null for an empty list", () => {
    expect(centroidOf([])).toBeNull();
  });

  it("averages coordinates", () => {
    const c = centroidOf([
      { lat: 26.8, lng: 80.9 },
      { lat: 26.9, lng: 81.0 }
    ]);
    expect(c).not.toBeNull();
    expect(c!.lat).toBeCloseTo(26.85, 10);
    expect(c!.lng).toBeCloseTo(80.95, 10);
  });
});

describe("boundsFromCenterZoom", () => {
  it("centers the bounds on the given point", () => {
    const b = boundsFromCenterZoom({ lat: 26.85, lng: 80.95 }, 12, 1280, 800);
    const p = projectToBounds(26.85, 80.95, b);
    expect(p.xPct).toBeCloseTo(50, 3);
    expect(p.yPct).toBeCloseTo(50, 3);
  });

  it("produces bounds that contain the center and shrink with zoom", () => {
    const wide = boundsFromCenterZoom({ lat: 26.85, lng: 80.95 }, 10, 1280, 800);
    const tight = boundsFromCenterZoom({ lat: 26.85, lng: 80.95 }, 13, 1280, 800);
    expect(wide.ne.lng - wide.sw.lng).toBeGreaterThan(tight.ne.lng - tight.sw.lng);
  });
});

describe("zoomToFitBounds", () => {
  it("returns a zoom whose image bounds contain the target bounds", () => {
    const z = zoomToFitBounds(LUCKNOW, 1280, 800);
    const img = boundsFromCenterZoom(
      { lat: (LUCKNOW.sw.lat + LUCKNOW.ne.lat) / 2, lng: (LUCKNOW.sw.lng + LUCKNOW.ne.lng) / 2 },
      z,
      1280,
      800
    );
    expect(img.sw.lat).toBeLessThanOrEqual(LUCKNOW.sw.lat);
    expect(img.ne.lat).toBeGreaterThanOrEqual(LUCKNOW.ne.lat);
    expect(img.sw.lng).toBeLessThanOrEqual(LUCKNOW.sw.lng);
    expect(img.ne.lng).toBeGreaterThanOrEqual(LUCKNOW.ne.lng);
  });

  it("zoom+1 would NOT fit (i.e. it picks the largest fitting zoom)", () => {
    const z = zoomToFitBounds(LUCKNOW, 1280, 800);
    const img = boundsFromCenterZoom(
      { lat: (LUCKNOW.sw.lat + LUCKNOW.ne.lat) / 2, lng: (LUCKNOW.sw.lng + LUCKNOW.ne.lng) / 2 },
      z + 1,
      1280,
      800
    );
    const fits =
      img.sw.lat <= LUCKNOW.sw.lat &&
      img.ne.lat >= LUCKNOW.ne.lat &&
      img.sw.lng <= LUCKNOW.sw.lng &&
      img.ne.lng >= LUCKNOW.ne.lng;
    expect(fits).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/geo.test.ts`
Expected: FAIL — cannot resolve `../geo`.

- [ ] **Step 3: Implement `apps/web/lib/geo.ts`**

```ts
// Web Mercator helpers for the homepage hero: project real listing
// coordinates onto a static map image with known geographic bounds, and
// derive those bounds deterministically from a center + zoom so the
// backdrop image and the pin layer can never drift apart.

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoBounds {
  sw: GeoPoint;
  ne: GeoPoint;
}

// Mercator y for a latitude in degrees (unscaled; monotonic in lat).
function mercY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

export function projectToBounds(
  lat: number,
  lng: number,
  bounds: GeoBounds
): { xPct: number; yPct: number } {
  const xPct = ((lng - bounds.sw.lng) / (bounds.ne.lng - bounds.sw.lng)) * 100;
  const yPct =
    ((mercY(bounds.ne.lat) - mercY(lat)) / (mercY(bounds.ne.lat) - mercY(bounds.sw.lat))) * 100;
  return { xPct, yPct };
}

export function centroidOf(points: GeoPoint[]): GeoPoint | null {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), {
    lat: 0,
    lng: 0
  });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

// World-pixel helpers at a given zoom (256px base tile).
function worldSize(zoom: number): number {
  return 256 * 2 ** zoom;
}

function lngToWorldX(lng: number, zoom: number): number {
  return ((lng + 180) / 360) * worldSize(zoom);
}

function latToWorldY(lat: number, zoom: number): number {
  const rad = (lat * Math.PI) / 180;
  const n = Math.log(Math.tan(rad) + 1 / Math.cos(rad));
  return ((1 - n / Math.PI) / 2) * worldSize(zoom);
}

function worldYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function worldXToLng(x: number, zoom: number): number {
  return (x / worldSize(zoom)) * 360 - 180;
}

export function boundsFromCenterZoom(
  center: GeoPoint,
  zoom: number,
  widthPx: number,
  heightPx: number
): GeoBounds {
  const cx = lngToWorldX(center.lng, zoom);
  const cy = latToWorldY(center.lat, zoom);
  return {
    sw: { lat: worldYToLat(cy + heightPx / 2, zoom), lng: worldXToLng(cx - widthPx / 2, zoom) },
    ne: { lat: worldYToLat(cy - heightPx / 2, zoom), lng: worldXToLng(cx + widthPx / 2, zoom) }
  };
}

export function zoomToFitBounds(
  bounds: GeoBounds,
  widthPx: number,
  heightPx: number,
  maxZoom = 15
): number {
  const center: GeoPoint = {
    lat: (bounds.sw.lat + bounds.ne.lat) / 2,
    lng: (bounds.sw.lng + bounds.ne.lng) / 2
  };
  for (let z = maxZoom; z >= 1; z--) {
    const img = boundsFromCenterZoom(center, z, widthPx, heightPx);
    if (
      img.sw.lat <= bounds.sw.lat &&
      img.ne.lat >= bounds.ne.lat &&
      img.sw.lng <= bounds.sw.lng &&
      img.ne.lng >= bounds.ne.lng
    ) {
      return z;
    }
  }
  return 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/geo.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @cribliv/web typecheck
git add apps/web/lib/geo.ts apps/web/lib/__tests__/geo.test.ts
git commit -m "feat(web): mercator projection helpers for the hero map backdrop"
```

---

### Task 2: Home city config + resolution (`lib/home-city-config.ts`)

**Files:**

- Create: `apps/web/lib/home-city-config.ts`
- Test: `apps/web/lib/__tests__/home-city-config.test.ts`

**Interfaces:**

- Consumes: `GeoBounds`, `GeoPoint` from `lib/geo.ts` (Task 1); `CITY_BBOXES` from existing `lib/city-bboxes.ts`.
- Produces (used by Tasks 3, 5, 6, 7):
  - `interface HomeCityConfig { slug: string; label: { en: string; hi: string }; backdrop: string; bounds: GeoBounds; center: GeoPoint; zoom: number; minHeroInventory: number }`
  - `HOME_CITIES: Record<string, HomeCityConfig>` (v1: lucknow only)
  - `DEFAULT_HOME_CITY = "lucknow"`
  - `HOME_CITY_COOKIE = "cribliv_home_city"`
  - `resolveHomeCity(input: { chipCity?: string | null; cookieCity?: string | null; geoCity?: string | null }): HomeCityConfig`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/home-city-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_CITY, HOME_CITIES, resolveHomeCity } from "../home-city-config";

describe("HOME_CITIES", () => {
  it("has a default city entry with sane bounds", () => {
    const city = HOME_CITIES[DEFAULT_HOME_CITY];
    expect(city).toBeDefined();
    expect(city.bounds.ne.lat).toBeGreaterThan(city.bounds.sw.lat);
    expect(city.bounds.ne.lng).toBeGreaterThan(city.bounds.sw.lng);
    expect(city.minHeroInventory).toBeGreaterThan(0);
    expect(city.backdrop.startsWith("/images/home/")).toBe(true);
  });
});

describe("resolveHomeCity", () => {
  it("prefers the query chip city over everything", () => {
    expect(resolveHomeCity({ chipCity: "Lucknow", cookieCity: "nope", geoCity: "nope" }).slug).toBe(
      "lucknow"
    );
  });

  it("falls back chip → cookie → geo → default", () => {
    expect(resolveHomeCity({ chipCity: "atlantis", cookieCity: "lucknow" }).slug).toBe("lucknow");
    expect(resolveHomeCity({ geoCity: "LUCKNOW" }).slug).toBe("lucknow");
    expect(resolveHomeCity({}).slug).toBe(DEFAULT_HOME_CITY);
  });

  it("ignores cities that are not configured", () => {
    // Delhi exists in CITY_BBOXES but is not a configured HOME city in v1.
    expect(resolveHomeCity({ chipCity: "delhi" }).slug).toBe(DEFAULT_HOME_CITY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/home-city-config.test.ts`
Expected: FAIL — cannot resolve `../home-city-config`.

- [ ] **Step 3: Implement `apps/web/lib/home-city-config.ts`**

```ts
// Single source of city truth for the listening-hero homepage. Nothing in
// the hero may hardcode a city slug — adding a city later must be one entry
// here plus one generated backdrop asset (scripts/generate-home-map.mjs).

import { CITY_BBOXES } from "./city-bboxes";
import type { GeoBounds, GeoPoint } from "./geo";

export interface HomeCityConfig {
  slug: string;
  label: { en: string; hi: string };
  // Public path prefix of the backdrop asset, without extension.
  // `${backdrop}.png` (landscape) and `${backdrop}-mobile.png` (portrait).
  backdrop: string;
  // EXACT geographic bounds of the generated backdrop image. Image and
  // bounds are only valid as a pair — regenerate both together with
  // scripts/generate-home-map.mjs, which prints this object.
  bounds: GeoBounds;
  center: GeoPoint;
  zoom: number;
  // Below this listing count the hero hides the counter and pins and shows
  // the "growing in {city}" subline instead. Small numbers never render.
  minHeroInventory: number;
}

export const DEFAULT_HOME_CITY = "lucknow";
export const HOME_CITY_COOKIE = "cribliv_home_city";

export const HOME_CITIES: Record<string, HomeCityConfig> = {
  lucknow: {
    slug: "lucknow",
    label: { en: "Lucknow", hi: "लखनऊ" },
    backdrop: "/images/home/lucknow-dusk",
    // Provisional: CITY_BBOXES until the asset script replaces it (Task 4).
    bounds: CITY_BBOXES.lucknow,
    center: { lat: 26.8467, lng: 80.9462 },
    zoom: 12,
    minHeroInventory: 25
  }
};

export function resolveHomeCity(input: {
  chipCity?: string | null;
  cookieCity?: string | null;
  geoCity?: string | null;
}): HomeCityConfig {
  for (const candidate of [input.chipCity, input.cookieCity, input.geoCity]) {
    const slug = candidate?.trim().toLowerCase();
    if (slug && HOME_CITIES[slug]) return HOME_CITIES[slug];
  }
  return HOME_CITIES[DEFAULT_HOME_CITY];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/home-city-config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @cribliv/web typecheck
git add apps/web/lib/home-city-config.ts apps/web/lib/__tests__/home-city-config.test.ts
git commit -m "feat(web): city-parametric config and resolution for the listening hero"
```

---

### Task 3: Hero query helpers (`lib/hero-query.ts`)

**Files:**

- Create: `apps/web/lib/hero-query.ts`
- Test: `apps/web/lib/__tests__/hero-query.test.ts`

**Interfaces:**

- Consumes: `ParsedChip`, `chipsToFilters` from existing `lib/smart-parser.ts`; `buildSearchQuery` from existing `lib/api.ts`; `centroidOf` from `lib/geo.ts` (Task 1); `HomeCityConfig` from `lib/home-city-config.ts` (Task 2).
- Produces (used by Tasks 6, 7):
  - `interface HeroPin { id: string; lat: number; lng: number; monthly_rent: number; listing_type: string; bhk: number | null; verification_status: string; furnishing: string | null; city: string; locality: string | null; locality_slug: string | null }` — a structural subset of the map endpoint's `MapPinResponse`.
  - `pinMatchesChips(pin: HeroPin, chips: ParsedChip[]): boolean`
  - `buildHeroCountPath(chips: ParsedChip[], citySlug: string): string` — API path for the debounced counter.
  - `buildMapHandoffUrl(locale: string, chips: ParsedChip[], city: HomeCityConfig, pins: HeroPin[]): string` — the `/{locale}/map?…&src=hero` URL for submit.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/hero-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ParsedChip } from "../smart-parser";
import { HOME_CITIES } from "../home-city-config";
import {
  buildHeroCountPath,
  buildMapHandoffUrl,
  pinMatchesChips,
  type HeroPin
} from "../hero-query";

const pin = (over: Partial<HeroPin> = {}): HeroPin => ({
  id: "p1",
  lat: 26.85,
  lng: 80.95,
  monthly_rent: 12000,
  listing_type: "flat_house",
  bhk: 2,
  verification_status: "verified",
  furnishing: "furnished",
  city: "lucknow",
  locality: "Gomti Nagar",
  locality_slug: "gomti-nagar",
  ...over
});

const chip = (kind: ParsedChip["kind"], value: string | number, label = ""): ParsedChip => ({
  kind,
  value,
  label: label || String(value)
});

describe("pinMatchesChips", () => {
  it("matches when every chip is satisfied", () => {
    expect(
      pinMatchesChips(pin(), [
        chip("bhk", 2),
        chip("max_rent", 15000),
        chip("furnishing", "furnished")
      ])
    ).toBe(true);
  });

  it("fails on bhk mismatch", () => {
    expect(pinMatchesChips(pin({ bhk: 3 }), [chip("bhk", 2)])).toBe(false);
  });

  it("fails when rent exceeds max_rent", () => {
    expect(pinMatchesChips(pin({ monthly_rent: 20000 }), [chip("max_rent", 15000)])).toBe(false);
  });

  it("matches locality by name or slug, case-insensitively", () => {
    expect(pinMatchesChips(pin(), [chip("locality", "gomti nagar")])).toBe(true);
    expect(pinMatchesChips(pin(), [chip("locality", "Gomti Nagar")])).toBe(true);
    expect(
      pinMatchesChips(pin({ locality: null, locality_slug: "gomti-nagar" }), [
        chip("locality", "gomti nagar")
      ])
    ).toBe(true);
    expect(pinMatchesChips(pin(), [chip("locality", "hazratganj")])).toBe(false);
  });

  it("never dims on amenity chips (pins carry no amenity data)", () => {
    expect(pinMatchesChips(pin(), [chip("amenity", "parking")])).toBe(true);
  });
});

describe("buildHeroCountPath", () => {
  it("builds a page_size=1 search path with chip filters and the resolved city", () => {
    const path = buildHeroCountPath([chip("bhk", 2), chip("max_rent", 15000)], "lucknow");
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith("/listings/search?")).toBe(true);
    expect(qs.get("city")).toBe("lucknow");
    expect(qs.get("bhk")).toBe("2");
    expect(qs.get("max_rent")).toBe("15000");
    expect(qs.get("page_size")).toBe("1");
  });

  it("lets an explicit city chip override the resolved city and drops amenity q", () => {
    const path = buildHeroCountPath([chip("city", "lucknow"), chip("amenity", "parking")], "delhi");
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(qs.get("city")).toBe("lucknow");
    expect(qs.get("q")).toBeNull();
  });
});

describe("buildMapHandoffUrl", () => {
  const city = HOME_CITIES.lucknow;

  it("maps chips to the map page's supported params and tags src=hero", () => {
    const url = buildMapHandoffUrl("en", [chip("bhk", 2), chip("max_rent", 15000)], city, []);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(url.startsWith("/en/map?")).toBe(true);
    expect(qs.get("city")).toBe("lucknow");
    expect(qs.get("bhk")).toBe("2");
    expect(qs.get("max_rent")).toBe("15000");
    expect(qs.get("src")).toBe("hero");
    expect(qs.get("furnishing")).toBeNull(); // map has no furnishing filter in v1
  });

  it("passes lat/lng/zoom for a locality chip using matching-pin centroid", () => {
    const pins = [pin({ lat: 26.86, lng: 80.99 }), pin({ id: "p2", lat: 26.84, lng: 80.97 })];
    const url = buildMapHandoffUrl("en", [chip("locality", "gomti nagar")], city, pins);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(Number(qs.get("lat"))).toBeCloseTo(26.85, 2);
    expect(Number(qs.get("lng"))).toBeCloseTo(80.98, 2);
    expect(qs.get("zoom")).toBe("14");
  });

  it("omits lat/lng when no pins match the locality", () => {
    const url = buildMapHandoffUrl("en", [chip("locality", "nowhere")], city, [pin()]);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("lat")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/hero-query.test.ts`
Expected: FAIL — cannot resolve `../hero-query`.

- [ ] **Step 3: Implement `apps/web/lib/hero-query.ts`**

```ts
// Pure helpers behind the listening hero: pin dim predicate, the debounced
// counter's API path, and the submit handoff URL into CriblMap. Pure and
// unit-tested; the component (home-listening-hero.tsx) stays thin.

import { chipsToFilters, type ParsedChip } from "./smart-parser";
import { buildSearchQuery } from "./api";
import { centroidOf } from "./geo";
import type { HomeCityConfig } from "./home-city-config";

export interface HeroPin {
  id: string;
  lat: number;
  lng: number;
  monthly_rent: number;
  listing_type: string;
  bhk: number | null;
  verification_status: string;
  furnishing: string | null;
  city: string;
  locality: string | null;
  locality_slug: string | null;
}

export function pinMatchesChips(pin: HeroPin, chips: ParsedChip[]): boolean {
  for (const chip of chips) {
    switch (chip.kind) {
      case "bhk":
        if (pin.bhk !== Number(chip.value)) return false;
        break;
      case "max_rent":
        if (!(pin.monthly_rent <= Number(chip.value))) return false;
        break;
      case "min_rent":
        if (!(pin.monthly_rent >= Number(chip.value))) return false;
        break;
      case "listing_type":
        if (pin.listing_type !== String(chip.value)) return false;
        break;
      case "furnishing":
        if ((pin.furnishing ?? "") !== String(chip.value)) return false;
        break;
      case "city":
        if (pin.city.toLowerCase() !== String(chip.value).toLowerCase()) return false;
        break;
      case "locality": {
        const wanted = String(chip.value).toLowerCase();
        const name = (pin.locality ?? "").toLowerCase();
        const slug = (pin.locality_slug ?? "").toLowerCase();
        if (name !== wanted && slug !== wanted && slug !== wanted.replace(/\s+/g, "-")) {
          return false;
        }
        break;
      }
      case "amenity":
        // Pins carry no amenity data — an amenity chip must never dim pins.
        break;
    }
  }
  return true;
}

export function buildHeroCountPath(chips: ParsedChip[], citySlug: string): string {
  const filters = chipsToFilters(chips);
  // Amenity words land in `q`; they'd narrow the count via FTS in ways the
  // pins can't mirror, so the counter ignores them.
  delete filters.q;
  if (typeof filters.city !== "string" || !filters.city) filters.city = citySlug;
  return `/listings/search?${buildSearchQuery({ ...filters, page: 1, page_size: 1 })}`;
}

export function buildMapHandoffUrl(
  locale: string,
  chips: ParsedChip[],
  city: HomeCityConfig,
  pins: HeroPin[]
): string {
  const filters = chipsToFilters(chips);
  const params: Record<string, string | number | boolean | undefined> = {
    city: typeof filters.city === "string" && filters.city ? filters.city : city.slug,
    bhk: typeof filters.bhk === "number" ? filters.bhk : undefined,
    max_rent: typeof filters.max_rent === "number" ? filters.max_rent : undefined,
    listing_type:
      filters.listing_type === "pg" || filters.listing_type === "flat_house"
        ? (filters.listing_type as string)
        : undefined,
    src: "hero"
  };

  // The map page has no `locality` param; center it on the locality instead
  // by passing the centroid of the hero pins that match the locality chip.
  const localityChips = chips.filter((c) => c.kind === "locality");
  if (localityChips.length > 0) {
    const matches = pins.filter((p) => pinMatchesChips(p, localityChips));
    const centroid = centroidOf(matches);
    if (centroid) {
      params.lat = centroid.lat.toFixed(5);
      params.lng = centroid.lng.toFixed(5);
      params.zoom = 14;
    }
  }

  return `/${locale}/map?${buildSearchQuery(params)}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/hero-query.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @cribliv/web typecheck
git add apps/web/lib/hero-query.ts apps/web/lib/__tests__/hero-query.test.ts
git commit -m "feat(web): pin predicate, counter path, and map handoff URL for the hero"
```

---

### Task 4: Strings, flag, analytics events, backdrop asset

**Files:**

- Modify: `apps/web/lib/i18n.ts` (add keys to the `dictionary` object)
- Modify: `apps/web/lib/feature-flags.ts` (one line in `ENV_FLAG_MAP`)
- Modify: `apps/web/lib/track.ts` (extend the `ProductEvent` union)
- Create: `scripts/generate-home-map.mjs`
- Create: `apps/web/public/images/home/lucknow-dusk.png` + `apps/web/public/images/home/lucknow-dusk-mobile.png` (generated)
- Modify: `apps/web/lib/home-city-config.ts` (paste exact bounds printed by the script)
- Test: `apps/web/lib/__tests__/listen-hero-i18n.test.ts`

**Interfaces:**

- Consumes: `boundsFromCenterZoom`, `zoomToFitBounds` formulas (the script re-implements them in plain JS — it cannot import TS).
- Produces: i18n keys `listenHeroTitle`, `listenHeroSub`, `listenHeroCountIdle`, `listenHeroCountMatching`, `listenHeroCountReady`, `listenHeroListening`, `listenHeroGrowing`, `listenHeroExample1..3`, `listenHeroCityStrip`, `mayaSectionTitle`, `mayaSectionSub`, `mayaSectionCta`; flag `ff_listening_hero`; track events `listening_hero_viewed`, `hero_chip_locked`, `hero_voice_started`, `hero_voice_transcript`, `hero_submitted`, `hero_map_handoff`; backdrop assets + exact bounds in `HOME_CITIES.lucknow.bounds`.

- [ ] **Step 1: Write the failing i18n test**

Create `apps/web/lib/__tests__/listen-hero-i18n.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { t } from "../i18n";

const KEYS = [
  "listenHeroTitle",
  "listenHeroSub",
  "listenHeroCountIdle",
  "listenHeroCountMatching",
  "listenHeroCountReady",
  "listenHeroListening",
  "listenHeroGrowing",
  "listenHeroExample1",
  "listenHeroExample2",
  "listenHeroExample3",
  "listenHeroCityStrip",
  "mayaSectionTitle",
  "mayaSectionSub",
  "mayaSectionCta"
];

describe("listening hero i18n", () => {
  it("has en and hi values for every key (t returns the key itself when missing)", () => {
    for (const key of KEYS) {
      expect(t("en", key), key).not.toBe(key);
      expect(t("hi", key), key).not.toBe(key);
    }
  });

  it("count strings carry the {n} slot and city strings the {city} slot", () => {
    expect(t("en", "listenHeroCountIdle")).toContain("{n}");
    expect(t("hi", "listenHeroCountIdle")).toContain("{n}");
    expect(t("en", "listenHeroCountIdle")).toContain("{city}");
    expect(t("en", "listenHeroGrowing")).toContain("{city}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/listen-hero-i18n.test.ts`
Expected: FAIL — `t("en", "listenHeroTitle")` returns the key.

- [ ] **Step 3: Add the dictionary entries**

In `apps/web/lib/i18n.ts`, inside the `dictionary` object (append before its closing brace, matching the existing entry style):

```ts
  listenHeroTitle: { en: "Tell me what you're looking for", hi: "बताइए, कैसा घर चाहिए?" },
  listenHeroSub: {
    en: "Type or speak — Hindi or English. Live homes across {city}.",
    hi: "टाइप करें या बोलें — हिंदी या अंग्रेज़ी में। {city} के लाइव घर।"
  },
  listenHeroCountIdle: {
    en: "{n} homes live in {city} right now",
    hi: "{n} घर अभी {city} में लाइव हैं"
  },
  listenHeroCountMatching: { en: "{n} homes match so far…", hi: "{n} घर अब तक मैच हुए…" },
  listenHeroCountReady: {
    en: "{n} homes match — press enter or keep talking",
    hi: "{n} घर मैच — एंटर दबाएँ या बोलते रहें"
  },
  listenHeroListening: { en: "Listening…", hi: "सुन रहे हैं…" },
  listenHeroGrowing: {
    en: "Cribliv is growing in {city} — tell us what you need",
    hi: "Cribliv {city} में बढ़ रहा है — बताइए आपको क्या चाहिए"
  },
  listenHeroExample1: { en: "2BHK Gomti Nagar under 15k", hi: "गोमती नगर में 2BHK, 15 हज़ार तक" },
  listenHeroExample2: { en: "furnished flat near Hazratganj", hi: "हज़रतगंज के पास फर्निश्ड फ्लैट" },
  listenHeroExample3: { en: "PG with food in Indira Nagar", hi: "इंदिरा नगर में खाने के साथ PG" },
  listenHeroCityStrip: { en: "Browse rentals by city", hi: "शहर के अनुसार किराये देखें" },
  mayaSectionTitle: {
    en: "List your property by talking to Maya",
    hi: "Maya से बात करके अपनी प्रॉपर्टी लिस्ट करें"
  },
  mayaSectionSub: {
    en: "Speak in Hindi or English — Maya fills in the listing as you talk.",
    hi: "हिंदी या अंग्रेज़ी में बोलें — Maya आपकी लिस्टिंग खुद भर देती है।"
  },
  mayaSectionCta: { en: "Try voice listing", hi: "वॉइस लिस्टिंग आज़माएं" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/listen-hero-i18n.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the flag and track events**

In `apps/web/lib/feature-flags.ts`, add to `ENV_FLAG_MAP`:

```ts
ff_listening_hero: process.env.NEXT_PUBLIC_FF_LISTENING_HERO;
```

In `apps/web/lib/track.ts`, extend the `ProductEvent` union (keep existing members):

```ts
type ProductEvent =
  | "lead_status_changed"
  | "kanban_card_dragged"
  | "lead_csv_exported"
  | "owner_dashboard_opened"
  | "contact_unlock_clicked"
  | "kanban_view_toggled"
  | "listening_hero_viewed"
  | "hero_chip_locked"
  | "hero_voice_started"
  | "hero_voice_transcript"
  | "hero_submitted"
  | "hero_map_handoff";
```

Run: `pnpm --filter @cribliv/web typecheck`
Expected: PASS.

- [ ] **Step 6: Write the asset generation script**

Create `scripts/generate-home-map.mjs`:

```js
#!/usr/bin/env node
// Generates the homepage hero backdrop for a city via the Google Static
// Maps API and prints the EXACT geographic bounds of the produced image.
// Image and bounds are only valid as a pair — paste the printed bounds
// into HOME_CITIES[<slug>].bounds in apps/web/lib/home-city-config.ts.
//
// Usage:
//   GOOGLE_MAPS_KEY=... node scripts/generate-home-map.mjs lucknow 26.70 80.80 26.95 81.10
// Args: <slug> <swLat> <swLng> <neLat> <neLng>  (use CITY_BBOXES values)

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const [slug, swLat, swLng, neLat, neLng] = process.argv.slice(2);
const KEY = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
if (!slug || !swLat || !KEY) {
  console.error(
    "Usage: GOOGLE_MAPS_KEY=... node scripts/generate-home-map.mjs <slug> <swLat> <swLng> <neLat> <neLng>"
  );
  process.exit(1);
}
const bbox = {
  sw: { lat: Number(swLat), lng: Number(swLng) },
  ne: { lat: Number(neLat), lng: Number(neLng) }
};

// --- Web Mercator (mirrors apps/web/lib/geo.ts; script can't import TS) ---
const worldSize = (z) => 256 * 2 ** z;
const lngToX = (lng, z) => ((lng + 180) / 360) * worldSize(z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldSize(z);
};
const yToLat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / worldSize(z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const xToLng = (x, z) => (x / worldSize(z)) * 360 - 180;
const boundsAt = (center, z, w, h) => {
  const cx = lngToX(center.lng, z);
  const cy = latToY(center.lat, z);
  return {
    sw: { lat: yToLat(cy + h / 2, z), lng: xToLng(cx - w / 2, z) },
    ne: { lat: yToLat(cy - h / 2, z), lng: xToLng(cx + w / 2, z) }
  };
};
const fits = (img, b) =>
  img.sw.lat <= b.sw.lat &&
  img.ne.lat >= b.ne.lat &&
  img.sw.lng <= b.sw.lng &&
  img.ne.lng >= b.ne.lng;

// Static Maps standard-plan limit: 640x640 logical px, scale=2 → 1280x1280 real px.
const SHAPES = [
  { suffix: "", w: 640, h: 400 }, // landscape → 1280x800
  { suffix: "-mobile", w: 400, h: 640 } // portrait → 800x1280
];
const center = {
  lat: (bbox.sw.lat + bbox.ne.lat) / 2,
  lng: (bbox.sw.lng + bbox.ne.lng) / 2
};

// Dusk styling: dark ground, faint roads, subtle water — flat, low contrast.
const STYLE = [
  "feature:all|element:labels|visibility:off",
  "feature:landscape|element:geometry|color:0x0f1728",
  "feature:road|element:geometry|color:0x1e293f",
  "feature:road.arterial|element:geometry|color:0x223052",
  "feature:water|element:geometry|color:0x16314a",
  "feature:poi|element:geometry|color:0x111b30",
  "feature:transit|visibility:off",
  "feature:administrative|visibility:off"
]
  .map((s) => `style=${encodeURIComponent(s)}`)
  .join("&");

const outDir = path.join("apps", "web", "public", "images", "home");
await mkdir(outDir, { recursive: true });

for (const shape of SHAPES) {
  // Real pixel size is 2x the logical request (scale=2).
  let zoom = 15;
  while (zoom > 1 && !fits(boundsAt(center, zoom, shape.w * 2, shape.h * 2), bbox)) zoom--;
  const bounds = boundsAt(center, zoom, shape.w * 2, shape.h * 2);
  const url =
    `https://maps.googleapis.com/maps/api/staticmap?center=${center.lat},${center.lng}` +
    `&zoom=${zoom}&size=${shape.w}x${shape.h}&scale=2&format=png&${STYLE}&key=${KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`Static Maps request failed (${res.status}) for ${slug}${shape.suffix}.`);
    console.error(
      "Enable the 'Maps Static API' for this key, or ship the CSS fallback (the hero tolerates a missing image)."
    );
    process.exit(2);
  }
  const file = path.join(outDir, `${slug}-dusk${shape.suffix}.png`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`wrote ${file} (zoom ${zoom})`);
  if (!shape.suffix) {
    console.log(
      "\nPaste into HOME_CITIES." + slug + ".bounds (apps/web/lib/home-city-config.ts):\n"
    );
    console.log(
      JSON.stringify(
        {
          sw: { lat: +bounds.sw.lat.toFixed(5), lng: +bounds.sw.lng.toFixed(5) },
          ne: { lat: +bounds.ne.lat.toFixed(5), lng: +bounds.ne.lng.toFixed(5) }
        },
        null,
        2
      )
    );
  }
}
```

- [ ] **Step 7: Run the script and paste the bounds**

Run (key from `apps/web/.env` / `.env.local` — `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`):

```bash
node scripts/generate-home-map.mjs lucknow 26.70 80.80 26.95 81.10
```

Expected: two PNG files written under `apps/web/public/images/home/` and a bounds JSON printed. Replace `bounds: CITY_BBOXES.lucknow` in `apps/web/lib/home-city-config.ts` with the printed literal object (keep the comment pointing at the script). If `CITY_BBOXES` becomes unused in that file, remove its import.

**If the request fails with 403/REQUEST_DENIED** (Maps Static API not enabled for the key): keep `bounds: CITY_BBOXES.lucknow`, skip the images, and continue — Task 5's component renders a flat `#0F1728` backdrop when the image is missing, and the script can be re-run later. Note it in the PR description.

- [ ] **Step 8: Run all unit tests, typecheck, commit**

```bash
pnpm --filter @cribliv/web test
pnpm --filter @cribliv/web typecheck
git add apps/web/lib/i18n.ts apps/web/lib/feature-flags.ts apps/web/lib/track.ts \
  apps/web/lib/__tests__/listen-hero-i18n.test.ts scripts/generate-home-map.mjs \
  apps/web/public/images/home apps/web/lib/home-city-config.ts
git commit -m "feat(web): hero strings, flag, analytics events, and dusk backdrop pipeline"
```

(If the images were skipped, drop `apps/web/public/images/home` from the `git add`.)

---

### Task 5: The listening hero client component + styles

**Files:**

- Create: `apps/web/components/home-listening-hero.tsx`
- Modify: `apps/web/app/globals.css` (append `hero-listen-*` styles + keyframes at the end)

**Interfaces:**

- Consumes: `parseQuery`, `ParsedChip` (`lib/smart-parser.ts`); `HeroPin`, `pinMatchesChips`, `buildHeroCountPath`, `buildMapHandoffUrl` (Task 3); `HomeCityConfig`, `HOME_CITY_COOKIE` (Task 2); `projectToBounds` (Task 1); `fetchApi` (`lib/api.ts`); `t`, `Locale` (`lib/i18n.ts`); `VoiceSearchButton` + `VoiceStage` (existing); `track` (`lib/track.ts`).
- Produces (used by Task 6): default export `HomeListeningHero` (client component) with props
  `{ locale: Locale; city: HomeCityConfig; pins: HeroPin[]; totalCount: number | null; showCount: boolean }`.
  It renders the interactive panel (input, chips, counter, live region) AND portals the pin layer into the server-rendered `<div id="hero-listen-pins">`.

- [ ] **Step 1: Write the component**

Create `apps/web/components/home-listening-hero.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { parseQuery, type ParsedChip } from "../lib/smart-parser";
import {
  buildHeroCountPath,
  buildMapHandoffUrl,
  pinMatchesChips,
  type HeroPin
} from "../lib/hero-query";
import { HOME_CITY_COOKIE, type HomeCityConfig } from "../lib/home-city-config";
import { projectToBounds } from "../lib/geo";
import { fetchApi } from "../lib/api";
import { t, type Locale } from "../lib/i18n";
import { track } from "../lib/track";
import { VoiceSearchButton } from "./voice-search-button";
import type { VoiceStage } from "./voice-search-types";

interface HomeListeningHeroProps {
  locale: Locale;
  city: HomeCityConfig;
  pins: HeroPin[];
  totalCount: number | null;
  showCount: boolean;
}

interface CountResponse {
  items: unknown[];
  total: number;
}

const COUNT_DEBOUNCE_MS = 400;
const PLACEHOLDER_ROTATE_MS = 4000;

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

function chipKey(chip: ParsedChip): string {
  return `${chip.kind}:${chip.value}`;
}

export default function HomeListeningHero({
  locale,
  city,
  pins,
  totalCount,
  showCount
}: HomeListeningHeroProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [chips, setChips] = useState<ParsedChip[]>([]);
  const [chipResidual, setChipResidual] = useState("");
  const [chipConfidence, setChipConfidence] = useState(0);
  const [dictionary, setDictionary] = useState<{ cities: string[]; localities: string[] }>({
    cities: [],
    localities: []
  });
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [voiceStage, setVoiceStage] = useState<VoiceStage>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [pinHost, setPinHost] = useState<HTMLElement | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const countAbortRef = useRef<AbortController | null>(null);
  const countTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevChipKeysRef = useRef<Set<string>>(new Set());
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const cityLabel = city.label[locale] ?? city.label.en;
  const examples = [
    t(locale, "listenHeroExample1"),
    t(locale, "listenHeroExample2"),
    t(locale, "listenHeroExample3")
  ];

  // Mount: pin portal host, viewed event.
  useEffect(() => {
    setPinHost(document.getElementById("hero-listen-pins"));
    track("listening_hero_viewed", { locale });
  }, [locale]);

  // Dictionary for the local parser (same pattern as SearchHero).
  useEffect(() => {
    const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000").replace(
      /\/+$/,
      ""
    );
    const base = apiBase.endsWith("/v1") ? apiBase : `${apiBase}/v1`;
    fetch(`${base}/listings/search/dictionary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body?.data) return;
        setDictionary({
          cities: Array.isArray(body.data.cities) ? body.data.cities : [],
          localities: Array.isArray(body.data.localities) ? body.data.localities : []
        });
      })
      .catch(() => {
        /* parser still handles BHK/rent/type without the dictionary */
      });
  }, []);

  // Re-parse per keystroke; emit hero_chip_locked for newly locked chips.
  useEffect(() => {
    if (query.trim().length < 2) {
      setChips([]);
      setChipResidual("");
      setChipConfidence(0);
      prevChipKeysRef.current = new Set();
      return;
    }
    const result = parseQuery(query, dictionary.cities, dictionary.localities);
    setChips(result.chips);
    setChipResidual(result.residual);
    setChipConfidence(result.confidence);

    const keys = new Set(result.chips.map(chipKey));
    for (const chip of result.chips) {
      if (!prevChipKeysRef.current.has(chipKey(chip))) {
        track("hero_chip_locked", {
          chip_type: chip.kind,
          chips_count: result.chips.length,
          confidence: result.confidence,
          via: voiceStage === "idle" ? "typed" : "voice"
        });
        setLiveMessage(
          `${chip.label} — ${fill(t(locale, "listenHeroCountMatching"), {
            n: String(matchCount ?? "")
          })}`
        );
      }
    }
    prevChipKeysRef.current = keys;
    // matchCount intentionally omitted: live message uses the value at lock time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, dictionary, locale, voiceStage]);

  // Debounced counter fetch whenever the chip set changes.
  const chipsSignature = chips.map(chipKey).join("|");
  useEffect(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    if (chips.length === 0) {
      setMatchCount(null);
      return;
    }
    countTimerRef.current = setTimeout(async () => {
      countAbortRef.current?.abort();
      const controller = new AbortController();
      countAbortRef.current = controller;
      try {
        const res = await fetchApi<CountResponse>(buildHeroCountPath(chips, city.slug), {
          signal: controller.signal
        });
        if (!controller.signal.aborted && Number.isFinite(res.total)) {
          setMatchCount(res.total);
        }
      } catch {
        // Network failure → approximate from the local pins instead.
        if (!controller.signal.aborted) {
          setMatchCount(pins.filter((p) => pinMatchesChips(p, chips)).length);
        }
      }
    }, COUNT_DEBOUNCE_MS);
    return () => {
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chipsSignature, city.slug]);

  // Rotating placeholder (static under reduced motion).
  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % examples.length),
      PLACEHOLDER_ROTATE_MS
    );
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const navigate = useCallback(
    (url: string) => {
      const push = () => router.push(url as never);
      const doc = document as Document & {
        startViewTransition?: (cb: () => void) => void;
      };
      if (!reducedMotion && typeof doc.startViewTransition === "function") {
        doc.startViewTransition(push);
      } else {
        push();
      }
    },
    [router, reducedMotion]
  );

  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (submitting) return;
      const url =
        chips.length > 0
          ? buildMapHandoffUrl(locale, chips, city, pins)
          : `/${locale}/map?city=${city.slug}&src=hero${
              query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""
            }`;
      track("hero_submitted", {
        chips_count: chips.length,
        confidence: chipConfidence,
        source: chips.length > 0 && chipConfidence >= 0.7 ? "fastpath" : "regex",
        match_count: matchCount ?? -1,
        query_length: query.length
      });
      document.cookie = `${HOME_CITY_COOKIE}=${city.slug};path=/;max-age=${60 * 60 * 24 * 90}`;
      setSubmitting(true);
      rootRef.current?.closest(".hero-listen")?.setAttribute("data-submitting", "true");
      if (reducedMotion) {
        navigate(url);
      } else {
        setTimeout(() => navigate(url), 350);
      }
    },
    [
      chips,
      chipConfidence,
      city,
      locale,
      matchCount,
      navigate,
      pins,
      query,
      reducedMotion,
      submitting
    ]
  );

  const counter = (() => {
    if (!showCount) return fill(t(locale, "listenHeroGrowing"), { city: cityLabel });
    if (chips.length === 0) {
      return totalCount === null
        ? null
        : fill(t(locale, "listenHeroCountIdle"), { n: String(totalCount), city: cityLabel });
    }
    if (matchCount === null) return fill(t(locale, "listenHeroCountMatching"), { n: "…" });
    return fill(t(locale, "listenHeroCountReady"), { n: String(matchCount) });
  })();

  // ---- Pin layer (portaled into the server-rendered backdrop container) ----
  const projected = useMemo(
    () =>
      pins
        .map((pin) => ({ pin, pos: projectToBounds(pin.lat, pin.lng, city.bounds) }))
        .filter(({ pos }) => pos.xPct >= 1 && pos.xPct <= 99 && pos.yPct >= 1 && pos.yPct <= 99),
    [pins, city.bounds]
  );
  const labelledIds = useMemo(() => {
    const byRent = [...projected].sort((a, b) => a.pin.monthly_rent - b.pin.monthly_rent);
    const picks = [...byRent.slice(0, 4), ...byRent.slice(-4)];
    return new Set(picks.map(({ pin }) => pin.id));
  }, [projected]);

  const pinLayer =
    pinHost && showCount
      ? createPortal(
          projected.map(({ pin, pos }) => {
            const matches = chips.length === 0 || pinMatchesChips(pin, chips);
            return (
              <span
                key={pin.id}
                className={`hero-listen__pin${matches ? "" : " hero-listen__pin--dim"}`}
                style={{ left: `${pos.xPct}%`, top: `${pos.yPct}%` }}
              >
                {labelledIds.has(pin.id) && (
                  <span className="hero-listen__pin-label">
                    ₹{Math.round(pin.monthly_rent / 1000)}k
                  </span>
                )}
              </span>
            );
          }),
          pinHost
        )
      : null;

  return (
    <div className="hero-listen__panel" ref={rootRef}>
      {pinLayer}
      <form className="hero-listen__form" onSubmit={handleSubmit}>
        <label htmlFor="hero-listen-input" className="sr-only">
          {t(locale, "listenHeroTitle")}
        </label>
        <div className="hero-listen__input-row">
          <Search size={17} aria-hidden="true" className="hero-listen__input-icon" />
          <input
            id="hero-listen-input"
            className="hero-listen__input"
            type="text"
            value={query}
            enterKeyHint="search"
            autoComplete="off"
            placeholder={examples[placeholderIdx]}
            readOnly={submitting}
            onChange={(e) => setQuery(e.target.value)}
          />
          <VoiceSearchButton
            locale={locale}
            onTranscript={(text) => setQuery(text)}
            onStageChange={(stage) => {
              setVoiceStage(stage);
              if (stage === "listening") track("hero_voice_started", { path: "webspeech" });
            }}
            onResult={(result) => {
              const text = result.transcription?.text?.trim();
              track("hero_voice_transcript", { length: text?.length ?? 0, locale });
              if (text) setQuery(text);
              handleSubmit();
            }}
          />
          <button type="submit" className="hero-listen__submit" disabled={submitting}>
            {t(locale, "navSearch")}
          </button>
        </div>

        {voiceStage !== "idle" && voiceStage !== "error" && (
          <p className="hero-listen__voice-stage">{t(locale, "listenHeroListening")}</p>
        )}

        <div className="hero-listen__chips" aria-hidden="true">
          {chips.map((chip) => (
            <span
              key={chipKey(chip)}
              className={`hero-listen__chip hero-listen__chip--${chip.kind}`}
            >
              {chip.label}
            </span>
          ))}
          {chips.length > 0 && chipConfidence < 0.7 && chipResidual.trim() && (
            <span className="hero-listen__chip hero-listen__chip--refining">…</span>
          )}
        </div>

        {counter && (
          <p className="hero-listen__counter" aria-hidden="true">
            {counter}
          </p>
        )}
        <p className="sr-only" aria-live="polite">
          {liveMessage}
        </p>
      </form>
    </div>
  );
}
```

Note: `t(locale, "navSearch")` reuses the existing "Search / खोजें" string — no new key needed for the button.

- [ ] **Step 2: Append the styles to `apps/web/app/globals.css`**

Append at the end of the file:

```css
/* ── Listening hero (homepage, ff_listening_hero) ─────────────────────── */
.hero-listen {
  position: relative;
  min-height: 560px;
  max-height: 100svh;
  height: 86svh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #0f1728;
}
.hero-listen__backdrop {
  position: absolute;
  inset: 0;
}
.hero-listen__backdrop img {
  object-fit: cover;
  animation: hero-listen-drift 40s linear infinite alternate;
  will-change: transform;
}
.hero-listen__wash {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(8, 14, 28, 0.42) 0%, rgba(8, 14, 28, 0.66) 100%);
}
.hero-listen__pins {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.hero-listen__pin {
  position: absolute;
  width: 9px;
  height: 9px;
  margin: -4px 0 0 -4px;
  border-radius: var(--radius-full);
  background: #ef9f27;
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  opacity: 1;
  transition:
    opacity 500ms ease,
    transform 300ms ease;
}
.hero-listen__pin--dim {
  opacity: 0.15;
}
.hero-listen__pin-label {
  position: absolute;
  left: 12px;
  top: -8px;
  background: #fff;
  color: #0f1728;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  white-space: nowrap;
}
.hero-listen__glass {
  position: relative;
  z-index: 2;
  width: min(480px, 88%);
  background: rgba(10, 16, 30, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: var(--radius-lg);
  padding: var(--space-6) var(--space-6) var(--space-5);
  text-align: center;
  transition:
    opacity 350ms cubic-bezier(0.45, 0, 0.2, 1),
    transform 350ms cubic-bezier(0.45, 0, 0.2, 1);
}
.hero-listen[data-submitting="true"] .hero-listen__glass {
  opacity: 0;
  transform: translateY(-8px) scale(0.97);
}
.hero-listen[data-submitting="true"] .hero-listen__backdrop img {
  transform: scale(1.12);
  transition: transform 350ms cubic-bezier(0.45, 0, 0.2, 1);
  animation: none;
}
.hero-listen[data-submitting="true"] .hero-listen__pin:not(.hero-listen__pin--dim) {
  transform: scale(1.3);
}
.hero-listen__title {
  color: #fff;
  font-size: clamp(22px, 3.4vw, 30px);
  font-weight: 700;
  line-height: 1.3;
  margin: 0;
}
.hero-listen__sub {
  color: rgba(255, 255, 255, 0.65);
  font-size: 14px;
  margin: var(--space-2) 0 var(--space-5);
}
.hero-listen__input-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  background: #fff;
  border-radius: var(--radius-full);
  padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
  text-align: left;
}
.hero-listen__input-icon {
  color: var(--text-tertiary, #888);
  flex-shrink: 0;
}
.hero-listen__input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 15px;
  color: #0f1728;
}
.hero-listen__submit {
  flex-shrink: 0;
  border: none;
  cursor: pointer;
  background: var(--brand);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
}
.hero-listen__voice-stage {
  margin: var(--space-2) 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}
.hero-listen__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
  min-height: 28px;
  margin-top: var(--space-3);
}
.hero-listen__chip {
  font-size: 12.5px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  background: #e6f0ff;
  color: var(--brand-dark, #0047b3);
  animation: hero-listen-chip-in 300ms cubic-bezier(0.2, 0.9, 0.3, 1.4) both;
}
.hero-listen__chip--max_rent,
.hero-listen__chip--min_rent {
  background: #faeeda;
  color: #633806;
}
.hero-listen__chip--locality,
.hero-listen__chip--city {
  background: #eeedfe;
  color: #3c3489;
}
.hero-listen__chip--furnishing,
.hero-listen__chip--amenity {
  background: #faece7;
  color: #712b13;
}
.hero-listen__chip--refining {
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.75);
}
.hero-listen__counter {
  margin: var(--space-3) 0 0;
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.78);
  font-variant-numeric: tabular-nums;
}
@keyframes hero-listen-drift {
  from {
    transform: scale(1.05) translateX(-1.5%);
  }
  to {
    transform: scale(1.05) translateX(1.5%);
  }
}
@keyframes hero-listen-chip-in {
  from {
    opacity: 0;
    transform: scale(0.7);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes hero-listen-map-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.map-entry--hero {
  animation: hero-listen-map-enter 250ms ease both;
}
@media (prefers-reduced-motion: reduce) {
  .hero-listen__backdrop img,
  .hero-listen__chip,
  .map-entry--hero {
    animation: none;
  }
  .hero-listen__glass,
  .hero-listen__pin {
    transition: none;
  }
}
@media (max-width: 640px) {
  .hero-listen {
    height: 78svh;
  }
  .hero-listen__title {
    font-size: 22px;
  }
}
```

If globals.css has no `.sr-only` utility (check with `grep -n "sr-only" apps/web/app/globals.css`), also append:

```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: PASS. (The component isn't mounted anywhere yet — that's Task 6.)

```bash
git add apps/web/components/home-listening-hero.tsx apps/web/app/globals.css
git commit -m "feat(web): listening hero client component with streaming chips and pin layer"
```

---

### Task 6: The flag-gated homepage (`listening-home.tsx` + `page.tsx` branch)

**Files:**

- Create: `apps/web/app/[locale]/listening-home.tsx` (server component)
- Modify: `apps/web/app/[locale]/page.tsx` (add the flag branch at the top of `HomePage`; touch nothing else)

**Interfaces:**

- Consumes: `HomeListeningHero` (Task 5); `HOME_CITIES`, `resolveHomeCity`, `HOME_CITY_COOKIE` (Task 2); `HeroPin` (Task 3); `fetchApi` (`lib/api.ts`); `ListingCarousel`, `ListingCardData` (existing); `t` (`lib/i18n.ts`); `cookies`, `headers` from `next/headers`.
- Produces: `ListeningHomePage({ locale }: { locale: Locale })` — the complete flag-ON homepage (async server component).

- [ ] **Step 1: Create `apps/web/app/[locale]/listening-home.tsx`**

```tsx
import type { Route } from "next";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { ArrowRight, KeyRound, Mic } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";
import { fetchApi } from "../../lib/api";
import { HOME_CITY_COOKIE, resolveHomeCity } from "../../lib/home-city-config";
import type { HeroPin } from "../../lib/hero-query";
import { ListingCarousel } from "../../components/listing-carousel";
import type { ListingCardData } from "../../components/listing-card";

const HomeListeningHero = dynamic(() => import("../../components/home-listening-hero"), {
  ssr: false,
  loading: () => <div style={{ minHeight: 148 }} />
});

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const CITY_LINKS = [
  "delhi",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "chandigarh",
  "jaipur",
  "lucknow"
];

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

async function safeFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await fetchApi<T>(path, undefined, { server: true });
  } catch {
    return fallback;
  }
}

export async function ListeningHomePage({ locale }: { locale: Locale }) {
  const cookieCity = cookies().get(HOME_CITY_COOKIE)?.value ?? null;
  const geoCity = headers().get("x-vercel-ip-city") ?? null;
  const city = resolveHomeCity({ cookieCity, geoCity });
  const cityLabel = city.label[locale] ?? city.label.en;

  const [pins, countRes, homesRes, pgsRes] = await Promise.all([
    safeFetch<HeroPin[]>(
      `/listings/search/map?sw_lat=${city.bounds.sw.lat}&sw_lng=${city.bounds.sw.lng}` +
        `&ne_lat=${city.bounds.ne.lat}&ne_lng=${city.bounds.ne.lng}&limit=80`,
      []
    ),
    safeFetch<{ items: unknown[]; total: number }>(
      `/listings/search?city=${city.slug}&page_size=1&page=1`,
      { items: [], total: 0 }
    ),
    safeFetch<{ items: ListingCardData[] }>(
      `/listings/search?city=${city.slug}&listing_type=flat_house&sort=verified&page=1`,
      { items: [] }
    ),
    safeFetch<{ items: ListingCardData[] }>(
      `/listings/search?city=${city.slug}&listing_type=pg&sort=newest&page=1`,
      { items: [] }
    )
  ]);

  const totalCount = Number.isFinite(countRes.total) ? countRes.total : 0;
  const showCount = totalCount >= city.minHeroInventory;

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cribliv",
    url: BASE_URL,
    logo: `${BASE_URL}/cribliv.png`,
    description:
      "AI-powered rental search platform for North India with live listings, photos, rent, locality, and verification signals.",
    foundingDate: "2025",
    areaServed: { "@type": "Country", name: "India" },
    contactPoint: {
      "@type": "ContactPoint",
      email: "help@cribliv.com",
      contactType: "customer service",
      availableLanguage: ["English", "Hindi"]
    }
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Cribliv",
    url: BASE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/${locale}/search?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };

  const isHindi = locale === "hi";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />

      {/* ── Listening hero ── */}
      {/* If Task 4 skipped the Static Maps asset (403), delete the <Image> block
          below and keep the flat .hero-listen background — do not ship a 404ing
          image element. Restore it when the asset lands. */}
      <section className="hero-listen" data-submitting="false">
        <div className="hero-listen__backdrop" aria-hidden="true">
          <Image
            src={`${city.backdrop}.png`}
            alt=""
            fill
            priority
            sizes="100vw"
            className="hero-listen__map"
          />
          <div id="hero-listen-pins" className="hero-listen__pins" />
          <div className="hero-listen__wash" />
        </div>
        <div className="hero-listen__glass">
          <h1 className="hero-listen__title">{t(locale, "listenHeroTitle")}</h1>
          <p className="hero-listen__sub">
            {fill(t(locale, "listenHeroSub"), { city: cityLabel })}
          </p>
          <HomeListeningHero
            locale={locale}
            city={city}
            pins={pins}
            totalCount={totalCount}
            showCount={showCount}
          />
        </div>
      </section>

      {/* ── Live listings ── */}
      {(homesRes.items.length > 0 || pgsRes.items.length > 0) && (
        <section className="home-section home-section--listings">
          <div className="container home-carousel-stack">
            {homesRes.items.length > 0 && (
              <ListingCarousel
                locale={locale}
                title={isHindi ? `${cityLabel} में लाइव घर` : `Live homes in ${cityLabel}`}
                viewAllHref={`/${locale}/search?city=${city.slug}&listing_type=flat_house`}
                items={homesRes.items}
              />
            )}
            {pgsRes.items.length > 0 && (
              <ListingCarousel
                locale={locale}
                title={isHindi ? `${cityLabel} में नए PG` : `Latest PGs in ${cityLabel}`}
                viewAllHref={`/${locale}/pg/${city.slug}`}
                items={pgsRes.items}
              />
            )}
          </div>
        </section>
      )}

      {/* ── Maya showcase ── */}
      <section className="home-section home-section--surface">
        <div className="container">
          <div className="edi-head">
            <div>
              <span className="edi-eyebrow">{isHindi ? "AI वॉइस" : "AI Voice"}</span>
              <h2 className="edi-title">{t(locale, "mayaSectionTitle")}</h2>
            </div>
            <p className="edi-lede">{t(locale, "mayaSectionSub")}</p>
          </div>
          <Link href={`/${locale}/owner/listings/new` as Route} className="ai-feature">
            <div className="ai-mini-mic" aria-hidden="true">
              <Mic size={22} />
            </div>
            <div className="ai-bubble">नमस्ते! Boliye…</div>
            <span className="ai-feature__cta">
              {t(locale, "mayaSectionCta")} <ArrowRight size={14} />
            </span>
          </Link>
        </div>
      </section>

      {/* ── Owner CTA ── */}
      <div className="container home-cta-wrap">
        <section className="cta-banner" style={{ margin: 0 }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              pointerEvents: "none",
              zIndex: 0
            }}
          />
          <div className="cta-banner__text">
            <span className="cta-banner__eyebrow">
              {isHindi ? "मालिकों के लिए" : "For Property Owners"}
            </span>
            <h2>
              {isHindi ? "प्रॉपर्टी है? मुफ़्त में लिस्ट करें" : "Own a property? List it free."}
            </h2>
            <p>
              {isHindi
                ? "लिस्टिंग ड्राफ्ट बनाएं, विवरण जोड़ें, और किरायेदारों से जुड़ने के लिए अपना मालिक डैशबोर्ड इस्तेमाल करें।"
                : "Create a listing draft, add property details, and use the owner dashboard to connect with tenants."}
            </p>
            <Link href={`/${locale}/owner/dashboard` as Route} className="btn btn--lg">
              {isHindi ? "अभी लिस्ट करें" : "List Your Property"}
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="cta-banner__mark" aria-hidden="true">
            <KeyRound size="0.78em" strokeWidth={1.25} />
          </div>
        </section>
      </div>

      {/* ── City link strip (SEO internal links to /city pages) ── */}
      <section className="home-city-strip-section">
        <div className="container">
          <p className="home-city-strip__label">{t(locale, "listenHeroCityStrip")}</p>
          <p className="home-city-strip__links">
            {CITY_LINKS.map((slug, i) => (
              <span key={slug}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                <Link href={`/${locale}/city/${slug}` as Route}>
                  {slug.charAt(0).toUpperCase() + slug.slice(1)}
                </Link>
              </span>
            ))}
          </p>
        </div>
      </section>
    </>
  );
}
```

- [ ] **Step 2: Add the city-strip styles**

Append to `apps/web/app/globals.css`:

```css
.home-city-strip-section {
  padding: var(--space-8) 0;
}
.home-city-strip__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #667);
  margin: 0 0 var(--space-2);
}
.home-city-strip__links {
  margin: 0;
  font-size: 14px;
  line-height: 1.9;
}
.home-city-strip__links a {
  color: var(--brand);
  text-decoration: none;
}
```

- [ ] **Step 3: Add the flag branch to `page.tsx`**

In `apps/web/app/[locale]/page.tsx`:

Add the import near the other imports:

```tsx
import { ListeningHomePage } from "./listening-home";
```

At the very top of the `HomePage` function body (first statement, before `const isHindi = …`):

```tsx
const listeningHeroEnabled =
  process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "1" ||
  process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "true";
if (listeningHeroEnabled) {
  return <ListeningHomePage locale={params.locale} />;
}
```

Change nothing else in the file. `generateMetadata` stays shared between both branches.

- [ ] **Step 4: Verify both branches render**

```bash
pnpm --filter @cribliv/web typecheck
```

Expected: PASS. Then start the API and web dev servers and check both flag states:

```bash
# Terminal check 1 — flag OFF (default): old homepage
pnpm dev:web &
sleep 15 && curl -s http://localhost:3000/en | grep -c "home-market-grid"
# Expected: >= 1 (old market band present)
kill %1

# Terminal check 2 — flag ON: new homepage
NEXT_PUBLIC_FF_LISTENING_HERO=1 pnpm dev:web &
sleep 15 && curl -s http://localhost:3000/en | grep -c "hero-listen__title"
# Expected: >= 1 ; and the H1 text is server-rendered:
curl -s http://localhost:3000/en | grep -c "Tell me what you"
# Expected: >= 1
curl -s http://localhost:3000/hi | grep -c "बताइए"
# Expected: >= 1
kill %1
```

Also verify no Maps SDK on the homepage bundle: `curl -s http://localhost:3000/en | grep -ci "js-api-loader\|maps.googleapis.com/maps/api/js"` → Expected: 0.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/listening-home.tsx" "apps/web/app/[locale]/page.tsx" apps/web/app/globals.css
git commit -m "feat(web): flag-gated listening-hero homepage with SSR shell and city resolution"
```

---

### Task 7: Map entry polish (`src=hero`)

**Files:**

- Modify: `apps/web/app/[locale]/map/page.tsx` (parse `src` param, pass `fromHero`)
- Modify: `apps/web/app/[locale]/map/map-client.tsx` (fade-in wrapper, strip param, `hero_map_handoff` event)

**Interfaces:**

- Consumes: `.map-entry--hero` CSS class (added in Task 5); `track` from `lib/track.ts`.
- Produces: `MapClientProps` gains optional `fromHero?: boolean`.

- [ ] **Step 1: Pass the param from the server page**

In `apps/web/app/[locale]/map/page.tsx`, next to the other `searchParams` parsing:

```tsx
const fromHero = searchParams.src === "hero";
```

And add `fromHero={fromHero}` to the `<MapClient …>` props.

- [ ] **Step 2: Consume it in `map-client.tsx`**

Update `apps/web/app/[locale]/map/map-client.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { MapStateProvider, type MapFilters } from "../../../components/criblmap/hooks/useMapState";
import { MapView } from "./map-view";
import { track } from "../../../lib/track";

interface MapClientProps {
  locale: string;
  initialFilters?: MapFilters;
  initialCenter?: { lat: number; lng: number };
  initialZoom?: number;
  initialCity?: string;
  initialOriginatingListingId?: string | null;
  fromHero?: boolean;
}

export default function MapClient({
  locale,
  initialFilters,
  initialCenter,
  initialZoom,
  initialCity,
  initialOriginatingListingId,
  fromHero
}: MapClientProps) {
  // Strip the one-shot ?src=hero marker so reloads/shares are clean, and
  // record that a listening-hero handoff completed.
  useEffect(() => {
    if (!fromHero) return;
    track("hero_map_handoff", { had_locality: window.location.search.includes("lat=") });
    const url = new URL(window.location.href);
    url.searchParams.delete("src");
    window.history.replaceState(null, "", url.toString());
  }, [fromHero]);

  return (
    <div className={fromHero ? "map-entry--hero" : undefined}>
      <MapStateProvider
        initialFilters={initialFilters}
        initialCity={initialCity}
        initialOriginatingListingId={initialOriginatingListingId}
      >
        <MapView locale={locale} initialCenter={initialCenter} initialZoom={initialZoom} />
      </MapStateProvider>
    </div>
  );
}
```

Note: if the wrapper `<div>` breaks the map's full-height layout (MapView may rely on being a direct child), give it `style={{ display: "contents" }}` when `fromHero` is false and `className="map-entry--hero"` with `style={{ height: "100%" }}` when true — check visually in Step 3 and pick the variant that leaves flag-off rendering pixel-identical.

- [ ] **Step 3: Verify manually**

```bash
NEXT_PUBLIC_FF_LISTENING_HERO=1 pnpm dev
```

Open `http://localhost:3000/en`, type `2BHK Gomti Nagar under 15k`, watch chips appear and pins dim, press enter. Expected: exit animation, landing on `/en/map?...` with a fade-in, and the `src=hero` param disappearing from the URL bar. Open `/en/map` directly → no fade class, map unchanged.

- [ ] **Step 4: Typecheck and commit**

```bash
pnpm --filter @cribliv/web typecheck
git add "apps/web/app/[locale]/map/page.tsx" "apps/web/app/[locale]/map/map-client.tsx"
git commit -m "feat(web): map entry fade and handoff tracking for listening-hero arrivals"
```

---

### Task 8: Playwright E2E

**Files:**

- Create: `apps/web/tests/listening-hero.spec.ts`

**Interfaces:**

- Consumes: everything shipped in Tasks 5–7; existing Playwright setup (`pnpm --filter @cribliv/web test:e2e`, specs in `apps/web/tests/`).

- [ ] **Step 1: Write the spec**

Create `apps/web/tests/listening-hero.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

// These tests exercise the flag-ON homepage. The flag is baked at build/dev
// start, so the suite self-skips unless the runner sets it:
//   NEXT_PUBLIC_FF_LISTENING_HERO=1 pnpm --filter @cribliv/web test:e2e -- listening-hero
const FLAG_ON =
  process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "1" ||
  process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "true";

test.describe("listening hero homepage", () => {
  test.skip(!FLAG_ON, "NEXT_PUBLIC_FF_LISTENING_HERO not set for this run");

  test("renders the hero with a server-rendered H1", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1.hero-listen__title")).toHaveText(
      "Tell me what you're looking for"
    );
    await expect(page.locator(".hero-listen__input")).toBeVisible();
  });

  test("streams chips while typing and updates the counter", async ({ page }) => {
    await page.goto("/en");
    const input = page.locator(".hero-listen__input");
    await input.fill("2BHK Gomti Nagar under 15k furnished");
    await expect(page.locator(".hero-listen__chip")).toHaveCount(4, { timeout: 5000 });
    await expect(page.locator(".hero-listen__counter")).toContainText("match", {
      timeout: 5000
    });
  });

  test("submits to the map with parsed filters and src=hero", async ({ page }) => {
    await page.goto("/en");
    await page.locator(".hero-listen__input").fill("2BHK under 15k");
    await page.locator(".hero-listen__submit").click();
    await page.waitForURL(/\/en\/map\?/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.searchParams.get("bhk")).toBe("2");
    expect(url.searchParams.get("max_rent")).toBe("15000");
    // src=hero is stripped by the map client after arrival; assert the
    // handoff worked by checking the map page rendered.
    await expect(page.locator(".map-entry--hero, [class*='map']").first()).toBeVisible();
  });

  test("zero-chip query still navigates without an error UI", async ({ page }) => {
    await page.goto("/en");
    await page.locator(".hero-listen__input").fill("ghar chahiye");
    await page.locator(".hero-listen__submit").click();
    await page.waitForURL(/\/en\/map\?/, { timeout: 10000 });
  });

  test("hindi locale renders the Devanagari headline", async ({ page }) => {
    await page.goto("/hi");
    await expect(page.locator("h1.hero-listen__title")).toHaveText("बताइए, कैसा घर चाहिए?");
  });

  test("reduced motion disables the drift animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    const animation = await page
      .locator(".hero-listen__backdrop img")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });
});

test.describe("flag off guard", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");

  test("old homepage renders when the flag is off", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator(".home-market-grid")).toBeVisible();
    await expect(page.locator(".hero-listen__title")).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the suite flag-ON**

The API must be running with seeded data (`pnpm db:migrate && pnpm db:seed && pnpm dev:api` or however the existing E2E setup boots — check `apps/web/playwright.config.ts` `webServer` section first and follow its pattern):

```bash
NEXT_PUBLIC_FF_LISTENING_HERO=1 PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 \
  pnpm --filter @cribliv/web test:e2e -- listening-hero
```

Expected: 6 tests pass, flag-off guard skipped. If the chips test is flaky because the dictionary fetch races the fill, add `await page.waitForTimeout(500)` after `goto` before filling — but only if actually observed.

- [ ] **Step 3: Run the suite flag-OFF (guard)**

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- listening-hero
```

Expected: guard test passes, hero tests skip.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/listening-hero.spec.ts
git commit -m "test(web): listening hero E2E — chips, counter, map handoff, flag guard"
```

---

### Task 9: Full verification + PR

**Files:** none new.

- [ ] **Step 1: Full quality gate**

```bash
pnpm --filter @cribliv/web test
pnpm --filter @cribliv/web typecheck
pnpm lint
pnpm build
```

Expected: all pass. `pnpm build` must succeed with the flag both unset and set (`NEXT_PUBLIC_FF_LISTENING_HERO=1 pnpm build`).

- [ ] **Step 2: Manual QA checklist (dev server, flag ON)**

- Type a Hindi query ("गोमती नगर में 2BHK") → chips appear.
- Mic button: grant permission, speak — transcript streams into the input, chips follow, auto-submit lands on the map.
- Back button from the map returns to an intact homepage.
- Mobile viewport (375px): glass panel fits, input+chips visible with keyboard open.
- Lighthouse on `/en`: LCP element is the backdrop image; CLS ≈ 0.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/listening-hero
gh pr create --title "feat(web): listening-hero homepage behind ff_listening_hero" --body "$(cat <<'EOF'
Flag-gated homepage redesign per docs/superpowers/specs/2026-07-10-listening-hero-homepage-design.md and the implementation plan in docs/superpowers/plans/2026-07-10-listening-hero-homepage.md.

- Voice/NL-first hero: client-side streaming filter chips (existing smart-parser), live match counter, real listing pins over a static dusk map, dimming as you type
- Submit hands off into CriblMap with parsed filters (+ locality centroid), exit animation, src=hero entry fade
- City-parametric from day one (HOME_CITIES config, cookie/geo resolution, inventory threshold)
- Old homepage is byte-identical with the flag off (default)

Flag: NEXT_PUBLIC_FF_LISTENING_HERO (default off).
Known follow-ups: Hindi copy native-speaker pass; backdrop asset regeneration if the Static Maps call was skipped; phase-2 items in spec §14.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Do NOT merge — squash-merge happens after human review per repo convention.

---

## Deviations from the spec (already agreed, restated for the implementer)

- Flag is read server-side from `process.env.NEXT_PUBLIC_FF_LISTENING_HERO` (spec §8 amended); no PostHog remote gating in v1.
- Last-used city is the `cribliv_home_city` cookie (spec §5.4 amended), written on hero submit.
- Backdrop assets are PNG (Static Maps output; next/image serves optimized formats automatically). Landscape 1280×800, portrait 800×1280 (Static Maps size cap), not the spec's 1600/2400 — visually equivalent under the wash overlay.
- Voice `via`/`path` analytics props are simplified: `path: "webspeech"` is reported from `onStageChange` (the fallback component drives the same events through the shared props; distinguishing paths precisely is a follow-up, not v1).
- The hero does not call `/search/agentic-route` on low-confidence submits in v1 — every submit routes to the map with whatever chips parsed (plus `q=` passthrough when no chips). Rationale: the map is a forgiving landing surface (it shows the city's inventory regardless), and it keeps the hero zero-LLM end to end. The spec's clarifying-question flow remains on `/search` via the old SearchHero, which still exists everywhere else.
- Spec §8's separate `home-hero-pins.tsx` is merged into `home-listening-hero.tsx` via a `createPortal` into the server-rendered `#hero-listen-pins` container — the pin layer and the chip state must share one client component, and a portal beats prop-drilling through the server boundary.
- Motion-spec simplifications (polish pass later, not v1): chip _exit_ animation (React unmounts instantly), counter slide-up number transition (plain text swap with `tabular-nums`), and the mic idle pulse ring (VoiceSearchButton owns its markup; don't restyle it blind).
- Mid-typing city _crossfade_ (spec §5.4 resolution step 1) is structurally supported but a no-op in v1: only one city is configured, so a city chip can never resolve to a different configured city. No code is written for the crossfade itself — that lands with the second `HOME_CITIES` entry.
