# Admin Verified Homes Inventory Design

**Date:** 2026-07-15  
**Status:** Approved for implementation planning  
**Branch:** `codex/admin-verified-listings-view`

## 1. Goal

Create a dedicated admin inventory for verified flat and house listings. Admins
must be able to scan every verified home, inspect complete listing, owner,
verification, lead, and activity information, copy the canonical public URL, and
open related operational workflows without duplicating Listing Review or Lead
Center.

## 2. Scope

### Included

- A new **Verified Homes** section in the admin sidebar.
- `flat_house` listings whose `verification_status` is `verified`.
- Listing statuses `active`, `paused`, and `archived`.
- An inventory table with server-side search, filters, sorting, and pagination.
- A read-only, full-width listing workspace with:
  - Overview
  - Property
  - Leads
  - Verification
  - Owner
  - Activity
- Canonical public URL generation, clipboard copy, and open-public-page actions.
- Listing-scoped lead metrics and a recent lead preview.
- Cross-navigation to Lead Center, prefiltered by exact `listing_id`.
- Secure verification evidence access through the existing short-lived artifact
  URL and admin audit trail.
- Postgres and `AppStateService` fallback implementations.

### Excluded

- PG listings. They remain in the existing PG Listings admin section.
- Draft, pending-review, and rejected homes. They remain in Listing Review.
- Listing mutations such as pause, reactivate, archive, edit, approve, or reject.
- Lead actions inside the home workspace. Calling, marking called, owner nudges,
  and refunds remain in Lead Center.
- A new `rented` listing status or any database migration.
- Bulk listing actions.

## 3. Product Boundaries

The new section is a production inventory, not a moderation queue.

- **Verified Homes** owns discovery and read-only inspection of verified homes.
- **Listing Review** owns listing and verification decisions and listing status
  changes.
- **Lead Center** owns lead operations and lead-specific timelines.
- **PG Listings** continues to own PG inventory, editing, and analytics.

These boundaries avoid two admin surfaces offering different versions of the
same action.

## 4. Information Architecture

### 4.1 Navigation

Add a `homes` admin tab labeled **Verified Homes** under the sidebar's
**Understand** group, adjacent to PG Listings. The topbar title is
**Verified Homes**.

The tab persists through the existing `admin:tab` session-storage behavior and
is available in the command palette.

### 4.2 Inventory View

The first screen is an operational table, not a card grid. It is optimized for
scanning and comparison.

#### KPI row

- **Active homes:** count of verified `flat_house` listings with status `active`.
- **Views 30d:** `view` events during the last 30 days across the currently
  filtered result set.
- **Leads 30d:** leads created during the last 30 days across the currently
  filtered result set.
- **Needs attention:** number of homes in the currently filtered result set with
  at least one open, uncalled, non-expired lead.

The API returns these KPIs for the full filtered result set, not only the current
page. `views_30d`, `leads_30d`, and `needs_attention` respect the selected
status, city, and search filters. `active_homes` respects city and search but
always counts status `active`, so switching to Paused or Archived does not turn
the active-supply KPI into a meaningless zero.

#### Default state

- Status filter: `active`.
- Sort: `leads_30d desc`, then `updated_at desc`.
- Page: `1`.
- Page size: `25`.

#### Filters and search

- Status: `active`, `paused`, `archived`, or `all`.
- City.
- Search across listing title, listing UUID, owner name, owner phone, locality,
  city, and address.
- Sort options:
  - Most leads
  - Most views
  - Highest conversion
  - Recently updated
  - Highest rent
  - Lowest rent
- Pagination with page sizes `25`, `50`, and `100`.

Invalid query values fall back to the defaults rather than reaching SQL casts.

#### Table columns

- Cover photo thumbnail.
- Listing title and shortened UUID.
- City and locality.
- Monthly rent.
- Owner name and masked phone.
- Listing status.
- Leads in the last 30 days.
- Views in the last 30 days.
- Lead conversion rate: `leads_30d / views_30d`, with zero when views are zero.
- Last updated.
- Icon actions:
  - Copy public URL.
  - Open public page in a new tab.

Public URL actions are enabled only for `active` homes because paused and
archived listings are intentionally unavailable on the public listing endpoint.
Paused and archived rows show **Not publicly available** instead. Action buttons
stop propagation so they do not open the workspace.

