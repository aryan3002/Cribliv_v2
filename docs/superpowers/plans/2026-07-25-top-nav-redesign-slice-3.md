# Top Navigation Redesign — Slice 3 (Additive Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cribliv Times a real hover panel — the four desks plus the latest posts, loaded client-side on first hover — and add a horizontally scrollable intent chip rail to browse pages.

**Architecture:** Everything here is additive. Until it lands, Cribliv Times stays the plain serif chip link slice 2 shipped, and browse pages have no rail; nothing else depends on either. The one new network call is deliberately client-side and same-origin: a Next route handler under `apps/web/app/api/` that server-fetches the blog list and caches it, so the header never triggers a server fetch and the browser never hits the API's CORS allowlist.

**Tech Stack:** TypeScript, Next.js 14 App Router route handlers, React client components, Vitest + jsdom + Testing Library, plain CSS in `apps/web/app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-07-25-top-nav-redesign-design.md` (§3.5, §4.4, §5)
**Predecessors:** slice 1 (`docs/superpowers/plans/2026-07-25-top-nav-redesign-slice-1.md`, merged), slice 2 (`docs/superpowers/plans/2026-07-25-top-nav-redesign-slice-2.md`)

## Global Constraints

- **No server fetch may be added to anything the root layout renders.** The header is in the root layout. The Times posts load **client-side, on first hover only** — never during SSR, never in a `use client` component's initial render path that runs on the server.
- **Same-origin only for the browser.** `cribliv.com` is not in the API's browser CORS allowlist, so a direct browser→API call fails in production. The client fetches `/api/nav/times` on the web app's own origin; that handler does the API call server-side.
- **The panel must degrade silently.** If the request fails, times out, or returns nothing, the panel renders desks-only. A blog outage must never break the header.
- **`--header-height` stays `72px`.** No feature flag. Motion behind `prefers-reduced-motion`.
- Typed routes are on — composed hrefs need `as Route`.
- Any new UI string needs an `en`/`hi` pair in `apps/web/lib/i18n.ts`.
- **Regression gate:** `apps/web/components/__tests__/header.post-property-gating.test.tsx`, `header-menu.pg-split.test.tsx`, `header.pg-operator.test.tsx`, plus everything slice 2 added under `apps/web/components/header/__tests__/`.
- Test command: `pnpm --filter @cribliv/web test -- <path>`.

## What slices 1 and 2 already give you

- `buildTimesPanel(locale): NavPanel` — one column, the four desks, from `BLOG_DESKS`. This slice **extends** its rendering; it does not replace the builder.
- `NavPanelView` — presentational column renderer.
- `NavMenuBar` with `NavMenuItem { id, label, panel, href, className, active }` — Times currently passes `panel: null`.
- `BLOG_DESKS: ReadonlyArray<{slug, en, hi}>` in `apps/web/lib/blog-desks.ts`.
- `nav-model.ts` — all link construction. This slice must not build a URL outside it, except the blog post permalinks, which come from the API response.

## Verified facts this plan depends on

Checked against source 2026-07-25.

| Fact                                                                                                                                    | Evidence                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `fetchBlogList({ page, page_size, category, city })` exists and accepts a `revalidate` opt                                              | `apps/web/lib/blog-api.ts`                                        |
| Blog posts carry `city_slug`; there is **no** `/blog/city/{city}` route, so `city` is API-only                                          | slice 1 route taxonomy audit                                      |
| Blog post permalinks are `/{locale}/blog/{slug}`                                                                                        | `apps/web/app/[locale]/blog/[slug]/page.tsx`                      |
| The four desks are `data-reports`, `local-guides`, `tenancy`, `market-updates`; `Masthead.tsx` prepends a `slug: null` Front Page entry | `apps/web/lib/blog-desks.ts`, `Masthead.tsx`                      |
| `intentsFor(surface)` / `intentsByCategory(surface)` take `"locality" \| "metro" \| "landmark"`                                         | `apps/web/lib/intent-filters.ts:42-54`                            |
| `IntentGrid` builds `{baseHref}/{intent}` SEO-page URLs — **not** `/search?` filter URLs                                                | `apps/web/components/seo/intent-grid.tsx:13-25`                   |
| A no-store fetch anywhere in a route's tree opts that route out of ISR entirely                                                         | `apps/web/lib/api.ts`, and the project's prior Fluid CPU incident |

**Correction carried from the spec (§5).** The spec calls the chip rail "reuse, not new code" on the grounds that `IntentGrid` already renders it. That holds only on locality / metro / landmark pages, where `/{intent}` routes exist. On `/search` and `/pg` there is no intent route, so the rail must emit filter URLs. Task 3 therefore borrows `IntentGrid`'s visual treatment but sources hrefs from `nav-model`. Do not try to reuse `IntentGrid` directly.

