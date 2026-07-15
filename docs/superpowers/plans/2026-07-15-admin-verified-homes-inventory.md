# Admin Verified Homes Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated read-only admin inventory and full workspace for verified flat/house listings, with canonical URL actions and exact-listing cross-navigation into the existing Lead Center.

**Architecture:** Add shared snake_case contracts, a focused `AdminHomesController` and `AdminHomesService` inside `AdminModule`, and validated list query parsing. The web adds a `homes` admin tab with a server-filtered inventory and tabbed detail workspace; listing mutations remain in Listing Review, while lead actions remain in Lead Center through an additive `listing_id` filter.

**Tech Stack:** TypeScript 5.6+, NestJS 10, PostgreSQL, Next.js 14 App Router, React 18, Vitest, Testing Library, Playwright browser QA, pnpm workspaces.

## Global Constraints

- Scope only `listing_type = 'flat_house'`, `verification_status = 'verified'`, and statuses `active`, `paused`, or `archived`.
- Do not add a migration or a `rented` status.
- The workspace is read-only; listing decisions/status changes stay in Listing Review.
- Lead actions stay in Lead Center; the home workspace only shows metrics/previews and opens Lead Center with exact `listing_id`.
- PG Listings and PG admin behavior must remain unchanged.
- Every API service path must support both Postgres and `AppStateService` modes.
- Inventory defaults: `status=active`, `sort=leads`, `page=1`, `page_size=25`.
- Allowed page sizes are exactly `25`, `50`, and `100`; invalid values fall back to `25`.
- Search input is trimmed and capped at 200 characters.
- Thirty-day metrics use database `now()` and set-based queries; no per-row API or SQL query loops.
- Inventory owner phones are masked; detail owner phones are full; recent lead previews omit seeker phones.
- Verification artifacts continue through the existing short-lived, audit-logged artifact-link endpoint.
- Absolute public URLs use `NEXT_PUBLIC_SITE_URL` or `https://cribliv.com`; never the admin/API origin.
- Copy URL and Open public page are available only for `active` homes; paused and archived homes show `Not publicly available`.
- Do not add a shortlist metric or new shortlist event tracking in this feature.
- Reuse the current admin visual system, Lucide icons, compact density, and 6–10px radii.
- Desktop, tablet, and mobile layouts must avoid overlap and keep touch actions at least 44px.
- Follow TDD for every behavior change: write a failing test, run it and record RED, implement, then run and record GREEN.

---

## File Structure

### Shared contracts

- `packages/shared-types/src/admin-homes.ts`: canonical inventory/detail/filter contracts.
- `packages/shared-types/src/index.ts`: exports the contracts.

### API

- `apps/api/src/modules/admin/admin-homes.params.ts`: validates and normalizes untrusted list query parameters.
- `apps/api/src/modules/admin/admin-homes.controller.ts`: guarded `/admin/homes` list/detail routes.
- `apps/api/src/modules/admin/admin-homes.service.ts`: Postgres and in-memory list/detail read models.
- `apps/api/src/modules/admin/admin.module.ts`: registers the controller/service.
- `apps/api/src/modules/admin/__tests__/admin-homes.params.test.ts`: parser behavior.
- `apps/api/src/modules/admin/__tests__/admin-homes.service.test.ts`: scope, list mapping, detail mapping, and in-memory fallback.
- `apps/api/src/modules/admin/__tests__/admin-homes.controller.test.ts`: controller delegation/envelope.
- `apps/api/test/admin-homes.integration.test.ts`: `TEST_DATABASE_URL`-gated list/detail scope, aggregate, privacy, ordering, and performance evidence.

### Lead Center exact listing filter

- `apps/api/src/modules/leads/board-params.ts`: validates `listing_id`.
- `apps/api/src/modules/leads/admin-leads.controller.ts`: forwards `listing_id`.
- `apps/api/src/modules/leads/admin-lead-ops.service.ts`: adds exact listing predicate.
- `apps/api/test/admin-lead-board.integration.test.ts`: exact-listing rows, total, and counters.

### Web utilities and API

- `apps/web/lib/admin-api.ts`: typed home list/detail fetchers and Lead Center `listing_id`.
- `apps/web/lib/admin-home-url.ts`: canonical absolute URL builder and clipboard fallback.
- `apps/web/lib/__tests__/admin-home-url.test.ts`: URL and clipboard behavior.
- `apps/web/lib/__tests__/admin-api-homes.test.ts`: API query forwarding.

### Web UI

- `apps/web/components/admin/homes/AdminHomesTab.tsx`: inventory/workspace state owner and data fetching.
- `apps/web/components/admin/homes/HomesInventory.tsx`: filters, KPIs, table, pagination, loading/empty/error states.
- `apps/web/components/admin/homes/AdminHomeWorkspace.tsx`: detail fetch, header, KPI strip, and tab selection.
- `apps/web/components/admin/homes/HomeOverviewTab.tsx`
- `apps/web/components/admin/homes/HomePropertyTab.tsx`
- `apps/web/components/admin/homes/HomeLeadsTab.tsx`
- `apps/web/components/admin/homes/HomeVerificationTab.tsx`
- `apps/web/components/admin/homes/HomeOwnerTab.tsx`
- `apps/web/components/admin/homes/HomeActivityTab.tsx`
- `apps/web/components/admin/homes/__tests__/HomesInventory.test.tsx`
- `apps/web/components/admin/homes/__tests__/AdminHomeWorkspace.test.tsx`
- `apps/web/components/admin/shell/AdminSidebar.tsx`
- `apps/web/components/admin/shell/AdminShell.tsx`
- `apps/web/components/admin/shell/CommandPalette.tsx`
- `apps/web/components/admin/lead-center/LeadCenterTab.tsx`
- `apps/web/components/admin/lead-center/LeadBoard.tsx`
- `apps/web/components/admin/admin.css`
- Existing shell/lead-center tests for navigation and filter handoff.

---

### Task 1: Shared Contracts and Query Sanitization

**Files:**

- Create: `packages/shared-types/src/admin-homes.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `apps/api/src/modules/admin/admin-homes.params.ts`
- Create: `apps/api/src/modules/admin/__tests__/admin-homes.params.test.ts`

**Interfaces:**

- Produces:

```ts
export type AdminHomeStatusFilter = "active" | "paused" | "archived" | "all";
export type AdminHomeSort = "leads" | "views" | "conversion" | "updated" | "rent_desc" | "rent_asc";

export interface AdminHomesListParams {
  status: AdminHomeStatusFilter;
  city?: string;
  q?: string;
  sort: AdminHomeSort;
  page: number;
  page_size: 25 | 50 | 100;
}

export function sanitizeAdminHomesParams(raw: {
  status?: string;
  city?: string;
  q?: string;
  sort?: string;
  page?: string;
  page_size?: string;
}): AdminHomesListParams;
```

- `AdminHomeListItem`, `AdminHomesListResponse`, and `AdminHomeDetail` are the shared payloads consumed by Tasks 2, 3, 5, 6, and 7.

- [ ] **Step 1: Write the failing parser tests**

Create `admin-homes.params.test.ts` with these exact behaviors:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeAdminHomesParams } from "../admin-homes.params";

describe("sanitizeAdminHomesParams", () => {
  it("uses the inventory defaults", () => {
    expect(sanitizeAdminHomesParams({})).toEqual({
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });
  });

  it("accepts supported filters and caps search at 200 characters", () => {
    const q = `  ${"x".repeat(220)}  `;
    expect(
      sanitizeAdminHomesParams({
        status: "archived",
        city: " Lucknow ",
        q,
        sort: "conversion",
        page: "3",
        page_size: "100"
      })
    ).toEqual({
      status: "archived",
      city: "lucknow",
      q: "x".repeat(200),
      sort: "conversion",
      page: 3,
      page_size: 100
    });
  });

  it("falls back for invalid enums, page numbers, and page sizes", () => {
    expect(
      sanitizeAdminHomesParams({
        status: "rented",
        sort: "random",
        page: "-4",
        page_size: "75"
      })
    ).toEqual({
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });
  });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes.params.test.ts
```

Expected: FAIL because `../admin-homes.params` does not exist.

- [ ] **Step 3: Add the shared contracts**

Create `packages/shared-types/src/admin-homes.ts` with:

