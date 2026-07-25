# Final fix wave — top navigation redesign

Closes the three Important and three Minor findings from
`.superpowers/sdd/s23-final-review-report.md`. Nothing here changes bundling;
no production build was needed.

**Gate after the wave:** typecheck clean · 247 test files / 1539 unit tests
passing · `top-nav.spec.ts` 11/11, seven consecutive runs · lint unchanged
(only pre-existing warnings, none in touched files).

All browser measurements below are Chromium 1280×800 against the dev server on
this branch, `document.fonts.ready` plus a settle delay before reading boxes.

---

## I-1 · Panel opening shifted the row, and Escape did not latch hover off

### (a) The geometry shift — confirmed, with one correction to the review

The mechanism the review identified is exactly right: `.nav-center` is
`display:flex; gap: var(--space-1)` (4px), and the open panel's wrapper was its
last flex item. `.nav-panel` is `position:absolute`, so the wrapper's own box
was 0×0 — but it still consumed one flex gap purely by existing.

Measured `.nav-center` width, closed → open, **before the fix**:

| Route | closed | open | delta |
|---|---|---|---|
| `/en` | 615.78 | 619.78 | **+4.00** |

**Correction to the review's stated consequence.** The report says "every
trigger moves 2px left on open". That is true, but *not on the homepage*, and
the homepage is where `top-nav.spec.ts` runs. `.nav-row`'s two `flex: 1 1 auto`
spacers can only redistribute the 4px if the row has free space. On `/en`
logged-out the row is **over-full** — both spacers are pinned at their
`min-width: 8px` and free space is negative — so the 4px instead pushes the
right-hand `nav-actions` cluster 4px right and overflows the container.

Trigger x-position (`#nav-trigger-rent`), closed → open, **before the fix**:

| Route | free space | closed | open | delta |
|---|---|---|---|---|
| `/en` (city chip, over-full) | −12 to −15 | 288.88 | 288.88 | 0.00 |
| `/hi` (over-full) | −12.14 | 288.88 | 288.88 | 0.00 |
| `/en/search?city=lucknow` | +47.99 | 312.98 | **310.98** | **−2.00** |
| `/en/pg` | +48.00 | 329.86 | **327.86** | **−2.00** |

So the −2px shift is real and reproduces exactly as the review measured, but
only on the inner pages, where the compact search pill replaces the wider city
chip and leaves the spacers something to give back. (The review's own figures,
488.16 → 492.16, are from a synthetic page; the +4px delta matches the real
header exactly, the absolute widths do not.)

**Fix.** The wrapper is now `.nav-panel-mount { display: contents }`
(`apps/web/app/globals.css`, immediately above `.nav-panel`). Its box leaves the
flex flow entirely; `.nav-panel` becomes a direct child of `.nav-center` and,
being absolutely positioned, is out-of-flow and contributes no gap of its own.
Not `position: absolute` on the wrapper — that would make it the panel's
containing block and move the panel.

**After the fix**, every one of the above deltas is `0.00`, and the row's free
space is byte-identical open vs closed (`/en/search` 47.99 → 47.99, `/hi`
−12.14 → −12.14; it previously went −12.14 → −16.14):

| Route | `.nav-center` closed → open | rent x closed → open |
|---|---|---|
| `/en` | 615.78 → **615.78** (Δ0) | 288.88 → 288.88 (Δ0) |
| `/en/search?city=lucknow` | — | 312.98 → **312.98** (Δ0) |
| `/en/pg` | — | 329.86 → **329.86** (Δ0) |
| `/hi` | — | 288.88 → 288.88 (Δ0) |

### (b) The Escape latch

`hoverSuppressed` ref in `nav-menu-bar.tsx`. Set on Escape — and only when the
pointer is actually on the bar (`pointerInsideBar`), so a keyboard user whose
mouse is elsewhere is not left with dead hover. Checked in `hoverOpen` *after*
the "a panel is already open, swap instantly" branch, so switching triggers is
never blocked. Released on `.nav-center`'s mouseleave.

