# CriblMap listing-pin redesign + zoom-repop fix

**Date:** 2026-07-20
**Branch:** `claude/crilbiv-maps-listings-ui-71b726`
**Status:** design locked, ready for implementation plan

## Summary

Redesign how a rental listing reads as a pin on CriblMap, and stop the whole
pin layer from flashing/re-popping on every zoom or pan. Three threads, one
change set:

1. **Pill redesign** — move from the current blue-verified / dark-unverified
   chips to a "price-first minimal" system: clean white price-tag pills where
   price is the hero and trust is a quiet-but-clear accent (Direction B from the
   approved mockup).
2. **Logo at rest** — the pin uses the real brand mark (`/cribliv-logo-new.svg`)
   but shrinks it to 12px inside an 18px white circle, where its own white
   centre dissolves into the circle and it stops reading as the Cribliv logo.
   Fix: drop the white circle and render the real mark directly on the white
   pill at ~16px, where the blue facets frame the white centre and it stays
   unmistakably Cribliv.
3. **Zoom repop** — the layer currently tears down **every** marker and rebuilds
   from scratch whenever `clustered` changes (any zoom step, any refetch),
   re-running the scale-from-0 entrance animation each time. Fix: **marker
   reconciliation** — persist markers across renders and only add/remove/update
   what actually changed.

The mockup harness lives at
`scratchpad/pin-redesign-mockup.html` (a standalone HTML file), used because the
local Browser preview cannot render Google Maps advanced markers (see
`memory/criblmap-markers-invisible-in-preview.md`).

## Problem detail

### Current pin rendering — `ListingPinLayer.tsx`

- `clustered = useMemo(() => clusterPins(pins, zoom), [pins, zoom])` recomputes
  on every `zoom` change and every `pins` change.
- The main `useEffect` depends on `clustered` and, on each run, does
  `for (const m of markersRef.current) m.map = null;` then recreates all markers
  and DOM elements. Combined with the `cmap-pin-enter` CSS animation
  (`globals.css` ~L12691, scale 0 → 1), every zoom step visibly flashes and
  re-animates all pins.
- `useMapPins.ts` refetches on viewport change (debounced 260ms). A refetch
  produces a new `pins` array → another full teardown/rebuild even when the data
  is identical.

### Current trust glyph

`globals.css` `.criblmap-pin__brand` is an 18px white circle; the mark `<img>`
is 12px. At that scale the mark's white centre square (16 of 100 viewbox units)
merges with the white circle, leaving a muddy blue blob. This is the
user-reported "at rest logo is not the real logo."

## Goals

- Pills read at a glance on a crowded, always-light map; price scans fastest.
- Verified listings carry the real Cribliv mark, legible at pin scale.
- Trust tiers, PG, below-market, selected, and cluster states are all visually
  distinct and consistent.
- Zoom/pan no longer causes a visible rebuild — pins stay mounted; only genuinely
  new pins animate in.
- Reconciliation + clustering logic is covered by unit tests (the only reliable
  local verification path for this layer).

## Non-goals

- No change to the pins API (`/listings/search/map`) or the `MapPin` contract.
- No change to the 260ms debounce/refetch behaviour in `useMapPins.ts` — after
  reconciliation, an identical refetch simply produces no DOM churn.
- No new mobile bottom-sheet component: the existing `MapResultsRail` already
  serves as the mobile detail surface (tap a pin → `SELECT_PIN` floats that
  listing to the top of the rail and marks it selected). The hover popover stays
  desktop-only (already suppressed via `@media (hover: none)`).
- No redesign of side panels, filters, overlays, or the results rail beyond an
  optional mark-consistency tweak (listed as a follow-up, not core scope).

## Visual design — Direction B (price-first minimal)

All pills are a white pill (`border-radius: 999px`) with a downward pointer nub,
price as the dominant element, dimensioned type secondary. Values below are the
design target; implementation should route through existing CriblMap CSS custom
properties (`--brand`, `--surface`, `--text-primary`, `--text-secondary`,
`--trust`, the PG violet token) rather than hardcoded hex wherever a token
exists. Pins render on the always-light map canvas (`CRIBLMAP_LIGHT_STYLE`,
`colorScheme: "LIGHT"`), so the pill treatment is designed for a light ground;
the existing dark-mode pin overrides (`globals.css` ~L20890) are pruned to what
still applies since the map never renders dark.