```ts
import type {
  LeadAccessState,
  LeadStatus,
  ListingStatus,
  VerificationResult,
  VerificationType
} from "./types";

export type AdminHomeStatusFilter = "active" | "paused" | "archived" | "all";
export type AdminHomeSort = "leads" | "views" | "conversion" | "updated" | "rent_desc" | "rent_asc";
export type AdminHomeActivityKind = "listing" | "admin" | "verification" | "lead";

export interface AdminHomesListParams {
  status: AdminHomeStatusFilter;
  city?: string;
  q?: string;
  sort: AdminHomeSort;
  page: number;
  page_size: 25 | 50 | 100;
}

export interface AdminHomeListItem {
  id: string;
  title: string;
  city_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
  monthly_rent: number;
  owner_id: string;
  owner_name: string | null;
  owner_phone_masked: string | null;
  status: Extract<ListingStatus, "active" | "paused" | "archived">;
  cover_photo_url: string | null;
  views_30d: number;
  leads_30d: number;
  open_leads: number;
  conversion_rate: number;
  updated_at: string;
  public_path: string;
}

export interface AdminHomesListResponse {
  items: AdminHomeListItem[];
  total: number;
  page: number;
  page_size: 25 | 50 | 100;
  filters: {
    status: AdminHomeStatusFilter;
    city: string | null;
    q: string | null;
    sort: AdminHomeSort;
  };
  available_cities: Array<{ slug: string; name: string; count: number }>;
  summary: {
    active_homes: number;
    views_30d: number;
    leads_30d: number;
    needs_attention: number;
  };
}

export interface AdminHomePhoto {
  id: string | null;
  url: string | null;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface AdminHomeVerificationAttempt {
  attempt_id: string;
  kind: VerificationType;
  result: VerificationResult;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AdminHomeRecentLead {
  lead_id: string;
  seeker_name: string;
  access_state: LeadAccessState;
  status: LeadStatus;
  called_at: string | null;
  called_by: "owner" | "team" | null;
  response_deadline_at: string | null;
  refund_state: "pending" | "responded" | "refunded";
  created_at: string;
}

export interface AdminHomeActivityItem {
  id: string;
  at: string;
  kind: AdminHomeActivityKind;
  label: string;
  detail: string | null;
  actor_id: string | null;
}

export interface AdminHomeDetail {
  listing: {
    id: string;
    title_en: string | null;
    title_hi: string | null;
    description_en: string | null;
    description_hi: string | null;
    status: Extract<ListingStatus, "active" | "paused" | "archived">;
    verification_status: "verified";
    monthly_rent: number;
    security_deposit: number | null;
    available_from: string | null;
    furnishing: string | null;
    bhk: number | null;
    bathrooms: number | null;
    area_sqft: number | null;
    preferred_tenant: string | null;
    whatsapp_available: boolean;
    amenities: string[];
    rules: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    last_owner_activity_at: string | null;
  };
  location: {
    address_line1: string | null;
    landmark: string | null;
    pincode: string | null;
    lat: number | null;
    lng: number | null;
    masked_address: string | null;
    locality_name: string | null;
    city_slug: string | null;
    city_name: string | null;
  } | null;
  photos: AdminHomePhoto[];
  owner: {
    id: string;
    name: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
    preferred_language: string | null;
    role: string;
    is_blocked: boolean;
    member_since: string | null;
    last_login_at: string | null;
    active_homes: number;
    paused_homes: number;
    archived_homes: number;
    report_count: number;
    lead_health: {
      health_score: number | null;
      health_grade: "A" | "B" | "C" | "D" | "F" | null;
      leads_30d: number;
      called_rate_30d: number;
      refund_rate_30d: number;
      median_response_minutes_30d: number | null;
    };
  };
  metrics_30d: {
    views: number;
    leads: number;
    open_leads: number;
    conversion_rate: number;
  };
  lead_summary: {
    by_status: Record<LeadStatus, number>;
    by_access_state: Record<LeadAccessState, number>;
    called: number;
    uncalled: number;
    refunded: number;
    open: number;
    median_response_minutes: number | null;
  };
  recent_leads: AdminHomeRecentLead[];
  verification_status: "verified";
  verified_at: string | null;
  verification_attempts: AdminHomeVerificationAttempt[];
  activity: AdminHomeActivityItem[];
  public_path: string;
}
```

Export it from `packages/shared-types/src/index.ts`:

```ts
export * from "./admin-homes";
```

- [ ] **Step 4: Implement the parser**

Create `admin-homes.params.ts`:

```ts
import type {
  AdminHomeSort,
  AdminHomesListParams,
  AdminHomeStatusFilter
} from "@cribliv/shared-types";

const VALID_STATUSES = new Set<AdminHomeStatusFilter>(["active", "paused", "archived", "all"]);
const VALID_SORTS = new Set<AdminHomeSort>([
  "leads",
  "views",
  "conversion",
  "updated",
  "rent_desc",
  "rent_asc"
]);
const VALID_PAGE_SIZES = new Set([25, 50, 100]);

export function sanitizeAdminHomesParams(
  raw: Record<string, string | undefined>
): AdminHomesListParams {
  const status = VALID_STATUSES.has(raw.status as AdminHomeStatusFilter)
    ? (raw.status as AdminHomeStatusFilter)
    : "active";
  const sort = VALID_SORTS.has(raw.sort as AdminHomeSort) ? (raw.sort as AdminHomeSort) : "leads";
  const pageNumber = Number(raw.page);
  const requestedPageSize = Number(raw.page_size);
  const city = raw.city?.trim().toLowerCase().slice(0, 100) || undefined;
  const q = raw.q?.trim().slice(0, 200) || undefined;
  return {
    status,
    ...(city ? { city } : {}),
    ...(q ? { q } : {}),
    sort,
    page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    page_size: (VALID_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25) as 25 | 50 | 100
  };
}
```

- [ ] **Step 5: Build shared types and run GREEN**

Run:

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes.params.test.ts
```

Expected: shared package builds; 3 parser tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/admin-homes.ts packages/shared-types/src/index.ts \
  apps/api/src/modules/admin/admin-homes.params.ts \
  apps/api/src/modules/admin/__tests__/admin-homes.params.test.ts
git commit -m "feat(shared): add admin homes contracts and filters"
```

---

### Task 2: Inventory API

**Files:**

- Create: `apps/api/src/modules/admin/admin-homes.service.ts`
- Create: `apps/api/src/modules/admin/admin-homes.controller.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`
- Create: `apps/api/src/modules/admin/__tests__/admin-homes.service.test.ts`
- Create: `apps/api/src/modules/admin/__tests__/admin-homes.controller.test.ts`
- Create: `apps/api/test/admin-homes.integration.test.ts`

**Interfaces:**

- Consumes `AdminHomesListParams` and shared response types from Task 1.
- Produces:

```ts
class AdminHomesService {
  listHomes(params: AdminHomesListParams): Promise<AdminHomesListResponse>;
}

@Controller("admin/homes")
class AdminHomesController {
  list(
    status?: string,
    city?: string,
    q?: string,
    sort?: string,
    page?: string,
    pageSize?: string
  ): Promise<{ data: AdminHomesListResponse }>;
}
```

- [ ] **Step 1: Write failing in-memory scope and mapping tests**

In `admin-homes.service.test.ts`, instantiate the service with:

```ts
const database = { isEnabled: () => false, query: vi.fn() } as any;
const appState = new AppStateService();
const service = new AdminHomesService(database, appState);
```

Replace `appState.listings` and `appState.users` with deterministic fixtures and
assert:

```ts
it("lists only verified flat_house homes in active/paused/archived states", async () => {
  const result = await service.listHomes({
    status: "all",
    sort: "leads",
    page: 1,
    page_size: 25
  });
  expect(result.items.map((row) => row.id)).toEqual([
    "active-home",
    "paused-home",
    "archived-home"
  ]);
  expect(result.items.every((row) => row.public_path === `/en/listing/${row.id}`)).toBe(true);
});

it("applies city, search, paging, and deterministic fallback metrics", async () => {
  const result = await service.listHomes({
    status: "active",
    city: "lucknow",
    q: "gomti",
    sort: "updated",
    page: 1,
    page_size: 25
  });
  expect(result.total).toBe(1);
  expect(result.items[0]).toMatchObject({
    city_slug: "lucknow",
    views_30d: 0,
    leads_30d: 0,
    conversion_rate: 0
  });
});

it("searches in-memory title, id, owner name, owner phone, locality, and city", async () => {
  for (const q of ["gomti", "active-home", "ramesh", "9999901", "gomti-nagar", "lucknow"]) {
    const result = await service.listHomes({
      status: "all",
      q,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    expect(result.items.map((row) => row.id)).toContain("active-home");
  }
});

it("masks inventory owner phones on the server", async () => {
  const result = await service.listHomes({
    status: "active",
    sort: "updated",
    page: 1,
    page_size: 25
  });
  expect(result.items[0].owner_phone_masked).toMatch(/X/);
  expect(result.items[0].owner_phone_masked).not.toContain("+919999999901");
});

it.each(["leads", "views", "conversion", "updated", "rent_desc", "rent_asc"] as const)(
  "applies deterministic in-memory %s sorting",
  async (sort) => {
    const result = await service.listHomes({
      status: "all",
      sort,
      page: 1,
      page_size: 25
    });
    expect(result.items).toHaveLength(3);
    expect(result.items.map((row) => row.id)).toEqual(expectedInMemoryOrderBySort[sort]);
  }
);

it("paginates the in-memory inventory and reports the unpaged total", async () => {
  installThirtyEligibleHomes(appState);
  const result = await service.listHomes({
    status: "all",
    sort: "updated",
    page: 2,
    page_size: 25
  });
  expect(result.total).toBe(30);
  expect(result.items).toHaveLength(5);
  expect(result.page).toBe(2);
  expect(result.page_size).toBe(25);
});
```

Define `expectedInMemoryOrderBySort` and `installThirtyEligibleHomes` in the
test file with explicit IDs/rents/timestamps so these tests do not derive their
expectations from the implementation.

Add a database-mode mapping test with a fake `query` router. It must assert:

- The main SQL contains `l.listing_type = 'flat_house'`.
- The main SQL contains `l.verification_status = 'verified'`.
- `limit` and `offset` are bound parameters.
- Returned Postgres numeric/string values are converted to JavaScript numbers.
- `toBlobUrl` resolves the cover photo path.