### 4.3 Listing Workspace

Selecting a table row replaces the inventory within the same admin tab. The
workspace has a clear **Back to verified homes** action and does not open a new
browser route.

#### Header

- Cover thumbnail.
- Listing title.
- Verified and listing-status pills.
- City and locality.
- Monthly rent.
- Full listing UUID.
- Copy public URL action.
- Open public page action.
- Open in Listing Review action for status or moderation work.

Copy URL and Open public page are enabled only while the home is `active`.
Paused and archived homes remain fully inspectable in admin but show
**Not publicly available** in place of those actions.

#### KPI strip

- Views in the last 30 days.
- Leads in the last 30 days.
- Open leads.
- Conversion rate.
- Last owner activity.

#### Overview tab

- Cover photo and compact gallery.
- Listing highlights.
- Pricing.
- Location summary.
- Lead-health summary.
- Owner-response summary.
- Verification summary.

#### Property tab

- English and Hindi titles and descriptions.
- Rent, deposit, availability, furnishing, BHK, bathrooms, and area.
- Preferred tenant, WhatsApp availability, amenities, and rules.
- Full admin-visible address, landmark, pincode, locality, city, latitude, and
  longitude.
- All non-rejected listing photos and moderation status.

This tab is read-only.

#### Leads tab

- Thirty-day lead totals and conversion metrics.
- Thirty-day status breakdown: new, contacted, visit scheduled, deal done, and
  lost.
- Thirty-day access-state breakdown: free, locked, unlocked, and expired.
- Thirty-day called and refunded counts.
- Current lifetime uncalled and open-lead counts.
- Median response time when response data exists.
- Up to 10 recent lead previews with seeker name, state, status, called state,
  deadline, and creation time. The preview does not expose seeker phone numbers.
- **Manage in Lead Center** action.

The action switches the admin shell to Lead Center and supplies the listing UUID.
Lead Center opens on the Board view with `filter=all`, `listing_id=<uuid>`,
`sort=newest`, and page `1`. Existing Lead Center actions remain unchanged.

Definitions:

- **Open lead:** status is `new`, `contacted`, or `visit_scheduled`, and
  `access_state` is not `expired`.
- **Uncalled lead:** the lead is open and `called_at` is null.
- **Refunded lead:** its linked contact unlock has `unlock_status = 'refunded'`.
- **Median response time:** median `called_at - created_at` for leads created in
  the last 30 days that have a `called_at` value.

#### Verification tab

- Current listing verification status.
- Verification completion date, derived from the latest passing attempt.
- Every verification attempt, newest first.
- Attempt type, result, scores, threshold, provider result, review reason,
  reviewer, and review time.
- Secure evidence action when artifacts exist.

Evidence links continue to use the existing
`GET /admin/review/verifications/:attempt_id/artifact-link` endpoint. Links are
short-lived and every access remains recorded in `admin_actions`.

#### Owner tab

- Owner ID, name, full phone, role, language, WhatsApp opt-in, blocked state, and
  member-since date.
- Owner portfolio counts: all `flat_house` active, paused, and archived homes,
  regardless of verification status.
- Owner lead-health summary.
- Report count and last login/activity.

#### Activity tab

Show a reverse-chronological, read-only timeline capped at 100 items:

- Listing created and last-updated markers.
- Listing-targeted admin actions.
- Verification attempts and decisions.
- Lead creation and lead-status events for this listing.

Every item contains a timestamp, category, short description, and actor ID when
available. The timeline is informational; action controls remain in their owning
admin sections.

## 5. API Design

All endpoints remain under `/v1`, inherit the existing admin auth guards, and
return the standard `{ data: ... }` envelope.

Create a focused `AdminHomesController` and `AdminHomesService` inside the
existing `AdminModule`. The controller owns only `/admin/homes` routes and uses
the same `AuthGuard`, `RolesGuard`, and `@Roles("admin")` pattern as the other
admin controllers. This keeps the already-large `AdminController` from growing
another unrelated feature surface.

### 5.1 `GET /admin/homes`

Query parameters:

- `status=active|paused|archived|all`
- `city=<city-slug>`
- `q=<search-text>`
- `sort=leads|views|conversion|updated|rent_desc|rent_asc`
- `page=<positive-int>`
- `page_size=25|50|100`

Response:

