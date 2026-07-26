# Top Navigation Redesign

**Date:** 2026-07-25
**Status:** Design approved, pending implementation plan

## Problem

The current top bar is a flat five-item row — `Search · Saved · Cribliv Times · CriblMap` plus a right-hand
action cluster. Two things are wrong with it.

**It holds too little.** The site has a deep public taxonomy (26 SEO intents across 4 categories, 8 hub
cities, locality/metro/landmark pages, PG city pages, 4 blog desks, pricing, rent agreement, how-it-works)
and almost none of it is reachable from the header. Competing portals — 99acres, magicbricks, housing.com —
all expose their taxonomy through multi-column hover menus. That is both a discovery gap and a missed
internal-linking opportunity for the SEO programme.

**It is visually inconsistent.** The CriblMap chip runs three simultaneous effects (a drifting gradient
background, a hover sheen sweep, a pulsing dot) on a ~90px element, inside a design system that is otherwise
flat hairlines and soft tints. Beside the restrained Cribliv Times serif chip it reads as a different
product's component.

Below 900px the situation is worse: `.nav-center` is `display: none`, so the entire primary navigation
disappears on tablet and phone.

## Goals

1. Expose the real taxonomy through hover mega-menus, sourced from constants that already exist.
2. Make the bar visually coherent — one chip language, not one editorial chip beside one gradient CTA.
3. Close the mobile gap so nothing is desktop-only.
4. Add zero server fetches to the layout.

## Non-goals

- No change to `--header-height` (72px) or any layout `calc()` that depends on it.
- No change to the role-aware Post Property targeting logic.
- No feature flag. The nav ships directly (decided 2026-07-25).
- No city-persistence state. The city chip navigates; it does not store a preference.

## Hard constraints

### C1 — No fetch in the layout

The header renders in the root layout. A server fetch there without an explicit `revalidate` opt forces
**every page on the site** to render dynamically. This is the exact cause of the Vercel Fluid CPU overage
already diagnosed and fixed for the SEO pages. All menu links must therefore come from static constants.

The single exception is the Cribliv Times "latest posts" column, which loads **client-side on first hover**
via a same-origin Next route handler (§4.4). Client-side means no SSR cost; same-origin means it is not
subject to the API's CORS allowlist, which does not currently include `cribliv.com` for browser calls.

### C2 — Only link to routes that exist

- There is **no `/city/{citySlug}/{intent}` route.** Intents exist only under a locality, metro station, or
  landmark. City-level intent links must therefore build a `/search?…` or `/pg?…` URL from the intent's own
  `filters` object via `intentToSearchParams()`.
- **Never emit `/search?listing_type=pg`.** `app/[locale]/search/page.tsx:205` redirects it to
  `/pg/{city}` or `/pg`. PG links must target `/pg` directly.
- `/city/{citySlug}/{locality}` calls `notFound()` for unknown localities. A guessed slug is a 404 _inside
  the navigation_. See §3.3 for the locality-linking rule.
- The homepage shows a ninth city card, `varanasi`, that is absent from every other city list. The nav lists
  only the 8 hub cities. **Correction (verified 2026-07-25):** an earlier draft called this a dead link. It
  is not. `city/[citySlug]/page.tsx` contains no `notFound()` and `dynamicParams` defaults to `true`, so
  `/city/varanasi` renders on demand — it just takes the non-programmatic search fallback because
  `isProgrammatic` is false. Nothing links to `/rent-in/varanasi` or `/pg/varanasi`, since the sitemap
  iterates the 8-city list. So this is a thin page, not a broken one, and fixing it is out of scope. The nav
  simply must not add a ninth entry that has no programmatic support behind it.

## 1. Bar anatomy

Single row, 72px, unchanged height. `.nav-center`'s `position: absolute; left: 50%` is replaced by a real
flex row with two `flex: 1` spacers, so the centre group stays optically centred while tolerating growth.

**At rest (homepage, unscrolled):**

```
[logo] [city chip] ←spacer→ Rent▾  PG▾  CriblMap  Cribliv Times▾  Owners▾ ←spacer→ [♥] [Post Property] [हिंदी] [☰avatar]
```

