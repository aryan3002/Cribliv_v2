# Top Navigation Redesign — Slice 2 (The Nav Itself) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat five-item top bar with the product-led mega-menu nav — city chip, hover panels for Rent / PG / Owners, restyled CriblMap chip, scroll-triggered search pill, Saved badge — on desktop **and** mobile, consuming the data layer slice 1 built.

**Architecture:** `header.tsx` becomes a folder of focused components under `apps/web/components/header/`. All link data comes from slice 1's pure `nav-model.ts` — no fetch is added to anything the layout renders. The one new client-side network call is the Saved badge count, which reuses the request `ListingCardHeart` already makes. Panels are a single full-width sheet driven by a hover-intent state machine with full keyboard support.

**Tech Stack:** TypeScript, Next.js 14 App Router (typed routes on), React client components, Vitest + jsdom + Testing Library, Playwright for E2E, plain CSS in `apps/web/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-07-25-top-nav-redesign-design.md`
**Predecessor:** `docs/superpowers/plans/2026-07-25-top-nav-redesign-slice-1.md` (complete, merged at `49895e9`)

## Global Constraints

- **No server fetch may be added to anything the root layout renders.** The header is in the root layout; a server fetch there forces every page site-wide to render dynamically — the exact cause of a past Vercel Fluid CPU overage. Menu data comes from `nav-model.ts`, which is pure and synchronous. The Saved count is **client-side only**.
- **`--header-height` stays `72px`.** Layout `calc()`s depend on it (e.g. `.ra-layout`).
- **No feature flag.** This ships directly, so every task must leave the header releasable.
- **The role-aware Post Property target is unchanged**: owner → `/owner/dashboard`, `pg_operator` or any `/pg-operator` route → `/pg-operator/listings/new`, everyone else → `/become-owner`.
- **Regression gate, must stay green every task:** `apps/web/components/__tests__/header.post-property-gating.test.tsx`, `header-menu.pg-split.test.tsx`, `header.pg-operator.test.tsx`.
- **All motion behind `prefers-reduced-motion`**, matching the existing guard at `globals.css:673`.
- Typed routes are on — composed hrefs need `as Route`.
- Hindi labels come from `nav-model` (`label_hi` / desk `hi`); any new UI string needs an `en`/`hi` pair via `t(locale, key)` in `apps/web/lib/i18n.ts`.
- Test command: `pnpm --filter @cribliv/web test -- <path>`. Full suite `pnpm --filter @cribliv/web test`. E2E: `pnpm --filter @cribliv/web test:e2e`.

## What slice 1 already gives you

Do not rebuild any of this. All pure, synchronous, fully tested.

```ts
// apps/web/lib/nav/nav-model.ts
interface NavLink  { label: string; href: string }
interface NavColumn{ title: string; links: NavLink[] }
interface NavPanel { id: "rent"|"pg"|"owners"|"times"; columns: NavColumn[] }
type NavLocale = "en" | "hi";

buildRentPanel(locale: NavLocale, citySlug: string): NavPanel   // 4 columns
buildPgPanel(locale: NavLocale, citySlug: string): NavPanel     // 5 columns
buildOwnersPanel(locale: NavLocale): NavPanel                   // 4 columns
buildTimesPanel(locale: NavLocale): NavPanel                    // 1 column (desks) — slice 3 adds latest posts
cityChipLinks(locale: NavLocale): NavLink[]                     // 8 cities → /{locale}/city/{slug}

// apps/web/lib/nav/cities.ts
HUB_CITIES: ReadonlyArray<{slug: string; label: string}>        // 8, ordered
HUB_CITY_SLUGS: ReadonlyArray<string>

// apps/web/lib/nav/localities.ts
localityLinks(locale, citySlug, limit?): NavLink[]

// apps/web/lib/blog-desks.ts
BLOG_DESKS: ReadonlyArray<{slug: string; en: string; hi: string}>
```

## Verified facts this plan depends on

Checked against source 2026-07-25. Do not re-derive.

| Fact                                                                                                                                                    | Evidence                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Guest shortlist lives in `localStorage` key `cribliv:guest-shortlist` via `readGuestShortlist()` / `toggleGuestShortlist()`                             | `apps/web/lib/client-auth.ts:15,57,84`                         |
| Logged-in shortlist: `GET /shortlist` returns `{ items: {id}[]; total: number }` — `total` is the count, no client math needed                          | `apps/web/components/listing-card-heart.tsx:39`                |
| Token resolution: `readAuthSession()?.access_token ?? (session as {accessToken?}).accessToken`                                                          | `listing-card-heart.tsx:25-29`                                 |
| `ListingCardHeart` already calls `trackEvent("shortlist_added"/"shortlist_removed")` on every toggle — the natural notify point                         | `listing-card-heart.tsx:63,71,77`                              |
| The header's CSS surface is ~85 rule blocks in one file                                                                                                 | `apps/web/app/globals.css:402-799`, `:1488-1560`, `:1845-2030` |
| `.nav-center` is `position:absolute; left:50%; transform:translate(-50%,-50%)` and `display:none` below 900px                                           | `globals.css:496-505`, `:685-689`                              |
| `.nav-tab--active::after` is `position:absolute` + `margin-top:30px` with no positioned ancestor of its own — resolves against `.nav-row`               | `globals.css:532-541`                                          |
| `HeaderMenu` already implements outside-pointerdown close, Escape close, route-change close, body-scroll lock, and a `<640px` portal to `document.body` | `header-menu.tsx:83-120,345-357`                               |
| `IntentGrid` builds `{baseHref}/{intent}` SEO-page URLs — **not** `/search?` filter URLs                                                                | `apps/web/components/seo/intent-grid.tsx:13-25`                |