```ts
interface AdminHomesListResponse {
  items: AdminHomeListItem[];
  total: number;
  page: number;
  page_size: number;
  filters: {
    status: "active" | "paused" | "archived" | "all";
    city: string | null;
    q: string | null;
    sort: "leads" | "views" | "conversion" | "updated" | "rent_desc" | "rent_asc";
  };
  available_cities: Array<{ slug: string; name: string; count: number }>;
  summary: {
    active_homes: number;
    views_30d: number;
    leads_30d: number;
    needs_attention: number;
  };
}
```

`AdminHomeListItem` contains the table fields plus:

- `public_path`, generated from listing type, city slug, and UUID.
- `cover_photo_url`.
- `owner_id`.
- `open_leads`.

The database path uses set-based CTEs or lateral aggregates so listing events,
lead counts, cover photos, and owner fields are fetched without per-row queries.
The page total uses the same validated status, city, and search predicate as the
page. Summary fields follow the KPI filter rules in section 4.2.

### 5.2 `GET /admin/homes/:listing_id`

Returns one `AdminHomeDetail` payload containing:

- `listing`
- `location`
- `photos`
- `owner`
- `metrics_30d`
- `lead_summary`
- `recent_leads`
- `verification_attempts`
- `activity`
- `public_path`

The endpoint returns not found unless the record is:

- `listing_type = 'flat_house'`
- `verification_status = 'verified'`
- `status IN ('active', 'paused', 'archived')`

Malformed listing IDs return the same not-found response without reaching a
Postgres UUID cast.

The detail endpoint is read-only. It reuses existing photo URL resolution and
verification evidence conventions.

### 5.3 Lead Center exact-listing filter

Extend `GET /admin/leads/board` with:

- `listing_id=<uuid>`

`sanitizeBoardParams` validates the UUID before it reaches the service. The
board query adds `ld.listing_id = $n::uuid` when present. This is an additive,
backward-compatible filter.

The web Lead Center accepts an optional initial listing UUID and initializes:

- Board view.
- `filter = all`.
- `sort = newest`.
- Exact listing filter visible as a removable chip.

## 6. Shared Types and Client API

Create a focused shared contract module for:

- Inventory filters and sort values.
- Inventory list item and response.
- Listing detail payload.
- Lead summary and recent lead preview.
- Verification attempt summary.
- Activity item.

Export it from `@cribliv/shared-types`.

Add typed web API wrappers to `apps/web/lib/admin-api.ts`:

- `fetchAdminHomes`
- `fetchAdminHomeDetail`

The API receives snake_case contracts. The homes UI consumes those shared
contracts directly to avoid maintaining a second mapping layer.

## 7. Public URL Rules

The canonical path uses the existing listing routing convention:

```text
/en/listing/<listing-id>
```

This feature only handles `flat_house`, so no PG city route is required.

For active homes, the copied URL is absolute and uses:

1. `NEXT_PUBLIC_SITE_URL` when configured.
2. `https://cribliv.com` as the production fallback.

The UI must not copy the admin host or API host. Clipboard success and failure
produce admin toasts. When `navigator.clipboard` is unavailable, use a temporary
text selection fallback. Paused and archived homes do not expose Copy URL or
Open public page actions.

## 8. UI and Interaction Design

### Visual system

Reuse the current admin system:

- `#FAFBFC` page canvas.
- White operational surfaces.
- Blue primary and navigation actions.
- Green verified and healthy states.
- Amber attention states.
- Existing Manrope/body font stack.
- Compact table typography.
- Existing 6–10px control and surface radii.
- Lucide icons for copy, external link, search, filter, and navigation actions.

The feature must feel like part of the existing admin console, not a separate
dashboard theme.

### Responsive behavior

- Desktop: full data table and full-width workspace.
- Tablet: horizontally scrollable table with sticky listing and action columns;
  workspace sections collapse to one column where needed.
- Mobile: inventory rows render as compact stacked records preserving the same
  information and actions; workspace tab labels scroll horizontally.
- All action hit targets are at least 44px on touch layouts.
- Dynamic content must not resize fixed action controls or overlap neighboring
  content.

### Loading, empty, and error states

- Inventory skeleton preserves table dimensions.
- Empty active state explains that no verified active homes match the filters
  and offers **Show all verified**.