**Scrolled, or any inner page:** the city chip and `हिंदी` yield their space. A search pill takes the freed
room showing the active query summary; clicking it reopens the existing search UI. `हिंदी` moves into the
hamburger menu while in this state.

The pill's summary is derived synchronously from the current URL's search params via `useSearchParams()` —
no fetch, no state. Precedence: `q` verbatim if present; otherwise `bhk` + `locality`/`city` composed as
`2 BHK in Gomti Nagar`; then `max_rent` appended as `· Under ₹20k`. With no recognised params it falls back
to the generic placeholder (`Search rentals`). City and locality names resolve through the same static
constants the panels use, so an unrecognised slug renders its raw value rather than blanking.

The menu triggers stay visible in both states. This was an explicit decision: dropping them on scroll would
remove internal links from precisely the pages (city, locality, listing) where they matter most for SEO, and
would leave inner pages without orientation.

**Right cluster.** `Saved` becomes a heart icon with a count badge (§1.1). `Post Property` keeps its existing
role-aware target from `header.tsx` (owner → `/owner/dashboard`, pg_operator or pg-operator route →
`/pg-operator/listings/new`, everyone else → `/become-owner`). The avatar/hamburger pill is unchanged.

### 1.1 Saved badge

Shortlist state today has no shared store: `ListingCardHeart` reads localStorage for guests and calls
`GET /shortlist` for logged-in users, per component instance. A header badge built on the same pattern would
go stale the moment a user hearts a listing.

So a small `lib/shortlist-count.ts` is introduced — a module-level count with subscribe/notify. It seeds
from localStorage (guest) or one client-side `GET /shortlist` on mount (logged in), and
`ListingCardHeart` notifies it on every successful toggle. The header subscribes. If the count cannot be
determined the icon renders with no badge; a zero count renders no badge either.

This is a client-side fetch, matching what `ListingCardHeart` already does — it inherits that component's
existing behaviour rather than introducing a new network dependency.

## 2. Chip language

Cribliv Times keeps its exact current styling — serif (`--font-display`), hairline `--border-strong` box,
4px radius, press-red hover. It is the reference, not the exception.

**CriblMap is restyled to match it**: the same hairline box and 4px radius, but sans-serif and brand blue
rather than serif and press red, retaining a small live dot. The gradient background, the `cribmap-drift`
animation, the `::after` sheen sweep, and the `cribmap-pulse` shadow animation are all removed.

The result is a deliberate pair of special chips distinguished by voice (editorial vs live data) rather than
by one being a loud CTA. These two chips are the only things on the bar that no competitor has, so they stay
special — just coherently so.

## 3. Panel contents

Five menus. `CriblMap` remains a direct link with no panel.

### 3.1 Rent

| Column             | Source                                                  | Href shape                 |
| ------------------ | ------------------------------------------------------- | -------------------------- |
| Property type      | `intentsByCategory` → `property-type`, minus `pg`       | `/search?…` from `filters` |
| By budget          | category `budget`                                       | `/search?…`                |
| By lifestyle       | category `lifestyle` + `family-flats`, `bachelor-flats` | `/search?…`                |
| Popular localities | see §3.3                                                | see §3.3                   |
| Promo card         | static                                                  | `/map`                     |

Five columns, not six. An earlier draft split BHK into its own column, but `1bhk` / `2bhk` / `3bhk` already
live in the `property-type` category alongside `flats`, `rooms`, and `studio` — so that column is a single
`intentsByCategory` group (six links, minus `pg`) rather than an artificial split. This is both lighter to
read and more faithful to the data model.

### 3.2 PG & Co-living

| Column           | Source                                                                           | Href shape                              |
| ---------------- | -------------------------------------------------------------------------------- | --------------------------------------- |
| By sharing       | static: single, double, triple, quad                                             | `/pg?city=…&sharing=…`                  |
| By who it's for  | `pg-for-girls`, `pg-for-boys`, `pg-for-students`, `pg-for-working-professionals` | `/pg?gender_policy=…` / `tenant_type=…` |
| Food & amenities | `with-food`, `vegetarian-pg`, `ac-rooms`, `co-living`                            | `/pg?food_included=true` etc.           |
| Popular PG hubs  | `PG_CITY_CONTENT[city].hubs` (6 per city)                                        | `/pg?city=…&q=…`                        |
| Promo card       | static                                                                           | `/pg`                                   |