**Correction to the spec (§5).** The spec says the mobile chip rail is "reuse, not new code" because `IntentGrid` already renders it. That is only true on locality/metro/landmark pages, where `/{intent}` routes exist. On `/search` and `/pg` there is no intent route, so the rail must build filter URLs from `nav-model`. Treat the rail as new code that borrows `IntentGrid`'s _visual_ treatment. This is slice 3's problem, not slice 2's.

---

## File Structure

**Create:**

- `apps/web/lib/shortlist-count.ts` — module-level count with subscribe/notify
- `apps/web/components/header/nav-panel.tsx` — presentational column renderer
- `apps/web/components/header/nav-menu-bar.tsx` — triggers + hover-intent state machine + ARIA
- `apps/web/components/header/city-chip.tsx`
- `apps/web/components/header/saved-icon.tsx`
- `apps/web/components/header/search-pill.tsx`
- `apps/web/components/header/mobile-nav-sections.tsx`
- `apps/web/components/header/header.tsx` — orchestration (moved from `components/header.tsx`)
- tests alongside each, under `apps/web/components/header/__tests__/`

**Modify:**

- `apps/web/components/header.tsx` → becomes a one-line re-export of `./header/header` so existing imports and the three regression suites keep working untouched
- `apps/web/components/listing-card-heart.tsx` — notify the count store on toggle
- `apps/web/components/header-menu.tsx` — inject mobile accordion sections
- `apps/web/app/globals.css` — bar layout, CriblMap restyle, panel surface, underline fix
- `apps/web/lib/i18n.ts` — new nav strings, `en` + `hi`
- `apps/web/lib/nav/nav-model.ts` + its test — only in Task 1

Split rationale: the hover-intent state machine (`nav-menu-bar`) and the column rendering (`nav-panel`) change for different reasons — interaction tuning versus visual layout — and the state machine is the only genuinely subtle logic in the slice, so it deserves isolation and its own tests.

---

### Task 1: Resolve the inert filter chip (carried from slice 1)

Slice 1's Rent-panel links carry `listing_type=flat_house`. Two independent reviewers confirmed: `search/page.tsx:227` force-injects `listing_type: "flat_house"` into the API call regardless of the URL, while `:265-271` renders a removable **"Type: Flat/House"** chip whenever the param is merely present. So the chip's remove action is a visible no-op. Nothing rendered these hrefs in slice 1; Task 9 of this slice will.

**Files:**

- Modify: `apps/web/lib/nav/nav-model.ts`
- Modify: `apps/web/lib/nav/__tests__/nav-model.test.ts`

**Interfaces:**

- Consumes: `translateFilters` from `surface-params.ts` (unchanged — the contract module correctly keeps `listing_type`; stripping is a _product_ decision and belongs here)
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Replace the existing assertion in `nav-model.test.ts` that requires `listing_type=flat_house` (in the `"points intent links at /search with the city applied"` test) and add a dedicated one:

```ts
it("omits listing_type from Rent links — /search hard-forces flat_house anyway, and the param only renders a filter chip whose remove is a no-op", () => {
  for (const locale of LOCALES) {
    for (const city of HUB_CITY_SLUGS) {
      for (const link of allLinks(buildRentPanel(locale, city))) {
        expect(link.href, link.label).not.toContain("listing_type=");
      }
    }
  }
});

it("still narrows Rent links by their real filters", () => {
  const twoBhk = allLinks(buildRentPanel("en", "lucknow")).find((l) => l.label === "2 BHK flats");
  expect(twoBhk).toBeDefined();
  expect(twoBhk!.href).toContain("/en/search?");
  expect(twoBhk!.href).toContain("city=lucknow");
  expect(twoBhk!.href).toContain("bhk=2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/nav-model.test.ts`
Expected: FAIL — the first new test finds `listing_type=flat_house` on every Rent link.

- [ ] **Step 3: Strip the param in the model, not the contract module**

In `nav-model.ts`, change `intentLink` so the search surface drops `listing_type`:

```ts
function intentLink(
  intent: IntentDefinition,
  locale: NavLocale,
  surface: NavSurface,
  citySlug: string
): NavLink {
  const params = translateFilters(intent.filters, surface);
  // /search hard-forces listing_type=flat_house server-side
  // (app/[locale]/search/page.tsx:227), so carrying it in the URL changes no
  // results — it only makes app/[locale]/search/page.tsx:265-271 render a
  // "Type: Flat/House" chip whose remove button does nothing. Drop it here, in
  // the product layer; surface-params.ts stays a faithful API contract.
  delete params.listing_type;
  return {
    label: label(intent, locale),
    href: surfaceHref(locale, surface, citySlug, params)
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/nav-model.test.ts`
Expected: PASS.