---

## File Structure

**Create:**

- `apps/web/app/api/nav/times/route.ts` — same-origin, cached GET returning up to 4 recent posts
- `apps/web/lib/nav/times-posts.ts` — client-side fetch + per-session memo
- `apps/web/components/header/times-panel.tsx` — desks + latest, with graceful degradation
- `apps/web/components/header/intent-chip-rail.tsx` — browse-page rail
- tests alongside each

**Modify:**

- `apps/web/components/header/header.tsx` — give Times a panel instead of `panel: null`
- `apps/web/components/header/nav-menu-bar.tsx` — allow an item to supply a custom panel renderer
- `apps/web/app/globals.css` — Times panel columns, chip rail
- `apps/web/lib/i18n.ts` — new strings
- the browse pages that host the rail (`/search`, `/pg`, `/city/[citySlug]`)

Split rationale: `times-posts.ts` holds the fetching and memoisation so `times-panel.tsx` stays a render concern and can be tested without touching the network.

---

### Task 1: The route handler

**Files:**

- Create: `apps/web/app/api/nav/times/route.ts`
- Create: `apps/web/app/api/nav/times/__tests__/route.test.ts`

**Interfaces:**

- Consumes: `fetchBlogList` from `apps/web/lib/blog-api.ts`.
- Produces: `GET /api/nav/times` → `200` with `{ posts: Array<{ slug: string; title: string; category: string | null }> }`, at most 4 entries. Never non-200 for a blog failure — returns `{ posts: [] }` instead.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../lib/blog-api", () => ({ fetchBlogList: vi.fn() }));
import { fetchBlogList } from "../../../../../lib/blog-api";
import { GET } from "../route";

const asMock = fetchBlogList as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/nav/times", () => {
  beforeEach(() => asMock.mockReset());

  it("returns at most 4 posts, newest first as the API ordered them", async () => {
    asMock.mockResolvedValue({
      items: Array.from({ length: 9 }, (_, i) => ({
        slug: `post-${i}`,
        title_en: `Post ${i}`,
        category_slug: "tenancy"
      }))
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.posts).toHaveLength(4);
    expect(body.posts[0]).toEqual({ slug: "post-0", title: "Post 0", category: "tenancy" });
  });

  it("returns an empty list, not an error, when the blog API throws", async () => {
    asMock.mockRejectedValue(new Error("upstream down"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).posts).toEqual([]);
  });

  it("returns an empty list when the response has no items", async () => {
    asMock.mockResolvedValue({});
    const res = await GET();
    expect((await res.json()).posts).toEqual([]);
  });

  it("skips posts missing a slug or a title rather than emitting a broken link", async () => {
    asMock.mockResolvedValue({
      items: [
        { slug: "", title_en: "No slug", category_slug: null },
        { slug: "ok", title_en: "Fine", category_slug: null },
        { slug: "no-title", title_en: "", category_slug: null }
      ]
    });
    expect((await (await GET()).json()).posts).toEqual([
      { slug: "ok", title: "Fine", category: null }
    ]);
  });

  it("sets a cache header so repeat hits do not reach the blog API", async () => {
    asMock.mockResolvedValue({ items: [] });
    const res = await GET();
    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });
});
```

Adjust the mocked field names (`title_en`, `category_slug`) to whatever `fetchBlogList` actually returns — **read `apps/web/lib/blog-api.ts` first** and use the real shape. If it differs from the guess above, use the real one and note it in your report.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test -- app/api/nav/times/__tests__/route.test.ts`
Expected: FAIL on the missing route module.

- [ ] **Step 3: Implement**

```ts
import { NextResponse } from "next/server";
import { fetchBlogList } from "../../../../lib/blog-api";

/**
 * Same-origin feed for the Cribliv Times nav panel.
 *
 * Two reasons this is a route handler rather than a direct call from the panel:
 * the header renders in the root layout, so a *server* fetch there would opt
 * every page on the site out of ISR; and the API's browser CORS allowlist does
 * not include cribliv.com, so a direct browser→API call fails in production.
 * The client hits this same-origin handler, which calls the API server-side.
 *
 * A blog outage must never break the header, so every failure path returns 200
 * with an empty list and the panel falls back to desks-only.
 */
export const revalidate = 900;

const MAX_POSTS = 4;

export async function GET() {
  try {
    const res = await fetchBlogList({ page: 1, page_size: MAX_POSTS }, { revalidate });
    const posts = (res?.items ?? [])
      .map((item) => ({
        slug: item.slug ?? "",
        title: item.title_en ?? "",
        category: item.category_slug ?? null
      }))
      .filter((p) => p.slug.length > 0 && p.title.length > 0)
      .slice(0, MAX_POSTS);

    return NextResponse.json(
      { posts },
      {
        headers: { "cache-control": `public, s-maxage=${revalidate}, stale-while-revalidate=3600` }
      }
    );
  } catch {
    return NextResponse.json({ posts: [] }, { status: 200 });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test -- app/api/nav/times/__tests__/route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm no route flipped**

Run: `pnpm --filter @cribliv/web build`
Expected: succeeds; `/api/nav/times` appears as a route; **no existing page flips from static to dynamic**.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/nav/times
git commit -m "feat(web): same-origin cached feed for the Times nav panel"
```

