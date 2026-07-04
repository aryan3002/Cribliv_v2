# SEO City Review Console — Design

- **Date:** 2026-07-04
- **Status:** Approved (design)
- **Builds on:** slice 1 (DB-driven programmatic city expansion, merged `1cd2fc1`)

## Problem

The admin "Programmatic SEO" tab (slice 1) is a flat enable/disable table. An admin cannot responsibly approve a city because:

1. **Counts are stale** — locality/landmark/metro/indexable counts only recompute when a city is toggled, so cities that were seeded-on (e.g. Lucknow) show `0` for everything.
2. **Nothing is inspectable** — no way to drill in and see the actual localities/landmarks/metro the AI+Google pipeline produced before approving.
3. **No safe way to preview** — a not-yet-enabled city's pages 404 (by design), so there's nothing to look at pre-approval.

## Goals

Turn the tab into a **review-and-approve console**: accurate numbers, a per-city drill-in showing the real data, and admin-only page previews — so approving a city is an informed decision.

## Non-goals

- Editing seed data from the UI (review only; edits go through the `generate-city` CLI + git).
- Map view / per-locality listings deep-dive (possible later; not v1).
- Production data population (tracked separately — see Part D).

## Design

### A. Always-accurate counts

`GET /v1/admin/seo/cities` (`SeoCityConfigService.listAllWithCounts`) computes localities / landmarks / metro / indexable counts **live per request** (a single aggregate query grouped by city — one round-trip, not N×3), so the list never shows stale zeros. `indexable` = localities with `listing_count >= 3` (`INDEXABLE_MIN`). Stored count columns remain as a snapshot updated on toggle but are no longer the display source of truth.

### B. City drill-in (review drawer)

Clicking a city row opens a slide-in **detail drawer** (master-detail; keeps the admin in the table):

- **Header:** city name, status (Live/Draft), live counts, `enabled_at`, notes.
- **Tabs** (each a searchable list, reusing existing endpoints):
  - **Localities** — `GET /seo/localities/:city`: name (en/hi), `listing_count`, **indexable ✓/✗**, lat/lng, **Preview** link.
  - **Landmarks** — `GET /landmarks/:city`: name, type, lat/lng, Preview link.
  - **Metro** — `GET /map/metro?city=`: station, line, lat/lng, Preview link.
- **Approve bar (footer):** notes input + **Enable/Disable** → existing audited `PATCH /v1/admin/seo/cities/:slug` (writes `admin_actions`, recomputes counts, stamps `enabled_at`).

### C. Admin page preview (gate bypass)

Each drill-in row's **Preview** link opens the item's real programmatic page with `?adminPreview=1`. The 6 templates' gate changes:

```
// before
if (!enabledCities.has(citySlug)) notFound();
// after
if (!enabledCities.has(citySlug) && !(await isAdminPreview(searchParams))) notFound();
```

`isAdminPreview` returns true only when `searchParams.adminPreview === "1"` **AND** the server-side session resolves to `role === "admin"` (via NextAuth `auth()`). Properties:

- Normal public requests (no param) never call `auth()` → pages stay cached/ISR and unchanged.
- Preview requests are dynamic (searchParams force it), `noindex`, and never enter the sitemap (disabled cities are excluded regardless).
- Public / Google / non-admins get a real **404** for disabled cities — this also fixes the slice-1 **soft-404** nit (the non-preview disabled path now returns a hard 404 because the gate check moves into a place that sets the status correctly; verify empirically).

### D. Production data (separate, parallel task — NOT in this build)

Prod shows "No cities configured" because prod's DB has no city/locality data (the dev seed was never—correctly—run against prod). Fix = a **production-safe data load** (real cities + localities/landmarks/metro, no dev users, idempotent). Own task; run only against prod with explicit confirmation. The console is built + demoed on local, which has data.

## Testing

- **API:** `listAllWithCounts` returns correct live per-city counts (unit with mocked query asserting the aggregate SQL shape; integration against `cribliv_test`). No new endpoints for drill-in (reuse existing).
- **Web (preview gate):** `isAdminPreview` helper — true only for `adminPreview=1` + admin session; false for missing param, non-admin, or logged-out. Unit-tested. Verify a disabled city returns 404 for public and 200 for an admin-preview request.
- **Web (drawer):** renders localities/landmarks/metro from mocked fetchers; preview links carry `?adminPreview=1`; enable/disable with notes calls `setSeoCityEnabled`. Existing `SeoProgrammaticPages` + admin-shell tests stay green.
- **Manual:** local — click Noida → drawer shows 41 localities / 19 landmarks / 21 metro with indexable flags; preview a Noida locality page as admin (200) while it stays 404 to the public; Lucknow now shows real counts, not 0.

## Backward compatibility / risk

- The gate change touches the 6 just-merged templates — must not regress enabled cities (Lucknow) or the public 404 for disabled cities. The `auth()` call is gated behind the preview param so public render paths are untouched.
- Security: the bypass MUST verify the admin session server-side (a bare `?adminPreview=1` from a non-admin must still 404). This is the highest-risk item — review it adversarially.