- Missing cover photo uses a neutral home placeholder.
- Empty metrics display `0`, not a dash.
- Workspace load failure offers retry and back actions.
- Tab-level missing data uses a scoped empty state rather than failing the whole
  workspace.
- Filter changes reset pagination to page 1.
- Search is debounced by 300ms.

## 9. Data and Performance

- Inventory and detail use bounded, set-based queries.
- The inventory query never fetches lead rows; it returns aggregates only.
- Recent leads are capped at 10.
- Activity is capped at 100.
- Photos are ordered by cover, sort order, and creation time.
- Thirty-day windows use database `now()` for consistent server-side counts.
- All counts are numeric, not Postgres string values.
- Search text is parameterized and bounded to 200 characters.
- Page size is capped at 100.
- No migration is planned. Existing indexes on listings, leads, and
  `listing_events` are expected to support the primary joins and time-window
  aggregates, but this assumption must be checked with
  `EXPLAIN (ANALYZE, BUFFERS)` against a migrated test database before release.
  If production-scale evidence shows a required index, that is a separate
  migration decision and must not be hidden inside this feature.

## 10. Dual-Mode Behavior

`AdminHomesService` checks `DatabaseService.isEnabled()`.

### Database enabled

Use Postgres for inventory, detail, metrics, verification attempts, and
activity.

### Database disabled

Use `AppStateService`:

- Filter the in-memory listing map to verified `flat_house` records in allowed
  statuses.
- Support status, city, title/UUID search, pagination, and deterministic sorting.
- Return zero analytics where the in-memory state has no equivalent event data.
- Use `createdAt` as the in-memory updated-sort fallback because `ListingRecord`
  has no separate updated timestamp.
- Return available owner/listing fields and empty verification/activity arrays
  where unavailable.

The API remains bootable and testable without `DATABASE_URL`.

## 11. Security and Privacy

- All endpoints require `admin`.
- Owner phone is masked in the inventory and full in the detail workspace.
- Seeker phone is only displayed in the Lead Center; the homes detail recent
  lead preview intentionally omits seeker phone numbers and calling controls.
- Verification artifacts are never returned directly in the home payload.
- Detail responses never return verification `artifact_paths`,
  `submitted_payload`, provider request payloads, or provider response payloads.
- Artifact URLs remain short-lived and audit logged.
- SQL accepts only sanitized enum-like filters and parameterized values.
- Public URL actions expose only the public listing URL.

## 12. Testing Strategy

### API

- Query parameter sanitization and defaults.
- Verified `flat_house` scope enforcement.
- Status, city, and exact search filters.
- Pagination and all sort modes.
- Summary totals use the full filtered result set.
- Set-based metrics produce correct views, leads, conversion, open-lead, and
  attention counts.
- Detail payload includes property, owner, photos, lead summary, attempts, and
  activity.
- Detail rejects PG, unverified, pending-review, rejected, and missing records.
- Lead Center `listing_id` validation and SQL forwarding.
- Lead Center board rows, total, and counters all respect `listing_id`.
- Database-disabled inventory and detail fallback.

### Web

- Admin shell navigation and topbar title.
- Inventory default filter and rendered columns.
- Search/filter/sort/page query forwarding.
- Copy URL success and fallback behavior.
- Paused/archived homes show Not publicly available and expose no public URL
  actions.
- Open-public-page action.
- Row-to-workspace navigation and back behavior.
- Workspace tab content and empty states.
- Leads tab switches to Lead Center with the exact listing filter.
- Verification evidence action uses the existing artifact API.
- Responsive layout checks for desktop, tablet, and mobile.

### Final verification

- `pnpm --filter @cribliv/shared-types build`
- Focused API and web tests.
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- Browser QA against desktop and mobile viewports.

## 13. Success Criteria

- An admin can find any verified flat or house listing without using Listing
  Review.
- The default inventory shows active homes and can reveal paused or archived
  homes without a new status or migration.
- The table exposes the agreed listing, owner, lead, view, conversion, and URL
  information without N+1 requests.
- Selecting a home exposes complete read-only property, lead, verification,
  owner, and activity information.
- Active homes copy/open the correct public listing page; paused and archived
  homes show Not publicly available.
- Lead operations continue exclusively in Lead Center, opened with an exact
  listing filter.
- Verification evidence remains short-lived and audit logged.
- PG management and moderation workflows are unchanged.