Deliberately **not** released on `.nav-center`'s mouseenter: moving from the
gap beside a trigger onto the trigger does not fire that, so releasing there
would look correct while doing nothing in precisely the case the latch exists
for.

### Visual verification (constraint: appearance must not change)

Panel box with the panel open, before vs after — identical:

| Panel | x | y | w | h |
|---|---|---|---|---|
| Rent (before & after) | 0 | 71 | 1280 | 337.72 |
| Times (before & after) | 0 | 71 | 1280 | 208.16 |

`offsetParent` is `.container.nav-row` in both, `z-index: 60`, `position:
absolute` — unchanged. The Times panel's `role="group"` box also stays non-zero
(337.72 / 208.16), so the S3-Task-4 regression it guards stays fixed.

Pixel diff of the top 1280×460 of the page with a panel open, reduced-motion,
before vs after:

| Shot | differing px | diff bounding box |
|---|---|---|
| `/en` + Rent panel | 2270 / 588800 | x 945–1275, **y 15–56** |
| `/en` + Times panel | 2270 / 588800 | x 945–1275, **y 15–56** |
| `/en/pg` + PG panel | 5087 / 588800 | x 223–926, y 16–54 |

Every differing pixel is above y=57; the panel starts at y=71, so **not one
panel pixel changed**. The `/en` diff is the `nav-actions` cluster at x≥945 —
i.e. exactly the 4px jump this fix removes. The `/en/pg` diff is the search
pill and the nav group it displaces, which is I-3's intended change.

---

## I-2 · Tab order

Verified the review's premise before relying on it: `.nav-panel` resolves its
`offsetParent` to `.container.nav-row`, not to its DOM parent, so moving it is
a pure DOM-order change. The measurement above proves it — panel box identical
after the move.

The panel now renders inside the `items.map()` immediately after its own
trigger (each panel item is wrapped in a keyed `<Fragment>`), instead of once
after the whole row.

Measured on `/en` with the Rent panel open:

| | before | after |
|---|---|---|
| `.nav-center` child order | rent, pg, map, times, owners, **div** | rent, **div**, pg, map, times, owners |
| Tab from expanded Rent lands on | `<button>` "PG & Co-living", `aria-expanded=false`, outside panel | `<a>` "1 BHK flats", **inside the panel** |
| Tabs to reach first panel link | **5** | **1** |

---

## I-3 · Search pill on the PG surface

`isSearchLikeRoute` (boolean) became `searchSurface()` returning
`"search" | "pg" | null`, so the pill knows *which* surface it is on rather than
just that it is on one.

- **Target.** On `/{locale}/pg` the pill now links to `/{locale}/pg?<qs>`.
  Previously `/en/pg?sharing=double` sent the visitor to
  `/en/search?sharing=double`, which forces `listing_type=flat_house` and has no
  `sharing` filter at all — silently swapping PG inventory for unfiltered flats.
- **Summary.** On `/pg` the pill reads the params that surface actually honours
  (`gender_policy`, `sharing`, `tenant_type` — the PG_PARAMS vocabulary from
  `lib/nav/surface-params.ts`, in the order `components/pg/PgFilters.tsx` shows
  them) instead of the flats-only `bhk`. Closed-vocabulary lookup maps, so an
  unrecognised value is skipped rather than title-cased into the header;
  `tenant_type=any` is the no-op default and adds nothing.
  `/en/pg?gender_policy=girls&sharing=single&tenant_type=students&city=lucknow&max_rent=12000`
  now reads "Girls PG · Single sharing · For students in Lucknow · Under ₹12k".
- **Placeholder.** New i18n key `navSearchPlaceholderPg` (`en` "Search PGs" /
  `hi` "पीजी खोजें") — "Search rentals" misdescribed the surface.

`search-pill.test.tsx:111` pinned the broken behaviour as intended; it is now a
regression test asserting `/en/pg?sharing=double`. I re-read the rest of that
file: no other assertion encoded the same assumption (the two remaining
`/en/search` href tests are on `/en` and `/en/search`, both still correct).
Eight further cases added, including one proving PG params are *not* read on
`/search`.

---

## Minors