**Correction (verified 2026-07-25): the PG panel does get a budget column.** An earlier draft omitted it,
claiming PG had no rent filtering — that check looked at `apps/api/src/modules/pg/`, which is a legacy 308
redirect stub, not the PG search. The real endpoint is `PgPublicController` `@Get("listings")` backed by
`apps/api/src/modules/pg-operator/services/pg-search.service.ts:158-163`, which **does** apply `min_rent`
and `max_rent`. So a sixth column is included:

| Column    | Source            | Href shape              |
| --------- | ----------------- | ----------------------- |
| By budget | category `budget` | `/pg?city=…&max_rent=…` |

Only the _UI_ lacks a budget control — `PgFilters.tsx` exposes just `gender_policy`, `sharing`,
`tenant_type`, `ac`, and `food_included`. The nav is not blocked by that, since `/pg` forwards every search
param straight through to the API. See §11.

### 3.3 Locality linking rule

`popularLocalities` in the rent-in city data are **display names** (`"Gomti Nagar"`), not slugs. They cannot
safely construct `/city/{slug}/{locality}` URLs, and that route 404s on an unknown locality.

- **Lucknow** — link to real `/city/lucknow/{parent_slug}` SEO pages, using the distinct `parent_slug` values
  from `data/seeds/lucknow/micro-localities.json` (34 entries, slugs such as `gomti-nagar`). These seeds
  populate the DB, so the slugs resolve.
- **All other cities** — use `/search?city={slug}&q={encodeURIComponent(name)}`, exactly the shape
  `rent-in/[city]/page.tsx:659` already ships. Zero 404 risk.

This is the right split today: `fetchEnabledCities()` falls back to `["lucknow"]`, so Lucknow is where the
programmatic pages actually exist.

### 3.4 For owners

| Column             | Links                                             |
| ------------------ | ------------------------------------------------- |
| List your property | `/become-owner`, `/pg-operator/become`            |
| Pricing            | `/pricing`                                        |
| Tools              | `/rent-agreement`                                 |
| Learn              | `/how-it-works`, `/faq`, `/blog/category/tenancy` |

### 3.5 Cribliv Times

Narrow desks column plus a wider latest-posts column and a front-page card.

- **Desks** — the 4 non-null entries of `DESKS` from `blog/_components/Masthead.tsx`
  (`data-reports`, `local-guides`, `tenancy`, `market-updates`) → `/blog/category/{slug}`. Static, renders
  instantly.
- **Latest** — up to 4 recent posts, loaded client-side on first hover (§4.4). Absent on first paint,
  filled in on hover, cached for the session. If the request fails the column is omitted and the panel
  degrades to desks plus front page.

### 3.6 City chip

Lists the 8 hub cities, each linking to `/city/{slug}`. `varanasi` is excluded.

### 3.7 Labels

All intent labels come from `label_en` / `label_hi` on `IntentDefinition`, and desk labels from the `en`/`hi`
fields on `DESKS`, so Hindi works without a new translation table.

## 4. Interaction

### 4.1 Open and close

Hover with a 120ms intent delay so cursoring across the bar does not strobe panels open. Click and full
keyboard operation are equally supported. Closing: 200ms grace on mouse-leave with a diagonal safe zone so
moving down-and-across into the panel does not dismiss it; plus Escape, outside pointerdown, and route
change. The last three already exist in `header-menu.tsx:83-108` and are reused, not rewritten.

### 4.2 Switching

Moving between triggers while a panel is open swaps content instantly with no re-animation. Only the first
open animates: 180ms fade plus 4px rise, skipped entirely under `prefers-reduced-motion` — matching the
existing guard at `globals.css:673`.

### 4.3 Surface