Before implementation, create `apps/api/test/admin-homes.integration.test.ts`
with the repository's `describe.runIf(!!TEST_DATABASE_URL)` pattern. Seed the
three eligible statuses plus PG, unverified, pending-review, and rejected
records; current and older views; and multiple lead states. Add RED assertions
for:

- Eligible/ineligible scope.
- Every sort value.
- Status/city/search filters.
- Pagination and page sizes.
- Full-filtered summary values.
- Server-side owner phone masking.
- Numeric aggregate coercion.
- `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` returning a plan for manual review.

- [ ] **Step 2: Run the service test and verify RED**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes.service.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @cribliv/api exec vitest run \
  test/admin-homes.integration.test.ts
```

Expected: unit test FAIL because `AdminHomesService` does not exist; DB suite
FAIL when configured and self-skip otherwise.

- [ ] **Step 3: Implement `listHomes`**

Use one filtered `base` CTE and set-based aggregates:

```sql
WITH base AS (
  SELECT l.id, l.title_en, l.title_hi, l.monthly_rent, l.status, l.updated_at,
         l.owner_user_id, ll.address_line1, c.slug AS city_slug, c.name_en AS city_name,
         loc.name_en AS locality_name, u.full_name AS owner_name, u.phone_e164 AS owner_phone
  FROM listings l
  JOIN users u ON u.id = l.owner_user_id
  LEFT JOIN listing_locations ll ON ll.listing_id = l.id
  LEFT JOIN cities c ON c.id = ll.city_id
  LEFT JOIN localities loc ON loc.id = ll.locality_id
  WHERE l.listing_type = 'flat_house'
    AND l.verification_status = 'verified'
    AND l.status IN ('active','paused','archived')
    ${whereSql}
),
event_agg AS (
  SELECT le.listing_id,
         count(*) FILTER (WHERE le.event_type = 'view')::int AS views_30d
  FROM listing_events le
  JOIN base b ON b.id = le.listing_id
  WHERE le.created_at >= now() - interval '30 days'
  GROUP BY le.listing_id
),
lead_agg AS (
  SELECT ld.listing_id,
         count(*) FILTER (WHERE ld.created_at >= now() - interval '30 days')::int AS leads_30d,
         count(*) FILTER (
           WHERE ld.status IN ('new','contacted','visit_scheduled')
             AND ld.access_state <> 'expired'
         )::int AS open_leads
  FROM leads ld JOIN base b ON b.id = ld.listing_id
  GROUP BY ld.listing_id
)
```

The page query attaches one cover photo with a `LEFT JOIN LATERAL`, uses a
whitelisted sort SQL fragment, and returns `count(*) OVER ()::int AS total`.
Run a second summary query over the same validated filters and a third query for
`available_cities`. `active_homes` ignores only the selected status predicate
while preserving city/search.

Add private helpers:

```ts
private listHomesInMemory(params: AdminHomesListParams): AdminHomesListResponse;
private maskPhone(phone?: string | null): string | null;
private ratio(numerator: number, denominator: number): number;
```

In-memory sorting uses the same six sort choices and stable `updated_at/id`
fallback ordering. Before sorting, derive each row's `leads_30d` and
`open_leads` from `appState.leads` using the same 30-day/current-state
definitions as Postgres; only `views_30d` is zero because AppState has no
listing-event store.

- [ ] **Step 4: Add controller tests and verify RED**

Write `admin-homes.controller.test.ts`:

```ts
it("sanitizes list query params and wraps the service result", async () => {
  const listHomes = vi.fn().mockResolvedValue({ items: [], total: 0 });
  const controller = new AdminHomesController({ listHomes } as any);
  const result = await controller.list("archived", "lucknow", "gomti", "views", "2", "50");
  expect(listHomes).toHaveBeenCalledWith({
    status: "archived",
    city: "lucknow",
    q: "gomti",
    sort: "views",
    page: 2,
    page_size: 50
  });
  expect(result).toMatchObject({ data: { items: [], total: 0 } });
});
```

Run:

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes.controller.test.ts
```

Expected: FAIL because the controller does not exist.

- [ ] **Step 5: Implement and register the controller**

```ts
@Controller("admin/homes")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminHomesController {
  constructor(@Inject(AdminHomesService) private readonly homes: AdminHomesService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("city") city?: string,
    @Query("q") q?: string,
    @Query("sort") sort?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string
  ) {
    return ok(
      await this.homes.listHomes(
        sanitizeAdminHomesParams({ status, city, q, sort, page, page_size: pageSize })
      )
    );
  }
}
```

Register `AdminHomesController` and `AdminHomesService` in `AdminModule`.

- [ ] **Step 6: Run focused GREEN tests and typecheck**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api exec vitest run \
  src/modules/admin/__tests__/admin-homes.params.test.ts \
  src/modules/admin/__tests__/admin-homes.service.test.ts \
  src/modules/admin/__tests__/admin-homes.controller.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @cribliv/api exec vitest run \
  test/admin-homes.integration.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: all focused tests PASS, DB integration PASS when configured (self-skip
otherwise), and API typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/admin/admin-homes.service.ts \
  apps/api/src/modules/admin/admin-homes.controller.ts \
  apps/api/src/modules/admin/admin.module.ts \
  apps/api/src/modules/admin/__tests__/admin-homes.service.test.ts \
  apps/api/src/modules/admin/__tests__/admin-homes.controller.test.ts \
  apps/api/test/admin-homes.integration.test.ts
git commit -m "feat(api): add verified homes inventory endpoint"
```

---

### Task 3: Home Detail API

**Files:**

- Modify: `apps/api/src/modules/admin/admin-homes.service.ts`
- Modify: `apps/api/src/modules/admin/admin-homes.controller.ts`
- Modify: `apps/api/src/modules/admin/__tests__/admin-homes.service.test.ts`
- Modify: `apps/api/src/modules/admin/__tests__/admin-homes.controller.test.ts`

**Interfaces:**

- Produces:

```ts
AdminHomesService.getHome(listingId: string): Promise<AdminHomeDetail>;
GET /admin/homes/:listing_id
```

- [ ] **Step 1: Write failing detail scope and fallback tests**

Add tests:

```ts
function installListingFixture(
  appState: AppStateService,
  input: {
    listingType: "flat_house" | "pg";
    verificationStatus: "unverified" | "pending" | "verified" | "failed";
    status: "draft" | "pending_review" | "active" | "rejected" | "paused" | "archived";
  }
) {
  appState.listings.clear();
  appState.listings.set("target", {
    id: "target",
    ownerUserId: [...appState.users.values()].find((user) => user.role === "owner")!.id,
    listingType: input.listingType,
    title: "Target home",
    city: "lucknow",
    monthlyRent: 15000,
    verificationStatus: input.verificationStatus,
    status: input.status,
    createdAt: Date.now()
  } as never);
}

it.each([
  ["pg", "verified", "active"],
  ["flat_house", "pending", "active"],
  ["flat_house", "verified", "pending_review"],
  ["flat_house", "verified", "rejected"]
])("rejects out-of-scope detail %s/%s/%s", async (listingType, verificationStatus, status) => {
  installListingFixture(appState, {
    listingType: listingType as "flat_house" | "pg",
    verificationStatus: verificationStatus as "unverified" | "pending" | "verified" | "failed",
    status: status as "draft" | "pending_review" | "active" | "rejected" | "paused" | "archived"
  });
  await expect(service.getHome("target")).rejects.toMatchObject({
    response: expect.objectContaining({ code: "home_not_found" })
  });
});

it("rejects a malformed listing id without querying Postgres", async () => {
  const query = vi.fn();
  const dbService = { isEnabled: () => true, query } as any;
  const dbBacked = new AdminHomesService(dbService, appState);
  await expect(dbBacked.getHome("malformed")).rejects.toMatchObject({
    response: expect.objectContaining({ code: "home_not_found" })
  });
  expect(query).not.toHaveBeenCalled();
});

it("returns a complete in-memory detail with zero metrics and no seeker phones", async () => {
  const detail = await service.getHome("active-home");
  expect(detail).toMatchObject({
    listing: { id: "active-home", verification_status: "verified" },
    metrics_30d: { views: 0 },
    public_path: "/en/listing/active-home"
  });
  expect(detail.recent_leads.every((lead) => !("seeker_phone" in lead))).toBe(true);
});
```

Add a database-mode mapping test whose fake query results cover:

- Main listing/location/owner row.
- Owner portfolio aggregation.
- Photos.
- Event and lead metrics.
- Lead status/access aggregations and median response.
- Recent lead previews.
- Verification attempts.
- Activity.

It must also assert:

```ts
expect(detail.recent_leads).toHaveLength(10);
expect(detail.recent_leads.map((lead) => lead.created_at)).toEqual(
  [...detail.recent_leads.map((lead) => lead.created_at)].sort().reverse()
);
expect(detail.photos.every((photo) => photo.moderation_status !== "rejected")).toBe(true);
expect(detail.photos[0].is_cover).toBe(true);
expect(detail.verification_attempts.map((attempt) => attempt.created_at)).toEqual(
  [...detail.verification_attempts.map((attempt) => attempt.created_at)].sort().reverse()
);
expect(detail.location?.lat).toBeTypeOf("number");
expect(detail.location?.lng).toBeTypeOf("number");
```

Extend the existing `TEST_DATABASE_URL`-gated
`apps/api/test/admin-homes.integration.test.ts` before detail implementation.
Add refunded unlock, verification attempts, photos, and activity fixtures plus
the detail assertions below. Its first detail run must fail because `getHome`
and the complete detail SQL do not yet satisfy the assertions.

- [ ] **Step 2: Run the detail tests and verify RED**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes.service.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @cribliv/api exec vitest run \
  test/admin-homes.integration.test.ts
```

