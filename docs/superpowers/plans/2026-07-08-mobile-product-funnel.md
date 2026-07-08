# Mobile Product Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit and fix the primary Cribliv mobile product funnel so tenant-facing discovery, search, PG, map, account, and conversion entry routes are usable and visually consistent on mobile.

**Architecture:** Use the existing web app, shared search URL helpers, and scoped global CSS. First reproduce concrete mobile defects with Playwright, then make small TDD-backed fixes in the affected component or CSS layer.

**Tech Stack:** Next.js 14 App Router, React, TypeScript, Vitest, Playwright, pnpm, CSS in `apps/web/app/globals.css`.

## Global Constraints

- Mobile viewport target is 390px wide, with spot checks at 360px and 430px where layout is tight.
- Pages must not create horizontal document overflow.
- Search controls must remain usable with touch targets at least 40px high where practical.
- Homepage search and results-page segmented search must resolve known city names and aliases consistently into canonical `city=` params.
- PG mode must route to the PG surface and homes mode must route to the homes surface.
- Filters, active chips, map entry points, login/account links, owner entry points, and PG operator entry points must remain reachable on mobile.
- Fixes must follow existing CSS/component patterns and avoid broad redesigns.

---

## File Structure

- Modify `apps/web/components/search-hero.tsx`: route homepage homes searches through canonical place params instead of always adding `q`.
- Modify or add focused tests under `apps/web/components/__tests__/` or `apps/web/lib/__tests__/`: verify known city names become `city=` and segment routing stays correct.
- Modify `apps/web/app/globals.css`: scoped mobile CSS fixes for search/results/filter surfaces discovered during audit.
- Use existing route files in `apps/web/app/[locale]/...` as inspection targets; avoid route restructuring.

### Task 1: Mobile Audit Baseline

**Files:**

- Inspect: `apps/web/app/[locale]/page.tsx`
- Inspect: `apps/web/app/[locale]/search/page.tsx`
- Inspect: `apps/web/app/[locale]/pg/page.tsx`
- Inspect: `apps/web/app/[locale]/map/page.tsx`
- Inspect: `apps/web/app/[locale]/tenant/dashboard/page.tsx`
- Inspect: `apps/web/app/globals.css`

**Interfaces:**

- Consumes: Existing local dev server.
- Produces: A concrete list of mobile failures to fix in later tasks.

- [ ] **Step 1: Start the app locally**

Run: `pnpm dev`
Expected: web runs on port 3000 and API runs on port 4000, or web still renders API fallback states.

- [ ] **Step 2: Open mobile homepage**

Run Playwright at 390x844 for `http://localhost:3000/en`.
Expected: no horizontal overflow, homepage search visible, Homes/PG toggle usable, suggestions not clipped.

- [ ] **Step 3: Check mobile results surfaces**

Open:

- `http://localhost:3000/en/search?city=noida`
- `http://localhost:3000/en/search?q=Noida`
- `http://localhost:3000/en/pg?city=noida`
- `http://localhost:3000/en/map?city=noida`

Expected: no horizontal overflow, search controls and filter controls remain reachable, map entry controls visible.

- [ ] **Step 4: Check mobile conversion/account entry surfaces**

Open:

- `http://localhost:3000/en/auth/login`
- `http://localhost:3000/en/shortlist`
- `http://localhost:3000/en/tenant/dashboard`
- `http://localhost:3000/en/rent-agreement`
- `http://localhost:3000/en/become-owner`
- `http://localhost:3000/en/pg-operator/become`
- `http://localhost:3000/en/pg-operator/onboarding`

Expected: no horizontal overflow, primary actions visible, forms fit viewport.

### Task 2: Homepage Search City Canonicalization

**Files:**

- Modify: `apps/web/components/search-hero.tsx`
- Test: `apps/web/lib/__tests__/search-segment.test.ts`

**Interfaces:**

- Consumes: `placeSearchParam(input: string): { city?: string; q?: string }` from `apps/web/lib/search-segment.ts`.
- Produces: Homepage homes search submits known cities as `city=<slug>` while preserving non-city text as `q=<text>`.

- [ ] **Step 1: Write the failing test**

Add cases to `apps/web/lib/__tests__/search-segment.test.ts`:

```ts
it("resolves supported city aliases to canonical city params", () => {
  expect(placeSearchParam("Noida")).toEqual({ city: "noida" });
  expect(placeSearchParam("Gurgaon")).toEqual({ city: "gurugram" });
  expect(placeSearchParam("new delhi")).toEqual({ city: "delhi" });
});
```

- [ ] **Step 2: Run test to verify current helper behavior**

Run: `pnpm --filter @cribliv/web vitest run lib/__tests__/search-segment.test.ts`
Expected: PASS if helper already works; then use existing behavior as the contract for the component change.

- [ ] **Step 3: Update homepage homes route construction**

In `routeToSearch`, replace unconditional `q: query` merging with this behavior:

```ts
const place =
  typeof filters.city === "string" && filters.city
    ? { city: filters.city }
    : placeSearchParam(query);
const search = buildSearchQuery({ ...filters, ...place });
```

Keep the empty-search clarification branch unchanged.

- [ ] **Step 4: Run focused tests**

Run: `pnpm --filter @cribliv/web vitest run lib/__tests__/search-segment.test.ts`
Expected: PASS.

### Task 3: Targeted Mobile CSS Fixes

**Files:**

- Modify: `apps/web/app/globals.css`
- Test: Playwright mobile inspection.

**Interfaces:**

- Consumes: CSS class names from `SearchHero`, `SegmentedSearchBar`, `SearchFilters`, PG filters, result cards, and map panels.
- Produces: Scoped mobile styles that prevent overflow and preserve control reachability.

- [ ] **Step 1: Identify exact selectors from audit**

Use browser inspection and CSS search to map each issue to existing selectors.
Expected: each CSS edit has a concrete visual bug attached.

- [ ] **Step 2: Apply scoped CSS fixes**

Use existing selectors such as:

```css
@media (max-width: 700px) {
  .tenant-results-hero__actions {
    width: 100%;
    flex-wrap: wrap;
  }
}
```

Only add selectors that correspond to reproduced defects.

- [ ] **Step 3: Re-run mobile inspection**

Open the affected routes at 390x844.
Expected: no horizontal overflow and fixed controls remain reachable.

### Task 4: Verification

**Files:**

- Verify: changed files only plus relevant web test commands.

**Interfaces:**

- Consumes: completed Tasks 1-3.
- Produces: evidence-backed final status.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter @cribliv/web vitest run lib/__tests__/search-segment.test.ts`
Expected: PASS.

- [ ] **Step 2: Run mobile E2E smoke if available**

Run: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test`
Expected: PASS, or report exact failures if environment/data-dependent.

- [ ] **Step 3: Check git diff**

Run: `git diff --stat`
Expected: only spec, plan, tests, component, and scoped CSS changes.

## Self-Review

- Spec coverage: The plan covers audit, search consistency, responsive fixes, and verification for the approved first-pass scope.
- Placeholder scan: No placeholders remain.
- Type consistency: The plan uses the existing `placeSearchParam` return type and route helper contract.