---

### Task 2: Times panel with hover-loaded posts

**Files:**

- Create: `apps/web/lib/nav/times-posts.ts`
- Create: `apps/web/components/header/times-panel.tsx`
- Create: `apps/web/components/header/__tests__/times-panel.test.tsx`
- Modify: `apps/web/components/header/nav-menu-bar.tsx`
- Modify: `apps/web/components/header/header.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- `times-posts.ts` produces:
  - `interface TimesPost { slug: string; title: string; category: string | null }`
  - `loadTimesPosts(): Promise<TimesPost[]>` — fetches `/api/nav/times` once per session, memoises the promise, resolves `[]` on any failure
  - `__resetTimesPostsForTests(): void`
- `times-panel.tsx` produces `<TimesPanel locale={NavLocale} onNavigate={() => void} />`
- `nav-menu-bar.tsx` gains an optional `renderPanel?: () => ReactNode` on `NavMenuItem`; when present it is rendered in place of `NavPanelView`, inside the same wrapper so hover-intent, ARIA, and Escape behave identically.

- [ ] **Step 1: Write the failing tests**

For `times-posts.ts`: fetches once and memoises across repeated calls; resolves `[]` on a rejected fetch; resolves `[]` on a non-JSON body; a failure does not poison the memo permanently if `__resetTimesPostsForTests` clears it.

For `times-panel.tsx`: renders the four desks immediately without waiting on any request; renders no "Latest" column before the fetch resolves; renders posts after it resolves, each linking to `/{locale}/blog/{slug}`; renders desks-only when the fetch resolves empty; **does not fetch on mount — only when rendered** (the panel only mounts on hover, so mounting is the trigger); uses Hindi desk labels for `hi`; clicking any link calls `onNavigate`.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`times-posts.ts` keeps a module-level `Promise<TimesPost[]> | null` so concurrent hovers share one request:

```ts
export interface TimesPost {
  slug: string;
  title: string;
  category: string | null;
}

let inflight: Promise<TimesPost[]> | null = null;

/**
 * Loads the Times panel's latest posts, once per session.
 *
 * Deliberately client-side: the header renders in the root layout, so a server
 * fetch here would opt the entire site out of ISR. Same-origin so it is not
 * subject to the API's browser CORS allowlist. Every failure resolves to an
 * empty list — the panel degrades to desks-only rather than breaking.
 */
export function loadTimesPosts(): Promise<TimesPost[]> {
  if (inflight) return inflight;
  inflight = fetch("/api/nav/times")
    .then((r) => (r.ok ? r.json() : { posts: [] }))
    .then((body) => (Array.isArray(body?.posts) ? (body.posts as TimesPost[]) : []))
    .catch(() => []);
  return inflight;
}

export function __resetTimesPostsForTests(): void {
  inflight = null;
}
```

`times-panel.tsx` renders `buildTimesPanel(locale)`'s desks column synchronously, then a `Latest` column once state arrives. Load in a `useEffect` on mount — the panel only mounts when the trigger is hovered, so mount _is_ first hover.

Then in `header.tsx`, give the Times item `panel: buildTimesPanel(locale)` and `renderPanel: () => <TimesPanel locale={locale} onNavigate={close} />`, keeping `className="nav-chip nav-chip--times"`.

- [ ] **Step 4: Run to verify they pass.** Output must be pristine — an unhandled promise rejection or a state-update-after-unmount warning is a real bug in the effect cleanup.

- [ ] **Step 5: Verify the whole header still works**

Run: `pnpm --filter @cribliv/web test -- components/header/__tests__ components/__tests__`
Expected: PASS, including all three regression suites.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/nav/times-posts.ts apps/web/components/header/times-panel.tsx apps/web/components/header/__tests__/times-panel.test.tsx apps/web/components/header/nav-menu-bar.tsx apps/web/components/header/header.tsx apps/web/app/globals.css
git commit -m "feat(web): Cribliv Times nav panel with hover-loaded latest posts"
```

---

### Task 3: Intent chip rail

**Files:**