Expected: unit test FAIL because `getHome` is missing; DB suite FAIL when
configured and self-skip otherwise.

- [ ] **Step 3: Implement database detail read model**

`getHome` must:

1. Query the main listing with hard scope:

```sql
WHERE l.id = $1::uuid
  AND l.listing_type = 'flat_house'
  AND l.verification_status = 'verified'
  AND l.status IN ('active','paused','archived')
```

2. Throw:

```ts
throw new NotFoundException({ code: "home_not_found", message: "Verified home not found" });
```

Validate `listingId` with the repository UUID pattern before issuing a
`$1::uuid` query. A malformed ID returns the same `home_not_found` response.

3. Run bounded, set-based detail queries in parallel after the main row:

```ts
const [ownerAgg, photos, metrics, leadSummary, recentLeads, attempts, activity] = await Promise.all(
  [
    this.loadOwnerAggregate(row.owner_id),
    this.loadPhotos(listingId),
    this.loadMetrics(listingId),
    this.loadLeadSummary(listingId),
    this.loadRecentLeads(listingId),
    this.loadVerificationAttempts(listingId),
    this.loadActivity(listingId)
  ]
);
```

4. Use these exact definitions:

- Open: status in `new/contacted/visit_scheduled` and access state not `expired`.
- Uncalled: open and `called_at IS NULL`.
- Status, access-state, called, and refunded breakdowns: leads created in the
  last 30 days.
- Open and uncalled: current lifetime state.
- Refunded: linked contact unlock has `unlock_status='refunded'`.
- Median response: `percentile_cont(0.5)` of `called_at-created_at` in minutes
  for leads created in the last 30 days with `called_at IS NOT NULL`.
- Verified at: latest `verification_attempts.created_at` where result is `pass`.

Query requirements:

- Recent leads: `ORDER BY ld.created_at DESC LIMIT 10`.
- Photos: exclude `moderation_status = 'rejected'` and order by
  `is_cover DESC, sort_order ASC, created_at ASC`.
- Verification attempts: include every attempt and order by `created_at DESC`.
- Convert Postgres numerics, including latitude/longitude, scores, rates, and
  counts, with `Number(...)` or null-preserving helpers.

5. Build activity with one `UNION ALL` query over:

- Listing created/updated synthetic rows.
- Listing-targeted `admin_actions`.
- Verification attempts and verification-decision `admin_actions` whose
  `target_type='verification_attempt'` and `target_id` belongs to a verification
  attempt for this listing.
- Leads and `lead_events`.

Order by timestamp descending and `LIMIT 100`.

6. Never select seeker phone for `recent_leads`.

- [ ] **Step 4: Implement the in-memory detail read model**

Use `AppStateService` maps and arrays:

- Return listing/owner fields that exist.
- Derive lead counts from `appState.leads`.
- Sort matching in-memory recent leads by `createdAt DESC` and cap them at 10.
- Use zero views.
- Map listing-targeted admin actions plus verification-decision actions whose
  target attempt belongs to this listing.
- Set unavailable location/photo/last-login fields to null/empty.
- Use `createdAt` as the `updated_at` and updated-sort fallback.
- Owner portfolio counts include every `flat_house` listing in
  `active/paused/archived`, regardless of verification status.
- Compute owner `lead_health` in both modes. Database mode may reuse the
  existing `computeOwnerHealth` calculator inputs; in-memory mode computes the
  available lead counts/rates and returns null score/grade when required
  recency/report inputs are unavailable.

Add in-memory assertions for:

- Owner active/paused/archived portfolio counts.
- 30-day status/access/called/refunded summaries.
- Current lifetime open/uncalled counts.
- Listing-scoped verification attempts and admin activity only.
- Recent leads ordered newest-first and capped at 10.
- Verification-decision activity excluded when its attempt belongs to another
  listing.

- [ ] **Step 5: Add and test the detail route**

Controller:

```ts
@Get(":listing_id")
async detail(@Param("listing_id") listingId: string) {
  return ok(await this.homes.getHome(listingId));
}
```

Test:

```ts
it("delegates GET /admin/homes/:id", async () => {
  const getHome = vi
    .fn()
    .mockResolvedValue({ listing: { id: "11111111-1111-4111-8111-111111111111" } });
  const controller = new AdminHomesController({ getHome } as any);
  expect(await controller.detail("11111111-1111-4111-8111-111111111111")).toMatchObject({
    data: { listing: { id: "11111111-1111-4111-8111-111111111111" } }
  });
  expect(getHome).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
});
```

- [ ] **Step 6: Run GREEN tests**

```bash
pnpm --filter @cribliv/api exec vitest run \
  src/modules/admin/__tests__/admin-homes.service.test.ts \
  src/modules/admin/__tests__/admin-homes.controller.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: all focused tests PASS and API typecheck exits 0.

- [ ] **Step 7: Complete and verify the DB-backed detail integration suite**

The integration file created in Task 2 already proves inventory SQL. Its Task 3
extension seeds:

- Leads covering every status/access state, called and uncalled state, and one
  refunded contact unlock.
- Two verification attempts for the eligible home.
- Listing-targeted admin activity and lead events.

Assertions:

```ts
expect((await service.listHomes(allParams)).items.map((row) => row.id)).toEqual(
  expect.arrayContaining([activeId, pausedId, archivedId])
);
expect((await service.listHomes(allParams)).items.map((row) => row.id)).not.toEqual(
  expect.arrayContaining([pgId, unverifiedId, pendingId, rejectedId])
);
expect((await service.getHome(activeId)).recent_leads[0]).not.toHaveProperty("seeker_phone");
expect(JSON.stringify(await service.getHome(activeId))).not.toMatch(
  /artifact_paths|submitted_payload|request_payload|response_payload/
);
```

Test detail scope, latest passing `verified_at`, privacy exclusions, ordering and
caps, portfolio/lead-health values, and numeric conversion. Task 2 already
captures the inventory `EXPLAIN`; retain its printed plan for manual release
review rather than enforcing machine-specific timing thresholds.

Run:

```bash
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @cribliv/api exec vitest run \
  test/admin-homes.integration.test.ts
```

Expected: PASS when a migrated test database is configured; self-skip otherwise.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/admin/admin-homes.service.ts \
  apps/api/src/modules/admin/admin-homes.controller.ts \
  apps/api/src/modules/admin/__tests__/admin-homes.service.test.ts \
  apps/api/src/modules/admin/__tests__/admin-homes.controller.test.ts \
  apps/api/test/admin-homes.integration.test.ts
git commit -m "feat(api): add verified home detail workspace data"
```

---

### Task 4: Lead Center Exact Listing Filter

**Files:**

- Modify: `apps/api/src/modules/leads/board-params.ts`
- Modify: `apps/api/src/modules/leads/admin-leads.controller.ts`
- Modify: `apps/api/src/modules/leads/admin-lead-ops.service.ts`
- Modify: `apps/api/src/modules/leads/__tests__/board-params.test.ts`
- Modify: `apps/api/src/modules/leads/__tests__/admin-leads.controller.test.ts`
- Modify: `apps/api/test/admin-lead-board.integration.test.ts`

**Interfaces:**

- `BoardParams.listingId?: string`.
- `RawBoardParams.listing_id?: string`.
- `GET /admin/leads/board?listing_id=<uuid>`.
- Preserve the current positional argument order and append `listingId`:

```ts
board(
  filter?: string,
  ownerId?: string,
  state?: string,
  status?: string,
  q?: string,
  range?: string,
  sort?: string,
  page?: string,
  pageSize?: string,
  listingId?: string
): Promise<unknown>;
```

- [ ] **Step 1: Write failing parser/controller tests**

Parser:

```ts
it("accepts a valid exact listing id and rejects malformed ids", () => {
  const valid = "11111111-1111-4111-8111-111111111111";
  expect(sanitizeBoardParams({ listing_id: valid }).listingId).toBe(valid);
  expect(sanitizeBoardParams({ listing_id: "not-a-uuid" }).listingId).toBeUndefined();
});
```

Controller:

```ts
it("forwards listing_id through to getBoard", async () => {
  const listingId = "11111111-1111-4111-8111-111111111111";
  await controller.board(
    "all",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "newest",
    undefined,
    undefined,
    listingId
  );
  expect(getBoard).toHaveBeenCalledWith(expect.objectContaining({ listingId }));
});
```

- [ ] **Step 2: Run RED tests**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api exec vitest run \
  src/modules/leads/__tests__/board-params.test.ts \
  src/modules/leads/__tests__/admin-leads.controller.test.ts
