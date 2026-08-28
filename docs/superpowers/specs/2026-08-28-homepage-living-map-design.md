# Homepage redesign — "The Living Map"

**Date:** 2026-08-28
**Status:** Approved (mockup direction A chosen by user from three production-fidelity mockups)
**Branch:** `claude/homepage-design-layout-181454`

## Problem

The current homepage reads as an AI-generated template, not a consumer brand:

- Developer copy leaks into consumer UI: "Pulled from the search API", "Real inventory,
  not hardcoded", "Live backend proof", "This is not a testimonial section. These are real
  listings from the backend response."
- Data undermines trust instead of building it: "0 live localities", a visible
  "Live locality data is unavailable right now" error banner, city cards for
  Delhi/Noida/Ghaziabad with zero inventory behind them.
- The same 3 listings render twice (carousel + "Live backend examples").
- Generic landing-page skeleton: eyebrow → heading → 4 stat cards → grid → gradient CTA,
  repeated ~10 times with count-up animations.

## Positioning decisions (user-confirmed)

- **North India, honestly**: regional framing kept, but only cities with real inventory
  are surfaced. Lucknow is explicitly the flagship. Zero-inventory cities collapse into an
  "Expanding next" chip row.
- **Every number appears inside a sentence, never as a stat card.** If a number is
  unavailable, the sentence is dropped — no error states are ever rendered.
- The map-texture visual language of the existing "Explore Top Cities" section (which the
  user likes) becomes the design system for the whole page.

## Page structure

Six sections replace the current ~10. Order:

1. **Hero — `HomeHeroMap` (new)**. Full-bleed stylized SVG map of Lucknow (streets +
   Gomti river) as the hero canvas. Live price markers (`₹14,000` pills with a green live
   dot) positioned by projecting real listing lat/lng into the SVG viewport. One featured
   popup card with a real listing photo. Overlaid content: eyebrow with pulsing green dot
   ("Live in Lucknow · North India"), headline **"Every home on this map is _real_."**
   (the "real." in the Fraunces display italic, brand blue), a live-count sentence
   ("**92 verified homes** are live in Lucknow right now — photos, rent, and owner
   checked."), the existing `SearchHero` search box (Homes/PG tabs + mic), and three
   trust chips ("✓ Every listing verified", "No brokers", "हिंदी + English voice search").
2. **Live homes rail** — "Homes you can call about today". Existing `ListingCarousel` /
   `ListingCardItem`, rendered exactly once. "View all 92 →" links to search.
3. **Cities** — existing "Explore Top Cities" section kept nearly as-is (flagship Lucknow
   tile + map-art cards), but **only cities with live count > 0 get cards**; the rest
   render as an "Expanding next: Delhi · Noida · …" chip row.
4. **Verification story** — "How a home gets verified": three steps (photos checked,
   owner confirmed, availability live) + a sentence weaving in the verified stat
   ("100% of live listings are verified."). Replaces every stat-card band.
5. **Maya / AI search** — "Just say what you need — Hindi or English": mic orb + tappable
   example query chips deep-linking to `/search?q=…` (e.g. "2BHK near Hazratganj under
   15k", "गोमती नगर में फर्निश्ड फ्लैट", "Girls PG near Amity University").
6. **Owner CTA** — dark navy band with faint map texture: "Own a place in Lucknow?
   List it free." + "Post your property →" + "Free · Live in under 24 hours".

**Deleted outright:** the live-market stat band (4 cards), "Where people are searching
now" localities section, "Live backend proof" band, "Live backend examples" section, the
editorial band, and all `CountUp` count-up animations.

## Architecture

- The page stays a server component at `apps/web/app/[locale]/page.tsx` with the existing
  production setup unchanged: `export const revalidate = 300`, `generateStaticParams`
  (both required for ISR — see Vercel Fluid CPU note), `fetchApi` with
  `{ revalidate }` per fetch, try/catch bucket helpers.
- One consolidated data pass feeds all sections: Lucknow homes bucket (items + total,
  photos, rents, lat/lng), PG bucket (for the PG tab context and query chips), per-city
  counts (for the cities section).
- **Graceful degradation contract:** every data-driven element degrades by disappearing,
  never by showing an error or a zero. API down → hero renders map with no markers and
  headline without the count sentence; rail section not rendered; cities section falls
  back to the flagship card only.
- `HomeHeroMap` is a new server-rendered component (`apps/web/components/home-hero-map.tsx`)
  replacing `home-hero-map-art.tsx` usage in the hero. The SVG art is inline (a few KB).
  No Google Maps JS anywhere on the homepage.
- Marker projection: linear lat/lng → SVG coordinate mapping over fixed Lucknow bounds
  (approx. lat 26.76–26.95, lng 80.85–81.05), clamped with edge padding; listings without
  coords or outside bounds are skipped; at most ~8 markers, deduplicated by proximity so
  pills don't overlap. Pure function, unit-tested.
- The existing `SearchHero` dynamic import (ssr:false with skeleton) is reused unchanged.
  `AnimateOnScroll` stays `ssr:true` where reused (CLS constraint — see comment in
  page.tsx). `CountUp` usage is removed.

## Copy & i18n

- All new copy is consumer-voice. Banned words on the homepage: API, backend, hardcoded,
  data, inventory (in the technical sense), proof.
- Every new string is added to the inline dictionary in `apps/web/lib/i18n.ts` with full
  Hindi translations.
- `generateMetadata` (SEO titles/descriptions) unchanged.

## Performance

- LCP: hero paint is text + inline SVG; the only above-fold image is the featured marker
  popup photo (fixed dimensions, `loading="lazy"` off — small enough to not matter, but
  explicitly sized so no CLS).
- CLS-safe by construction: no client-injected sections above the fold; all sections are
  in the server HTML.
- Mobile: the map becomes a quiet backdrop with at most 3 markers; sections stack;
  search box remains the primary element.

## Rollout

- Ships **unflagged** as the new homepage (replaces the classic page wholesale).
- Safety gate is the Vercel preview deploy on the PR — the local Browser-pane preview is
  not trusted for map/marker rendering (known limitation).
- Pre-merge guards: `pnpm build`, `pnpm lint`, `pnpm typecheck`, web unit tests,
  `pnpm seo:audit`.
- Normal branch → PR → squash-merge flow to `master`.

## Testing

- Unit: marker projection (coords → SVG position; missing/out-of-bounds coords skipped;
  proximity dedup).
- Component (Vitest): each data-driven section renders with data and disappears without
  it (no error text ever); cities section renders cards only for count > 0 and chips for
  the rest; no banned dev-copy strings appear in the rendered page.
- Existing homepage component tests updated to the new structure.
- E2E: existing homepage smoke updated (hero renders, search box present, rail present
  when API seeded).
