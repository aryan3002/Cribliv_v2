# Living Map Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~10-section "AI grade" homepage with the approved 6-section "Living Map" design: map-led hero with real listing markers, one listing rail, trimmed cities section, verification story, Maya query chips, and a dark owner band — with zero dev-facing copy and zero visible error/zero states.

**Architecture:** `apps/web/app/[locale]/page.tsx` stays a server component with the existing ISR setup (`revalidate = 300` + `generateStaticParams`). A new server component `HomeHeroMap` renders a light-theme inline-SVG Lucknow map with price markers projected from real `/listings/search/map` pins via the existing `projectToBounds` (`apps/web/lib/geo.ts`) and Lucknow bounds from `resolveHomeCity` (`apps/web/lib/home-city-config.ts`). Every data-driven element degrades by disappearing.

**Tech Stack:** Next.js 14 App Router (server components), Vitest + Testing Library, plain CSS in `apps/web/app/globals.css`, lucide-react icons.

## Global Constraints

- Copy convention: this page uses inline `isHindi ? "…" : "…"` ternaries (NOT `t()`); every new string gets both languages. (Deviation from spec's "add to i18n.ts" — matches the page's existing convention.)
- Banned words in rendered homepage copy: "API", "backend", "hardcoded", "proof", "inventory", "data". Numbers only ever appear inside sentences.
- No error/empty-state text ever renders: missing data ⇒ element/section not rendered.
- `AnimateOnScroll` must stay `ssr: true` (CLS — see comment at page.tsx:51). `CountUp` usage removed entirely.
- No Google Maps JS on the homepage. Map art is inline SVG.
- `generateMetadata`, JSON-LD blocks, `revalidate`, `generateStaticParams`, and the `ListeningHomePage` flag branch stay unchanged.
- Run web tests from repo root: `pnpm --filter @cribliv/web test -- run <file>` (worktree may need `pnpm install --frozen-lockfile` first).
- Commit after each task; lint-staged runs prettier automatically.

## File Structure

- Create `apps/web/lib/hero-map-markers.ts` — pure marker selection/projection (testable, no React).
- Create `apps/web/lib/__tests__/hero-map-markers.test.ts`.
- Create `apps/web/components/home-hero-map.tsx` — light SVG map art + marker layer + featured listing card. Server component, decorative layer is `aria-hidden`.
- Modify `apps/web/app/[locale]/page.tsx` — new section structure; delete old hero/stat/locality/editorial/AI/browse/impact/proof sections.
- Modify `apps/web/app/globals.css` — append a `/* ── Living Map homepage ── */` block; old homepage CSS left in place (other pages share some classes; dead-CSS cleanup is out of scope).
- Create `apps/web/app/[locale]/__tests__/home-living-map.test.tsx`.
- Modify `apps/web/app/[locale]/__tests__/home-city-cards.test.tsx`; delete `home-how-it-works.test.tsx`; adjust `home-city-cards-style.test.ts` / `home-search-mobile-style.test.ts` only if they fail.

---

### Task 1: Marker selection utility

**Files:**

- Create: `apps/web/lib/hero-map-markers.ts`
- Test: `apps/web/lib/__tests__/hero-map-markers.test.ts`

**Interfaces:**

- Consumes: `projectToBounds`, `GeoBounds` from `apps/web/lib/geo.ts`; `HeroPin` from `apps/web/lib/hero-query.ts`.
- Produces: `selectHeroMarkers(pins: HeroPin[], bounds: GeoBounds, opts?: { maxMarkers?: number; minGapPct?: number }): HeroMapMarker[]` where `HeroMapMarker = { id: string; xPct: number; yPct: number; rentLabel: string }`. Task 2 consumes this exact signature.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/hero-map-markers.test.ts
import { describe, expect, it } from "vitest";
import { selectHeroMarkers } from "../hero-map-markers";
import type { HeroPin } from "../hero-query";
import type { GeoBounds } from "../geo";

const BOUNDS: GeoBounds = { sw: { lat: 26.76, lng: 80.85 }, ne: { lat: 26.95, lng: 81.05 } };

function pin(overrides: Partial<HeroPin>): HeroPin {
  return {
    id: Math.random().toString(36).slice(2),
    lat: 26.85,
    lng: 80.95,
    monthly_rent: 12000,
    listing_type: "flat_house",
    bhk: 2,
    verification_status: "verified",
    furnishing: null,
    city: "lucknow",
    locality: null,
    locality_slug: null,
    ...overrides
  };
}