One full-width sheet anchored under the bar: `--surface` background, `--shadow-lg`, 1px `--border`,
`--radius-lg` on the bottom corners only, top edge merging with the header border. No scrim — the header's
existing backdrop blur already provides separation.

### 4.4 Times posts route handler

`apps/web/app/api/nav/times/route.ts` — same-origin GET returning up to 4 recent posts (title, slug, desk).
Server-side it calls the existing `fetchBlogList()`; the response is cached with a revalidation window. The
client fetches it once per session on first hover of the Times trigger, and holds the result in module
state. Failure is non-fatal and silent.

## 5. Mobile

**Sheet accordions.** The existing hamburger sheet gains collapsible `Rent` / `PG & Co-living` /
`For owners` sections carrying the identical link set, generated from the same `nav-model` functions. One
source of truth, so nothing is desktop-only. Below 900px the desktop panels never mount.

**Intent chip rail.** A horizontally scrollable rail of intent chips sits under the bar on browse pages only
(`/search`, `/pg`, `/city/*`), rendered from `intentsFor(surface)`.
`components/seo/intent-grid.tsx` already performs this rendering and is reused.

## 6. Code architecture

`header.tsx` is currently one 166-line file already juggling role logic, scroll state, PG-route branching,
and markup. Five panels would make it unmaintainable, so it becomes a folder of focused units.

```
apps/web/lib/nav/
  cities.ts             HUB_CITIES + HUB_CITY_SLUGS — canonical city list
  nav-model.ts          pure sync functions → panel data
apps/web/lib/
  rent-city-content.ts  CITIES extracted out of the rent-in page file
apps/web/components/header/
  header.tsx                 orchestration + scroll state
  nav-menu-bar.tsx           triggers + hover-intent state machine
  nav-panel.tsx              generic column renderer
  times-panel.tsx            desks + client-loaded latest posts
  city-chip.tsx
  search-pill.tsx
  saved-icon.tsx
  mobile-nav-sections.tsx    accordions injected into the existing sheet
  intent-chip-rail.tsx       browse-page rail
apps/web/app/api/nav/times/route.ts
```

**`nav-model.ts` is pure and synchronous.** It takes a locale and a city slug and returns panel data
assembled from `intent-filters.ts`, `rent-city-content.ts`, `PG_CITY_CONTENT`, `DESKS`, and the Lucknow
micro-locality seed. Every link-correctness rule in §C2 is therefore unit-testable without rendering
anything.

**`header-menu.tsx` is extended, not replaced**, so its outside-click, Escape, scroll-lock, and mobile portal
behaviour survive intact.

**Supporting refactors** (in scope because the nav depends on them, and no further):

- Extract `CITIES` from `app/[locale]/rent-in/[city]/page.tsx` into `lib/rent-city-content.ts`; the page
  imports it back. The nav must not import from a page file.
- Introduce `lib/nav/cities.ts` exporting `HUB_CITIES: ReadonlyArray<{slug, label}>` and a derived
  `HUB_CITY_SLUGS: ReadonlyArray<string>`.

**On the five city lists — they are not literal duplicates.** They share a slug set but carry different
payloads, so this is a convergence, not a delete-and-replace:

| Site                                      | Current shape                             | Action                                                                         |
| ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| `sitemap.ts:24` `HUB_CITIES`              | `string[]`                                | replace with `HUB_CITY_SLUGS`                                                  |
| `city/[citySlug]/page.tsx:44` `CITIES`    | `string[]`                                | replace with `HUB_CITY_SLUGS`                                                  |
| `search/page.tsx:53` `CITIES`             | `{slug,label}[]`                          | replace with `HUB_CITIES`                                                      |
| `[locale]/page.tsx` `CITIES`              | `{name,photo,icon,gradient}[]`, 9 entries | keep presentation data; key it by canonical slug                               |
| `lib/search-segment.ts:18` `CITY_ALIASES` | `Record<alias, slug>`                     | **keep as-is** — an alias map (`gurgaon`→`gurugram`) is extra data, not a copy |

The homepage and the alias map are therefore guarded by tests rather than rewritten: every `CITY_ALIASES`
value must be a member of `HUB_CITY_SLUGS`, and every homepage card slug except `varanasi` must be too.