- Create: `apps/web/components/header/intent-chip-rail.tsx`
- Create: `apps/web/components/header/__tests__/intent-chip-rail.test.tsx`
- Modify: `apps/web/app/[locale]/search/page.tsx`, `apps/web/app/[locale]/pg/page.tsx`, `apps/web/app/[locale]/city/[citySlug]/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Consumes: `buildRentPanel` / `buildPgPanel` from `nav-model.ts` — the rail's chips are a flattened selection of the same links the desktop panels show, so there is one source of truth.
- Produces: `<IntentChipRail locale={NavLocale} citySlug={string} surface={"rent" | "pg"} />`

Behaviour: a horizontally scrollable single row of chips, rendered server-side (plain links, no client JS needed to be crawlable), shown only below 900px. Sources its links from the appropriate panel's intent columns — not the locality column, which is long and place-specific.

**This is a server component with no fetch** — `nav-model` is pure, so the rail adds no dynamic-rendering risk. Do not add `"use client"` unless a genuine interaction requires it; horizontal scrolling needs only CSS `overflow-x: auto`.

- [ ] **Step 1: Write the failing test**

Cover: renders chips from the rent panel's intent columns for `surface="rent"`; renders PG chips for `surface="pg"`; every chip href matches what `buildRentPanel`/`buildPgPanel` produced (no locally-built URLs); the locality column is excluded; Hindi labels for `hi`; renders nothing when the panel has no intent columns.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**, and add CSS:

```css
.intent-rail {
  display: none;
}
@media (max-width: 900px) {
  .intent-rail {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .intent-rail::-webkit-scrollbar {
    display: none;
  }
}
.intent-rail__chip {
  flex: 0 0 auto;
  padding: 6px 13px;
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-decoration: none;
  white-space: nowrap;
}
.intent-rail__chip:hover {
  color: var(--brand);
  border-color: var(--brand);
}
```

- [ ] **Step 4: Mount it on the three browse pages**, directly below the header, passing the surface each page represents. `/city/[citySlug]` is ISR at `revalidate = 3600` — adding a pure component must not change that.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cribliv/web test -- components/header/__tests__/intent-chip-rail.test.tsx`
Run: `pnpm --filter @cribliv/web build`
Expected: build succeeds and **`/city/{slug}` still prerenders 16 pages**. If that number drops, the rail pulled something dynamic into the page — the exact failure this slice's constraints exist to prevent.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/header/intent-chip-rail.tsx apps/web/components/header/__tests__/intent-chip-rail.test.tsx "apps/web/app/[locale]/search/page.tsx" "apps/web/app/[locale]/pg/page.tsx" "apps/web/app/[locale]/city/[citySlug]/page.tsx" apps/web/app/globals.css
git commit -m "feat(web): intent chip rail on browse pages"
```

---

### Task 4: Slice gate

- [ ] **Step 1: Full quality gate**

```bash
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/web lint
pnpm --filter @cribliv/web test
pnpm --filter @cribliv/web build
```

All must pass. On the build, confirm against slice 1's baseline that nothing flipped from static to dynamic and `/city/{slug}` still prerenders 16 pages.

- [ ] **Step 2: Verify the degradation path deliberately**

Temporarily make `/api/nav/times` throw, load a page, hover Cribliv Times, and confirm the panel renders desks-only with no console error and no broken layout. Restore. Report both observations — a graceful-degradation claim that was never exercised is not evidence.

- [ ] **Step 3: E2E**

Extend `apps/web/tests/e2e/top-nav.spec.ts`: hovering Times opens a panel containing the four desks; the chip rail is visible at a 375px viewport on `/search` and scrolls horizontally.

Run: `pnpm --filter @cribliv/web test:e2e -- top-nav.spec.ts`

- [ ] **Step 4: Visual check** at 1280px and 375px via the Browser preview tools, with a screenshot in the report.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/e2e/top-nav.spec.ts
git commit -m "test(web): E2E for the Times panel and chip rail"
```

---

## Self-review notes

- **Spec coverage.** §3.5 Times panel → Tasks 1, 2. §4.4 route handler → Task 1. §5 chip rail → Task 3. Everything else in the spec landed in slices 1 and 2.
- **Deviation from the spec, stated deliberately.** §5 claims the chip rail is `IntentGrid` reuse. It is not, on `/search` and `/pg`, because those surfaces have no `/{intent}` route — Task 3 builds filter URLs from `nav-model` instead. Verified against `intent-grid.tsx:13-25`.
- **The `city` blog filter is intentionally unused.** `fetchBlogList` accepts `city`, but there is no `/blog/city/{city}` route to link to, so city-scoped blog columns stay a follow-up rather than something this slice half-builds.
- **Type consistency.** `TimesPost` is declared once in `times-posts.ts` and imported by the panel and the route handler's test. `NavMenuItem` gains exactly one optional field (`renderPanel`); no existing field changes shape, so slice 2's call sites keep compiling.