**`surfaceHref`'s comment** (`lib/nav/nav-model.ts`) — the claim "params sorted
for stable output" was false; nothing sorts. Dropped the claim rather than
adding a `.sort()`, since sorting would reorder every generated href and the
determinism the tests rely on already comes from `URLSearchParams` insertion
order. The comment now says that.

**`tenant_type` pinning** (`lib/nav/__tests__/nav-model.test.ts`) — added a test
asserting the label→param pairing per link (not `hrefs.some(...)`, which both
arms satisfy either way round), plus that the gendered pair picks up no
`tenant_type` at all. **Proved it fails:** swapping the two ternary arms in
`buildPgPanel` turns the suite red with
`expected '/en/pg?city=lucknow&tenant_type=working' to contain 'tenant_type=students'`
(1 failed / 36 passed); restored, 37 passed.

**React ref warning** (`components/__tests__/header.post-property-gating.test.tsx`)
— the `next/link` stub now uses `forwardRef`, mirroring
`components/header/__tests__/header.composition.test.tsx`. Stub only; no
assertion touched. Fixing the ref warning exposed a second, pre-existing one
("Received `false` for a non-boolean attribute `prefetch`") from the same stub
spreading `prefetch` onto a bare `<a>`; dropped it the same way the composition
stub does. That file now runs with no React warnings at all.

---

## E2E: `locator.hover()` restored — and what the flake actually was

`hoverTrigger` now calls `trigger.hover()`. The `page.mouse.move()` workaround
is gone.

- **Post-fix, `locator.hover()`: 7 consecutive full runs, 11/11 each.**
- Three new tests: Escape-stays-closed under a one-pixel resting-pointer
  tremor; opening a panel does not move the nav row (on `/en/search`, where the
  −2px shift was reproducible); Tab from an expanded trigger lands in the panel.

**I could not confirm that I-1 caused the historical flake, and I am not
claiming it did.** I ran the control: pre-fix code with `locator.hover()`
restored, 3 full runs plus 5 filtered runs — the Escape tests passed every
time. Only the two new geometry/tab-order tests failed, as designed. So the
reopen did not reproduce on the *unfixed* code either, which means my 7 clean
runs are evidence that the workaround is removable, not evidence of causation.

The honest summary: the flake is not reproducible in this environment today, on
either side of the fix. `locator.hover()` is safe to keep. The comment on
`hoverTrigger` has been rewritten to describe the latch and the geometry fix,
and the reopen is now pinned by a real product-level regression test rather than
by a workaround.

This does leave the original symptom unexplained. If it resurfaces, the
resting-pointer test is the place it will show up first.

## Test discrimination

Every new latch test was mutation-checked; each mutation kills exactly one:

| Mutation | Test that fails |
|---|---|
| delete `if (hoverSuppressed.current) return;` | stays closed when the pointer re-enters after Escape |
| never release the latch on bar leave | re-arms hover once the pointer leaves and re-enters |
| `hoverSuppressed = true` unconditionally | does not latch when Escape is pressed with the pointer off the bar |

Worth recording, because it cost two wrong attempts: **jsdom/userEvent leave
`relatedTarget` null**, and React uses it to decide how far up the tree to
synthesise enter/leave — null means "from outside the document", so under
userEvent every move fires enter and leave on the whole ancestor chain,
`.nav-center` included. An intra-bar pointer move is therefore unsimulatable
with `user.pointer`. Worse, React emits *both* sides from the `mouseout` event
and early-returns on `mouseover` whenever its relatedTarget is React-managed, so
a `mouseover`-driven simulation dispatches nothing and passes regardless of the
component. The tests dispatch `fireEvent.mouseOut` with an explicit
`relatedTarget` (and `mouseOver` only for the leg whose other node is outside
React's tree). All of this is written into the test file.

## Constraints held

No client component value-imports `nav-model.ts` / `nav-data.ts` / the
city-prose modules. No server fetch or unsuspended `useSearchParams` added.
Typed routes still satisfied (`as Route`). The one new UI string has an `en`/`hi`
pair. No new motion. Mock-resetting hooks untouched, and no new ones added.