**Typed routes are enabled**, so dynamically composed hrefs need the same `as Route` cast used throughout the
current header.

## 7. Accessibility

Triggers are real `<button>` elements with `aria-expanded` and `aria-controls`. Left/right arrows move
between triggers; Escape closes the panel and returns focus to its trigger. Hover-opening never blocks
keyboard operation. Panel columns are headed groups with accessible names. All motion is behind
`prefers-reduced-motion`.

## 8. CSS fix

`.nav-tab--active::after` at `globals.css:532` is `position: absolute` with `margin-top: 30px` and no
positioned ancestor of its own, so it resolves against `.nav-row`. The active underline's position is
coincidence rather than layout. It becomes a proper `::after` on a `position: relative` tab.

## 9. Testing

**Must keep passing** — the role-aware Post Property logic is unchanged, so these three existing suites are
the regression gate:

- `components/__tests__/header.post-property-gating.test.tsx`
- `components/__tests__/header-menu.pg-split.test.tsx`
- `components/__tests__/header.pg-operator.test.tsx`

**New unit tests, against `nav-model.ts`** (pure, no rendering):

- No emitted PG link is ever `/search?listing_type=pg`.
- No emitted link references `varanasi`.
- Lucknow locality hrefs match `/{locale}/city/lucknow/{slug}` and every slug is present in the
  micro-locality seed's `parent_slug` set.
- Non-Lucknow locality hrefs match `/{locale}/search?city={slug}&q=…`.
- Locale `hi` yields `label_hi` for every intent and desk.
- Every emitted href begins with `/{locale}/`.

**New E2E** (Playwright): panel opens on hover and on click, switches between triggers, closes on Escape with
focus returned to the trigger, and the mobile sheet exposes the same links as the desktop panels.

## 10. Suggested slicing

Shipping unflagged means each slice must leave the header in a releasable state on prod. Three slices:

1. **Foundations, no visible change.** Extract `HUB_CITIES` and `rent-city-content.ts`, point the 5
   city lists at them (see §6), build `nav-model.ts` with its full unit-test suite. Nothing renders
   differently; the model is proven correct before anything consumes it.
2. **The nav itself.** Flex layout replacing absolute centring, CriblMap restyle, active-underline fix, city
   chip, Saved badge with `shortlist-count.ts`, search pill, `nav-menu-bar.tsx` + `nav-panel.tsx` with the
   hover-intent state machine, the Rent / PG / Owners panels, keyboard and ARIA, **and the mobile sheet
   accordions**. The three existing header suites plus new E2E are the regression gate.
3. **Additive polish.** Times panel with its route handler and client hover-load, plus the intent chip rail.

An earlier draft split slice 2 into "bar restructure" and "panels". Merged, for two reasons. A bar-only
release would ship the new layout and the restyled CriblMap with no menus behind the triggers — a visibly
half-finished nav on prod with no flag to hide it. And the mobile sheet accordions cannot trail the desktop
panels: below 900px the panels never mount, so shipping panels without accordions would leave phone users
with the new bar and _less_ navigation than they have today. Desktop and mobile have to land together.

Slice 3 is genuinely additive — Times stays a plain link until its panel exists, and the chip rail is new
surface that nothing else depends on.

## 11. Follow-ups (out of scope)

- **PG budget filtering exists in the API but is not exposed in the UI.** `pg-search.service.ts` applies
  `min_rent`/`max_rent`, and `/pg` forwards them, so the nav's budget links work today — but a user who
  lands on `/pg` has no on-page control to change the range, because `PgFilters.tsx` renders no budget chip.
  Adding one is a small, self-contained UI change. Budget is plausibly the top filter for student and
  working-professional PG seekers.
- Live listing counts beside locality names, once ISR behaviour is measured on Vercel.
- Upgrading non-Lucknow locality links from `/search?…` to real `/city/{slug}/{locality}` pages, once those
  cities have verified locality slugs.
- City-scoped blog columns — `fetchBlogList()` already accepts a `city` param, but there is no
  `/blog/city/{city}` route to link to.