```

Expected: FAIL because `listing_id`/`listingId` are not wired.

- [ ] **Step 3: Implement parser and controller forwarding**

Add `listing_id` to `RawBoardParams`, validate with the existing `UUID_RE`, and
return `listingId`.

Append `@Query("listing_id") listingId?: string` after `pageSize` in the
controller signature and pass it to `sanitizeBoardParams`. Update the existing
signature comment in `admin-leads.controller.test.ts` to list all ten
parameters.

- [ ] **Step 4: Write and run a failing exact-listing integration test**

Extend `apps/api/test/admin-lead-board.integration.test.ts` to seed a second
listing and lead for the same owner. Call:

```ts
const result = await svc.getBoard({
  filter: "all",
  sort: "newest",
  listingId,
  range: "30 days"
});
expect(result.rows.every((row) => row.listing_id === listingId)).toBe(true);
expect(result.total).toBe(1);
expect(result.counters.uncalled).toBe(1);
```

Run with `TEST_DATABASE_URL`; expected RED because rows/counters include both
listings.

- [ ] **Step 5: Add the service predicate**

Immediately after owner filtering:

```ts
if (p.listingId && UUID_RE.test(p.listingId)) {
  params.push(p.listingId);
  where.push(`ld.listing_id = $${params.length}::uuid`);
}
```

The same `whereSql` must continue to drive page and total queries. Extend
`getCounters` to accept the validated `listingId` and add the same exact listing
predicate, so board rows, total, and counters agree.

- [ ] **Step 6: Run GREEN tests and typecheck**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api exec vitest run \
  src/modules/leads/__tests__/board-params.test.ts \
  src/modules/leads/__tests__/admin-leads.controller.test.ts
TEST_DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter @cribliv/api exec vitest run \
  test/admin-lead-board.integration.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/leads/board-params.ts \
  apps/api/src/modules/leads/admin-leads.controller.ts \
  apps/api/src/modules/leads/admin-lead-ops.service.ts \
  apps/api/src/modules/leads/__tests__/board-params.test.ts \
  apps/api/src/modules/leads/__tests__/admin-leads.controller.test.ts \
  apps/api/test/admin-lead-board.integration.test.ts
git commit -m "feat(admin): filter Lead Center by listing"
```

---

### Task 5: Web API and Canonical URL Utilities

**Files:**

- Modify: `apps/web/lib/admin-api.ts`
- Create: `apps/web/lib/admin-home-url.ts`
- Create: `apps/web/lib/__tests__/admin-api-homes.test.ts`
- Create: `apps/web/lib/__tests__/admin-home-url.test.ts`

**Interfaces:**

```ts
export function fetchAdminHomes(
  accessToken: string,
  params?: Partial<AdminHomesListParams>
): Promise<AdminHomesListResponse>;

export function fetchAdminHomeDetail(
  accessToken: string,
  listingId: string
): Promise<AdminHomeDetail>;

export function adminHomePublicUrl(publicPath: string): string;
export async function copyAdminHomeUrl(publicPath: string): Promise<void>;
```

- [ ] **Step 1: Write failing API forwarding tests**

Mock `../api`'s `fetchApi` following the existing admin API tests and assert:

```ts
await fetchAdminHomes("tok", {
  status: "paused",
  city: "lucknow",
  sort: "views",
  page: 2,
  page_size: 50
});

expect(mockedFetchApi).toHaveBeenCalledWith(
  "/admin/homes?status=paused&city=lucknow&sort=views&page=2&page_size=50",
  { headers: { Authorization: "Bearer tok" } }
);
```

Also assert `fetchAdminHomeDetail("tok", "11111111-1111-4111-8111-111111111111")` requests
`/admin/homes/11111111-1111-4111-8111-111111111111`.

- [ ] **Step 2: Write failing URL/clipboard tests**

```ts
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) {
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
});

it("builds an absolute production URL without using window.location", () => {
  expect(adminHomePublicUrl("/en/listing/11111111-1111-4111-8111-111111111111")).toBe(
    "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111"
  );
});

it("copies with navigator.clipboard when available", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  await copyAdminHomeUrl("/en/listing/11111111-1111-4111-8111-111111111111");
  expect(writeText).toHaveBeenCalledWith(
    "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111"
  );
});

it("falls back to a temporary textarea and execCommand", async () => {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    configurable: true
  });
  const execCommand = vi.spyOn(document, "execCommand").mockReturnValue(true);
  await copyAdminHomeUrl("/en/listing/11111111-1111-4111-8111-111111111111");
  expect(execCommand).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
});

it("throws when both clipboard strategies fail", async () => {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  vi.spyOn(document, "execCommand").mockReturnValue(false);
  await expect(
    copyAdminHomeUrl("/en/listing/11111111-1111-4111-8111-111111111111")
  ).rejects.toThrow("copy_failed");
  expect(document.querySelector("textarea")).toBeNull();
});
```

- [ ] **Step 3: Run RED tests**

```bash
pnpm --filter @cribliv/web exec vitest run \
  lib/__tests__/admin-api-homes.test.ts \
  lib/__tests__/admin-home-url.test.ts
```

Expected: FAIL because the functions/files do not exist.

- [ ] **Step 4: Implement API wrappers**

Use shared contracts and existing helpers:

```ts
export async function fetchAdminHomes(
  accessToken: string,
  params: Partial<AdminHomesListParams> = {}
) {
  const qs = buildSearchQuery(params as Record<string, string | number | boolean | undefined>);
  return fetchApi<AdminHomesListResponse>(`/admin/homes${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}

export async function fetchAdminHomeDetail(accessToken: string, listingId: string) {
  return fetchApi<AdminHomeDetail>(`/admin/homes/${listingId}`, {
    headers: authHeaders(accessToken)
  });
}
```

Add `listing_id?: string` to `AdminLeadBoardParams` and query forwarding.

- [ ] **Step 5: Implement canonical URL and clipboard fallback**

```ts
export function adminHomePublicUrl(publicPath: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com").replace(/\/+$/, "");
  const path = publicPath.startsWith("/") ? publicPath : `/${publicPath}`;
  return `${siteUrl}${path}`;
}

export async function copyAdminHomeUrl(publicPath: string): Promise<void> {
  const url = adminHomePublicUrl(publicPath);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // Fall through to the selection-based copy path.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  let copied = false;
  try {
    textarea.select();
    copied = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!copied) throw new Error("copy_failed");
}
```

- [ ] **Step 6: Run GREEN tests and web typecheck**

```bash
pnpm --filter @cribliv/web exec vitest run \
  lib/__tests__/admin-api-homes.test.ts \
  lib/__tests__/admin-home-url.test.ts
pnpm --filter @cribliv/web typecheck
```

Expected: tests PASS and web typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/admin-api.ts apps/web/lib/admin-home-url.ts \
  apps/web/lib/__tests__/admin-api-homes.test.ts \
  apps/web/lib/__tests__/admin-home-url.test.ts
git commit -m "feat(web): add admin homes API and URL helpers"
```

---

### Task 6: Verified Homes Inventory UI

**Files:**

- Create: `apps/web/components/admin/homes/AdminHomesTab.tsx`
- Create: `apps/web/components/admin/homes/HomesInventory.tsx`
- Create: `apps/web/components/admin/homes/__tests__/HomesInventory.test.tsx`
- Modify: `apps/web/components/admin/shell/AdminSidebar.tsx`
- Modify: `apps/web/components/admin/shell/AdminShell.tsx`
- Modify: `apps/web/components/admin/shell/CommandPalette.tsx`
- Modify: `apps/web/components/admin/admin.css`
- Modify/create shell tests for the new tab.

**Interfaces:**

```ts
export function AdminHomesTab(props: {
  accessToken: string;
  initialListingId?: string | null;
  onOpenListingReview: (listingId: string) => void;
  onOpenLeadCenter: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}): JSX.Element;

interface AdminHomesQueryState {
  status: AdminHomeStatusFilter;
  city: string;
  q: string;
  sort: AdminHomeSort;
  page: number;
  pageSize: 25 | 50 | 100;
}

export function HomesInventory(props: {
  accessToken: string;
  query: AdminHomesQueryState;
  onQueryChange: (next: AdminHomesQueryState) => void;
  onSelect: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}): JSX.Element;
```

- [ ] **Step 1: Write failing inventory tests**

Mock `fetchAdminHomes`, `fetchAdminHomeDetail`, and `copyAdminHomeUrl`. Define:

```ts
const homeRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "2BHK in Gomti Nagar",
  city_slug: "lucknow",
  city_name: "Lucknow",
  locality_name: "Gomti Nagar",
  monthly_rent: 22000,
  owner_id: "O1",
  owner_name: "Ramesh Gupta",
  owner_phone_masked: "XXXXXXXX9901",
  status: "active" as const,
  cover_photo_url: null,
  views_30d: 428,
  leads_30d: 14,
  open_leads: 4,
  conversion_rate: 14 / 428,
  updated_at: "2026-07-15T08:00:00.000Z",
  public_path: "/en/listing/11111111-1111-4111-8111-111111111111"
};

const homeListFixture = {
  items: [homeRow],
  total: 1,
  page: 1,
  page_size: 25 as const,
  filters: { status: "active" as const, city: null, q: null, sort: "leads" as const },
  available_cities: [{ slug: "lucknow", name: "Lucknow", count: 1 }],
  summary: { active_homes: 1, views_30d: 428, leads_30d: 14, needs_attention: 1 }
};

const emptyActiveHomeListFixture = {
  ...homeListFixture,
  items: [],
  total: 0,
  available_cities: [],
  summary: { active_homes: 0, views_30d: 0, leads_30d: 0, needs_attention: 0 }
};

it("loads active homes with leads sort by default", async () => {
  render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await waitFor(() =>
    expect(fetchAdminHomes).toHaveBeenCalledWith("tok", {
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    })
  );
});

it("renders agreed columns and copies without opening the workspace", async () => {
  mockedFetchAdminHomes.mockResolvedValueOnce(homeListFixture);
  render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await screen.findByText("2BHK in Gomti Nagar");
  expect(screen.getByText("Views 30d")).toBeInTheDocument();
  expect(screen.getByText("Leads 30d")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /copy public url/i }));
  expect(copyAdminHomeUrl).toHaveBeenCalledWith("/en/listing/11111111-1111-4111-8111-111111111111");
  expect(fetchAdminHomeDetail).not.toHaveBeenCalled();
});

it("opens an active inventory row public page without opening the workspace", async () => {
  mockedFetchAdminHomes.mockResolvedValueOnce(homeListFixture);
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await screen.findByText("2BHK in Gomti Nagar");
  fireEvent.click(screen.getByRole("button", { name: /open public page/i }));
  expect(open).toHaveBeenCalledWith(
    "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111",
    "_blank",
    "noopener,noreferrer"
  );
  expect(fetchAdminHomeDetail).not.toHaveBeenCalled();
});

it("resets page one when filters change and shows all verified from empty active state", async () => {
  mockedFetchAdminHomes.mockResolvedValue(emptyActiveHomeListFixture);
  render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  fireEvent.click(await screen.findByRole("button", { name: "Show all verified" }));
  await waitFor(() =>
    expect(mockedFetchAdminHomes).toHaveBeenLastCalledWith(
      "tok",
      expect.objectContaining({ status: "all", page: 1 })
    )
  );
});

it("preserves filters and page after opening a workspace and returning", async () => {
  render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  fireEvent.change(await screen.findByLabelText("Home status"), {
    target: { value: "paused" }
  });
  fireEvent.click(screen.getByText("2BHK in Gomti Nagar"));
  fireEvent.click(await screen.findByRole("button", { name: "Back to verified homes" }));
  expect(screen.getByLabelText("Home status")).toHaveValue("paused");
});

it("forwards search, city, sort, and page-size changes and resets page one", async () => {
  render(
    <AdminHomesTab
      accessToken="tok"
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  fireEvent.change(await screen.findByLabelText("Search verified homes"), {
    target: { value: "gomti" }
  });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "lucknow" } });
  fireEvent.change(screen.getByLabelText("Sort homes"), { target: { value: "views" } });
  fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "50" } });
  await waitFor(
    () =>
      expect(mockedFetchAdminHomes).toHaveBeenLastCalledWith(
        "tok",
        expect.objectContaining({
          q: "gomti",
          city: "lucknow",
          sort: "views",
          page: 1,
          page_size: 50
        })
      ),
    { timeout: 1_000 }
  );
});

it.each(["paused", "archived"] as const)(
  "shows no public URL actions for %s inventory rows",
  async (status) => {
    mockedFetchAdminHomes.mockResolvedValueOnce({
      ...homeListFixture,
      items: [{ ...homeRow, status }]
    });
    render(
      <AdminHomesTab
        accessToken="tok"
        onOpenListingReview={vi.fn()}
        onOpenLeadCenter={vi.fn()}
        onToast={vi.fn()}
      />
    );
    expect(await screen.findByText("Not publicly available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy public url/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open public page/i })).not.toBeInTheDocument();
  }
);
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @cribliv/web exec vitest run components/admin/homes/__tests__/HomesInventory.test.tsx
```

Expected: FAIL because the homes components do not exist.

- [ ] **Step 3: Implement inventory state and data flow**

`AdminHomesTab` owns both selection and the complete query state so replacing the
inventory with the workspace does not reset filters:

```ts
const [selectedId, setSelectedId] = useState<string | null>(initialListingId ?? null);
const [query, setQuery] = useState<AdminHomesQueryState>({
  status: "active",
  city: "",
  q: "",
  sort: "leads",
  page: 1,
  pageSize: 25
});
```

`HomesInventory` receives the controlled `query` and `onQueryChange`. It may
hold only transient request state (`loading`, `error`, fetched data, and the
300ms debounced search value).

- Debounce search by 300ms.
- Reset page to 1 for status/city/search/sort/page-size changes.
- Preserve filter state when returning from workspace.
- Render a feature-specific semantic `<table>` on desktop so rows can carry
  `data-admin-home-row`. Do not extend or modify the generic `DataTable`.
- Render `.admin-homes-mobile-list` stacked records below 760px.
- Add `data-admin-home-row` to desktop rows and mobile records for E2E targeting.
- Action buttons call `stopPropagation`.
- Copy success: `onToast("Public URL copied", "trust")`.
- Copy failure: `onToast("Could not copy public URL", "danger")`.
- Open public page uses
  `window.open(adminHomePublicUrl(row.public_path), "_blank", "noopener,noreferrer")`.

Use Lucide `Copy`, `ExternalLink`, `House`, and `Search`.

- [ ] **Step 4: Add shell navigation with a failing shell test**

Add `"homes"` to `AdminTab`, title `"Verified Homes"`, sidebar item under
Understand, command-palette item, and shell view.

At this task boundary, pass the existing `openListingReview` callback and a
temporary `onOpenLeadCenter={() => setTab("lead-center")}` callback so the new
tab compiles. Task 8 replaces the temporary callback with the exact-listing
target state and proves the full handoff.

Test:

```ts
it("navigates to Verified Homes and renders the homes tab", () => {
  // click mocked sidebar homes control
  expect(screen.getByTestId("homes-tab")).toBeInTheDocument();
});
```

- [ ] **Step 5: Add inventory CSS**

Add scoped classes:

```css
.admin-homes-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.admin-homes-thumb {
  width: 72px;
  aspect-ratio: 4/3;
  object-fit: cover;
  border-radius: 6px;
}
.admin-homes-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}
.admin-homes-icon-action {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
}
.admin-homes-mobile-list {
  display: none;
}
@media (max-width: 760px) {
  .admin-homes-desktop-table {
    display: none;
  }
  .admin-homes-mobile-list {
    display: grid;
    gap: 8px;
  }
  .admin-homes-icon-action {
    width: 44px;
    height: 44px;
  }
}
```

Use full-row records, not nested cards inside section cards.

- [ ] **Step 6: Run GREEN tests and typecheck**

```bash
pnpm --filter @cribliv/web exec vitest run \
  components/admin/homes/__tests__/HomesInventory.test.tsx \
  components/admin/shell/__tests__/AdminShell.crossnav.test.tsx
pnpm --filter @cribliv/web typecheck
```

Expected: focused tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/admin/homes/AdminHomesTab.tsx \
  apps/web/components/admin/homes/HomesInventory.tsx \
  apps/web/components/admin/homes/__tests__/HomesInventory.test.tsx \
  apps/web/components/admin/shell/AdminSidebar.tsx \
  apps/web/components/admin/shell/AdminShell.tsx \
  apps/web/components/admin/shell/CommandPalette.tsx \
  apps/web/components/admin/shell/__tests__ \
  apps/web/components/admin/admin.css
git commit -m "feat(web): add verified homes inventory"
```

---

### Task 7: Full Home Workspace

**Files:**

- Create: `apps/web/components/admin/homes/AdminHomeWorkspace.tsx`
- Create: `apps/web/components/admin/homes/HomeOverviewTab.tsx`
- Create: `apps/web/components/admin/homes/HomePropertyTab.tsx`
- Create: `apps/web/components/admin/homes/HomeLeadsTab.tsx`
- Create: `apps/web/components/admin/homes/HomeVerificationTab.tsx`
- Create: `apps/web/components/admin/homes/HomeOwnerTab.tsx`
- Create: `apps/web/components/admin/homes/HomeActivityTab.tsx`
- Create: `apps/web/components/admin/homes/__tests__/AdminHomeWorkspace.test.tsx`
- Modify: `apps/web/components/admin/homes/AdminHomesTab.tsx`
- Modify: `apps/web/components/admin/admin.css`

**Interfaces:**

```ts
export function AdminHomeWorkspace(props: {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onOpenListingReview: (listingId: string) => void;
  onOpenLeadCenter: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}): JSX.Element;