### Base pill (`.criblmap-pin__chip`)

- Background white; `padding: 6px 11px`; `font-size: 13px`; `border-radius: 999px`.
- Price (`.criblmap-pin__price`): weight 800, near-black, letter-spacing -0.01em.
- Type (`.criblmap-pin__type`, e.g. `· 3BHK` / `· PG`): weight 600, muted grey.
- Shadow: `0 3px 10px rgba(9,20,40,.2)`, hairline border `rgba(15,23,42,.06)`.
- **Nub** (`.criblmap-pin__nub`, new): 10px square rotated 45°, white with the
  matching hairline on its two exposed edges, centred under the chip. The pin's
  content is anchored so the nub tip sits on the listing coordinate.

### States

| State            | Treatment                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Verified**     | Real mark (`/cribliv-logo-new.svg`) at 16px leading the chip; blue hairline outline + faint blue glow (`box-shadow: 0 0 0 1px rgba(0,102,255,.28), 0 3px 12px rgba(9,20,40,.2)`).                       |
| **Unverified**   | No mark; grey price + type; softer shadow; slightly reduced scale so it recedes behind verified stock.                                                                                                  |
| **PG**           | Violet outline + a leading violet `PG` token in place of the type prefix. A **verified PG** additionally leads with the mark (`[mark] PG ₹6K`) so trust is not lost; an unverified PG is just `PG ₹6K`. |
| **Below-market** | Green `DEAL` badge pinned to the top-right corner (`bg #10b981`, white, weight 800, 9px), layered on top of whatever tier the pill already is.                                                          |
| **Selected**     | `transform: scale(1.06)`; solid blue ring (`0 0 0 2px var(--brand)`) + raised shadow; top `zIndex`; opens the detail card.                                                                              |

### Cluster (`.criblmap-cluster`)

- Blue gradient bubble (`linear-gradient(180deg,#2b82ff,#0057e0)`), white count,
  weight 800, 2.5px white border, blue drop shadow.
- A small white check follows the count when the cluster contains verified stock.
- `N verified` tag pill below the bubble (white bg, brand-dark text, weight 700).
- Clicking a cluster zooms in +2 and pans to its centroid (unchanged behaviour).

### Detail card

- **Desktop:** the existing hover popover (`.criblmap-pin__preview`), restyled to
  the new card: cover photo, a `Cribliv Verified` pill (real mark + label) for
  verified listings, rent + `/month`, `BHK · furnishing`, title, and
  `View listing` / `Save` actions.
- **Mobile / touch:** no hover. `MapResultsRail` is the detail surface —
  selecting a pin already reorders that listing to the front of the rail and
  marks it selected. No new component.

## Zoom-repop fix — marker reconciliation

Extract the render math into a pure, testable module and replace teardown/rebuild
with a keyed diff.

### New pure module — `apps/web/components/criblmap/lib/pin-render.ts`

- `clusterPins(pins, zoom)` — moved from `ListingPinLayer`, extended to give each
  cluster a **stable id** derived from its grid cell key
  (`${Math.round(lat/gridSize)}_${Math.round(lng/gridSize)}`) instead of an
  anonymous object, so a cluster keeps its identity across renders.
- `renderKey(item)` — `item.id` for a single pin; `cluster:${cellKey}` for a
  cluster.
- `pinSignature(item)` — a string of everything that affects the DOM:
  - pin: `verification_status | listing_type | bhk | monthly_rent | belowMarket`
  - cluster: `count | verifiedCount | lat | lng`
    Selection and opacity are deliberately excluded — they are applied by separate
    in-place passes, so toggling them never triggers a re-render.
- `diffRenderItems(prevKeys, nextItems)` → `{ toAdd, toRemove, toKeep }`.

### `ListingPinLayer` effect (keyed on `clustered`, `map`)

Maintain `recordsRef: Map<key, { item, element, marker, signature }>`.

