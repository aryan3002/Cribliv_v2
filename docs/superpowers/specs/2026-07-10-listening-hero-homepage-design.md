# Listening Hero Homepage — Design Spec

**Date:** 2026-07-10
**Status:** Approved concept, pending implementation plan
**Feature flag:** `ff_listening_hero` (web-side; default OFF)
**North-star mockups:** desktop before/after and mobile sequence were prototyped as animated mocks in the design session of 2026-07-09 (chat artifacts). This document is the authoritative written form.

---

## 1. Vision

Replace the current brochure-style homepage with a page that **is the product, already running**. The hero is a full-viewport dusk map of Lucknow with live listing pins. A single input invites the user to type or speak (Hindi or English). As they type, AI-understood filter chips materialize in real time, non-matching pins dim, and a live counter ticks down. Pressing enter does not feel like navigation — the panel lifts, the map zooms, and the user lands in CriblMap with their parsed filters applied.

The differentiating moment: **the user watches the city respond to their words before they press enter.** No Indian rental platform has this.

### Goals

- Make Cribliv's real differentiators (NL search, Hindi voice, live map) the first thing every visitor experiences.
- Remove all builder-speak and empty-state confessions from the homepage.
- Preserve or improve SEO (this page is the domain's strongest URL; cutover from v1 is imminent).
- Ship behind a flag with a graceful fallback to the current homepage.

### Non-goals (v1)

- No changes to the PG funnel (PG toggle keeps routing to `/{locale}/pg`).
- No AI-written summary sentence on the map results side (phase 2).
- No new LLM calls during typing — chip streaming is 100 % client-side.
- No subdomain. Decision recorded: everything stays on `cribliv.com` paths. If marketing wants a memorable URL later, `map.cribliv.com` may be a pure 301 to `/{locale}/map` — never a separate app.

---

## 2. What already exists (reuse, don't rebuild)

| Capability                                          | Where                                                                                                                                                                                                         | Reuse in this design                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Streaming chip parsing (client-side, per keystroke) | `apps/web/lib/smart-parser.ts` → `parseQuery(query, cities, localities)` returning `chips`, `chipResidual`, `chipConfidence`; rendered by `SmartChipStrip` in `apps/web/components/search-hero.tsx:1244`      | The core mechanic. Restyle, don't rewrite.                           |
| Search dictionary prefetch                          | `GET /listings/search/dictionary` (fetched in `search-hero.tsx:216`, 10-min server cache)                                                                                                                     | Feeds the parser's city/locality vocabulary.                         |
| Voice input (streaming, hi-IN/en-IN)                | `apps/web/components/voice-search-button.tsx` (Web Speech API, interim results via `onTranscript`, silence detection) + `voice-search-fallback.tsx` (MediaRecorder → `POST /voice/search`, Azure batch)       | Voice transcript flows into the same chip pipeline.                  |
| LLM intent routing on submit                        | `POST /search/agentic-route` (`apps/api/src/modules/search/search.controller.ts:18`), AI path gated by `ff_ai_intent_classifier` (default OFF), regex fallback always available, 8 s timeout                  | Unchanged. Only consulted on submit when chip confidence < 0.7.      |
| Map page with URL-param filters                     | `apps/web/app/[locale]/map/` accepts `bhk`, `max_rent`, `listing_type`, `verified_only`, `near_metro`, `lat`, `lng`, `zoom`, `city`, `listing`                                                                | The enter-transition target. No map-page API changes required in v1. |
| Map pins endpoint                                   | `GET /listings/search/map?sw_lat&sw_lng&ne_lat&ne_lng&limit…` returning `{id, lat, lng, title, monthly_rent, listing_type, bhk, verification_status, furnishing, cover_photo, city, locality, locality_slug}` | Server-side fetch for the hero backdrop pins.                        |
| Listing search + counts                             | `GET /listings/search` → `{items, total, page, page_size}`                                                                                                                                                    | Debounced count fetch for the live counter.                          |
| Listing cards + carousels                           | `components/listing-card.tsx`, `components/listing-carousel.tsx`                                                                                                                                              | Below-the-fold rows unchanged.                                       |
| Scroll animation                                    | `components/scroll-animations.tsx` (`AnimateOnScroll`, reduced-motion aware)                                                                                                                                  | Below-the-fold reveal.                                               |
| Feature flags                                       | `apps/web/lib/feature-flags.ts` (`useFlag`, `ENV_FLAG_MAP`)                                                                                                                                                   | Add `ff_listening_hero`.                                             |
| i18n                                                | `apps/web/lib/i18n.ts` — `t(locale, key)`, inline dictionary                                                                                                                                                  | All new strings added there.                                         |

**Known repo gap (must fix as part of this work):** `SearchHero` emits analytics via `trackEvent()` from `apps/web/lib/analytics.ts`, which only dispatches a `cribliv:analytics` CustomEvent that nothing listens to. All new hero events MUST go through `track()` in `apps/web/lib/track.ts` (PostHog-backed). Do not add new `trackEvent` calls.

**Prod dependency:** the AI intent classifier needs a valid `AZURE_OPENAI_API_KEY` in the prod container app (currently a broken placeholder — separate ops task). The listening hero works fully without it (client parser + regex fallback); the LLM path only improves low-confidence submits.

---

## 3. Page information architecture

### New homepage structure (flag ON)

1. **Listening hero** — full-viewport-height section (min 560 px, max 100svh minus header).
2. **Live in {city}** — one `ListingCarousel` of flats/houses (existing `popularHomes` bucket, fetched for the resolved city per §5.4).
3. **Latest PGs in {city}** — one `ListingCarousel` (existing `trendingPgs` bucket, resolved city).
4. **Maya showcase** — one full-width section for the voice listing agent (repurposed from the current AI-showcase card, promoted to its own section; static art + copy + CTA to `/{locale}/owner/listings/new`; a looping product video is a later enhancement, NOT v1).
5. **Owner CTA banner** — keep current `cta-banner` as-is.
6. **City link strip** — a compact, server-rendered row of plain text links to all 8 `/{locale}/city/{slug}` pages ("Browse rentals: Delhi · Gurugram · Noida · …"). This preserves internal linking for the SEO city pages without the empty-looking card grid.
7. **Footer** — unchanged.

### Removed sections (flag ON)

- Live market stat band (`home-market-band`) — a "0 Active localities" card must never render again.
- City card grid (`home-city-grid`) — replaced by the text link strip (see above).
- Popular-localities pill strip and its "data unavailable" empty state.
- Furnished-homes third carousel (chips cover this intent).
- How It Works.
- AI showcase 3-card grid (CriblMap card is now the hero itself; AI search card is the hero; Maya gets its own section).
- Browse-by-type bento.
- "Live backend proof" impact stats band.
- "Listings currently coming from the API" proof grid.

### SEO invariants (do not regress)

- `generateMetadata`, Organization + WebSite JSON-LD blocks: keep byte-identical behavior.
- Hero H1, subline, section H2s, carousels, Maya copy, city links, CTA: all server-rendered text.
- The map backdrop is a static `<Image priority>` (see §5.1); the Google Maps JS SDK must NOT be imported anywhere on `/`.
- `hreflang`/canonical handling unchanged.
- Copy rule for every string on the page: if it mentions API, backend, hardcoded, or any internal system concept, it does not ship. ("Pulled from the search API" → "Live right now in Lucknow".)

---

## 4. The hero — anatomy and states

### 4.1 Layout (desktop ≥ 900 px)

- Full-bleed dark section. Backdrop layers, bottom to top:
  1. Static dusk map image of Lucknow (§5.1) with a slow idle drift (`transform: scale(1.05)` pan over ~40 s, CSS keyframes, paused under `prefers-reduced-motion`).
  2. Pin layer: absolutely-positioned DOM pins projected from real listing coordinates (§5.2).
  3. A dark wash gradient overlay for text contrast (flat rgba stops, no fancy effects).
- Centered glass panel (~460 px max width): headline, subline, search input, chip row, counter.
- Top bar: existing site header floats over the hero (header already supports transparent-over-hero styling via `hero--landing` patterns in `globals.css`).

### 4.2 Layout (mobile < 900 px)

- Same stack; glass panel width 88 %, headline 22–24 px.
- The mic button inside the input is 44×44 px minimum touch target with the pulsing ring.
- When the input focuses and the OS keyboard opens, the chip row + counter sit directly under the input (inside the panel), so the "understood" feedback stays visible above the keyboard.
- Backdrop image uses a portrait crop art-directed via `<picture>`/`sizes`.

### 4.3 States

**State A — idle (first paint):**

- Headline (HI locale: "बताइए, कैसा घर चाहिए?" / EN locale: "Tell me what you're looking for").
- Subline (EN: "Type or speak — Hindi or English. Live homes across Lucknow." / HI equivalent, §9).
- Input placeholder cycles through 3 example queries every 4 s (type-writer swap, reduced-motion: static first example). Examples: "2BHK Gomti Nagar under 15k", "furnished flat near Hazratganj", "PG with food in Indira Nagar".
- Counter: "**{N} homes** live in {city} right now" where N = server-fetched total for the resolved city; suppressed below the city's `minHeroInventory` threshold (§5.4), in which case the growth subline renders instead.
- All pins at full opacity, mic ring pulsing.

**State B — typing (chips streaming):**

- On every keystroke, `parseQuery` runs (already the case in `SearchHero`). Each newly locked chip animates in (§7 motion spec). Chip types: bhk, locality, city, budget, furnishing, listing-type.
- Pin layer dims pins that fail the current chip set (client-side predicate over pin fields: `bhk`, `monthly_rent`, `listing_type`, `furnishing`, `locality_slug`). Opacity 1 → 0.15, 500 ms ease.
- Counter switches to "**{n} homes** match so far…" — n comes from a debounced (400 ms) `GET /listings/search?city=lucknow&page_size=1&…chipFilters` using the existing `chipsToFilters` mapping; while in flight, the number holds (no spinner). If the request fails, fall back to counting matching pins locally.
- If `chipConfidence < 0.7` show the existing "refining…" hint restyled to fit the glass panel.

**State C — voice:**

- Tapping the mic starts the existing `StreamingVoiceButton` flow. Interim transcripts write into the input value, which drives the same State B pipeline (chips + dimming + counter) live.
- Voice stage feedback (listening / transcribing / parsing) reuses `VoiceStage` states, rendered as a single subtle line under the input, not the current multi-chip strip.
- Browsers without Web Speech get the existing `voice-search-fallback` recorder; during recording, show "सुन रहे हैं…" / "Listening…" and run chips only after the transcript returns.

**State D — submit (the enter transition):** see §6.

**Empty/degraded states:**

- Pins fetch failed or empty → render the backdrop without pins; counter falls back to the static subline (no number). Never show an error.
- Dictionary fetch failed → input still works; chips simply don't stream; submit goes through `agentic-route` as today.
- Query parses to zero chips ("ghar chahiye") → no chips, counter shows the full count, submit routes with `q=` passthrough as today.

---

## 5. Backdrop: static map + real pins

### 5.1 The map image(s)

- Per-city assets: `apps/web/public/images/home/{city}-dusk@{1600,2400}.webp` (+ portrait crop `{city}-dusk-mobile@900.webp`). v1 ships **lucknow** only; the pipeline must make adding a city a data task, not a code task.
- Produced via the Google Static Maps API using a dark/dusk style consistent with `CRIBLMAP_LIGHT_STYLE`'s palette direction (a dark variant; styling JSON checked into `apps/web/lib/map-styles.ts` alongside the existing style so the hero and CriblMap read as the same product). The generation command/script is checked in (`scripts/generate-home-map.md` or a small node script) so regeneration is repeatable per city.
- **Each image's geographic bounds are part of the contract**, recorded in the city config (§5.4):
  ```ts
  // apps/web/lib/home-city-config.ts
  export const HOME_CITIES: Record<string, HomeCityConfig> = {
    lucknow: {
      backdrop: "/images/home/lucknow-dusk",
      bounds: { sw: { lat: 26.76, lng: 80.87 }, ne: { lat: 26.95, lng: 81.06 } }, // captured at asset generation
      center: { lat: 26.8467, lng: 80.9462 },
      zoom: 12,
      minHeroInventory: 25
    }
  };
  ```
  Image + bounds are only valid as a pair; the generation script must output both together.

### 5.4 Multi-city readiness (v1 requirement)

The concept is city-agnostic — the parser's dictionary already covers all 8 cities and their localities, so **the input itself is the city switcher** (typing "Cyber City" resolves Gurugram with no dropdown). v1 ships with one city configured but must be built city-parametric:

- **`HOME_CITIES` config is the single source of city truth** for the hero: backdrop asset, bounds, center/zoom, inventory threshold. Nothing else in the hero may hardcode a city slug. Adding a city later = one config entry + one generated asset pair.
- **Resolved city** drives the backdrop, pins fetch, counter, and both carousels. Resolution order:
  1. City/locality chip parsed from the query (live — a mid-typing city change crossfades the backdrop 400 ms and refetches pins client-side via `GET /listings/search/map`),
  2. last-used city (cookie `cribliv_home_city`, set client-side on submit — a cookie, not localStorage, so the server can read it at first paint),
  3. request geo (Vercel `x-vercel-ip-city` header, matched against `HOME_CITIES`, server-side),
  4. default: `lucknow`.
     In v1, steps 1's crossfade and client refetch only activate when the target city exists in `HOME_CITIES`; a chip for an unconfigured city keeps the current backdrop and routes normally on submit.
- **Inventory threshold rule:** a city gets the full treatment (live counter, pins) only when its listing total ≥ `minHeroInventory`. Below threshold: same hero, no count number, no pins, subline swaps to the growth framing (`listenHeroGrowing`, §9). **A small inventory number must never render above the fold.**
- Server-side, `page.tsx` resolves the city before fetching pins/counts/carousels, so first paint is already the right city (no client flash).

### 5.2 Pin projection

- Server component (`page.tsx`) fetches up to 80 pins: `GET /listings/search/map?sw_lat…&ne_lat…&limit=80` with `HOME_MAP_BOUNDS`, `{ server: true }`, silent-failure wrapper like the existing `safeFetchListingBucket`.
- Pins are plain absolutely-positioned `<span>`s. Projection (Web Mercator):
  ```
  x% = (lng − west) / (east − west) × 100
  mercY(lat) = ln(tan(π/4 + lat·π/360))
  y% = (mercY(north) − mercY(lat)) / (mercY(north) − mercY(south)) × 100
  ```
  Helper `projectToBounds(lat, lng, bounds)` lives in `apps/web/lib/geo.ts` (new) with unit tests.
- Up to 8 pins nearest the price extremes get small rent labels ("₹8.5k") — replaces the current fake `home-hero__pin` decorations with real data.
- Pins are `aria-hidden`; they are decoration, not navigation (v1).

### 5.3 Why not a live map here

Homepage LCP and SEO outrank interactivity; the Maps JS SDK costs ~100 KB+ and a billed map load per visit. The live map lives one enter-press away. Do not "upgrade" the hero to a real map without revisiting this spec.

---

## 6. The enter transition (homepage → CriblMap)

### 6.1 Routing

- Homes segment (default): submit → `/{locale}/map?city={resolvedCity}&…` with filters mapped from chips:
  - bhk chip → `bhk`
  - budget chip → `max_rent`
  - furnishing chip → **dropped from the map URL in v1** (the map has no furnishing filter). The chip still renders, still dims pins, and still feeds the count fetch (`/listings/search` supports `furnishing`) — it is only omitted from the handoff. Map-side furnishing filter is phase 2.
  - listing-type chip `pg` → see PG note below
  - locality chip → **no `locality` param exists on the map**; instead compute the centroid of matching hero pins for that `locality_slug` and pass `lat`,`lng`,`zoom=14`. If no matching pins, fall back to the resolved city's configured center.
- Chip confidence ≥ 0.7 → route directly (fast path, no network). Confidence < 0.7 → `POST /search/agentic-route` exactly as today, but when the response's `route` is the search results page, translate to the map URL instead. `clarifying_question` responses render inline in the panel as today.
- PG segment toggle: unchanged — routes to `/{locale}/pg?…` (existing behavior). A "pg" listing-type chip typed in Homes mode routes to the map with `listing_type=pg`.
- URL is pushed with `router.push` so back-button returns to the homepage.

### 6.2 Choreography

Sequence on submit (total ≤ 650 ms before navigation):

1. 0 ms — input locks (readonly), submit button morphs to spinner-less "→" state.
2. 0–350 ms — glass panel: `opacity 1→0`, `translateY(-8px)`, `scale(0.97)`; backdrop: `scale(1.05→1.12)` toward the locality centroid (CSS `transform-origin` set from the centroid's projected x/y); non-matching pins already dimmed from State B, matching pins scale 1→1.3.
3. 350 ms — `router.push` to the map URL.
4. Map page entry: CriblMap already renders its own loading state; add a 250 ms fade-in on the map container and a staggered pin-drop (80 ms apart, max 6 staggers) the first time pins arrive after a listening-hero handoff (detected via a `?src=hero` param; the param is stripped from the URL after read).

**View Transitions API:** where `document.startViewTransition` exists (Chromium), wrap the push so the hero search pill morphs into the map toolbar's search field via `view-transition-name: cribliv-search` on both elements. Non-supporting browsers get the choreography above, which must stand alone — the View Transition is enhancement only.

**Reduced motion:** all steps collapse to an instant `router.push` with a plain 150 ms opacity fade.

---

## 7. Motion spec

| Element                           | Animation                                           | Duration / easing                                                              | Notes                                                    |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Backdrop idle drift               | `scale(1.05)` slow pan (keyframes `hero-map-drift`) | 40 s linear infinite alternate                                                 | paused on reduced motion; `will-change: transform`       |
| Chip enter                        | `opacity 0→1`, `scale(0.7→1)`                       | 300 ms `cubic-bezier(0.2, 0.9, 0.3, 1.4)` (existing "pop" feel, cf. `menuPop`) | one chip per parse diff; never re-animate existing chips |
| Chip exit (backspaced away)       | `opacity→0`, `scale→0.8`                            | 150 ms ease-in                                                                 |                                                          |
| Pin dim / undim                   | `opacity 1↔0.15`                                    | 500 ms ease                                                                    | CSS class toggle only; no layout writes                  |
| Pin highlight (matches on submit) | `scale 1→1.3`                                       | 300 ms ease-out                                                                |                                                          |
| Counter number change             | old number slides up-and-out, new slides in (8 px)  | 250 ms ease                                                                    | wrap number in fixed-width span to avoid layout shift    |
| Mic idle ring                     | expanding ring `scale 1→1.9`, `opacity 0.7→0`       | 1.6 s ease-out infinite                                                        | ring is a bordered pseudo-element, no box-shadow         |
| Placeholder cycle                 | type-out/erase or crossfade                         | 4 s cadence                                                                    | reduced motion: static                                   |
| Panel exit (submit)               | see §6.2                                            | 350 ms `cubic-bezier(0.45, 0, 0.2, 1)`                                         |                                                          |
| Below-fold sections               | existing `AnimateOnScroll`                          | as-is                                                                          |                                                          |

Global rules: animate only `transform` and `opacity`; every animation has a `prefers-reduced-motion` collapse; all keyframes live in `globals.css` following the existing `cribmap-*` naming (`hero-listen-*` prefix).

---

## 8. Component & file plan

New files:

- `apps/web/components/home-listening-hero.tsx` (client) — the hero. Composes: `parseQuery` + dictionary fetch (extracted, see below), `VoiceSearchButton`, restyled chip row, counter, pin layer, submit/transition logic. Dynamic-imported from `page.tsx` with an SSR placeholder that reserves full hero height (CLS guard, mirroring the existing `SearchHero` loading placeholder approach).
- `apps/web/components/home-hero-pins.tsx` (client, tiny) — pin layer + dim predicate.
- `apps/web/lib/geo.ts` — `projectToBounds`, centroid helper. Unit-tested.
- `apps/web/lib/home-city-config.ts` — `HOME_CITIES` config + `resolveHomeCity(queryChips, storedCity, geoCity)` (§5.4). Unit-tested.
- `apps/web/lib/hero-query.ts` — extraction of the query-state machinery currently inline in `SearchHero` (parse effect, `chipsToFilters`, debounced count fetch, agentic-route submit). **Extraction rule:** `SearchHero` must keep working unchanged (it consumes the extracted hook); no behavior change with the flag off. If extraction proves too entangled, v1 may duplicate the ~150 lines instead and file a follow-up — do not destabilize `SearchHero` for the fallback path.

Modified files:

- `apps/web/app/[locale]/page.tsx` — flag branch: `ff_listening_hero` ? new structure (§3) : current JSX untouched. Server-side additions: city resolution (§5.4), pins fetch, total count fetch (generalize the existing `allLucknowBucket` pattern to the resolved city).
- `apps/web/lib/feature-flags.ts` — add `ff_listening_hero: process.env.NEXT_PUBLIC_FF_LISTENING_HERO` to `ENV_FLAG_MAP`.
- `apps/web/lib/i18n.ts` — new strings (§9).
- `apps/web/app/globals.css` — `hero-listen-*` styles + keyframes; dark-map style JSON additions in `lib/map-styles.ts`.
- `apps/web/app/[locale]/map/map-client.tsx` (or `map-view.tsx`) — read-and-strip `?src=hero`, entry fade + pin stagger, `view-transition-name` on the toolbar search field.

Flag semantics: web-side only. **The structural branch in `page.tsx` is a server component, so it reads `process.env.NEXT_PUBLIC_FF_LISTENING_HERO` directly** (the `useFlag` hook is client-only and cannot gate server-rendered structure without hydration mismatch). Consequence for rollout: v1 toggling is an env-var flip + redeploy (~1 min on Vercel) rather than a PostHog remote toggle; PostHog-based gradual rollout would need middleware-level bucketing and is deferred. No API-side flag needed — no new API surface in v1.

---

## 9. Copy & i18n

All added via `apps/web/lib/i18n.ts`. Keys and values (EN / HI):

| Key                       | EN                                                                 | HI                                                                |
| ------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `listenHeroTitle`         | Tell me what you're looking for                                    | बताइए, कैसा घर चाहिए?                                             |
| `listenHeroSub`           | Type or speak — Hindi or English. Live homes across {city}.        | टाइप करें या बोलें — हिंदी या अंग्रेज़ी में। {city} के लाइव घर।   |
| `listenHeroCountIdle`     | {n} homes live in {city} right now                                 | {n} घर अभी {city} में लाइव हैं                                    |
| `listenHeroGrowing`       | Cribliv is growing in {city} — tell us what you need               | Cribliv {city} में बढ़ रहा है — बताइए आपको क्या चाहिए             |
| `listenHeroCountMatching` | {n} homes match so far…                                            | {n} घर अब तक मैच हुए…                                             |
| `listenHeroCountReady`    | {n} homes match — press enter or keep talking                      | {n} घर मैच — एंटर दबाएँ या बोलते रहें                             |
| `listenHeroListening`     | Listening…                                                         | सुन रहे हैं…                                                      |
| `listenHeroExample1`      | 2BHK Gomti Nagar under 15k                                         | गोमती नगर में 2BHK, 15 हज़ार तक                                   |
| `listenHeroExample2`      | furnished flat near Hazratganj                                     | हज़रतगंज के पास फर्निश्ड फ्लैट                                    |
| `listenHeroExample3`      | PG with food in Indira Nagar                                       | इंदिरा नगर में खाने के साथ PG                                     |
| `listenHeroCityStrip`     | Browse rentals by city                                             | शहर के अनुसार किराये देखें                                        |
| `mayaSectionTitle`        | List your property by talking to Maya                              | Maya से बात करके अपनी प्रॉपर्टी लिस्ट करें                        |
| `mayaSectionSub`          | Speak in Hindi or English — Maya fills in the listing as you talk. | हिंदी या अंग्रेज़ी में बोलें — Maya आपकी लिस्टिंग खुद भर देती है। |

(Hindi strings need a native-speaker pass before launch — flagged as an open item, §14.)

The `{n}` interpolation: the current `t()` returns plain strings; format with a simple `.replace("{n}", …)` at the call site (pattern already used elsewhere is manual concatenation — either is fine; do not build an i18n framework for this).

---

## 10. Analytics

All via `track()` from `apps/web/lib/track.ts` (PostHog). Events:

| Event                   | Props                                                                                           | When                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| `listening_hero_viewed` | `{ locale }`                                                                                    | hero mounts (once per pageview) |
| `hero_chip_locked`      | `{ chip_type, chips_count, confidence, via: "typed" \| "voice" }`                               | each newly locked chip          |
| `hero_voice_started`    | `{ path: "webspeech" \| "fallback" }`                                                           | mic engaged                     |
| `hero_voice_transcript` | `{ length, locale }`                                                                            | final transcript                |
| `hero_submitted`        | `{ chips_count, confidence, source: "fastpath" \| "ai" \| "regex", match_count, query_length }` | submit fired                    |
| `hero_map_handoff`      | `{ had_locality: boolean }`                                                                     | map page reads `src=hero`       |

Success metrics for rollout (§13): search-start rate (`hero_submitted` / `listening_hero_viewed`) vs. the old hero's submit rate; map handoff completion; downstream listing-open rate from map sessions with `src=hero`.

---

## 11. Performance budgets

- **LCP ≤ 2.5 s (p75 mobile):** LCP element is the static map image — `<Image priority sizes=…>` with preloaded webp; the glass panel text renders server-side.
- **CLS ≈ 0:** hero section has a fixed min-height at first paint; the dynamic client hero mounts into a placeholder of identical height (the current homepage already learned this lesson — see the CLS comment at `page.tsx:49`).
- **No Maps JS SDK on `/`** — enforce by review; nothing under `components/criblmap/` may be imported by the homepage.
- **JS budget:** the listening hero adds ≤ 10 KB gzip over the current `SearchHero` bundle (it mostly reuses it).
- **No layout-thrashing animations:** transform/opacity only (§7).
- Debounces: parse per-keystroke (already fine — it's synchronous and local), count fetch 400 ms, no network call before 3 typed characters.

---

## 12. Accessibility

- Exactly **one** visually-hidden `aria-live="polite"` region for the whole hero. On each chip lock it announces the combined update ("Filter added: 2 BHK — 23 homes match"). The visible chip row and visible counter are `aria-hidden` (they'd double-announce otherwise).
- Pins layer `aria-hidden="true"`.
- Mic button: `aria-label` = t(`listenHeroListening`)-appropriate labels for idle/recording; keyboard operable; recording state visible without color alone (ring + icon change).
- Input: proper `<label>` (visually hidden), `enterkeyhint="search"`.
- Contrast: all text over the map must pass AA against the wash overlay — the wash exists for this; verify with the darkest and lightest map regions.
- Full flow keyboard-only operable; the enter transition must not trap focus — focus lands on the map page's search field after navigation.
- `prefers-reduced-motion`: every animation collapses (§7); the View Transition is skipped.

---

## 13. Rollout

1. Ship with `ff_listening_hero` OFF. Old homepage untouched and default.
2. Local/dev: `NEXT_PUBLIC_FF_LISTENING_HERO=1`.
3. Preview deploy → manual QA on real devices (low-end Android + iOS Safari; voice on both; Hindi locale).
4. Prod: enable with the env var (`NEXT_PUBLIC_FF_LISTENING_HERO=1` in Vercel → redeploy). The branch is server-rendered, so PostHog remote toggling doesn't apply in v1 (see §8 flag semantics); watch the §10 metrics for a week before considering the old path removable.
5. Keep the old homepage code path for at least one full cycle after 100 % — instant rollback is the flag.
6. Precondition for prod: v1→v2 domain cutover complete (this page only matters on cribliv.com traffic) and prod Azure OpenAI key fixed (for the low-confidence submit path; not required for chips).

---

## 14. Open questions / phase 2

- **Hindi copy review** by a native speaker before flag-on (§9).
- **Phase 2 — map-side polish:** AI summary sentence over results ("Cheapest is ₹11k in Vibhuti Khand…") — one cheap LLM call over the result set; docked chip strip on the map toolbar so refinement stays conversational; `locality` and `furnishing` params on the map endpoint.
- **City expansion (mostly de-risked by §5.4):** adding a city = one `HOME_CITIES` entry + one scripted asset pair; resolution (query > stored > geo > default) is built in v1. Remaining phase-2 items: Hindi city-name declension in interpolated strings, and whether the idle backdrop should be a national view that flies into the resolved city.
- **PG segment on the map** — revisit after phase 2 (PG page currently has richer PG-specific filters).
- Maya section video loop (v1 ships static art).

---

## 15. Testing

**Unit (Vitest, web):**

- `projectToBounds` known-coordinate cases + bounds edges.
- Chip→map-URL mapping incl. locality-centroid fallback and zero-chip passthrough.

**E2E (Playwright, `apps/web`):**

- Flag OFF: current homepage renders (guard test: market band present).
- Flag ON: hero renders; type "2BHK Gomti Nagar under 15k" → expect ≥ 3 chips, counter text changes, pins container gains dimmed children; submit → URL matches `/en/map?…bhk=2…max_rent=15000…src=hero`.
- Zero-chip query submits and navigates (no crash, no error UI).
- Reduced-motion emulation: no animated classes applied.
- Hindi locale: headline + placeholder in Devanagari.
- Voice: mock Web Speech absence → fallback button present (deep voice E2E is out of scope; existing voice tests cover the components).

**Manual QA checklist:** keyboard-over-map contrast, OS-keyboard behavior on iOS Safari (visual viewport), back-button from map returns to intact homepage, PostHog events arriving.

---

## 16. Decision log

| Decision                           | Choice                                                                                | Why                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Subdomain vs path                  | Path (`/map`); optional 301 vanity subdomain later                                    | SEO equity consolidation pre-cutover; auth/session simplicity                                                                    |
| Live map vs static backdrop on `/` | Static image + DOM pins                                                               | LCP, SEO, Maps billing; live map is one enter away                                                                               |
| Chip parsing                       | Client-side `smart-parser` (existing)                                                 | Zero latency; LLM only on low-confidence submit                                                                                  |
| Submit target                      | CriblMap (`/map`) for Homes; `/pg` unchanged for PG                                   | Map is the differentiated experience; PG page has segment-specific filters                                                       |
| Fallback                           | Full old homepage behind flag                                                         | Cutover safety; instant rollback                                                                                                 |
| New analytics                      | `track()`/PostHog only                                                                | `trackEvent()` is a dead end (no listener)                                                                                       |
| Multi-city                         | City-parametric from v1 (`HOME_CITIES` config, resolution chain, inventory threshold) | Query-as-city-switcher scales; hardcoding Lucknow would need a rewrite at expansion; small counts must never show above the fold |
