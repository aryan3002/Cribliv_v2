# Mobile Product Funnel Design

## Goal

Make the primary Cribliv product website work cleanly on mobile for tenant-facing discovery and conversion flows, with special attention to search consistency from the homepage into search results.

## Scope

This pass covers the highest-impact mobile routes:

- `/{locale}` homepage
- `/{locale}/search`
- `/{locale}/pg`
- `/{locale}/map`
- `/{locale}/listing/{listingId}` when a listing is available
- `/{locale}/rent-in/{city}` and `/{locale}/city/{citySlug}`
- `/{locale}/auth/login`
- `/{locale}/shortlist`
- `/{locale}/tenant/dashboard`
- `/{locale}/rent-agreement`
- `/{locale}/become-owner`
- `/{locale}/pg-operator/become`
- `/{locale}/pg-operator/onboarding`

Admin and deep authenticated operator dashboards are excluded from this first pass unless a shared public CSS change obviously affects them.

## Requirements

- Mobile viewport target is 390px wide, with spot checks at 360px and 430px where layout is tight.
- Pages must not create horizontal document overflow.
- Search controls must remain usable with touch targets at least 40px high where practical.
- The homepage search and results-page segmented search must resolve known city names and aliases consistently into canonical `city=` params.
- PG mode must route to the PG surface and homes mode must route to the homes surface.
- Filters, active chips, map entry points, login/account links, owner entry points, and PG operator entry points must remain reachable on mobile.
- Fixes should follow existing CSS/component patterns and avoid broad redesigns.

## Architecture

Use Playwright-driven mobile inspection to find concrete defects, then apply targeted component or CSS fixes. Search URL behavior should remain centralized through `apps/web/lib/search-segment.ts` and its existing helpers. Responsive fixes should prefer scoped selectors around the affected surfaces instead of global typography or reset changes.

## Testing

- Add or extend focused tests for search parameter consistency before changing search behavior.
- Run the focused test file for the changed behavior.
- Use Playwright at mobile viewport sizes against the local app to verify the audited pages for overflow and control reachability.
- Run the relevant web verification command available in the repo after code changes.

## Risks

- Some data-backed pages may render empty or API-unavailable states locally if no Postgres or seed data is running. Empty and error states are still part of the mobile product experience and must be inspected.
- Deep authenticated flows may require seeded sessions and are not part of this first pass except for route entry pages.