describe("selectHeroMarkers", () => {
  it("projects an in-bounds pin to percentage coordinates with an ₹ label", () => {
    const [m] = selectHeroMarkers([pin({ id: "a", monthly_rent: 14000 })], BOUNDS);
    expect(m.id).toBe("a");
    expect(m.xPct).toBeGreaterThan(0);
    expect(m.xPct).toBeLessThan(100);
    expect(m.yPct).toBeGreaterThan(0);
    expect(m.yPct).toBeLessThan(100);
    expect(m.rentLabel).toBe("₹14,000");
  });

  it("skips pins outside bounds, without coords, or without a positive rent", () => {
    const markers = selectHeroMarkers(
      [
        pin({ id: "out", lat: 28.6, lng: 77.2 }),
        pin({ id: "nan", lat: Number.NaN }),
        pin({ id: "free", monthly_rent: 0 }),
        pin({ id: "ok" })
      ],
      BOUNDS
    );
    expect(markers.map((m) => m.id)).toEqual(["ok"]);
  });

  it("keeps at most maxMarkers and enforces a minimum gap between pills", () => {
    const cluster = Array.from({ length: 20 }, (_, i) =>
      pin({ id: `c${i}`, lat: 26.85 + i * 0.0001, lng: 80.95 + i * 0.0001 })
    );
    const spread = selectHeroMarkers(cluster, BOUNDS, { maxMarkers: 8, minGapPct: 8 });
    expect(spread.length).toBeLessThanOrEqual(8);
    // clustered pins collapse to a single marker under the gap rule
    expect(spread.length).toBe(1);
  });

  it("prefers verified pins when thinning", () => {
    const markers = selectHeroMarkers(
      [
        pin({ id: "unv", lat: 26.85, lng: 80.95, verification_status: "pending" }),
        pin({ id: "ver", lat: 26.851, lng: 80.951, verification_status: "verified" })
      ],
      BOUNDS,
      { minGapPct: 50 }
    );
    expect(markers.map((m) => m.id)).toEqual(["ver"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- run lib/__tests__/hero-map-markers.test.ts`
Expected: FAIL — cannot resolve `../hero-map-markers`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/lib/hero-map-markers.ts
// Picks which live listings become price pills on the homepage hero map.
// Pure so the projection/thinning rules are unit-testable without React.
import { projectToBounds, type GeoBounds } from "./geo";
import type { HeroPin } from "./hero-query";

export interface HeroMapMarker {
  id: string;
  xPct: number;
  yPct: number;
  rentLabel: string;
}

const EDGE_PAD_PCT = 4;

export function selectHeroMarkers(
  pins: HeroPin[],
  bounds: GeoBounds,
  opts: { maxMarkers?: number; minGapPct?: number } = {}
): HeroMapMarker[] {
  const maxMarkers = opts.maxMarkers ?? 8;
  const minGapPct = opts.minGapPct ?? 9;

  const candidates = pins
    .filter(
      (pin) =>
        Number.isFinite(pin.lat) &&
        Number.isFinite(pin.lng) &&
        (pin.monthly_rent ?? 0) > 0 &&
        pin.lat >= bounds.sw.lat &&
        pin.lat <= bounds.ne.lat &&
        pin.lng >= bounds.sw.lng &&
        pin.lng <= bounds.ne.lng
    )
    .map((pin) => ({ pin, pos: projectToBounds(pin.lat, pin.lng, bounds) }))
    .filter(
      ({ pos }) =>
        pos.xPct >= EDGE_PAD_PCT &&
        pos.xPct <= 100 - EDGE_PAD_PCT &&
        pos.yPct >= EDGE_PAD_PCT &&
        pos.yPct <= 100 - EDGE_PAD_PCT
    )
    // Verified pins first so thinning drops unverified ones.
    .sort((a, b) => {
      const av = a.pin.verification_status === "verified" ? 0 : 1;
      const bv = b.pin.verification_status === "verified" ? 0 : 1;
      return av - bv || a.pin.monthly_rent - b.pin.monthly_rent;
    });

  const kept: HeroMapMarker[] = [];
  for (const { pin, pos } of candidates) {
    if (kept.length >= maxMarkers) break;
    const tooClose = kept.some((m) => Math.hypot(m.xPct - pos.xPct, m.yPct - pos.yPct) < minGapPct);
    if (tooClose) continue;
    kept.push({
      id: pin.id,
      xPct: pos.xPct,
      yPct: pos.yPct,
      rentLabel: `₹${pin.monthly_rent.toLocaleString("en-IN")}`
    });
  }
  return kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- run lib/__tests__/hero-map-markers.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/hero-map-markers.ts apps/web/lib/__tests__/hero-map-markers.test.ts
git commit -m "feat(web): hero map marker selection util"
```

---

### Task 2: `HomeHeroMap` component + CSS

**Files:**

- Create: `apps/web/components/home-hero-map.tsx`
- Modify: `apps/web/app/globals.css` (append block at end of file)
- Test: `apps/web/app/[locale]/__tests__/home-living-map.test.tsx` (first cases)

**Interfaces:**

- Consumes: `HeroMapMarker` from Task 1; `ListingCardData` from `../listing-card`.
- Produces: `<HomeHeroMap markers={HeroMapMarker[]} featured={ListingCardData | null} featuredHref={string | null} locale={Locale}>` — renders the map canvas layer only (art + markers + featured card). Task 3 places it inside the hero section behind the copy. Exports named `HomeHeroMap`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/app/[locale]/__tests__/home-living-map.test.tsx  (initial content)
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HomeHeroMap } from "../../../components/home-hero-map";

const MARKERS = [
  { id: "a", xPct: 40, yPct: 30, rentLabel: "₹14,000" },
  { id: "b", xPct: 70, yPct: 60, rentLabel: "₹6,000" }
];

describe("HomeHeroMap", () => {
  it("renders one price pill per marker at projected positions", () => {
    const { container } = render(
      <HomeHeroMap markers={MARKERS} featured={null} featuredHref={null} locale="en" />
    );
    const pills = container.querySelectorAll(".hero-map__marker");
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toContain("₹14,000");
    expect((pills[0] as HTMLElement).style.left).toBe("40%");
    expect((pills[0] as HTMLElement).style.top).toBe("30%");
  });

  it("renders the SVG art and no markers when the market is empty", () => {
    const { container } = render(
      <HomeHeroMap markers={[]} featured={null} featuredHref={null} locale="en" />
    );
    expect(container.querySelector(".hero-map__art")).toBeTruthy();
    expect(container.querySelectorAll(".hero-map__marker")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/unavailable|error/i);
  });

  it("shows the featured listing card only when a photo listing is provided", () => {
    const listing = {
      id: "l1",
      title: "3BHK Semi-Furnished Flat in LDA Colony, Lucknow",
      locality: "LDA Colony",
      monthly_rent: 20000,
      cover_photo: "https://example.com/p.jpg",
      verification_status: "verified" as const
    };
    const { container } = render(
      <HomeHeroMap markers={[]} featured={listing} featuredHref="/en/listing/l1" locale="en" />
    );
    const card = container.querySelector(".hero-map__card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("₹20,000");
    expect(card?.getAttribute("href")).toBe("/en/listing/l1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-living-map.test.tsx"`
Expected: FAIL — cannot resolve `home-hero-map`.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/home-hero-map.tsx
// Light-theme cartographic canvas for the Living Map hero. Pure decoration
// plus real data: the SVG streetscape is loosely shaped after Lucknow (Gomti
// sweeping NW→SE, arterials, a ring road) and ships inline — no Maps JS, no
// billing, no network. The price pills are REAL live listings projected from
// their coordinates; the featured card is a real listing. The whole canvas is
// aria-hidden except the featured card link.
import Link from "next/link";
import type { Route } from "next";
import type { Locale } from "../lib/i18n";
import type { HeroMapMarker } from "../lib/hero-map-markers";
import type { ListingCardData } from "./listing-card";
import { CheckCircle2 } from "lucide-react";

export function HomeHeroMap({
  markers,
  featured,
  featuredHref,
  locale
}: {
  markers: HeroMapMarker[];
  featured: ListingCardData | null;
  featuredHref: string | null;
  locale: Locale;
}) {
  const isHindi = locale === "hi";
  return (
    <div className="hero-map" aria-hidden={featured ? undefined : true}>
      <svg
        className="hero-map__art"
        viewBox="0 0 1400 800"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
      >
        <rect width="1400" height="800" fill="var(--hero-map-bg)" />
        {/* Gomti */}
        <path
          d="M-40,340 C220,290 380,420 600,380 C830,340 900,460 1120,430 C1280,410 1360,470 1460,450"
          stroke="var(--hero-map-water)"
          strokeWidth="34"
          fill="none"
          strokeLinecap="round"
        />
        {/* arterials */}
        <g stroke="var(--hero-map-road-major)" strokeWidth="5" fill="none" opacity="0.9">
          <path d="M120,-20 L340,820" />
          <path d="M-40,180 L1460,260" />
          <path d="M700,-30 L560,830" />
          <path d="M-30,620 L1450,540" />
          <path d="M1050,-30 L1180,830" />
        </g>
        {/* streets */}
        <g stroke="var(--hero-map-road)" strokeWidth="2.5" fill="none">
          <path d="M-30,80 L1460,140" />
          <path d="M-30,450 L1460,380" />
          <path d="M-40,720 L1460,660" />
          <path d="M260,-20 L400,820" />
          <path d="M480,-20 L430,830" />
          <path d="M880,-20 L800,830" />
          <path d="M1250,-20 L1330,830" />
          <path d="M-20,290 L560,330" />
          <path d="M620,520 L1460,470" />
          <path d="M180,540 C300,500 420,580 520,545" />
          <path d="M900,180 C1000,240 1120,190 1240,230" />
          <path d="M340,120 L640,190" />
          <path d="M980,560 L1220,640" />
        </g>
        {/* blocks + parks */}
        <g fill="var(--hero-map-block)">
          <rect x="180" y="120" width="60" height="42" rx="4" />
          <rect x="420" y="480" width="74" height="50" rx="4" />
          <rect x="760" y="230" width="66" height="46" rx="4" />
          <rect x="1080" y="500" width="80" height="52" rx="4" />
          <rect x="600" y="620" width="58" height="40" rx="4" />
          <rect x="950" y="90" width="64" height="44" rx="4" />
        </g>
        <g fill="var(--hero-map-park)" opacity="0.9">
          <ellipse cx="330" cy="660" rx="70" ry="42" />
          <ellipse cx="1150" cy="150" rx="62" ry="38" />
          <ellipse cx="840" cy="560" rx="52" ry="34" />
        </g>
      </svg>

      <div className="hero-map__markers" aria-hidden="true">
        {markers.map((marker) => (
          <span
            key={marker.id}
            className="hero-map__marker"
            style={{ left: `${marker.xPct}%`, top: `${marker.yPct}%` }}
          >
            <span className="hero-map__marker-pill">
              <span className="hero-map__marker-dot" />
              {marker.rentLabel}
            </span>
          </span>
        ))}
      </div>

      {featured && featuredHref && featured.cover_photo && (
        <Link href={featuredHref as Route} className="hero-map__card">
          <span
            className="hero-map__card-media"
            style={{ backgroundImage: `url('${featured.cover_photo}')` }}
            aria-hidden="true"
          >
            {featured.verification_status === "verified" && (
              <span className="hero-map__card-badge">
                <CheckCircle2 size={11} aria-hidden="true" />
                {isHindi ? "वेरिफाइड" : "Verified"}
              </span>
            )}
          </span>
          <span className="hero-map__card-body">
            <span className="hero-map__card-title">{featured.title}</span>
            {featured.monthly_rent && featured.monthly_rent > 0 ? (
              <span className="hero-map__card-rent">
                ₹{featured.monthly_rent.toLocaleString("en-IN")}
                <em>{isHindi ? "/माह" : "/month"}</em>
              </span>
            ) : null}
          </span>
        </Link>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Append the CSS block**

Append to the end of `apps/web/app/globals.css`:

```css
/* ── Living Map homepage ─────────────────────────────────────────────── */
:root {
  --hero-map-bg: #eef2f7;
  --hero-map-road: #d8dfe9;
  --hero-map-road-major: #c6cfdc;
  --hero-map-water: #d5e4f4;
  --hero-map-block: #dde4ee;
  --hero-map-park: #dfe8dd;
}

.hero-map {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.hero-map__art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.hero-map__markers {
  position: absolute;
  inset: 0;
}
.hero-map__marker {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.hero-map__marker::after {
  content: "";
  width: 2px;
  height: 9px;
  border-radius: 2px;
  background: var(--gray-400);
  margin-top: 1px;
}
.hero-map__marker-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  padding: 5px 12px;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--gray-900);
  box-shadow: var(--shadow-md);
  white-space: nowrap;
}
.hero-map__marker-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green, #16a34a);
  box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.18);
}
.hero-map__card {
  position: absolute;
  right: 7%;
  bottom: 12%;
  width: 230px;
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
}
.hero-map__card-media {
  display: block;
  height: 110px;
  background-size: cover;
  background-position: center;
  position: relative;
}
.hero-map__card-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.94);
  color: #065f46;
  font-size: 11px;
  font-weight: 700;
  border-radius: var(--radius-full);
  padding: 3px 9px;
  backdrop-filter: blur(6px);
}
.hero-map__card-body {
  display: block;
  padding: 10px 12px 12px;
}
.hero-map__card-title {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
}
.hero-map__card-rent {
  display: block;
  margin-top: 4px;
  font-size: 14px;
  font-weight: 800;
}
.hero-map__card-rent em {
  font-style: normal;
  font-weight: 500;
  font-size: 12px;
  color: var(--gray-500);
}
@media (max-width: 900px) {
  .hero-map__marker:nth-child(n + 4) {
    display: none;
  }
  .hero-map__card {
    display: none;
  }
}
```

Note: if `--gray-200`/`--gray-400`/`--gray-500`/`--gray-900`, `--radius-lg`, `--radius-full`, `--shadow-md`, `--shadow-lg` don't exist in globals.css `:root`, substitute the tokens that do (check the top of globals.css) — do not invent new grey tokens.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-living-map.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/home-hero-map.tsx apps/web/app/globals.css "apps/web/app/[locale]/__tests__/home-living-map.test.tsx"
git commit -m "feat(web): HomeHeroMap canvas with live price markers"
```

---

### Task 3: New hero + data pass in page.tsx (delete old hero, stat band, localities, extra carousels)

**Files:**

- Modify: `apps/web/app/[locale]/page.tsx`
- Modify: `apps/web/app/globals.css` (hero section styles)
- Test: extend `apps/web/app/[locale]/__tests__/home-living-map.test.tsx`

**Interfaces:**

- Consumes: `selectHeroMarkers` (Task 1), `HomeHeroMap` (Task 2), `resolveHomeCity` from `../../lib/home-city-config`, `HeroPin` from `../../lib/hero-query`, existing `SearchHero`, `ListingCarousel`.
- Produces: the page's new data pass — later tasks rely on these variables existing in `HomePage`: `homesBucket` (rail items), `listingsTotal`, `verifiedTotal`, `verifiedPct`, `cityTotals` (Map<string, number>), `listingHref`.

- [ ] **Step 1: Extend the test file with page-level cases**

Append to `home-living-map.test.tsx` (uses the same `vi.mock` pattern as `home-city-cards.test.tsx` — mock `next/dynamic` and `../../../lib/api`; the api mock must answer `/listings/search/map` with pins, `verified_only` with `{ total: 88 }`, `city=lucknow&page_size=1` with `{ total: 92 }`, listing buckets with 4 items incl. `cover_photo`):

```tsx
describe("living map homepage", () => {
  it("weaves the live verified count into a sentence, not a stat card", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    expect(container.textContent).toContain("88 verified homes");
    expect(container.querySelector(".home-market-band")).toBeNull();
    expect(container.querySelector(".impact-grid")).toBeNull();
  });

  it("never renders dev-facing copy or error states", async () => {
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    const text = container.textContent ?? "";
    for (const banned of [
      "search API",
      "backend",
      "hardcoded",
      "Live backend proof",
      "testimonial",
      "unavailable right now"
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it("drops the count sentence when the market comes back empty", async () => {
    // reconfigure the fetchApi mock to return { items: [], total: 0 } everywhere and [] for map pins
    const ui = await HomePage({ params: { locale: "en" } });
    const { container } = render(ui);
    expect(container.textContent).not.toMatch(/verified homes/);
    expect(container.textContent).not.toMatch(/\b0 (verified|live)/);
  });
});
```

(Implement the mock reconfiguration with `vi.mocked(fetchApi).mockImplementation(...)` per test; module-level default mirrors home-city-cards.test.tsx.)

- [ ] **Step 2: Run to verify the new cases fail**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-living-map.test.tsx"`
Expected: FAIL — old hero/stat band still render, no count sentence.

- [ ] **Step 3: Rewrite the data pass and hero in page.tsx**

In `HomePage`:

- Delete: `popularLocalities` fetch, `trendingPgsBucket`, `furnishedHomesBucket`, `liveProofListings`, `liveRents`, `heroLowRent/heroHighRent`, `heroPhotoListings/heroAnyListings/heroListings/heroHasVisual`, `marketStatCandidates/liveMarketStats`, `impactStats`, `distinctLocalities/localitiesCount`, `HOW_IT_WORKS`.
- Keep: `safeFetchListingBucket`, `listingHref`, city buckets, `formatCompactCount` (cities count label), JSON-LD.
- Add:

```tsx
import { resolveHomeCity } from "../../lib/home-city-config";
import type { HeroPin } from "../../lib/hero-query";
import { selectHeroMarkers } from "../../lib/hero-map-markers";
import { HomeHeroMap } from "../../components/home-hero-map";

// inside HomePage, alongside the existing bucket fetches:
const heroCity = resolveHomeCity({ cookieCity: null, geoCity: null });
let heroPins: HeroPin[] = [];
try {
  heroPins = await fetchApi<HeroPin[]>(
    `/listings/search/map?sw_lat=${heroCity.bounds.sw.lat}&sw_lng=${heroCity.bounds.sw.lng}` +
      `&ne_lat=${heroCity.bounds.ne.lat}&ne_lng=${heroCity.bounds.ne.lng}&limit=80`,
    undefined,
    { revalidate }
  );
} catch {
  /* markers simply don't render */
}
const heroMarkers = selectHeroMarkers(heroPins, heroCity.bounds);

const [homesBucket, allLucknowBucket, verifiedLucknowBucket, cityBuckets] = await Promise.all([
  safeFetchListingBucket("city=lucknow&listing_type=flat_house&sort=verified&page=1"),
  safeFetchListingBucket("city=lucknow&page_size=1&page=1"),
  safeFetchListingBucket("city=lucknow&verified_only=true&page_size=1&page=1"),
  Promise.all(
    CITIES.map(async (city) => {
      const slug = city.name.toLowerCase();
      const bucket = await safeFetchListingBucket(`city=${slug}&page_size=1&page=1`);
      return { slug, total: bucket.total };
    })
  )
]);
const listingsTotal = allLucknowBucket.total;
const verifiedTotal = verifiedLucknowBucket.total;
const verifiedPct = listingsTotal > 0 ? Math.round((verifiedTotal / listingsTotal) * 100) : null;
const heroCount = verifiedTotal > 0 ? verifiedTotal : listingsTotal;
const featuredListing =
  homesBucket.items.find(
    (l) => l.cover_photo && l.verification_status === "verified" && (l.monthly_rent ?? 0) > 0
  ) ?? null;
```

Replace the entire old hero `<section className="hero--landing …">…</section>` AND the `home-market-band` section with:

```tsx
<section className="hero-living" aria-label={isHindi ? "घर खोजें" : "Search homes"}>
  <HomeHeroMap
    markers={heroMarkers}
    featured={featuredListing}
    featuredHref={featuredListing ? listingHref(featuredListing) : null}
    locale={params.locale}
  />
  <div className="container hero-living__inner">
    <p className="hero-living__eyebrow">
      <span className="hero-living__live-dot" aria-hidden="true" />
      {isHindi ? "लखनऊ में लाइव · उत्तर भारत" : "Live in Lucknow · North India"}
    </p>
    <h1 className="hero-living__title">
      {isHindi ? (
        <>
          इस नक्शे का हर घर <em>असली है।</em>
        </>
      ) : (
        <>
          Every home on this map is <em>real.</em>
        </>
      )}
    </h1>
    {heroCount > 0 && (
      <p className="hero-living__count">
        {isHindi ? (
          <>
            <strong>{heroCount} सत्यापित घर</strong> अभी लखनऊ में लाइव हैं — फोटो, किराया और मालिक,
            सब जांचे हुए।
          </>
        ) : (
          <>
            <strong>{heroCount} verified homes</strong> are live in Lucknow right now — photos,
            rent, and owner checked.
          </>
        )}
      </p>
    )}
    <div className="hero-living__search">
      <SearchHero locale={params.locale} />
    </div>
    <div className="hero-living__chips" aria-hidden="true">
      <span>
        <ShieldCheck size={13} /> {isHindi ? "हर लिस्टिंग वेरिफाइड" : "Every listing verified"}
      </span>
      <span>{isHindi ? "कोई ब्रोकर नहीं" : "No brokers"}</span>
      <span>
        <Mic size={13} /> {isHindi ? "हिंदी + English वॉइस खोज" : "हिंदी + English voice search"}
      </span>
    </div>
  </div>
</section>
```

Delete the "Popular Localities" section entirely. Replace the three-carousel stack with a single rail:

```tsx
{
  homesBucket.items.length > 0 && (
    <AnimateOnScroll>
      <section className="home-section home-section--listings">
        <div className="container home-carousel-stack">
          <ListingCarousel
            locale={params.locale}
            title={isHindi ? "आज ही बात करने लायक घर" : "Homes you can call about today"}
            subtitle={
              isHindi
                ? "सीधे लाइव बाज़ार से — मालिक पोस्ट करते हैं, घर किराए पर उठते ही हट जाते हैं।"
                : "Straight from the live market — updated as owners post and homes get rented."
            }
            viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house`}
            items={homesBucket.items}
          />
        </div>
      </section>
    </AnimateOnScroll>
  );
}
```

Remove now-unused imports (`Clock`, `BadgeIndianRupee`, `Search`, `KeyRound`, `Building2`, `Star`?, `Sofa`, `Sparkles`, `TrendingUp`, `CountUp`, `ListingCardItem` — keep whichever the remaining sections still use; typecheck will catch strays). Keep `SearchHero` dynamic import and its skeleton; keep `AnimateOnScroll` dynamic import.

- [ ] **Step 4: Hero CSS**

Append to the Living Map block in globals.css:

```css
.hero-living {
  position: relative;
  min-height: 560px;
  display: flex;
  align-items: center;
  overflow: hidden;
  background: var(--hero-map-bg);
}
.hero-living__inner {
  position: relative;
  z-index: 2;
  padding-block: 76px 70px;
}
.hero-living__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--brand);
}
.hero-living__live-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.16);
  animation: hero-living-pulse 2.4s ease-in-out infinite;
}
@keyframes hero-living-pulse {
  50% {
    box-shadow: 0 0 0 7px rgba(22, 163, 74, 0.08);
  }
}
@media (prefers-reduced-motion: reduce) {
  .hero-living__live-dot {
    animation: none;
  }
}
.hero-living__title {
  font-family: var(--font-heading);
  font-size: clamp(38px, 5vw, 56px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.06;
  margin-top: 14px;
  max-width: 640px;
}
.hero-living__title em {
  font-family: var(--font-display), Georgia, "Times New Roman", serif;
  font-style: italic;
  font-weight: 600;
  color: var(--brand);
}
.hero-living__count {
  margin-top: 18px;
  font-size: 16px;
  color: var(--gray-700);
  max-width: 560px;
}
.hero-living__count strong {
  color: var(--gray-900);
}
.hero-living__search {
  margin-top: 30px;
  max-width: 620px;
}
.hero-living__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.hero-living__chips span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gray-700);
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  padding: 6px 13px;
  backdrop-filter: blur(4px);
}
@media (max-width: 900px) {
  .hero-living {
    min-height: 480px;
  }
  .hero-living__inner {
    padding-block: 56px 48px;
  }
}
```

(Same token caveat as Task 2: verify `--gray-*`/`--font-heading`/`--font-display` names against globals.css `:root` and use the real ones.)

- [ ] **Step 5: Run the page tests + existing suite files**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-living-map.test.tsx" "app/[locale]/__tests__/home-search-mobile-style.test.ts"`
Expected: living-map cases PASS; if the mobile-style test greps deleted classes, update it to the new hero class names.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): Living Map hero, single rail; drop stat bands and locality strip"
```

---

### Task 4: Cities section — cards only for live cities, chips for the rest

**Files:**

- Modify: `apps/web/app/[locale]/page.tsx` (cities section)
- Modify: `apps/web/app/globals.css` (chip row styles)
- Test: `apps/web/app/[locale]/__tests__/home-city-cards.test.tsx`

**Interfaces:**

- Consumes: `cityTotals`, `CITIES`, `formatCompactCount` from Task 3's data pass.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Update the test**

In `home-city-cards.test.tsx` (mock returns lucknow=10, delhi=1, gurugram=2, others 0), replace the assertions:

```tsx
it("renders cards only for cities with live inventory and chips for the rest", async () => {
  const ui = await HomePage({ params: { locale: "en" } });
  const { container } = render(ui);

  // 3 cities have inventory → 3 cards, map art intact
  expect(container.querySelectorAll(".home-city-card")).toHaveLength(3);
  expect(container.querySelectorAll(".home-city-card__map")).toHaveLength(3);
  const delhiCard = screen.getByRole("link", { name: /Delhi/i });
  expect(delhiCard.querySelector(".home-city-card__map")).toBeTruthy();
  expect(delhiCard.textContent).toContain("1 live rental");

  // zero-inventory cities collapse into "Expanding next" chips
  const soonRow = container.querySelector(".home-city-soon");
  expect(soonRow).toBeTruthy();
  expect(soonRow?.textContent).toContain("Noida");
  expect(soonRow?.textContent).toContain("Ghaziabad");
  expect(container.textContent).not.toContain("Browse city");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-city-cards.test.tsx"`
Expected: FAIL — 9 cards render today.

- [ ] **Step 3: Implement**

In the cities section: split `CITIES` by `cityTotals`:

```tsx
const liveCities = CITIES.filter((c) => (cityTotals.get(c.name.toLowerCase()) ?? 0) > 0);
const upcomingCities = CITIES.filter((c) => (cityTotals.get(c.name.toLowerCase()) ?? 0) === 0);
```

Render `liveCities` through the existing card markup (unchanged, minus the `home-city-card--empty` branch and the "Browse city" fallback label — count label becomes `` `${formatCompactCount(total)} live rental${total === 1 ? "" : "s"}` ``, Hindi: `` `${formatCompactCount(total)} लाइव किराया` ``). After the grid, render:

```tsx
{
  upcomingCities.length > 0 && (
    <div className="home-city-soon">
      <span className="home-city-soon__label">{isHindi ? "आगे विस्तार:" : "Expanding next:"}</span>
      {upcomingCities.map((city) => (
        <Link
          key={city.name}
          href={`/${params.locale}/city/${city.name.toLowerCase()}` as Route}
          className="home-city-soon__chip"
        >
          {city.name}
        </Link>
      ))}
    </div>
  );
}
```

CSS:

```css
.home-city-soon {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
.home-city-soon__label {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--gray-700);
}
.home-city-soon__chip {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--gray-600);
  background: var(--gray-50);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-full);
  padding: 5px 13px;
  text-decoration: none;
}
.home-city-soon__chip:hover {
  color: var(--brand);
  border-color: var(--brand);
}
```

If `home-city-cards-style.test.ts` asserts on removed markup, update it to the surviving classes.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-city-cards.test.tsx" "app/[locale]/__tests__/home-city-cards-style.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): cities section shows only live cities, chips for expansion"
```

---

### Task 5: Verification story + Maya chips + owner band; delete remaining old sections

**Files:**

- Modify: `apps/web/app/[locale]/page.tsx`
- Modify: `apps/web/app/globals.css`
- Test: extend `home-living-map.test.tsx`; delete `apps/web/app/[locale]/__tests__/home-how-it-works.test.tsx`

**Interfaces:**

- Consumes: `verifiedPct` from Task 3.
- Produces: final page structure.

- [ ] **Step 1: Extend tests**

```tsx
it("renders the verification story, Maya chips, and owner band; old sections are gone", async () => {
  const ui = await HomePage({ params: { locale: "en" } });
  const { container } = render(ui);

  expect(container.querySelector(".home-verify")).toBeTruthy();
  expect(container.textContent).toContain("How a home gets verified");

  const chips = container.querySelectorAll(".home-maya__chip");
  expect(chips.length).toBeGreaterThanOrEqual(3);
  expect(chips[0].getAttribute("href")).toContain("/en/search?q=");

  expect(container.querySelector(".home-owner-band")).toBeTruthy();
  // deleted sections
  expect(container.querySelector("[data-testid='home-how-it-works']")).toBeNull();
  expect(container.querySelector(".ai-showcase")).toBeNull();
  expect(container.querySelector(".browse-bento")).toBeNull();
  expect(container.querySelector(".home-proof-grid")).toBeNull();
  expect(container.querySelector(".cta-banner")).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-living-map.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implement the three sections**

Delete from page.tsx: How It Works section (+ `HOW_IT_WORKS` const if not already), AI Feature Showcase, Browse by Type, Backend Proof Stats (impact), Live Backend Examples, CTA Banner. Delete `home-how-it-works.test.tsx`. In their place (order: verification → maya → owner):

```tsx
{
  /* ── How verification works ── */
}
<AnimateOnScroll>
  <section className="home-section home-verify">
    <div className="container">
      <span className="home-section__eyebrow">{isHindi ? "भरोसे की वजह" : "Why trust it"}</span>
      <h2 className="home-section__title">
        {isHindi ? "घर कैसे वेरिफाई होता है" : "How a home gets verified"}
      </h2>
      <div className="home-verify__grid">
        {[
          {
            icon: Camera,
            title: isHindi ? "फोटो जांची जाती हैं" : "Photos checked",
            desc: isHindi
              ? "असली प्रॉपर्टी की असली फोटो — कोई स्टॉक इमेज नहीं, कोई झांसा नहीं।"
              : "Real photos from the actual property — no stock images, no bait listings."
          },
          {
            icon: PhoneCall,
            title: isHindi ? "मालिक कन्फर्म होता है" : "Owner confirmed",
            desc: isHindi
              ? "लिस्टिंग लाइव होने से पहले मालिक का फोन वेरिफाई होता है, ताकि आप सही इंसान से बात करें।"
              : "We verify the owner's phone before a listing goes live, so you call the right person."
          },
          {
            icon: Clock,
            title: isHindi ? "उपलब्धता लाइव रहती है" : "Availability live",
            desc: isHindi
              ? "किराए पर उठ चुके घर साइट से हट जाते हैं। जो दिखता है, वही मिलता है।"
              : "Rented-out homes leave the site. What you see is what you can actually get."
          }
        ].map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="home-verify__step">
              <span className="home-verify__icon" aria-hidden="true">
                <Icon size={17} />
              </span>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          );
        })}
      </div>
      {verifiedPct != null && verifiedPct > 0 && (
        <p className="home-verify__fact">
          {isHindi ? (
            <>
              <strong>लाइव लिस्टिंग में से {verifiedPct}% वेरिफाइड हैं।</strong> Cribliv पर है, तो
              असली है — यही तो बात है।
            </>
          ) : (
            <>
              <strong>{verifiedPct}% of live listings are verified.</strong> If it's on Cribliv,
              it's real — that's the whole point.
            </>
          )}
        </p>
      )}
    </div>
  </section>
</AnimateOnScroll>;

{
  /* ── Maya / search like you talk ── */
}
<AnimateOnScroll>
  <section className="home-section home-maya">
    <div className="container home-maya__row">
      <Link
        href={`/${params.locale}/search` as Route}
        className="home-maya__orb"
        aria-label={isHindi ? "वॉइस से खोजें" : "Search by voice"}
      >
        <Mic size={30} aria-hidden="true" />
      </Link>
      <div>
        <span className="home-section__eyebrow">
          {isHindi ? "जैसे बोलते हैं, वैसे खोजें" : "Search like you talk"}
        </span>
        <h2 className="home-section__title">
          {isHindi
            ? "बस बताइए क्या चाहिए — हिंदी या English"
            : "Just say what you need — Hindi or English"}
        </h2>
        <div className="home-maya__chips">
          {[
            isHindi ? "हज़रतगंज के पास 2BHK, 15 हज़ार तक" : "2BHK near Hazratganj under 15k",
            "गोमती नगर में फर्निश्ड फ्लैट",
            isHindi ? "Amity के पास गर्ल्स PG" : "Girls PG near Amity University",
            isHindi ? "मेट्रो के पास फैमिली फ्लैट" : "Family flat near a metro station"
          ].map((query) => (
            <Link
              key={query}
              href={`/${params.locale}/search?q=${encodeURIComponent(query)}` as Route}
              className="home-maya__chip"
            >
              <Sparkles size={13} aria-hidden="true" />
              {query}
            </Link>
          ))}
        </div>
        <Link href={`/${params.locale}/map` as Route} className="home-maya__map-link">
          {isHindi ? "या CriblMap पर घूमकर देखें" : "Or explore on CriblMap"}{" "}
          <ArrowRight size={14} />
        </Link>
      </div>
    </div>
  </section>
</AnimateOnScroll>;

{
  /* ── Owner band ── */
}
<section className="home-owner-band">
  <svg
    className="home-owner-band__art"
    viewBox="0 0 1400 800"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <g stroke="rgba(159,178,204,0.35)" strokeWidth="2.5" fill="none">
      <path d="M-30,80 L1460,140" />
      <path d="M-30,450 L1460,380" />
      <path d="M-40,720 L1460,660" />
      <path d="M260,-20 L400,820" />
      <path d="M880,-20 L800,830" />
      <path d="M-40,340 C220,290 380,420 600,380 C830,340 900,460 1120,430" />
    </g>
  </svg>
  <div className="container home-owner-band__inner">
    <div>
      <h2>
        {isHindi
          ? "लखनऊ में प्रॉपर्टी है? मुफ़्त में लिस्ट करें।"
          : "Own a place in Lucknow? List it free."}
      </h2>
      <p>
        {isHindi
          ? "वेरिफाइड किरायेदार, कोई ब्रोकर का खेल नहीं — और जब तक कोई सीरियस न हो, आपका नंबर प्राइवेट रहता है।"
          : "Verified tenants, no broker games — and your number stays private until someone's serious."}
      </p>
    </div>
    <div className="home-owner-band__cta">
      <Link
        href={`/${params.locale}/owner/dashboard` as Route}
        className="btn btn--lg home-owner-band__btn"
      >
        {isHindi ? "प्रॉपर्टी पोस्ट करें" : "Post your property"} <ArrowRight size={18} />
      </Link>
      <span>{isHindi ? "मुफ़्त · 24 घंटे में लाइव" : "Free · Live in under 24 hours"}</span>
    </div>
  </div>
</section>;
```

Add `Camera, PhoneCall` to the lucide imports (Clock, Mic, Sparkles, ArrowRight, ShieldCheck already imported; remove any now-unused).

CSS:

```css
.home-verify {
  background: var(--gray-50);
  border-top: 1px solid var(--gray-200);
  border-bottom: 1px solid var(--gray-200);
}
.home-verify__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 26px;
}
.home-verify__step {
  background: #fff;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  padding: 22px;
}
.home-verify__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: #ecfdf5;
  color: #16a34a;
  margin-bottom: 14px;
}
.home-verify__step h3 {
  font-family: var(--font-heading);
  font-size: 16.5px;
  font-weight: 800;
}
.home-verify__step p {
  margin-top: 6px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--gray-500);
}
.home-verify__fact {
  margin-top: 22px;
  font-size: 15.5px;
  color: var(--gray-700);
}
.home-verify__fact strong {
  color: #065f46;
}
.home-maya__row {
  display: flex;
  align-items: center;
  gap: 40px;
}
.home-maya__orb {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 110px;
  height: 110px;
  border-radius: 50%;
  color: #fff;
  background: radial-gradient(circle at 35% 30%, #4d94ff, var(--brand) 60%, #0047b3);
  box-shadow: 0 14px 40px rgba(0, 102, 255, 0.35);
}
.home-maya__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 20px;
}
.home-maya__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1.5px solid var(--gray-200);
  background: #fff;
  border-radius: var(--radius-full);
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-700);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
}
.home-maya__chip:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.home-maya__chip svg {
  color: var(--brand);
}
.home-maya__map-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  font-size: 14px;
  font-weight: 700;
  color: var(--brand);
  text-decoration: none;
}
.home-owner-band {
  position: relative;
  overflow: hidden;
  background: #0e1a2f;
  color: #fff;
}
.home-owner-band__art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.35;
}
.home-owner-band__inner {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
  padding-block: 70px;
}
.home-owner-band h2 {
  font-family: var(--font-heading);
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 800;
  letter-spacing: -0.02em;
  max-width: 520px;
}
.home-owner-band p {
  margin-top: 12px;
  font-size: 15.5px;
  line-height: 1.6;
  color: #9fb2cc;
  max-width: 480px;
}
.home-owner-band__cta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
.home-owner-band__cta > span {
  font-size: 12.5px;
  color: #7e93b1;
}
.home-owner-band__btn {
  background: #fff;
  color: var(--gray-900);
}
@media (max-width: 900px) {
  .home-verify__grid {
    grid-template-columns: 1fr;
  }
  .home-maya__row {
    flex-direction: column;
    align-items: flex-start;
    gap: 24px;
  }
  .home-owner-band__inner {
    flex-direction: column;
    align-items: flex-start;
  }
  .home-owner-band__cta {
    align-items: flex-start;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @cribliv/web test -- run "app/[locale]/__tests__/home-living-map.test.tsx" "app/[locale]/__tests__/home-city-cards.test.tsx"`
Expected: PASS. (`home-how-it-works.test.tsx` deleted with `git rm`.)

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git rm "apps/web/app/[locale]/__tests__/home-how-it-works.test.tsx"
git commit -m "feat(web): verification story, Maya chips, owner band; drop legacy sections"
```

---

### Task 6: Full verification + fallout fixes

**Files:**

- Modify: whatever the gates surface.

- [ ] **Step 1: Full web test suite**

Run: `pnpm --filter @cribliv/web test -- run`
Expected: PASS. Fix any homepage-adjacent test fallout (style greps, snapshot-ish assertions) to match the new structure — never by re-adding deleted sections.

- [ ] **Step 2: Static gates**

Run: `pnpm --filter @cribliv/web lint && pnpm typecheck`
Expected: clean. Remove any unused imports/consts typecheck flags.

- [ ] **Step 3: Build + SEO guard**

Run: `pnpm build && pnpm seo:audit`
Expected: build succeeds (worktree may need `pnpm install --frozen-lockfile` first); seo:audit unchanged (homepage metadata untouched).

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "test(web): align remaining suites with Living Map homepage"
```

- [ ] **Step 5: Visual check + PR**

Push branch, open PR against `master` with before/after context; verify hero, markers, all six sections, and mobile layout on the Vercel preview (local preview untrusted for markers). Not merged without the user seeing the preview.