```

- [ ] **Step 1: Write failing workspace tests**

Use this complete `AdminHomeDetail` fixture:

```ts
const homeDetailFixture = {
  listing: {
    id: "11111111-1111-4111-8111-111111111111",
    title_en: "2BHK in Gomti Nagar",
    title_hi: null,
    description_en: "Furnished verified home",
    description_hi: null,
    status: "active" as const,
    verification_status: "verified" as const,
    monthly_rent: 22000,
    security_deposit: 44000,
    available_from: "2026-08-01",
    furnishing: "fully_furnished",
    bhk: 2,
    bathrooms: 2,
    area_sqft: 1050,
    preferred_tenant: "family",
    whatsapp_available: true,
    amenities: ["parking"],
    rules: { pets: false },
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-15T08:00:00.000Z",
    last_owner_activity_at: "2026-07-15T07:00:00.000Z"
  },
  location: {
    address_line1: "Vibhuti Khand",
    landmark: "Near metro",
    pincode: "226010",
    lat: 26.8467,
    lng: 80.9462,
    masked_address: "Gomti Nagar, Lucknow",
    locality_name: "Gomti Nagar",
    city_slug: "lucknow",
    city_name: "Lucknow"
  },
  photos: [],
  owner: {
    id: "O1",
    name: "Ramesh Gupta",
    phone: "+919999999901",
    whatsapp_opt_in: true,
    preferred_language: "en",
    role: "owner",
    is_blocked: false,
    member_since: "2026-01-01T00:00:00.000Z",
    last_login_at: "2026-07-15T07:00:00.000Z",
    active_homes: 1,
    paused_homes: 0,
    archived_homes: 0,
    report_count: 0,
    lead_health: {
      health_score: 86,
      health_grade: "A" as const,
      leads_30d: 14,
      called_rate_30d: 10 / 14,
      refund_rate_30d: 0,
      median_response_minutes_30d: 42
    }
  },
  metrics_30d: { views: 428, leads: 14, open_leads: 4, conversion_rate: 14 / 428 },
  lead_summary: {
    by_status: { new: 4, contacted: 6, visit_scheduled: 3, deal_done: 1, lost: 0 },
    by_access_state: { free: 10, locked: 1, unlocked: 3, expired: 0 },
    called: 10,
    uncalled: 4,
    refunded: 0,
    open: 4,
    median_response_minutes: 42
  },
  recent_leads: [
    {
      lead_id: "LD1",
      seeker_name: "Seeker One",
      access_state: "free" as const,
      status: "new" as const,
      called_at: null,
      called_by: null,
      response_deadline_at: null,
      refund_state: "pending" as const,
      created_at: "2026-07-15T06:00:00.000Z"
    }
  ],
  verification_status: "verified" as const,
  verified_at: "2026-07-10T08:00:00.000Z",
  verification_attempts: [
    {
      attempt_id: "V1",
      kind: "video_liveness" as const,
      result: "pass" as const,
      liveness_score: 96,
      address_match_score: null,
      threshold: 85,
      provider: "mock",
      provider_result_code: "PASS",
      review_reason: null,
      artifact_available: true,
      reviewed_by: "A1",
      reviewed_at: "2026-07-10T08:00:00.000Z",
      created_at: "2026-07-10T07:00:00.000Z"
    }
  ],
  activity: [],
  public_path: "/en/listing/11111111-1111-4111-8111-111111111111"
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchAdminHomeDetail.mockResolvedValue(homeDetailFixture);
  vi.spyOn(window, "open").mockReturnValue(null);
});

it("loads the selected home and exposes all six tabs", async () => {
  render(
    <AdminHomeWorkspace
      accessToken="tok"
      listingId="11111111-1111-4111-8111-111111111111"
      onBack={vi.fn()}
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await screen.findByText("2BHK in Gomti Nagar");
  for (const label of ["Overview", "Property", "Leads", "Verification", "Owner", "Activity"]) {
    expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  }
});

it("copies, opens the active public page, and delegates moderation to Listing Review", async () => {
  const onOpenListingReview = vi.fn();
  render(
    <AdminHomeWorkspace
      accessToken="tok"
      listingId="11111111-1111-4111-8111-111111111111"
      onBack={vi.fn()}
      onOpenListingReview={onOpenListingReview}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await screen.findByText("2BHK in Gomti Nagar");
  fireEvent.click(screen.getByRole("button", { name: "Copy public URL" }));
  expect(copyAdminHomeUrl).toHaveBeenCalledWith("/en/listing/11111111-1111-4111-8111-111111111111");
  fireEvent.click(screen.getByRole("button", { name: "Open public page" }));
  expect(window.open).toHaveBeenCalledWith(
    "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111",
    "_blank",
    "noopener,noreferrer"
  );
  fireEvent.click(screen.getByRole("button", { name: "Open in Listing Review" }));
  expect(onOpenListingReview).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
});

it.each(["paused", "archived"] as const)(
  "hides public actions for %s homes",
  async (status) => {
    mockedFetchAdminHomeDetail.mockResolvedValueOnce({
      ...homeDetailFixture,
      listing: { ...homeDetailFixture.listing, status }
    });
    render(
      <AdminHomeWorkspace
        accessToken="tok"
        listingId="11111111-1111-4111-8111-111111111111"
        onBack={vi.fn()}
        onOpenListingReview={vi.fn()}
        onOpenLeadCenter={vi.fn()}
        onToast={vi.fn()}
      />
    );
    expect(await screen.findByText("Not publicly available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy public URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open public page" })).not.toBeInTheDocument();
  }
);

it("shows recent lead metrics but delegates actions to Lead Center", async () => {
  const onOpenLeadCenter = vi.fn();
  render(
    <AdminHomeWorkspace
      accessToken="tok"
      listingId="11111111-1111-4111-8111-111111111111"
      onBack={vi.fn()}
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={onOpenLeadCenter}
      onToast={vi.fn()}
    />
  );
  await screen.findByText("2BHK in Gomti Nagar");
  fireEvent.click(screen.getByRole("button", { name: "Leads" }));
  expect(screen.getByText("Seeker One")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /call/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /manage in lead center/i }));
  expect(onOpenLeadCenter).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
});

