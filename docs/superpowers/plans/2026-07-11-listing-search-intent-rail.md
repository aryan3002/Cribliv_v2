# Listing Search Intent Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact natural-language intent rail to Homes listing search results.

**Architecture:** A pure helper translates parser output into canonical route and count-request parameters. A results-page-only client component renders the segmented input, parsed chips, and live count while the server page remains responsible for rendering results.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Testing Library, existing `parseQuery` and `fetchApi` helpers.

## Global Constraints

- Preserve the Homes/PG route split: Homes is `/[locale]/search`; PG is `/[locale]/pg`.
- Keep the existing filter panel, active-filter chips, map handoff, and guest gating unchanged.
- Do not modify unrelated `.claude` working-tree files.
- Use `parseQuery` and `chipsToFilters`; do not introduce a second NLP parser.

---

### Task 1: Intent Search URL and Count Helpers

**Files:**

- Create: `apps/web/lib/intent-search.ts`
- Create: `apps/web/lib/__tests__/intent-search.test.ts`

**Interfaces:**

- Produces: `buildIntentSearchHref(locale, currentSegment, currentFilters, query, dictionary)`
- Produces: `buildIntentCountPath(currentSegment, chips, residual)`

- [ ] **Step 1: Write failing tests**

```ts
expect(
  buildIntentSearchHref("en", "homes", { sort: "verified" }, "2BHK Lucknow under 20k", dictionary)
).toBe("/en/search?sort=verified&bhk=2&city=lucknow&max_rent=20000");

expect(buildIntentSearchHref("en", "homes", {}, "PG in Lucknow under 10k", dictionary)).toBe(
  "/en/pg?city=lucknow&max_rent=10000"
);
```

- [ ] **Step 2: Run the focused test and confirm the import fails**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/intent-search.test.ts`

- [ ] **Step 3: Implement minimal helpers**

Use `parseQuery`, `chipsToFilters`, and `hrefForSegment`. Exclude stale parsed parameters before applying the new parsed filter object. Preserve non-search filters.

- [ ] **Step 4: Re-run the focused test**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/intent-search.test.ts`

### Task 2: Results Intent Search Component

**Files:**

- Create: `apps/web/components/search/IntentSearchBar.tsx`
- Create: `apps/web/components/search/__tests__/IntentSearchBar.test.tsx`

**Interfaces:**

- Consumes: `buildIntentSearchHref`, `buildIntentCountPath`, `parseQuery`
- Produces: a client component compatible with `locale`, `params`, and `segment` props.

- [ ] **Step 1: Write failing component tests**

```tsx
render(<IntentSearchBar locale="en" segment="homes" params={{}} />);
fireEvent.change(screen.getByRole("textbox", { name: "Search" }), {
  target: { value: "2BHK Lucknow under 20k" }
});
expect(await screen.findByText("2 BHK")).toBeVisible();
expect(screen.getByText("Lucknow")).toBeVisible();
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm --filter @cribliv/web test -- components/search/__tests__/IntentSearchBar.test.tsx`

- [ ] **Step 3: Implement the component**

Load dictionary and a debounced count using abortable browser requests. Render chips, a count/status line, and a live-region summary. Submit through the helper and switch segment when the parsed listing type demands it.

- [ ] **Step 4: Re-run the focused component test**

Run: `pnpm --filter @cribliv/web test -- components/search/__tests__/IntentSearchBar.test.tsx`

### Task 3: Integrate and Style

**Files:**

- Modify: `apps/web/app/[locale]/search/page.tsx`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Replaces the Homes page's `SegmentedSearchBar` mount with `IntentSearchBar`.

- [ ] **Step 1: Mount the component**

Replace only the Homes `/search` toolbar mount. Leave PG's use of `SegmentedSearchBar` in place.

- [ ] **Step 2: Add compact results-toolbar styles**

Use existing tenant-result spacing, colors, border, focus, and chip conventions. Add responsive rules so the segmented control, query input, buttons, and rail do not overlap at mobile widths.

- [ ] **Step 3: Run focused tests**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/intent-search.test.ts components/search/__tests__/IntentSearchBar.test.tsx components/search/__tests__/SegmentedSearchBar.test.tsx`

### Task 4: Verify the Integrated Surface

**Files:**

- Test: `apps/web/tests/listing-search-intent.spec.ts`

- [ ] **Step 1: Add or extend an E2E interaction test**

Open `/en/search`, type `2BHK Lucknow under 20k`, assert visible chips, submit, and assert query parameters.

- [ ] **Step 2: Run focused verification**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/intent-search.test.ts components/search/__tests__/IntentSearchBar.test.tsx components/search/__tests__/SegmentedSearchBar.test.tsx`

Run: `pnpm --filter @cribliv/web typecheck`

Run: `pnpm --filter @cribliv/web build`