Then confirm the slice-1 guarantee is untouched:
Run: `pnpm --filter @cribliv/web test -- lib/nav/__tests__/surface-params.test.ts`
Expected: PASS — `surface-params.ts` was not modified.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav/nav-model.ts apps/web/lib/nav/__tests__/nav-model.test.ts
git commit -m "fix(web): drop listing_type from Rent nav links"
```

---

### Task 2: Shared shortlist count

The header badge and every `ListingCardHeart` must agree. Today each heart fetches independently, so a header badge built the same way would go stale the moment a user saves a listing.

**Files:**

- Create: `apps/web/lib/shortlist-count.ts`
- Create: `apps/web/lib/__tests__/shortlist-count.test.ts`
- Modify: `apps/web/components/listing-card-heart.tsx`

**Interfaces:**

- Consumes: `readGuestShortlist` from `lib/client-auth.ts`; `fetchApi` from `lib/api.ts`.
- Produces:
  - `getShortlistCount(): number | null` — `null` means "not yet determined"
  - `subscribeShortlistCount(fn: (n: number | null) => void): () => void`
  - `refreshShortlistCount(token: string | null): Promise<void>`
  - `adjustShortlistCount(delta: number): void`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getShortlistCount,
  subscribeShortlistCount,
  refreshShortlistCount,
  adjustShortlistCount,
  __resetShortlistCountForTests
} from "../shortlist-count";

describe("shortlist count store", () => {
  beforeEach(() => {
    __resetShortlistCountForTests();
    window.localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts undetermined", () => {
    expect(getShortlistCount()).toBeNull();
  });

  it("seeds from localStorage for guests", async () => {
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a", "b"]));
    await refreshShortlistCount(null);
    expect(getShortlistCount()).toBe(2);
  });

  it("notifies subscribers on change", async () => {
    const seen: (number | null)[] = [];
    const unsub = subscribeShortlistCount((n) => seen.push(n));
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a"]));
    await refreshShortlistCount(null);
    expect(seen).toContain(1);
    unsub();
  });

  it("stops notifying after unsubscribe", async () => {
    const seen: (number | null)[] = [];
    const unsub = subscribeShortlistCount((n) => seen.push(n));
    unsub();
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a"]));
    await refreshShortlistCount(null);
    expect(seen).toEqual([]);
  });

  it("adjusts optimistically without a refetch", async () => {
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify(["a"]));
    await refreshShortlistCount(null);
    adjustShortlistCount(1);
    expect(getShortlistCount()).toBe(2);
    adjustShortlistCount(-1);
    expect(getShortlistCount()).toBe(1);
  });

  it("never goes below zero", async () => {
    window.localStorage.setItem("cribliv:guest-shortlist", JSON.stringify([]));
    await refreshShortlistCount(null);
    adjustShortlistCount(-5);
    expect(getShortlistCount()).toBe(0);
  });

  it("ignores an adjust while still undetermined", () => {
    adjustShortlistCount(1);
    expect(getShortlistCount()).toBeNull();
  });

  it("stays undetermined when the logged-in fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await refreshShortlistCount("acc_token");
    expect(getShortlistCount()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/shortlist-count.test.ts`
Expected: FAIL — `Failed to resolve import "../shortlist-count"`.

- [ ] **Step 3: Write the implementation**

```ts
import { readGuestShortlist } from "./client-auth";
import { fetchApi } from "./api";

/**
 * One shared shortlist count for the whole page.
 *
 * Before this module every ListingCardHeart fetched its own saved-state
 * independently, so a header badge built the same way would go stale the
 * instant a user hearted a listing. The header subscribes here; the hearts
 * notify on toggle.
 *
 * `null` means "not determined yet" and must render as no badge at all —
 * distinct from a determined zero, which also renders no badge but for a
 * different reason.
 */
type Listener = (count: number | null) => void;

let count: number | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn(count);
}

export function getShortlistCount(): number | null {
  return count;
}

export function subscribeShortlistCount(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Optimistic local nudge — avoids a refetch on every heart tap. */
export function adjustShortlistCount(delta: number): void {
  if (count === null) return;
  count = Math.max(0, count + delta);
  emit();
}

export async function refreshShortlistCount(token: string | null): Promise<void> {
  if (!token) {
    count = readGuestShortlist().length;
    emit();
    return;
  }
  try {
    const res = await fetchApi<{ items: { id: string }[]; total: number }>("/shortlist", {
      headers: { Authorization: `Bearer ${token}` }
    });
    count = res.total;
    emit();
  } catch {
    // Leave the count as-is. A failed refresh must not blank an existing badge,
    // and must not invent a zero.
  }
}

/** Test-only. */
export function __resetShortlistCountForTests(): void {
  count = null;
  listeners.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/shortlist-count.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Notify from the heart**

In `apps/web/components/listing-card-heart.tsx`, import `adjustShortlistCount` and call it on each successful toggle — beside the existing `trackEvent` calls, in all three branches (guest toggle, logged-in DELETE, logged-in POST):

- guest branch (after `setSaved(result.active)`): `adjustShortlistCount(result.active ? 1 : -1);`
- logged-in DELETE branch (after `setSaved(false)`): `adjustShortlistCount(-1);`
- logged-in POST branch (after `setSaved(true)`): `adjustShortlistCount(1);`

Do not change any other behaviour in that component.

- [ ] **Step 6: Verify the heart still works**

Run: `pnpm --filter @cribliv/web test -- components/__tests__`
Expected: PASS. Any existing heart tests must stay green.

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/shortlist-count.ts apps/web/lib/__tests__/shortlist-count.test.ts apps/web/components/listing-card-heart.tsx
git commit -m "feat(web): shared shortlist count store for the header badge"
```

---

### Task 3: Header CSS foundation

Pure CSS plus the minimal markup changes needed to support it. No new components yet — after this task the bar looks restyled but still has the old five items.

**Files:**

- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/components/header.tsx` (class names only)

**Interfaces:**

- Produces CSS classes consumed by later tasks: `.nav-row`, `.nav-center`, `.nav-spacer`, `.nav-chip`, `.nav-chip--map`, `.nav-chip--times`, `.nav-panel`, `.nav-panel__grid`, `.nav-panel__col`, `.nav-trigger`, `.nav-trigger--open`.

- [ ] **Step 1: Replace absolute centring with a real flex row**

In `globals.css`, delete the `position:absolute; left:50%; top:50%; transform:translate(-50%,-50%)` block from `.nav-center` (`:496-505`). The row becomes:

```css
.nav-row {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
/* Two flexible spacers keep the centre group optically centred while letting
   it grow. The old absolute centring collided as soon as items got wider. */
.nav-spacer {
  flex: 1 1 auto;
  min-width: var(--space-2);
}
.nav-center {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-shrink: 0;
}
```

Keep the existing `@media (max-width: 900px) { .nav-center { display: none } }`.

- [ ] **Step 2: Fix the active underline**

Replace `.nav-tab--active::after` (`:532-541`). The bug: it is `position:absolute` with `margin-top:30px` and no positioned ancestor of its own, so it resolves against `.nav-row` and its position is coincidence.

```css
.nav-tab {
  position: relative;
}
.nav-tab--active::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -6px;
  transform: translateX(-50%);
  width: 28px;
  height: 2px;
  border-radius: 1px;
  background: var(--text-primary);
}
```

- [ ] **Step 3: Restyle CriblMap as the Times chip's sibling**

Replace the whole `.nav-cribmap` block (`:584-683`), deleting the `cribmap-drift` and `cribmap-pulse` keyframes and the `::after` sheen. Both chips become one language — same hairline box, differing only in voice:

```css
/* The two signature chips. Same box, different voice: Times is the editorial
   serif in press red, CriblMap is the live-data sans in brand blue. They read
   as a deliberate pair rather than one chip beside one gradient CTA. */
.nav-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 4px;
  padding: 5px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  font-size: 14.5px;
  font-weight: 700;
  letter-spacing: 0.005em;
  color: var(--text-primary);
  text-decoration: none;
  white-space: nowrap;
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast);
}
.nav-chip svg {
  opacity: 0.7;
}
.nav-chip:hover svg,
.nav-chip--active svg {
  opacity: 1;
}

.nav-chip--times {
  font-family: var(--font-display), Georgia, "Times New Roman", serif;
}
.nav-chip--times:hover,
.nav-chip--times.nav-chip--active {
  color: #c2301c;
  border-color: #c2301c;
  background: rgba(194, 48, 28, 0.05);
}

.nav-chip--map {
  font-size: 13.5px;
}
.nav-chip--map:hover,
.nav-chip--map.nav-chip--active {
  color: var(--brand);
  border-color: var(--brand);
  background: var(--brand-light);
}
/* Live-inventory dot. Static — the pulse animation went with the gradient. */
.nav-chip__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand);
}
```

Keep `.nav-times` and `.nav-cribmap` as aliases **only if** something outside the header uses them — grep first; if nothing does, delete them.

- [ ] **Step 4: Add the panel surface**

```css
.nav-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 8px 14px;
  border: 0;
  background: transparent;
  border-radius: var(--radius-full);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition:
    color var(--transition-fast),
    background var(--transition-fast);
}
.nav-trigger:hover,
.nav-trigger--open {
  color: var(--text-primary);
  background: var(--surface-sunken);
}
.nav-trigger svg {
  transition: transform var(--transition-fast);
}
.nav-trigger--open svg {
  transform: rotate(180deg);
}

.nav-panel {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 60;
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: 0;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  box-shadow: var(--shadow-lg);
  animation: nav-panel-in 180ms ease;
}
@keyframes nav-panel-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.nav-panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--space-6);
  padding: var(--space-6) var(--space-8);
  max-width: var(--container-max);
  margin: 0 auto;
}
.nav-panel__col-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: var(--space-3);
}
.nav-panel__link {
  display: block;
  padding: 5px 0;
  font-size: 14px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: color var(--transition-fast);
}
.nav-panel__link:hover {
  color: var(--brand);
}

@media (prefers-reduced-motion: reduce) {
  .nav-panel {
    animation: none;
  }
  .nav-trigger svg {
    transition: none;
  }
}
```

- [ ] **Step 5: Point the existing markup at the new classes**

In `components/header.tsx`, change the Times link's class from `nav-times` to `nav-chip nav-chip--times` (active → `nav-chip--active`), and CriblMap's from `nav-cribmap` to `nav-chip nav-chip--map`, with the dot span becoming `nav-chip__dot`. Insert `<span className="nav-spacer" />` either side of `<nav className="nav-center">`. Change nothing else.

- [ ] **Step 6: Verify**

Run: `pnpm --filter @cribliv/web test -- components/__tests__`
Expected: PASS — the three header suites assert behaviour and links, not these class names. If one asserts a removed class name, that is a real coupling: update the test and say so in your report.

Run: `pnpm --filter @cribliv/web typecheck` — no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/globals.css apps/web/components/header.tsx
git commit -m "feat(web): flex nav row, matched chip pair, panel surface"
```

---

### Task 4: `nav-panel.tsx` — presentational column renderer

**Files:**

- Create: `apps/web/components/header/nav-panel.tsx`
- Create: `apps/web/components/header/__tests__/nav-panel.test.tsx`

**Interfaces:**

- Consumes: `NavPanel` type from `lib/nav/nav-model.ts`.
- Produces: `<NavPanelView panel={NavPanel} labelledBy={string} onNavigate={() => void} />`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavPanelView } from "../nav-panel";
import { buildRentPanel } from "../../../lib/nav/nav-model";

const panel = buildRentPanel("en", "lucknow");