it("reuses secure verification evidence loading", async () => {
  render(
    <AdminHomeWorkspace
      accessToken="tok"
      listingId="11111111-1111-4111-8111-111111111111"
      onBack={vi.fn()}
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await screen.findByText("2BHK in Gomti Nagar");
  fireEvent.click(screen.getByRole("button", { name: "Verification" }));
  expect(screen.getByRole("button", { name: /play liveness video/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @cribliv/web exec vitest run components/admin/homes/__tests__/AdminHomeWorkspace.test.tsx
```

Expected: FAIL because the workspace files do not exist.

- [ ] **Step 3: Implement workspace shell and header**

The workspace:

- Fetches `fetchAdminHomeDetail(accessToken, listingId)` on mount.
- Shows loading skeleton, retryable error, and not-found state.
- Defaults to `overview`.
- Renders horizontally scrollable tab controls.
- Uses `StatusPill`, `StatCard`, and Lucide icons.
- Calls `copyAdminHomeUrl` with toast handling.
- Uses the absolute public URL helper for `window.open`.
- Shows **Open in Listing Review** as a navigation command, not a mutation.

KPI values:

```ts
[
  ["Views 30d", detail.metrics_30d.views],
  ["Leads 30d", detail.metrics_30d.leads],
  ["Open leads", detail.metrics_30d.open_leads],
  ["Conversion", `${Math.round(detail.metrics_30d.conversion_rate * 100)}%`],
  ["Last owner activity", formatRelativeTime(detail.listing.last_owner_activity_at)]
];
```

- [ ] **Step 4: Implement focused tab components**

`HomeOverviewTab`:

- Cover/gallery, highlights, location, lead health, owner response, and
  verification summary.

`HomePropertyTab`:

- Reuse `PhotoGallery` by mapping `AdminHomePhoto` to its expected shape.
- Reuse/adapt read-only `PropertySpecs` and `LocationBlock`.
- Show both language titles/descriptions, amenities, and JSON rules.

`HomeLeadsTab`:

- Status/access-state grids.
- Called, uncalled, refunded, open, and median response metrics.
- Recent lead table without phone/call actions.
- One **Manage in Lead Center** command.

`HomeVerificationTab`:

- Verified date.
- Attempt metadata table.
- Reuse `VerificationEvidence` with mapped items and existing artifact fetcher.

`HomeOwnerTab`:

- Full owner identity and portfolio counts.
- No owner mutation controls.

`HomeActivityTab`:

- Reverse-chronological list, capped by API.
- Empty state when no activity.

- [ ] **Step 5: Add workspace responsive CSS**

Use:

```css
.admin-home-workspace__header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  flex-wrap: wrap;
}
.admin-home-workspace__tabs {
  display: flex;
  overflow-x: auto;
  gap: 6px;
}
.admin-home-workspace__grid {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
  gap: 16px;
}
@media (max-width: 900px) {
  .admin-home-workspace__grid {
    grid-template-columns: 1fr;
  }
}
```

Keep tab buttons and header actions at 44px on touch layouts.

- [ ] **Step 6: Run GREEN tests and typecheck**

```bash
pnpm --filter @cribliv/web exec vitest run \
  components/admin/homes/__tests__/AdminHomeWorkspace.test.tsx \
  components/admin/homes/__tests__/HomesInventory.test.tsx
pnpm --filter @cribliv/web typecheck
```

Expected: focused tests PASS and web typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/admin/homes apps/web/components/admin/admin.css
git commit -m "feat(web): add verified home workspace"
```

---

### Task 8: Shell Cross-Navigation, Lead Center UX, and Integration Verification

**Files:**

- Modify: `apps/web/components/admin/shell/AdminShell.tsx`
- Modify: `apps/web/components/admin/lead-center/LeadCenterTab.tsx`
- Modify: `apps/web/components/admin/lead-center/LeadBoard.tsx`
- Modify: `apps/web/components/admin/shell/__tests__/AdminShell.crossnav.test.tsx`
- Modify: `apps/web/components/admin/lead-center/__tests__/LeadCenterTab.test.tsx`
- Create: `apps/web/tests/admin-verified-homes.spec.ts`
- Create: `docs/superpowers/reports/2026-07-15-admin-homes-explain-review.md`
- Modify: `docs/superpowers/plans/2026-07-15-admin-verified-homes-inventory.md` only to check completed boxes during execution.

**Interfaces:**

- `AdminShell.openHome(listingId)`.
- `AdminShell.openListingReview(listingId)` remains supported.
- `AdminShell.openLeadCenterForListing(listingId)`.
- `LeadCenterTab.initialListingId?: string | null`.
- `LeadBoard.initialListingId?: string | null`.

- [ ] **Step 1: Write failing shell and Lead Center handoff tests**

In `AdminShell.crossnav.test.tsx`, mock the homes and Lead Center tabs:

```ts
vi.mock("../../homes/AdminHomesTab", () => ({
  AdminHomesTab: ({
    onOpenLeadCenter,
    onOpenListingReview
  }: {
    onOpenLeadCenter: (id: string) => void;
    onOpenListingReview: (id: string) => void;
  }) => (
    <div>
      <button onClick={() => onOpenLeadCenter("11111111-1111-4111-8111-111111111111")}>
        open-home-leads
      </button>
      <button onClick={() => onOpenListingReview("11111111-1111-4111-8111-111111111111")}>
        open-home-review
      </button>
    </div>
  )
}));

vi.mock("../../lead-center/LeadCenterTab", () => ({
  LeadCenterTab: ({ initialListingId }: { initialListingId?: string | null }) => (
    <div>lead-center:{initialListingId ?? "none"}</div>
  )
}));
```

Extend the existing `AdminSidebar` mock with a `go-homes` button that invokes
`onChange("homes")`.

Shell:

```ts
it("opens Lead Center with the listing selected from Verified Homes", async () => {
  render(<AdminShell accessToken="tok" />);
  fireEvent.click(screen.getByText("go-homes"));
  fireEvent.click(await screen.findByText("open-home-leads"));
  expect(await screen.findByText("lead-center:11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
});

it("opens Listing Review with the listing selected from Verified Homes", async () => {
  render(<AdminShell accessToken="tok" />);
  fireEvent.click(screen.getByText("go-homes"));
  fireEvent.click(await screen.findByText("open-home-review"));
  expect(await screen.findByText("listing-tab:11111111-1111-4111-8111-111111111111")).toBeInTheDocument();
});
```

Lead Center:

```ts
it("initializes exact listing mode and allows clearing it", async () => {
  render(
    <LeadCenterTab
      accessToken="tok"
      initialListingId="11111111-1111-4111-8111-111111111111"
      onCountChange={vi.fn()}
      onToast={vi.fn()}
    />
  );
  await waitFor(() =>
    expect(fetchAdminLeadBoard).toHaveBeenCalledWith(
      "tok",
      expect.objectContaining({
        filter: "all",
        sort: "newest",
        listing_id: "11111111-1111-4111-8111-111111111111",
        page: 1
      })
    )
  );
  fireEvent.click(await screen.findByRole("button", { name: /clear listing filter/i }));
  await waitFor(() =>
    expect(fetchAdminLeadBoard).toHaveBeenLastCalledWith(
      "tok",
      expect.not.objectContaining({ listing_id: "11111111-1111-4111-8111-111111111111" })
    )
  );
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @cribliv/web exec vitest run \
  components/admin/shell/__tests__/AdminShell.crossnav.test.tsx \
  components/admin/lead-center/__tests__/LeadCenterTab.test.tsx
```

Expected: FAIL because listing-targeted Lead Center props/state are absent.

- [ ] **Step 3: Implement shell target state**

Add:

```ts
const [homeTarget, setHomeTarget] = useState<string | null>(null);
const [leadCenterListingTarget, setLeadCenterListingTarget] = useState<string | null>(null);

const openHome = useCallback((listingId: string) => {
  setHomeTarget(listingId);
  setTab("homes");
}, []);

const openLeadCenterForListing = useCallback((listingId: string) => {
  setLeadCenterListingTarget(listingId);
  setTab("lead-center");
}, []);
```

Pass `initialListingId` and navigation callbacks to the relevant tabs. Clear
one-shot home/listing-review targets when leaving their tabs. Clear
`leadCenterListingTarget` when leaving Lead Center; the in-tab removable chip
clears the active filter without changing tabs.

- [ ] **Step 4: Implement exact-listing Lead Center UX**

`LeadCenterTab` receives `initialListingId`.

`LeadBoard` initializes:

```ts
const [listingId, setListingId] = useState(initialListingId ?? "");
const [filter, setFilter] = useState<AdminLeadBoardFilter>(initialListingId ? "all" : "all");
const [sort, setSort] = useState<AdminLeadBoardSort>(initialListingId ? "newest" : "urgency");
```

The request includes `listing_id: listingId || undefined`.

Render a visible chip:

```tsx
{
  listingId && (
    <button
      type="button"
      className="admin-chip"
      aria-label="Clear listing filter"
      onClick={() => setListingId("")}
    >
      Listing {listingId.slice(0, 8)} ×
    </button>
  );
}
```

Do not add or duplicate lead actions.

- [ ] **Step 5: Add the Playwright workflow**

Create `apps/web/tests/admin-verified-homes.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

test("admin can inspect a verified home and open its public page and leads", async ({
  page,
  request
}) => {
  const admin = await loginAsRole(request, "admin");
  await setSessionOnPage(page, admin);
  await page.goto("/en/admin");
  await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();
  await page.getByRole("button", { name: "Verified Homes" }).click();
  await expect(page.getByRole("heading", { name: "Verified Homes" })).toBeVisible();
  await page.locator("[data-admin-home-row]").first().click();
  await expect(page.getByRole("button", { name: "Copy public URL" })).toBeVisible();
  const [publicPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Open public page" }).click()
  ]);
  await expect(publicPage).toHaveURL(/\/en\/listing\/[0-9a-f-]+$/);
  await publicPage.close();
  await page.getByRole("button", { name: "Leads" }).click();
  await page.getByRole("button", { name: "Manage in Lead Center" }).click();
  await expect(page.getByRole("heading", { name: "Lead Center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear listing filter" })).toBeVisible();
});
```

The in-memory `AppStateService` seed already contains one active verified
`flat_house`, so this workflow runs without Postgres. Invoke this E2E with
`FF_ADMIN_LEAD_CENTER=true` so the empty in-memory Lead Center still renders the
exact listing chip:

```bash
FF_ADMIN_LEAD_CENTER=true pnpm --filter @cribliv/web test:e2e -- admin-verified-homes.spec.ts
```

- [ ] **Step 6: Run GREEN focused tests**

```bash
pnpm --filter @cribliv/web exec vitest run \
  components/admin/shell/__tests__/AdminShell.crossnav.test.tsx \
  components/admin/lead-center/__tests__/LeadCenterTab.test.tsx \
  components/admin/homes/__tests__/HomesInventory.test.tsx \
  components/admin/homes/__tests__/AdminHomeWorkspace.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 7: Run complete verification**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api test
pnpm --filter @cribliv/web test
pnpm typecheck
pnpm lint
pnpm build
FF_ADMIN_LEAD_CENTER=true pnpm --filter @cribliv/web test:e2e -- admin-verified-homes.spec.ts
```

Expected: every command exits 0. If a pre-existing unrelated failure appears,
record the exact command and failure, verify the feature-focused suites remain
green, and do not hide or relabel the failure.

- [ ] **Step 8: Browser QA**

Start the app:

```bash
pnpm dev
```

Verify with Playwright/browser screenshots at:

- Desktop: `1440x1000`.
- Tablet: `900x1100`.
- Mobile: `390x844`.

Check:

- Inventory data and actions do not overlap.
- Mobile records preserve every agreed field.
- Workspace tabs remain reachable.
- Header and action text fit.
- Copy URL toast appears.
- Public page opens the canonical home URL.
- Lead Center opens with a removable exact listing chip.
- Verification artifact controls render without exposing URLs before click.
- Browser console has no new errors.

When `TEST_DATABASE_URL` is configured, also run the DB-backed admin homes and
Lead Center integration tests and capture `EXPLAIN (ANALYZE, BUFFERS)` for the
inventory query. Without `TEST_DATABASE_URL`, report those gates as skipped
rather than claiming Postgres query correctness or performance evidence.

Record a manual performance verdict in
`docs/superpowers/reports/2026-07-15-admin-homes-explain-review.md` containing:

```text
Database dataset size:
Observed plan:
Unexpected sequential scans:
Aggregate/sort spill:
Decision: acceptable without migration | migration required before release
Reviewer:
Date:
```

The release gate passes only when the decision is `acceptable without
migration`. A `migration required before release` decision stops completion and
requires a separate user-approved migration plan.

- [ ] **Step 9: Commit**

```bash
git add apps/web/components/admin/shell/AdminShell.tsx \
  apps/web/components/admin/lead-center/LeadCenterTab.tsx \
  apps/web/components/admin/lead-center/LeadBoard.tsx \
  apps/web/components/admin/shell/__tests__/AdminShell.crossnav.test.tsx \
  apps/web/components/admin/lead-center/__tests__/LeadCenterTab.test.tsx \
  apps/web/tests/admin-verified-homes.spec.ts \
  docs/superpowers/reports/2026-07-15-admin-homes-explain-review.md \
  docs/superpowers/plans/2026-07-15-admin-verified-homes-inventory.md
git commit -m "test(admin): verify homes workspace integration"
```

---

## Final Review Gate

After Task 8:

1. Generate a whole-branch review package from the branch merge base.
2. Run a Sol Extra High review against this plan and the approved design spec.
3. Fix every Critical or Important finding with one Terra fix subagent.
4. Re-run the covering focused tests and the complete verification commands.
5. Run a Luna Medium mechanical closeout that checks git status, test/build
   evidence, and browser-QA evidence.
6. Do not push or create a pull request unless the user separately authorizes it.