1. Build `next` items with their `renderKey` + `pinSignature`.
2. **Remove:** keys in records but not in `next` → `marker.map = null`; delete.
3. **Add:** keys in `next` but not in records → create the outer
   `.criblmap-pin` element (entrance animation runs on mount here, and only
   here), its marker, and bind the click handler; store the record.
4. **Update-in-place:** keys in both whose signature changed → replace the
   element's **innerHTML** (chip + preview) and re-bind the click handler, and
   for clusters set `marker.position` to the new centroid. The outer element and
   the `AdvancedMarkerElement` are **not** recreated and the marker is never
   detached from the map, so there is no flash and no re-animation.
5. **Unchanged:** keys in both with an equal signature → no-op. This is what
   eliminates the zoom flash.
6. After the diff, run the selection pass and the opacity pass (below).

### Selection pass (keyed on `selectedPinId`) — mostly unchanged

`applySelectedState` iterates records, sets the selected class + `zIndex` in
place. Must run after reconciliation so freshly-added/updated elements pick up
the current selection.

### Opacity pass (keyed on `demandViewActive`, `reachabilityZones`) — new

Move the demand-view and commute-reachability opacity out of the rebuild into an
in-place pass that sets `element.style.opacity` on single-pin records. Toggling
the demand view or changing the commute filter then updates opacity without any
DOM churn.

## Files to change

- `apps/web/components/criblmap/ListingPinLayer.tsx` — reconciliation loop, new
  markup (chip = mark? + price + type; nub; DEAL badge; restyled preview),
  split selection/opacity passes.
- `apps/web/components/criblmap/lib/pin-render.ts` — **new** pure helpers.
- `apps/web/components/criblmap/lib/__tests__/pin-render.test.ts` — **new** unit
  tests.
- `apps/web/app/globals.css` — rewrite the `.criblmap-pin*` / `.criblmap-cluster`
  blocks (Direction B), add `.criblmap-pin__nub`, `.criblmap-pin__price`,
  `.criblmap-pin__type`, prune the now-unused dark overrides.
- (follow-up, optional) `apps/web/components/criblmap/MapResultsRail.tsx` — give
  `ResultCard` the same verified-mark treatment for visual consistency.

## Testing strategy

Local Google-Maps markers do not render in the Browser preview, so:

- **Unit (Vitest):** `pin-render.test.ts` covers `clusterPins` stable ids across
  re-cluster, `pinSignature` sensitivity/stability, and `diffRenderItems`
  (add/remove/keep partitions, including the pin↔cluster swap at the zoom-14
  threshold). Keep `criblmap-regressions.test.tsx` green.
- **Visual:** the `pin-redesign-mockup.html` harness for pill states; final
  confirmation on a Vercel preview deploy (per project convention).
- **Manual smoke on Vercel:** zoom in/out repeatedly → pins stay put, no flash;
  new pins entering the viewport animate once; selection + demand toggle cause no
  rebuild.

## Accessibility / i18n / performance

- Give each pin element an `aria-label` (e.g. "Verified listing, 3 BHK, ₹14,000
  per month") since the visible text is price-only.
- Respect `prefers-reduced-motion`: suppress the entrance animation.
- Labels ("PG", "/month", "verified") keep current English parity; wiring them to
  `lib/i18n.ts` is a noted future improvement, not in scope.
- Reconciliation strictly reduces DOM work vs. today (500-pin cap unchanged);
  identical refetches become no-ops.

## Risks & rollout

- **In-place `AdvancedMarkerElement` content update** is the load-bearing
  assumption (updating `element.innerHTML` without detaching the marker must not
  flash). Verified on a Vercel preview before merge.
- **Cluster-threshold swap** (zoom 14) still adds/removes the swapped items — this
  is correct and only touches items that actually changed type.
- Ship unflagged as a visual refinement of a live surface; if we want a safety
  valve, the pin markup/CSS can sit behind a `NEXT_PUBLIC_FF_*` flag, decided at
  plan time.

## Resolved decisions

- **Verified-PG mark (resolved 2026-07-21):** include the Cribliv mark on
  verified PGs (`[mark] PG ₹6K`) so a verified PG still visibly earns the trust
  badge. Unverified PGs stay mark-free (`PG ₹6K`).