describe("NavPanelView", () => {
  it("renders every column title", () => {
    render(<NavPanelView panel={panel} labelledBy="t" onNavigate={() => {}} />);
    for (const col of panel.columns) expect(screen.getByText(col.title)).toBeInTheDocument();
  });

  it("renders every link with its real href", () => {
    render(<NavPanelView panel={panel} labelledBy="t" onNavigate={() => {}} />);
    for (const col of panel.columns) {
      for (const link of col.links) {
        expect(screen.getByRole("link", { name: link.label })).toHaveAttribute("href", link.href);
      }
    }
  });

  it("is a labelled group for assistive tech", () => {
    render(<NavPanelView panel={panel} labelledBy="rent-trigger" onNavigate={() => {}} />);
    expect(screen.getByRole("group")).toHaveAttribute("aria-labelledby", "rent-trigger");
  });

  it("calls onNavigate when a link is clicked, so the panel can close", async () => {
    const onNavigate = vi.fn();
    render(<NavPanelView panel={panel} labelledBy="t" onNavigate={onNavigate} />);
    await userEvent.click(screen.getAllByRole("link")[0]);
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("renders nothing for a panel with no columns", () => {
    const { container } = render(
      <NavPanelView panel={{ id: "rent", columns: [] }} labelledBy="t" onNavigate={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- components/header/__tests__/nav-panel.test.tsx`
Expected: FAIL on the missing import.

- [ ] **Step 3: Implement**

```tsx
"use client";

import Link from "next/link";
import type { Route } from "next";
import type { NavPanel } from "../../lib/nav/nav-model";

/**
 * Presentational only. All link data — including every correctness rule about
 * which hrefs are legal — is decided by lib/nav/nav-model.ts. This component
 * must never construct a URL.
 */
export function NavPanelView({
  panel,
  labelledBy,
  onNavigate
}: {
  panel: NavPanel;
  labelledBy: string;
  onNavigate: () => void;
}) {
  if (panel.columns.length === 0) return null;

  return (
    <div className="nav-panel" role="group" aria-labelledby={labelledBy}>
      <div className="nav-panel__grid">
        {panel.columns.map((col) => (
          <div className="nav-panel__col" key={col.title}>
            <p className="nav-panel__col-title">{col.title}</p>
            {col.links.map((link) => (
              <Link
                key={link.href}
                href={link.href as Route}
                className="nav-panel__link"
                onClick={onNavigate}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- components/header/__tests__/nav-panel.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header/nav-panel.tsx apps/web/components/header/__tests__/nav-panel.test.tsx
git commit -m "feat(web): presentational nav panel column renderer"
```

---

### Task 5: `nav-menu-bar.tsx` — triggers, hover intent, keyboard

The only genuinely subtle logic in the slice. Read this task's requirements carefully.

**Files:**

- Create: `apps/web/components/header/nav-menu-bar.tsx`
- Create: `apps/web/components/header/__tests__/nav-menu-bar.test.tsx`

**Interfaces:**

- Consumes: `NavPanelView` (Task 4); `NavPanel` from `nav-model.ts`.
- Produces: `<NavMenuBar items={NavMenuItem[]} />` where

```ts
export interface NavMenuItem {
  id: string; // stable, used for element ids
  label: string;
  panel: NavPanel | null; // null → plain link, no panel
  href?: string; // required when panel is null
  className?: string; // lets the Times / CriblMap chips keep their styling
  active?: boolean;
}
```

Behaviour requirements:

- Hover opens after a **120 ms** intent delay; leaving closes after a **200 ms** grace so a diagonal cursor path into the panel does not dismiss it.
- Moving between triggers while a panel is open swaps content **instantly**, with no re-animation and no delay.
- Click toggles. Escape closes and returns focus to the trigger. Outside pointerdown closes.
- Left/Right arrows move focus between triggers; `Home`/`End` jump to first/last.
- Each trigger is a real `<button>` with `aria-expanded` and `aria-controls`; its `id` is what the panel's `aria-labelledby` points at.
- Items with `panel: null` render as `<Link>`, take part in arrow navigation, and never open anything.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavMenuBar, type NavMenuItem } from "../nav-menu-bar";
import { buildRentPanel, buildPgPanel } from "../../../lib/nav/nav-model";

const items: NavMenuItem[] = [
  { id: "rent", label: "Rent", panel: buildRentPanel("en", "lucknow") },
  { id: "pg", label: "PG", panel: buildPgPanel("en", "lucknow") },
  { id: "map", label: "CriblMap", panel: null, href: "/en/map" }
];

function setup() {
  return {
    user: userEvent.setup({ advanceTimers: vi.advanceTimersByTime }),
    ...render(<NavMenuBar items={items} />)
  };
}

describe("NavMenuBar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders a button per panel item and a link for panel-less items", () => {
    render(<NavMenuBar items={items} />);
    expect(screen.getByRole("button", { name: /rent/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^pg/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /criblmap/i })).toHaveAttribute("href", "/en/map");
  });

  it("starts with every panel closed and aria-expanded false", () => {
    render(<NavMenuBar items={items} />);
    expect(screen.getByRole("button", { name: /rent/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("does not open on a hover shorter than the intent delay", async () => {
    const { user } = setup();
    await user.hover(screen.getByRole("button", { name: /rent/i }));
    vi.advanceTimersByTime(80);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("opens after the intent delay", async () => {
    const { user } = setup();
    await user.hover(screen.getByRole("button", { name: /rent/i }));
    vi.advanceTimersByTime(150);
    await waitFor(() => expect(screen.getByRole("group")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /rent/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens immediately on click, without waiting for hover intent", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("click toggles closed again", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.click(trigger);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("swaps panels instantly when moving to another trigger while open", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    await user.hover(screen.getByRole("button", { name: /^pg/i }));
    expect(screen.getByRole("button", { name: /^pg/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /rent/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("moves focus between triggers with arrow keys", async () => {
    const { user } = setup();
    const rent = screen.getByRole("button", { name: /rent/i });
    rent.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: /^pg/i })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(rent).toHaveFocus();
  });

  it("wraps arrow navigation at both ends", async () => {
    const { user } = setup();
    screen.getByRole("button", { name: /rent/i }).focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("link", { name: /criblmap/i })).toHaveFocus();
  });

  it("links the panel to its trigger for assistive tech", async () => {
    const { user } = setup();
    const trigger = screen.getByRole("button", { name: /rent/i });
    await user.click(trigger);
    expect(screen.getByRole("group")).toHaveAttribute("aria-labelledby", trigger.id);
    expect(trigger).toHaveAttribute("aria-controls", screen.getByRole("group").id);
  });

  it("closes when a panel link is followed", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /rent/i }));
    await user.click(screen.getAllByRole("link", { name: /BHK|Flats/i })[0]);
    await waitFor(() => expect(screen.queryByRole("group")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- components/header/__tests__/nav-menu-bar.test.tsx`
Expected: FAIL on the missing import.

- [ ] **Step 3: Implement**

```tsx
"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { NavPanel } from "../../lib/nav/nav-model";
import { NavPanelView } from "./nav-panel";

export interface NavMenuItem {
  id: string;
  label: string;
  panel: NavPanel | null;
  href?: string;
  className?: string;
  active?: boolean;
}

const OPEN_DELAY_MS = 120;
const CLOSE_GRACE_MS = 200;

export function NavMenuBar({ items }: { items: NavMenuItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLElement>());

  const clearTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // Hover open. If a panel is already open, switching triggers is instant —
  // the delay exists to stop a cursor crossing the bar from strobing panels,
  // and once one is open that ambiguity is gone.
  const hoverOpen = useCallback(
    (id: string) => {
      clearTimer();
      if (openId !== null) {
        setOpenId(id);
        return;
      }
      timer.current = setTimeout(() => setOpenId(id), OPEN_DELAY_MS);
    },
    [openId, clearTimer]
  );

  // Grace period so a diagonal path from trigger into the panel body doesn't
  // dismiss it mid-move.
  const hoverClose = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => setOpenId(null), CLOSE_GRACE_MS);
  }, [clearTimer]);

  const close = useCallback(() => {
    clearTimer();
    setOpenId(null);
  }, [clearTimer]);

  useEffect(() => {
    if (openId === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const id = openId;
      close();
      triggerRefs.current.get(id)?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openId, close]);

  const onTriggerKeyDown = (e: React.KeyboardEvent, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    let next: number | null = null;
    if (delta !== 0) next = (index + delta + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    triggerRefs.current.get(items[next].id)?.focus();
  };

  const openItem = items.find((i) => i.id === openId) ?? null;

  return (
    <div className="nav-center" ref={rootRef} onMouseLeave={hoverClose} onMouseEnter={clearTimer}>
      {items.map((item, index) => {
        const triggerId = `nav-trigger-${item.id}`;
        const panelId = `nav-panel-${item.id}`;
        const isOpen = openId === item.id;
        const ref = (el: HTMLElement | null) => {
          if (el) triggerRefs.current.set(item.id, el);
          else triggerRefs.current.delete(item.id);
        };

        if (!item.panel) {
          return (
            <Link
              key={item.id}
              id={triggerId}
              ref={ref as React.Ref<HTMLAnchorElement>}
              href={(item.href ?? "/") as Route}
              className={item.className ?? "nav-tab"}
              onMouseEnter={hoverClose}
              onKeyDown={(e) => onTriggerKeyDown(e, index)}
            >
              {item.label}
            </Link>
          );
        }

        return (
          <button
            key={item.id}
            id={triggerId}
            ref={ref as React.Ref<HTMLButtonElement>}
            type="button"
            className={`nav-trigger${isOpen ? " nav-trigger--open" : ""}`}
            aria-expanded={isOpen}
            aria-controls={panelId}
            onMouseEnter={() => hoverOpen(item.id)}
            onClick={() => (isOpen ? close() : (clearTimer(), setOpenId(item.id)))}
            onKeyDown={(e) => onTriggerKeyDown(e, index)}
          >
            <span>{item.label}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        );
      })}

      {openItem?.panel && (
        <div id={`nav-panel-${openItem.id}`} onMouseEnter={clearTimer} onMouseLeave={hoverClose}>
          <NavPanelView
            panel={openItem.panel}
            labelledBy={`nav-trigger-${openItem.id}`}
            onNavigate={close}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- components/header/__tests__/nav-menu-bar.test.tsx`
Expected: PASS, 12 tests.

If a timing test is flaky under fake timers, do **not** delete it — make the delay constants importable and assert against them rather than hard-coded numbers.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header/nav-menu-bar.tsx apps/web/components/header/__tests__/nav-menu-bar.test.tsx
git commit -m "feat(web): nav menu bar with hover intent and keyboard support"
```

---

### Task 6: City chip

**Files:**

- Create: `apps/web/components/header/city-chip.tsx`
- Create: `apps/web/components/header/__tests__/city-chip.test.tsx`

**Interfaces:**

- Consumes: `cityChipLinks(locale)` from `nav-model.ts`; `usePathname` to derive the current city.
- Produces: `<CityChip locale={NavLocale} />`

Behaviour: renders a `<button>` labelled with the current city (derived from the pathname — `/{locale}/city/{slug}`, `/{locale}/pg/{slug}`, or `/{locale}/rent-in/{slug}`; defaults to `Lucknow`), opening a small popover listing all 8 cities. Reuses the same close-on-Escape / close-on-outside-pointerdown pattern as `NavMenuBar`. Hidden when the header is in its scrolled state (Task 9 controls that via a prop).

- [ ] **Step 1: Write the failing test**

Cover: renders the default city when the path has none; derives the city from `/en/city/jaipur`, `/en/pg/noida` and `/en/rent-in/delhi`; opens on click and lists exactly 8 cities; each links to `/{locale}/city/{slug}`; Varanasi is absent; closes on Escape returning focus to the button; renders nothing when `hidden` is true.

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL on the missing import.

- [ ] **Step 3: Implement.** Derive the city with a single regex over the pathname; get links from `cityChipLinks(locale)`; never construct a URL locally.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header/city-chip.tsx apps/web/components/header/__tests__/city-chip.test.tsx
git commit -m "feat(web): header city chip"
```

---

### Task 7: Saved icon with count badge

**Files:**

- Create: `apps/web/components/header/saved-icon.tsx`
- Create: `apps/web/components/header/__tests__/saved-icon.test.tsx`

**Interfaces:**

- Consumes: `getShortlistCount` / `subscribeShortlistCount` / `refreshShortlistCount` (Task 2); `useSession`; `readAuthSession`.
- Produces: `<SavedIcon locale={NavLocale} />`

Behaviour: a `<Link>` to `/{locale}/shortlist` with a heart icon. On mount, resolves the token exactly as `ListingCardHeart` does and calls `refreshShortlistCount`. Subscribes for updates. Renders a badge **only** when the count is a determined number greater than zero — `null` (undetermined) and `0` both render no badge. Counts above 9 render as `9+`. `aria-label` includes the count when there is one.

- [ ] **Step 1: Write the failing test**

Cover: no badge while undetermined; no badge at zero; badge shows `3`; badge shows `9+` for 12; badge updates live when `adjustShortlistCount` fires; `aria-label` mentions the count; unsubscribes on unmount (no state update warning in the output).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run to verify it passes.** Test output must be pristine — a React "state update on unmounted component" warning is a real bug in the subscription cleanup, not noise to ignore.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header/saved-icon.tsx apps/web/components/header/__tests__/saved-icon.test.tsx
git commit -m "feat(web): saved icon with live shortlist badge"
```

---

### Task 8: Search pill

**Files:**

- Create: `apps/web/components/header/search-pill.tsx`
- Create: `apps/web/components/header/__tests__/search-pill.test.tsx`

**Interfaces:**

- Consumes: `useSearchParams`, `usePathname`; `HUB_CITIES` for city labels.
- Produces: `<SearchPill locale={NavLocale} />`

Behaviour, derived synchronously from the URL — no fetch, no state. Summary precedence:

1. `q` present → use it verbatim.
2. Otherwise compose from `bhk` + `locality`/`city`: `2 BHK in Gomti Nagar`.
3. Append `max_rent` as `· Under ₹20k` when present.
4. Nothing recognised → the placeholder from `t(locale, "navSearchPlaceholder")`.

City and locality slugs resolve to display names through `HUB_CITIES`; an unrecognised slug renders its raw value rather than blanking. The pill links to `/{locale}/search` preserving the current params when already on a search-like route, else to bare `/{locale}/search`.

- [ ] **Step 1: Write the failing test**

Cover each precedence branch, the `9`→`₹9k` style formatting, an unknown city slug rendering raw, the empty-params placeholder, and Hindi placeholder selection.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.** Add `navSearchPlaceholder` (and any other new string) to both `en` and `hi` in `apps/web/lib/i18n.ts`.

- [ ] **Step 4: Run to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header/search-pill.tsx apps/web/components/header/__tests__/search-pill.test.tsx apps/web/lib/i18n.ts
git commit -m "feat(web): scroll-state search pill"
```

---

### Task 9: Compose the header

The integration task. After this, the new nav is live.

**Files:**

- Create: `apps/web/components/header/header.tsx`
- Modify: `apps/web/components/header.tsx` → `export { Header } from "./header/header";`
- Create: `apps/web/components/header/__tests__/header.composition.test.tsx`

**Interfaces:**

- Consumes: every component from Tasks 4–8, plus `buildRentPanel` / `buildPgPanel` / `buildOwnersPanel` / `buildTimesPanel`.
- Produces: `<Header locale={Locale} />` — same public signature as today.

Requirements:

- Move the existing `header.tsx` body across unchanged **except** the centre nav, preserving the scroll listener, the PG-operator route branch, `hostLinkHref` / `hostLinkLabel` / `hostLinkShort`, `isActive`, `BrandLockup`, `lang-pill` and `HeaderMenu` exactly.
- Keeping `components/header.tsx` as a re-export means the three regression suites and every existing import keep working with no edits. **Do not modify those three test files.**
- Build the menu items: `Rent` and `PG & Co-living` and `For owners` get panels; `CriblMap` is a panel-less item with `className="nav-chip nav-chip--map"`; `Cribliv Times` is panel-less in this slice with `className="nav-chip nav-chip--times"` (slice 3 gives it a panel).
- The current city for `buildRentPanel` / `buildPgPanel` comes from the pathname, defaulting to `lucknow` — same derivation as the city chip, so **extract that helper into `lib/nav/current-city.ts` in this task** rather than duplicating it.
- Scrolled state (existing `scrolled` boolean, `window.scrollY > 8`): hide `CityChip` and the `lang-pill`, show `SearchPill`. On non-home routes, show the pill regardless of scroll.
- Below 900px the panels must not mount at all.

- [ ] **Step 1: Write the failing test**

Cover: renders all five centre items on desktop; `Rent` opens a panel containing a real locality link; the search pill is absent at scroll 0 on `/en` and present after scrolling; the city chip is present at rest and gone when scrolled; Post Property href for each of guest / owner / pg_operator / tenant / admin (mirroring the existing gating suite's fixtures, so a regression shows up here too).

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cribliv/web test` — the **full** suite. This is the integration point; the three regression suites must be green.
Run: `pnpm --filter @cribliv/web typecheck` — no errors.
Run: `pnpm --filter @cribliv/web build` — must succeed, and **no route may flip from static (`○`/`●`) to dynamic (`ƒ`)**. A flip means something in the header pulled a server call into the layout — the constraint this whole design exists to protect. Compare against slice 1's baseline: `/city/{slug}` prerenders 16 pages.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header apps/web/components/header.tsx apps/web/lib/nav/current-city.ts
git commit -m "feat(web): compose the mega-menu header"
```

---

### Task 10: Mobile sheet accordions

Below 900px the desktop panels never mount, so without this task phone users get the new bar with **less** navigation than before. This task is what makes slice 2 shippable.

**Files:**

- Create: `apps/web/components/header/mobile-nav-sections.tsx`
- Create: `apps/web/components/header/__tests__/mobile-nav-sections.test.tsx`
- Modify: `apps/web/components/header-menu.tsx`
- Modify: `apps/web/app/globals.css` (accordion styles)

**Interfaces:**

- Consumes: the same `buildRentPanel` / `buildPgPanel` / `buildOwnersPanel` output as desktop — one source of truth, no mobile-only link list.
- Produces: `<MobileNavSections locale={NavLocale} citySlug={string} onNavigate={() => void} />`

Behaviour: three collapsible sections rendered inside the existing `HeaderMenu` sheet, above its current `explore` section. Each is a `<button aria-expanded aria-controls>` over a region listing that panel's columns and links. Only one open at a time. Selecting a link closes the whole sheet via `onNavigate`.

- [ ] **Step 1: Write the failing test**

Cover: all three section headers render; sections start collapsed; clicking expands and sets `aria-expanded`; opening a second collapses the first; **every link in the desktop `buildRentPanel` output also appears here** (the parity assertion that keeps mobile from falling behind); clicking a link calls `onNavigate`.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement and inject into `HeaderMenu`.** Insert above the existing `explore` section; do not disturb the account/primary/footer sections or the existing close/scroll-lock effects.

- [ ] **Step 4: Verify**

Run: `pnpm --filter @cribliv/web test -- components/__tests__ components/header/__tests__`
Expected: PASS, including `header-menu.pg-split.test.tsx` unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/header/mobile-nav-sections.tsx apps/web/components/header/__tests__/mobile-nav-sections.test.tsx apps/web/components/header-menu.tsx apps/web/app/globals.css
git commit -m "feat(web): mobile nav accordions in the header sheet"
```

---

### Task 11: Slice gate and E2E

**Files:**

- Create: `apps/web/tests/e2e/top-nav.spec.ts`

- [ ] **Step 1: Write the E2E spec**

Cover, against a running dev server: hovering `Rent` opens a panel; moving to `PG` swaps it; Escape closes it; a panel link navigates to a URL containing the expected filter params; at mobile viewport the hamburger sheet exposes the same Rent links; the Saved badge appears after hearting a listing.

- [ ] **Step 2: Run the E2E suite**

Run: `pnpm --filter @cribliv/web test:e2e -- top-nav.spec.ts`
Expected: PASS. If Playwright browsers are missing: `pnpm --filter @cribliv/web exec playwright install`.

- [ ] **Step 3: Full quality gate**

```bash
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/web lint
pnpm --filter @cribliv/web test
pnpm --filter @cribliv/web build
```

All must pass. On the build, re-check the route table against slice 1's baseline — nothing may flip to dynamic.

- [ ] **Step 4: Manual visual check**

Use the Browser preview tools, not a manual request to the user. Verify at 1280px and at 375px: the bar's spacing, both chips reading as a pair, a panel opening, the mobile sheet accordions. Capture a screenshot for the report.

Note: the CriblMap map itself does not render markers in the local preview (a known local-only issue) — do not treat that as a regression from this slice.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/e2e/top-nav.spec.ts
git commit -m "test(web): E2E coverage for the mega-menu nav"
```

---

## Self-review notes

- **Spec coverage.** §1 bar anatomy → Tasks 3, 9. §1.1 Saved badge → Tasks 2, 7. §2 chip language → Task 3. §3 panel contents → consumed from slice 1, rendered in Tasks 4, 9. §4 interaction → Task 5. §5 mobile → Task 10. §7 accessibility → Task 5 (arrow keys, ARIA), Tasks 6, 7, 10. §8 CSS fix → Task 3. §9 testing → every task, plus Task 11.
- **Deliberate deviation from the spec.** §3.1 lists a promo card in the Rent panel; `nav-model` returns four columns without one. The promo card is presentation, so if it is wanted it belongs in `NavPanelView` as a per-panel prop — not in the model. Left out of this slice; raise it as a product question rather than inventing it.
- **Task 1 reverses a slice-1 decision** on purpose. The slice-1 Task 5 reviewer's reasoning still holds: `surface-params.ts` must keep `listing_type` because the API accepts it. Stripping it is a product decision, so it lives in `nav-model.ts`. Both facts are consistent.
- **Type consistency.** `NavLocale` (`"en"|"hi"`) is the model's locale type; the app's own `Locale` from `lib/i18n` is the component-facing one. They are structurally identical today — Task 9 must not silently widen either. `NavLink` / `NavColumn` / `NavPanel` come only from `nav-model.ts`.
