# Verified PGs Admin Surface — Implementation Plan (v2, re-verified 2026-07-22)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **v2 note:** This plan was re-verified against the codebase on 2026-07-22 after significant PG/migration/admin churn (migrations now at `0066`; the PG wizard, deposit, and amenities work landed). Four design decisions changed from v1 — see **Decision Log**. Every file path, line reference, column, and enum below was checked against the working tree at commit `0d55a98`.

**Goal:** Bring the admin **PG Listings** tab (`PgPropertiesTab`) and its endpoint `GET /admin/pg/listings` up to **Verified Homes** parity — verification/status/city/sort filters, debounced search, server pagination, cover + rent + gender columns, and one-click copy/open of the **public URL** (`/en/pg/{city}/{id}`) — plus copy/open in the detail header, without touching the working Verified Homes tab.

**Architecture:** Read/projection + UI only — **no DB migration** (every field already exists). Extend `PgAdminPropertiesService.listListings` to return an envelope `{ items, total, page, page_size, filters, available_cities, summary }` mirroring `AdminHomesListResponse`; add a param sanitizer mirroring `admin-homes.params.ts`; add a **shared** web URL helper; upgrade `PgPropertiesTab` + `PgListingDetail` by copying the _structure_ of `HomesInventory.tsx` (copy the pattern; do **not** import homes components — different data shape).

**Tech Stack:** NestJS (api, `/v1`), Next.js 14 App Router (web), `@cribliv/shared-types`, Postgres/PostGIS, Vitest (api + web, both `vitest run`), TypeScript strict, pnpm.

---

## Decision Log (owner-approved 2026-07-22 — do not re-litigate)

| #      | Decision                                                                                                                                                                                                               | Rationale (verified)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | **"Verified" reads `listings.verification_status`, not `pg_listings.verification_status`.** Join `LEFT JOIN listings l ON l.id = pl.id` and use `COALESCE(l.verification_status::text, pl.verification_status::text)`. | **`pg_listings.verification_status` has zero readers in `apps/api`** — it is written on insert, by the V1 import, and by review approval, and consulted by nothing. Every consumer reads the `listings` projection: search ([search.service.ts:476](../../../apps/api/src/modules/search/search.service.ts)), map ([map.service.ts:164](../../../apps/api/src/modules/map/map.service.ts)), Verified Homes ([admin-homes.service.ts:428](../../../apps/api/src/modules/admin/admin-homes.service.ts)), PG score ([pg-score.service.ts:59](../../../apps/api/src/modules/pg-operator/services/pg-score.service.ts)), PG search ([pg-search.service.ts:223](../../../apps/api/src/modules/pg-operator/services/pg-search.service.ts)) — and [pg-listing.service.ts:815](../../../apps/api/src/modules/pg-operator/services/pg-listing.service.ts) states it outright in a comment: _"verification lives on the public projection"_. D1 therefore conforms to the established convention rather than working around it. Filtering on the PG head would hide PGs the public site badges as verified. The `COALESCE` fallback covers only the case where a `listings` row is missing entirely. |
| **D2** | **Status filter keeps `draft` and `pending_review`.** Options: `all \| active \| paused \| pending_review \| draft \| archived`. Defaults: `status=active`, `verification=verified`.                                   | This tab is the only PG-listing management surface in admin (`PgListingsTab` is analytics-only, [AdminShell.tsx:169](../../../apps/web/components/admin/shell/AdminShell.tsx)). v1's `active/paused/archived/all` set would have made drafts and pending-review PGs unreachable — a functional regression.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **D3** | **Mobile = existing `DataTable` + horizontal scroll.** No `useIsMobile`, no hand-rolled mobile cards.                                                                                                                  | `DataTable` already wraps in `.admin-table-wrap` (overflow container). `useIsMobile` is local to `HomesInventory` and not shared. Halves the Task 7 diff and keeps every admin tab consistent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **D4** | **One shared helper `apps/web/lib/public-site-url.ts`, fallback `https://cribliv.com`.** `admin-home-url.ts` stays byte-for-byte untouched.                                                                            | 33 of 34 `NEXT_PUBLIC_SITE_URL` call sites fall back to apex `https://cribliv.com`, including `app/layout.tsx:51` (`metadataBase`), `sitemap.ts`, `robots.txt`, and **the PG detail page itself** ([pg/[city]/[id]/page.tsx:11](../../../apps/web/app/[locale]/pg/[city]/[id]/page.tsx)), which builds its own canonical + hreflang as `${BASE_URL}/en/pg/${citySlug}/${id}`. A `www` fallback for PG alone would make the copied admin link disagree with that page's own `<link rel="canonical">`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Deployment caveat (state this, do not try to fix it):** as of 2026-07-22 both `cribliv.com` and `www.cribliv.com` serve the **V1** site (`nginx/1.24.0`, Pages Router, `nextExport: true`); `/en/pg` returns **404 on both**. This V2 app is not deployed to either host. Therefore **"Open public page" is only verifiable against localhost**, not production. Task 7 Step 9 is written accordingly. Do not treat the prod 404 as a bug in this work.

---

## Global Constraints

- Package manager **pnpm**; TypeScript strict; match each file's existing idiom/naming/error style.
- Node 22 for tests: prefix background shells with `export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"`.
- Test DB: `export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"` (local `cribliv-pg-local` :5433 — **never** the Azure DB).
- Every admin PG endpoint stays behind `@UseGuards(AuthGuard, RolesGuard)` + `@Roles("admin")` (already class-level on `AdminController`). **Do not** change guards.
- **Raw owner phone is never returned** — only `owner_phone_masked`. Raw phone may be _matched_ inside the server-side `q` clause but must never appear as a SELECTed output column.
- Every query value is **parameterized** (`$1`, `$2`, …). `ORDER BY` comes only from a whitelisted `switch` — never interpolated from raw input.
- DB dual-mode: `PgAdminPropertiesService` returns an empty result when `!this.db.isEnabled()` — preserve that exact behavior for the new envelope (return an empty envelope, never throw).
- Public URL base: `NEXT_PUBLIC_SITE_URL`, fallback `https://cribliv.com` (**D4**).
- Shareability rule (list **and** detail): `status === 'active' && city_slug != null`. **Verification is a badge, not a gate** — an active unverified PG is still publicly reachable, so it still gets a `public_path`.
- **DO NOT MODIFY:** `admin-homes.*` (controller/service/params/types), `HomesInventory.tsx`, `AdminHomeWorkspace.tsx`, `admin-home-url.ts` (and its 4 dependent test files), `pg_listings`/`pg_details` schema, the verification-decision endpoints (`/admin/review/...`), `StatusPill.tsx`.
- **No new migration.** All fields exist: `pg_listings.starting_rent_paise` (bigint NOT NULL, `0032`), `pg_listings.verification_status` (`0032`), `pg_details.gender_policy` (`pg_gender_policy` enum `boys|girls|coed`, `0031`), `listing_photos.blob_path`.

---

## File Structure

**Create:**

- `apps/api/src/modules/admin/admin-pg-listings.params.ts` — param sanitizer (mirrors `admin-homes.params.ts`).
- `apps/api/src/modules/admin/__tests__/unit/pg-admin-listings.params.test.ts`
- `apps/api/src/modules/admin/__tests__/unit/pg-admin-listings.service.test.ts`
- `apps/web/lib/public-site-url.ts` — `publicSiteUrl` + `copyPublicSiteUrl` (**D4**).
- `apps/web/lib/__tests__/public-site-url.test.ts`

**Modify:**

- `packages/shared-types/src/pg-operator.ts` — extend `PgAdminListingListItem`; add params/envelope/filter/sort types.
- `apps/api/src/modules/admin/pg-admin-properties.service.ts` — `listListings` → envelope.
- `apps/api/src/modules/admin/admin.controller.ts` — `pgListings` handler at **line 1240**.
- `apps/api/src/modules/admin/__tests__/pg-admin.controller.integration.test.ts` — update the listings case (**lines 86-97**) and the `pgProps.listListings` mock (**line 37**).
- `apps/web/lib/admin-api.ts` — `fetchAdminPgListings` at **line 1111**.
- `apps/web/components/admin/tabs/PgPropertiesTab.tsx`
- `apps/web/components/admin/pg-properties/PgListingDetail.tsx` — header at **lines 239-247**.
- `.env.example` — document `NEXT_PUBLIC_SITE_URL`.

---

## Task 0: Branch setup — do this before any edit

This plan produces **nine commits**. They must not land on `master`. Verified 2026-07-22: the repo sits on `master` with two unrelated dirty test files.

- [ ] **Step 1: Confirm where you are.**

```bash
git branch --show-current && git status --porcelain
```

- [ ] **Step 2: Handle the pre-existing dirty files.** `apps/api/src/modules/pg-operator/__tests__/migration-0034.integration.test.ts` and `apps/api/test/migration-0031-pg-operator.integration.test.ts` may show as modified. **They are not part of this work** — they are in-progress fixes for two of the known pre-existing test failures. Leave them alone: do not commit them, do not revert them, do not `git add .` / `git add -A` anywhere in this plan. Every commit below uses explicit paths for exactly this reason. If they are dirty, they simply carry over onto the new branch, which is fine.

- [ ] **Step 3: Create the branch off `master`.**

```bash
git checkout -b feat/verified-pgs-admin-surface
git branch --show-current   # must print feat/verified-pgs-admin-surface
```

If `master` is behind `origin/master`, rebase first (`git fetch origin && git rebase origin/master`) — do this _before_ creating the branch, and stop and report if it conflicts.

- [ ] **Step 4: Sanity-check the baseline compiles** before you change anything, so a later failure is unambiguously yours:

```bash
export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"
pnpm typecheck
```

Record the result. If the baseline is already broken, stop and report — do not start Task 1 on a red tree.

> **Worktrees:** not needed here. The nine tasks are strictly sequential (each depends on the previous task's types/signatures), so there is nothing to parallelize. Use a worktree only if you are running this alongside other work in the same checkout. Note `git worktree list` currently shows a prunable stale entry at `/private/tmp/cribliv-a3-red`; ignore it, and do not run `git worktree prune` as part of this task.

**Do not open a PR or merge at the end.** Task 9 finishes on the branch; integration is the owner's call.

---

## Task 1: Shared types

**Files:** Modify `packages/shared-types/src/pg-operator.ts` — the `PgAdminListingListItem` interface at **line 382**, and add new exports directly below it.

**Produces:** `PgAdminListingListItem` (extended), `PgAdminVerificationFilter`, `PgAdminListingStatusFilter`, `PgAdminListingSort`, `PgAdminListingsParams`, `PgAdminListingsResponse` — consumed by Tasks 2-8.

- [ ] **Step 1: Extend `PgAdminListingListItem`** — keep all twelve existing fields, add six:

```ts
export interface PgAdminListingListItem {
  listing_id: string;
  title: string | null;
  status: string; // pg_listings.status: draft | pending_review | active | rejected | paused | archived
  pg_property_id: string | null;
  property_name: string | null;
  city_slug: string | null;
  locality_slug: string | null;
  owner_id: string;
  owner_name: string | null;
  owner_phone_masked: string | null;
  leads_7d: number;
  analytics_cut: boolean; // global OR this-listing override active
  // --- Verified-PGs additions ---
  /**
   * Public verification truth, read from `listings.verification_status` (the
   * column search/map/homes all read), falling back to the pg_listings head
   * when the projection row is missing. See Decision D1.
   * One of: unverified | pending | verified | failed.
   */
  verification_status: string;
  cover_photo_url: string | null;
  starting_rent_paise: number | null; // cheapest room rent; NOT NULL in schema, nullable here for in-memory mode
  gender_policy: string | null; // boys | girls | coed
  /** Postgres timestamptz rendered via ::text (e.g. "2026-07-10 00:00:00+00") — NOT strict ISO-8601. `formatDate` parses it. */
  updated_at: string;
  /** `/en/pg/{city}/{id}`; null when not shareable (status !== 'active' or no city). */
  public_path: string | null;
}
```

- [ ] **Step 2: Add the filter/sort/params/response types** immediately after:

```ts
export type PgAdminVerificationFilter = "verified" | "all";
/** Mirrors listing_status, minus 'rejected' (not surfaced in this tab). See Decision D2. */
export type PgAdminListingStatusFilter =
  | "active"
  | "paused"
  | "pending_review"
  | "draft"
  | "archived"
  | "all";
export type PgAdminListingSort = "leads" | "updated" | "rent_desc" | "rent_asc";

export interface PgAdminListingsParams {
  verification: PgAdminVerificationFilter;
  status: PgAdminListingStatusFilter;
  city?: string;
  q?: string;
  sort: PgAdminListingSort;
  page: number;
  page_size: 25 | 50 | 100;
}

export interface PgAdminListingsResponse {
  items: PgAdminListingListItem[];
  total: number;
  page: number;
  page_size: 25 | 50 | 100;
  filters: {
    verification: PgAdminVerificationFilter;
    status: PgAdminListingStatusFilter;
    city: string | null;
    q: string | null;
    sort: PgAdminListingSort;
  };
  /** Facet counts. Honors verification + status + q; deliberately ignores `city` so the dropdown can switch cities. */
  available_cities: Array<{ slug: string; name: string; count: number }>;
  /** Inventory scope tiles. Honors q + city; deliberately ignores `status` and the `verification` toggle — always reports verified counts within the searched scope. */
  summary: { verified: number; active: number; cities: number };
}
```

- [ ] **Step 3: Build.** `pnpm --filter @cribliv/shared-types build` → exits 0.
- [ ] **Step 4: Commit.** `git commit -m "feat(shared-types): PgAdminListing envelope + verification/status/sort params"`

---

## Task 2: Param sanitizer

**Files:** Create `apps/api/src/modules/admin/admin-pg-listings.params.ts` + `apps/api/src/modules/admin/__tests__/unit/pg-admin-listings.params.test.ts`.

**Reference (read, don't modify):** `apps/api/src/modules/admin/admin-homes.params.ts` — copy its exact shape.

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeAdminPgListingsParams } from "../../admin-pg-listings.params";

describe("sanitizeAdminPgListingsParams", () => {
  it("applies defaults for empty input (verified + active landing view)", () => {
    expect(sanitizeAdminPgListingsParams({})).toEqual({
      verification: "verified",
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });
  });

  it("clamps unknown enums to defaults and truncates oversized q / page_size", () => {
    const out = sanitizeAdminPgListingsParams({
      verification: "bogus",
      status: "weird",
      sort: "hax",
      page: "-3",
      page_size: "999",
      q: "x".repeat(500),
      city: "  LucKnow  "
    });
    expect(out.verification).toBe("verified");
    expect(out.status).toBe("active");
    expect(out.sort).toBe("leads");
    expect(out.page).toBe(1);
    expect(out.page_size).toBe(25);
    expect(out.q?.length).toBe(200);
    expect(out.city).toBe("lucknow");
  });

  it("accepts draft and pending_review statuses (Decision D2)", () => {
    expect(sanitizeAdminPgListingsParams({ status: "draft" }).status).toBe("draft");
    expect(sanitizeAdminPgListingsParams({ status: "pending_review" }).status).toBe(
      "pending_review"
    );
  });

  it("rejects 'rejected' status (not surfaced in this tab)", () => {
    expect(sanitizeAdminPgListingsParams({ status: "rejected" }).status).toBe("active");
  });

  it("passes through valid values", () => {
    expect(
      sanitizeAdminPgListingsParams({
        verification: "all",
        status: "paused",
        sort: "rent_desc",
        page: "3",
        page_size: "50",
        q: "green nest",
        city: "delhi"
      })
    ).toEqual({
      verification: "all",
      status: "paused",
      city: "delhi",
      q: "green nest",
      sort: "rent_desc",
      page: 3,
      page_size: 50
    });
  });
});
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module '../../admin-pg-listings.params'`).

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/unit/pg-admin-listings.params.test.ts
```

- [ ] **Step 3: Create the sanitizer:**

```ts
import type {
  PgAdminListingSort,
  PgAdminListingStatusFilter,
  PgAdminListingsParams,
  PgAdminVerificationFilter
} from "@cribliv/shared-types";

const VALID_VERIFICATION = new Set<PgAdminVerificationFilter>(["verified", "all"]);
const VALID_STATUSES = new Set<PgAdminListingStatusFilter>([
  "active",
  "paused",
  "pending_review",
  "draft",
  "archived",
  "all"
]);
const VALID_SORTS = new Set<PgAdminListingSort>(["leads", "updated", "rent_desc", "rent_asc"]);
const VALID_PAGE_SIZES = new Set([25, 50, 100]);

export function sanitizeAdminPgListingsParams(
  raw: Record<string, string | undefined>
): PgAdminListingsParams {
  const verification = VALID_VERIFICATION.has(raw.verification as PgAdminVerificationFilter)
    ? (raw.verification as PgAdminVerificationFilter)
    : "verified";
  const status = VALID_STATUSES.has(raw.status as PgAdminListingStatusFilter)
    ? (raw.status as PgAdminListingStatusFilter)
    : "active";
  const sort = VALID_SORTS.has(raw.sort as PgAdminListingSort)
    ? (raw.sort as PgAdminListingSort)
    : "leads";
  const pageNumber = Number(raw.page);
  const requestedPageSize = Number(raw.page_size);
  const city = raw.city?.trim().toLowerCase().slice(0, 100) || undefined;
  const q = raw.q?.trim().slice(0, 200) || undefined;

  return {
    verification,
    status,
    ...(city ? { city } : {}),
    ...(q ? { q } : {}),
    sort,
    page: Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1,
    page_size: (VALID_PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 25) as 25 | 50 | 100
  };
}
```

- [ ] **Step 4: Run → PASS (5 tests).**
- [ ] **Step 5: Commit.** `git commit -m "feat(admin-pg): param sanitizer for PG listings list"`

---

## Task 3: Service — `listListings` returns the envelope

**Files:** Modify `apps/api/src/modules/admin/pg-admin-properties.service.ts` (`listListings` at **lines 25-69**); add module-level SQL constants + a private `pgListOrderBy` helper. Test: `apps/api/src/modules/admin/__tests__/unit/pg-admin-listings.service.test.ts`.

**Reference (read, don't modify):** `admin-homes.service.ts` `orderBy` (line 1360, whitelisted switch idiom); the cover-photo lateral at `pg-listing.service.ts:478-483`; the existing mocking style in the sibling `__tests__/unit/pg-admin-properties.service.test.ts`.

### SQL design — read this before writing code

Three queries. **Every one of them uses `$1` for `q`.** This is deliberate: the shared predicate constants are then safe to reuse without renumbering (the v1 draft had `$2` meaning _city_ in one query and _verification_ in another — a silent-wrong-filter trap).

| Query        | Params                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| page         | `$1` q, `$2` city, `$3` verification, `$4` status, `$5` limit, `$6` offset |
| cities facet | `$1` q, `$2` verification, `$3` status                                     |
| summary      | `$1` q, `$2` city                                                          |

- [ ] **Step 1: Write the failing test:**

```ts
import { describe, it, expect, vi } from "vitest";
import { PgAdminPropertiesService } from "../../pg-admin-properties.service";
import type { PgAdminListingsParams } from "@cribliv/shared-types";

const PARAMS: PgAdminListingsParams = {
  verification: "verified",
  status: "active",
  sort: "leads",
  page: 1,
  page_size: 25
};

function makeService(rows: { list: any[]; cities: any[]; summary: any }) {
  const query = vi.fn(async (sql: string) => {
    if (/count\(\*\) OVER/i.test(sql)) return { rows: rows.list, rowCount: rows.list.length };
    if (/GROUP BY c\.slug/i.test(sql)) return { rows: rows.cities, rowCount: rows.cities.length };
    return { rows: [rows.summary], rowCount: 1 };
  });
  const db = { isEnabled: () => true, query } as any;
  return { service: new PgAdminPropertiesService(db), query };
}

const BASE_ROW = {
  listing_id: "11111111-1111-1111-1111-111111111111",
  title: "Green Nest PG",
  status: "active",
  pg_property_id: "p1",
  property_name: "Green Nest",
  city_slug: "lucknow",
  locality_slug: "gomti-nagar",
  owner_id: "o1",
  owner_name: "Asha",
  owner_phone_masked: "+9199***901",
  leads_7d: 4,
  analytics_cut: false,
  verification_status: "verified",
  cover_blob: "pg/cover1.jpg",
  starting_rent_paise: "700000", // pg driver returns bigint as string
  gender_policy: "girls",
  updated_at: "2026-07-10 00:00:00+00",
  total: 1
};

describe("PgAdminPropertiesService.listListings", () => {
  it("returns an empty envelope when the DB is disabled", async () => {
    const db = { isEnabled: () => false, query: vi.fn() } as any;
    const res = await new PgAdminPropertiesService(db).listListings(PARAMS);
    expect(res.items).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.available_cities).toEqual([]);
    expect(res.summary).toEqual({ verified: 0, active: 0, cities: 0 });
    expect(res.filters.verification).toBe("verified");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("maps rows: bigint rent -> number, cover -> url, city -> public_path", async () => {
    const { service } = makeService({
      list: [BASE_ROW],
      cities: [{ slug: "lucknow", name: "Lucknow", count: 1 }],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    const res = await service.listListings(PARAMS);

    expect(res.total).toBe(1);
    const item = res.items[0];
    expect(item.starting_rent_paise).toBe(700000);
    expect(typeof item.starting_rent_paise).toBe("number");
    expect(item.gender_policy).toBe("girls");
    expect(item.public_path).toBe("/en/pg/lucknow/11111111-1111-1111-1111-111111111111");
    expect(item.cover_photo_url).not.toBeNull();
    expect((item as any).cover_blob).toBeUndefined(); // raw blob path not leaked
    expect((item as any).total).toBeUndefined(); // window-count not leaked
    expect(res.available_cities).toEqual([{ slug: "lucknow", name: "Lucknow", count: 1 }]);
    expect(res.summary).toEqual({ verified: 1, active: 1, cities: 1 });
  });

  it("nulls public_path when the listing has no city slug", async () => {
    const { service } = makeService({
      list: [{ ...BASE_ROW, city_slug: null, cover_blob: null }],
      cities: [],
      summary: { verified: 1, active: 0, cities: 0 }
    });
    const res = await service.listListings(PARAMS);
    expect(res.items[0].public_path).toBeNull();
    expect(res.items[0].cover_photo_url).toBeNull();
  });

  it("nulls public_path for a non-active listing (shareability = active + city)", async () => {
    const { service } = makeService({
      list: [{ ...BASE_ROW, status: "draft" }],
      cities: [],
      summary: { verified: 0, active: 0, cities: 0 }
    });
    const res = await service.listListings({ ...PARAMS, status: "draft" });
    expect(res.items[0].public_path).toBeNull();
  });

  it("reads verification from the listings projection, not the pg head (D1)", async () => {
    const { service, query } = makeService({
      list: [BASE_ROW],
      cities: [],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    await service.listListings(PARAMS);
    const pageSql = String(query.mock.calls[0][0]);
    expect(pageSql).toMatch(/LEFT JOIN listings l ON l\.id = pl\.id/i);
    expect(pageSql).toMatch(/COALESCE\(l\.verification_status::text/i);
  });

  it("never SELECTs a raw phone column", async () => {
    const { service, query } = makeService({
      list: [BASE_ROW],
      cities: [],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    await service.listListings(PARAMS);
    const pageSql = String(query.mock.calls[0][0]);
    const selectClause = pageSql.slice(0, pageSql.search(/\bFROM\b/i));
    expect(selectClause).not.toMatch(/AS\s+owner_phone\b/i);
    expect(selectClause).toMatch(/owner_phone_masked/i);
  });

  it("parameterizes sort — ORDER BY never contains raw input", async () => {
    const { service, query } = makeService({
      list: [BASE_ROW],
      cities: [],
      summary: { verified: 1, active: 1, cities: 1 }
    });
    await service.listListings({ ...PARAMS, sort: "rent_desc" as any });
    const pageSql = String(query.mock.calls[0][0]);
    expect(pageSql).toMatch(/ORDER BY pl\.starting_rent_paise DESC NULLS LAST/i);
  });
});
```

- [ ] **Step 2: Run → FAIL** (current `listListings` returns `{items,total}` only, rows unmapped).

- [ ] **Step 3: Imports.** Add `import { toBlobUrl } from "../../common/photo-url";` after the existing `DatabaseService` import. Add `PgAdminListingSort`, `PgAdminListingsParams`, `PgAdminListingsResponse` to the existing `import type { ... } from "@cribliv/shared-types"` block.

- [ ] **Step 4: Add module-level SQL constants** just below the existing `round2`/`ratio` helpers (line 13), above the `@Injectable()` decorator:

```ts
/**
 * Shared FROM for the three admin PG list queries.
 *
 * `listings l` is the public READ PROJECTION of the PG head (same id, 1:1 — see
 * migration 0032). It is joined solely for verification truth: the admin
 * verification-decision endpoint writes `listings.verification_status` and never
 * touches the pg_listings head, and search/map/homes all read the projection.
 * LEFT JOIN (not JOIN) so a listing whose projection row is somehow missing is
 * still visible to admins rather than silently disappearing.
 */
const PG_LIST_FROM = `
     FROM pg_listings pl
     JOIN users u ON u.id = pl.operator_user_id
     LEFT JOIN listings l ON l.id = pl.id
     LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
     LEFT JOIN cities c ON c.id = pp.city_id
     LEFT JOIN localities loc ON loc.id = pp.locality_id`;

/** Public verification truth. Projection wins; pg head is the fallback. */
const PG_VERIFICATION_SQL = `COALESCE(l.verification_status::text, pl.verification_status::text)`;

/**
 * Free-text predicate, IDENTICAL across all three queries so facet counts can
 * never disagree with the visible rows. Always bound to $1 — every query below
 * reserves $1 for `q` precisely so this constant is reusable without renumbering.
 * Raw phone is MATCHED here but never SELECTed.
 */
const PG_LIST_Q_PREDICATE = `($1::text IS NULL OR (
             pl.title            ILIKE '%' || $1 || '%'
          OR pl.id::text         ILIKE '%' || $1 || '%'
          OR pp.display_name     ILIKE '%' || $1 || '%'
          OR u.full_name         ILIKE '%' || $1 || '%'
          OR u.phone_e164        ILIKE '%' || $1 || '%'
          OR loc.slug            ILIKE '%' || $1 || '%'
          OR loc.name_en         ILIKE '%' || $1 || '%'
          OR c.slug              ILIKE '%' || $1 || '%'
          OR c.name_en           ILIKE '%' || $1 || '%'))`;
```

- [ ] **Step 5: Replace the whole `listListings` method (lines 25-69)** with:

```ts
  /**
   * Verified-PGs inventory list. Returns an envelope mirroring
   * AdminHomesListResponse: page items + facet cities + scope summary.
   *
   * Filter semantics (deliberate, documented in PgAdminListingsResponse):
   *   items/total       — all filters (verification, status, city, q)
   *   available_cities  — verification + status + q; IGNORES city (facet pattern)
   *   summary           — q + city; IGNORES status and the verification toggle
   */
  async listListings(params: PgAdminListingsParams): Promise<PgAdminListingsResponse> {
    const filters = {
      verification: params.verification,
      status: params.status,
      city: params.city ?? null,
      q: params.q ?? null,
      sort: params.sort
    };

    if (!this.db.isEnabled()) {
      return {
        items: [],
        total: 0,
        page: params.page,
        page_size: params.page_size,
        filters,
        available_cities: [],
        summary: { verified: 0, active: 0, cities: 0 }
      };
    }

    const page = Math.max(1, params.page);
    const pageSize = params.page_size;
    const offset = (page - 1) * pageSize;

    // $1 q, $2 city, $3 verification, $4 status
    const where = `
        WHERE ${PG_LIST_Q_PREDICATE}
          AND ($2::text IS NULL OR c.slug = $2)
          AND ($3::text = 'all' OR ${PG_VERIFICATION_SQL} = 'verified')
          AND ($4::text = 'all' OR pl.status::text = $4)`;

    const filterValues = [
      params.q ?? null,
      params.city ?? null,
      params.verification,
      params.status
    ];

    const pageResult = await this.db.query<
      Omit<PgAdminListingListItem, "cover_photo_url" | "public_path" | "starting_rent_paise"> & {
        cover_blob: string | null;
        starting_rent_paise: string | null;
        total: number;
      }
    >(
      `SELECT pl.id::text AS listing_id, pl.title, pl.status::text AS status,
              pl.pg_property_id::text AS pg_property_id, pp.display_name AS property_name,
              c.slug AS city_slug, loc.slug AS locality_slug,
              pl.operator_user_id::text AS owner_id, u.full_name AS owner_name,
              CASE WHEN u.phone_e164 IS NOT NULL
                   THEN regexp_replace(u.phone_e164, '(\\+\\d{2})(\\d{3})\\d+(\\d{3})', '\\1\\2***\\3')
                   ELSE NULL END AS owner_phone_masked,
              COALESCE(ld.cnt, 0)::int AS leads_7d,
              EXISTS (SELECT 1 FROM pg_analytics_overrides o
                       WHERE o.operator_id = pl.operator_user_id AND o.active = true
                         AND (o.listing_id IS NULL OR o.listing_id = pl.id)) AS analytics_cut,
              ${PG_VERIFICATION_SQL} AS verification_status,
              pl.starting_rent_paise::text AS starting_rent_paise,
              d.gender_policy::text AS gender_policy,
              pl.updated_at::text AS updated_at,
              cover.blob_path AS cover_blob,
              count(*) OVER ()::int AS total
         ${PG_LIST_FROM}
         LEFT JOIN pg_details d ON d.listing_id = pl.id
         LEFT JOIN LATERAL (
           SELECT count(*) AS cnt FROM leads lead
            WHERE lead.listing_id = pl.id AND lead.created_at >= now() - interval '7 days'
         ) ld ON true
         LEFT JOIN LATERAL (
           SELECT blob_path FROM listing_photos
            WHERE listing_id = pl.id AND moderation_status != 'rejected'
            ORDER BY is_cover DESC, sort_order ASC, created_at ASC
            LIMIT 1
         ) cover ON true
         ${where}
        ORDER BY ${this.pgListOrderBy(params.sort)}
        LIMIT $5 OFFSET $6`,
      [...filterValues, pageSize, offset]
    );

    const items: PgAdminListingListItem[] = pageResult.rows.map((row) => {
      const { total: _total, cover_blob, starting_rent_paise, ...rest } = row;
      const shareable = rest.status === "active" && !!rest.city_slug;
      return {
        ...rest,
        starting_rent_paise: starting_rent_paise == null ? null : Number(starting_rent_paise),
        cover_photo_url: toBlobUrl(cover_blob),
        public_path: shareable ? `/en/pg/${rest.city_slug}/${rest.listing_id}` : null
      };
    });

    // `count(*) OVER ()` rides on the returned rows, so an out-of-range page
    // yields no rows and no count. Fall back to an explicit COUNT so the UI
    // reports a real total instead of "Page 7 of 1 · 0 total".
    let total = pageResult.rows[0]?.total ?? 0;
    if (pageResult.rows.length === 0 && page > 1) {
      const countResult = await this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total ${PG_LIST_FROM} ${where}`,
        filterValues
      );
      total = countResult.rows[0]?.total ?? 0;
    }

    // Facet: $1 q, $2 verification, $3 status. City intentionally absent.
    const citiesResult = await this.db.query<{ slug: string; name: string; count: number }>(
      `SELECT c.slug AS slug, c.name_en AS name, count(*)::int AS count
         ${PG_LIST_FROM}
        WHERE ${PG_LIST_Q_PREDICATE}
          AND ($2::text = 'all' OR ${PG_VERIFICATION_SQL} = 'verified')
          AND ($3::text = 'all' OR pl.status::text = $3)
          AND c.slug IS NOT NULL
        GROUP BY c.slug, c.name_en
        ORDER BY name ASC, slug ASC`,
      [params.q ?? null, params.verification, params.status]
    );

    // Scope tiles: $1 q, $2 city. Status + verification toggle intentionally absent.
    const summaryResult = await this.db.query<{
      verified: number;
      active: number;
      cities: number;
    }>(
      `SELECT
          count(*) FILTER (WHERE ${PG_VERIFICATION_SQL} = 'verified')::int AS verified,
          count(*) FILTER (WHERE ${PG_VERIFICATION_SQL} = 'verified'
                             AND pl.status::text = 'active')::int AS active,
          count(DISTINCT c.slug) FILTER (WHERE ${PG_VERIFICATION_SQL} = 'verified')::int AS cities
         ${PG_LIST_FROM}
        WHERE ${PG_LIST_Q_PREDICATE}
          AND ($2::text IS NULL OR c.slug = $2)`,
      [params.q ?? null, params.city ?? null]
    );
    const summary = summaryResult.rows[0] ?? { verified: 0, active: 0, cities: 0 };

    return {
      items,
      total,
      page,
      page_size: pageSize,
      filters,
      available_cities: citiesResult.rows.map((row) => ({
        slug: row.slug,
        name: row.name,
        count: Number(row.count)
      })),
      summary: {
        verified: Number(summary.verified),
        active: Number(summary.active),
        cities: Number(summary.cities)
      }
    };
  }

  /** Whitelisted ORDER BY. Never interpolate raw input. Mirrors admin-homes.service.ts:1360. */
  private pgListOrderBy(sort: PgAdminListingSort): string {
    const fallback = "pl.updated_at DESC, pl.id DESC";
    switch (sort) {
      case "updated":
        return fallback;
      case "rent_desc":
        return `pl.starting_rent_paise DESC NULLS LAST, ${fallback}`;
      case "rent_asc":
        return `pl.starting_rent_paise ASC NULLS LAST, ${fallback}`;
      case "leads":
      default:
        return `COALESCE(ld.cnt, 0) DESC, ${fallback}`;
    }
  }
```

> **Note on the `leads` alias:** the lateral aliases the table as `lead` (not `l`) because `l` is now taken by the `listings` projection join. Do not revert this — `FROM leads l` would shadow the projection and silently break the verification filter.

- [ ] **Step 6: Run → PASS (7 tests).**
- [ ] **Step 7:** `pnpm --filter @cribliv/api typecheck` — expect the _controller_ to error until Task 4; that is the only acceptable failure here.
- [ ] **Step 8: Commit.** `git commit -m "feat(admin-pg): listListings envelope — projection-backed verification, sort, cover, facets"`

---

## Task 4: Controller

**Files:** Modify `apps/api/src/modules/admin/admin.controller.ts` (`pgListings`, **lines 1240-1256**) and `__tests__/pg-admin.controller.integration.test.ts`.

- [ ] **Step 1: Import** `import { sanitizeAdminPgListingsParams } from "./admin-pg-listings.params";` with the other admin imports.

- [ ] **Step 2: Replace the handler:**

```ts
  @Get("pg/listings")
  async pgListings(
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("city") city?: string,
    @Query("verification") verification?: string,
    @Query("sort") sort?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string
  ) {
    return ok(
      await this.pgProps.listListings(
        sanitizeAdminPgListingsParams({
          q,
          status,
          city,
          verification,
          sort,
          page,
          page_size: pageSize
        })
      )
    );
  }
```

**Breaking change, deliberate:** the query key is now `page_size` (snake_case, matching homes); the old `pageSize` key is gone, and the response is `ok(envelope)` rather than `ok(items, { total })`. `fetchAdminPgListings` (Task 6) is the **only** caller — verify with `git grep -n "admin/pg/listings"` before and after.

- [ ] **Step 3: Update the mock at line 37** so it returns a full envelope:

```ts
    listListings: vi.fn(async () => ({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      filters: { verification: "verified", status: "active", city: null, q: null, sort: "leads" },
      available_cities: [],
      summary: { verified: 0, active: 0, cities: 0 }
    })),
```

- [ ] **Step 4: Replace the test at lines 86-97:**

```ts
it("GET pg/listings sanitizes params and wraps the envelope in ok()", async () => {
  const { ctrl, pgProps } = makeCtrl();
  const res = await ctrl.pgListings(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined
  );
  expect(pgProps.listListings).toHaveBeenCalledWith({
    verification: "verified",
    status: "active",
    sort: "leads",
    page: 1,
    page_size: 25
  });
  expect(res).toMatchObject({ data: { items: [], total: 0 } });
});

it("GET pg/listings clamps hostile query values before they reach the service", async () => {
  const { ctrl, pgProps } = makeCtrl();
  await ctrl.pgListings(
    "'; DROP TABLE listings; --",
    "bogus",
    "  DELHI ",
    "nope",
    "1=1",
    "-5",
    "9999"
  );
  expect(pgProps.listListings).toHaveBeenCalledWith({
    verification: "verified",
    status: "active",
    city: "delhi",
    q: "'; DROP TABLE listings; --",
    sort: "leads",
    page: 1,
    page_size: 25
  });
});
```

- [ ] **Step 5: Run** `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/pg-admin.controller.integration.test.ts` → PASS (all existing + 2).
- [ ] **Step 6:** `pnpm --filter @cribliv/api typecheck` → exits 0. Commit: `git commit -m "feat(admin-pg): controller runs sanitizer, returns Verified-PGs envelope"`

---

## Task 5: Shared public-site URL helper (D4)

**Files:** Create `apps/web/lib/public-site-url.ts` + `apps/web/lib/__tests__/public-site-url.test.ts`.

**Reference (read, DO NOT MODIFY):** `apps/web/lib/admin-home-url.ts` and `apps/web/lib/__tests__/admin-home-url.test.ts`. The new helper is the same logic under a domain-neutral name; homes keeps its own copy so its 4 dependent test files stay green.

- [ ] **Step 1: Write the failing test** — mirror the _existing_ homes test file structure (it has 5 cases including clipboard-rejection and `copy_failed`; do not ship a thinner version):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyPublicSiteUrl, publicSiteUrl } from "../public-site-url";

const publicPath = "/en/pg/lucknow/11111111-1111-4111-8111-111111111111";
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (originalSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand);
  else Reflect.deleteProperty(document, "execCommand");
});

function mockExecCommand(copied: boolean) {
  const execCommand = vi.fn().mockReturnValue(copied);
  Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
  return execCommand;
}

describe("publicSiteUrl", () => {
  it("falls back to the apex domain used by every other call site (D4)", () => {
    expect(publicSiteUrl(publicPath)).toBe(
      "https://cribliv.com/en/pg/lucknow/11111111-1111-4111-8111-111111111111"
    );
  });

  it("uses NEXT_PUBLIC_SITE_URL and normalizes leading/trailing slashes", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://preview.cribliv.com///";
    expect(publicSiteUrl(publicPath.slice(1))).toBe(
      "https://preview.cribliv.com/en/pg/lucknow/11111111-1111-4111-8111-111111111111"
    );
  });
});

describe("copyPublicSiteUrl", () => {
  it("copies with navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    await copyPublicSiteUrl(publicPath);
    expect(writeText).toHaveBeenCalledWith(
      "https://cribliv.com/en/pg/lucknow/11111111-1111-4111-8111-111111111111"
    );
  });

  it("falls back to a temporary textarea when clipboard rejects", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true
    });
    const execCommand = mockExecCommand(true);
    await copyPublicSiteUrl(publicPath);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to a temporary textarea when clipboard is absent", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    const execCommand = mockExecCommand(true);
    await copyPublicSiteUrl(publicPath);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("throws when both clipboard strategies fail", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mockExecCommand(false);
    await expect(copyPublicSiteUrl(publicPath)).rejects.toThrow("copy_failed");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @cribliv/web exec vitest run lib/__tests__/public-site-url.test.ts`

- [ ] **Step 3: Create `apps/web/lib/public-site-url.ts`:**

```ts
/**
 * Absolute public-site URLs for admin share actions (copy link / open page).
 *
 * The fallback matches the 33 other NEXT_PUBLIC_SITE_URL call sites — including
 * app/layout.tsx's metadataBase, sitemap.ts, robots.txt, and the PG detail page
 * itself, which derives its own canonical + hreflang from the same base. Keeping
 * one fallback is what guarantees a copied admin link and the target page's
 * <link rel="canonical"> agree.
 *
 * Domain-neutral by design: `admin-home-url.ts` is the older per-surface copy and
 * should converge here when homes is next touched.
 */
export function publicSiteUrl(publicPath: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com").replace(/\/+$/, "");
  const path = publicPath.startsWith("/") ? publicPath : `/${publicPath}`;
  return `${siteUrl}${path}`;
}

export async function copyPublicSiteUrl(publicPath: string): Promise<void> {
  const url = publicSiteUrl(publicPath);
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

- [ ] **Step 4: Run → PASS (6 tests).**
- [ ] **Step 5: Verify homes untouched:** `git status --porcelain apps/web/lib/admin-home-url.ts` → empty. Commit: `git commit -m "feat(web): shared public-site URL helper for admin share actions"`

---

## Task 6: Web client returns the envelope

**Files:** Modify `apps/web/lib/admin-api.ts` (`fetchAdminPgListings`, **line 1111**) and minimally unbreak `PgPropertiesTab.tsx`.

- [ ] **Step 1: Replace the function** (add `PgAdminListingsResponse` to the `@cribliv/shared-types` import; `PgAdminListingListItem` is already imported):

```ts
export async function fetchAdminPgListings(
  accessToken: string,
  params: {
    q?: string;
    status?: string;
    city?: string;
    verification?: string;
    sort?: string;
    page?: number;
    page_size?: number;
  } = {}
): Promise<PgAdminListingsResponse> {
  const qs = buildSearchQuery(params);
  return fetchApi<PgAdminListingsResponse>(`/admin/pg/listings${qs ? `?${qs}` : ""}`, {
    headers: authHeaders(accessToken)
  });
}
```

- [ ] **Step 2: Minimally adapt `PgPropertiesTab.tsx`** — in the `.then()` at line 109, change `setRows(res ?? [])` to `setRows(res.items)`. Full wiring is Task 7; this step only restores compilation.
- [ ] **Step 3:** `pnpm --filter @cribliv/web typecheck` → exits 0.
- [ ] **Step 4: Commit.** `git commit -m "feat(admin-pg): fetchAdminPgListings returns the list envelope"`

---

## Task 7: PG Listings tab

**Files:** Modify `apps/web/components/admin/tabs/PgPropertiesTab.tsx`.

**Reference (read, do NOT import):** `HomesInventory.tsx` — for the 300 ms debounce, facet dropdowns, pagination, error state with Retry, and the copy/open action pattern. **Adapt, don't copy verbatim:** homes uses raw `<table>` + `useIsMobile`; per **D3** this tab keeps `DataTable`.

**Keep these existing local components unchanged:** `AnalyticsDot`, `MiniLeadBars`, `SkeletonRows`, and the `<style>` keyframes block. They are this tab's idiom.

**Data-shape mapping:**

| Homes (`AdminHomeListItem`)   | PG (`PgAdminListingListItem`)                                           |
| ----------------------------- | ----------------------------------------------------------------------- |
| `id`                          | `listing_id`                                                            |
| `title`                       | `title` → fallback `property_name` → `"Untitled PG"`                    |
| `monthly_rent` (rupees)       | `starting_rent_paise` (paise — use `formatINR` from `lib/admin/format`) |
| `city_name`/`locality_name`   | `city_slug`/`locality_slug`                                             |
| `views_30d`/`conversion_rate` | **omit** (PG has neither)                                               |
| `leads_30d`                   | `leads_7d`                                                              |
| —                             | `verification_status`, `gender_policy` (new)                            |
| `cover_photo_url`             | `cover_photo_url`                                                       |
| `public_path` (always set)    | `public_path` (**nullable**)                                            |

- [ ] **Step 1: Replace state + fetch.** Add `error` state — a failed request must NOT render as "no results" (that's a v1 defect):

```tsx
const [data, setData] = useState<PgAdminListingsResponse | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);
const [reloadKey, setReloadKey] = useState(0);
const [q, setQ] = useState("");
const [debouncedQ, setDebouncedQ] = useState("");
const [verification, setVerification] = useState<PgAdminVerificationFilter>("verified");
const [statusFilter, setStatusFilter] = useState<PgAdminListingStatusFilter>("active");
const [city, setCity] = useState("");
const [sort, setSort] = useState<PgAdminListingSort>("leads");
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState<25 | 50 | 100>(25);
const [selected, setSelected] = useState<string | null>(null);

// 300ms debounce on the search box (mirrors HomesInventory).
useEffect(() => {
  const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
  return () => window.clearTimeout(t);
}, [q]);

// Any filter change invalidates the current page offset.
useEffect(() => {
  setPage(1);
}, [debouncedQ, verification, statusFilter, city, sort, pageSize]);

useEffect(() => {
  if (!accessToken) return;
  let cancelled = false;
  setLoading(true);
  setError(null);
  fetchAdminPgListings(accessToken, {
    q: debouncedQ || undefined,
    verification,
    status: statusFilter,
    city: city || undefined,
    sort,
    page,
    page_size: pageSize
  })
    .then((res) => {
      if (!cancelled) setData(res);
    })
    .catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Could not load PG listings");
      }
    })
    .finally(() => {
      if (!cancelled) setLoading(false);
    });
  return () => {
    cancelled = true;
  };
}, [accessToken, debouncedQ, verification, statusFilter, city, sort, page, pageSize, reloadKey]);

const rows = data?.items ?? [];
const total = data?.total ?? 0;
const totalPages = Math.max(1, Math.ceil(total / pageSize));
const maxLeads = useMemo(() => Math.max(1, ...rows.map((r) => r.leads_7d ?? 0)), [rows]);
```

Imports to add:

```tsx
import { publicSiteUrl, copyPublicSiteUrl } from "../../../lib/public-site-url";
import { formatDate, formatINR } from "../../../lib/admin/format";
import type {
  PgAdminListingListItem,
  PgAdminListingSort,
  PgAdminListingStatusFilter,
  PgAdminListingsResponse,
  PgAdminVerificationFilter
} from "@cribliv/shared-types";
```

Delete the now-unused local `StatusFilter` type and `FILTER_OPTIONS` const (lines 17-25); they are replaced by the option arrays in Step 3.

- [ ] **Step 2: Add `PublicActions`** as a file-local component:

```tsx
function PublicActions({ item }: { item: PgAdminListingListItem }) {
  const [copied, setCopied] = useState(false);

  if (!item.public_path) {
    return <span style={{ color: "#9CA3AF", fontSize: 12 }}>Not publicly available</span>;
  }
  const path = item.public_path;

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        className="admin-btn admin-btn--ghost"
        style={{ minHeight: 40 }}
        aria-label={`Copy public URL for ${item.title ?? "listing"}`}
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await copyPublicSiteUrl(path);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard unavailable in this context */
          }
        }}
      >
        {copied ? "Copied ✓" : "Copy link"}
      </button>
      <a
        className="admin-btn admin-btn--ghost"
        style={{ minHeight: 40, display: "inline-flex", alignItems: "center" }}
        href={publicSiteUrl(path)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open public page for ${item.title ?? "listing"}`}
        onClick={(e) => e.stopPropagation()}
      >
        Open
      </a>
    </div>
  );
}
```

> `public_path` is already null-gated server-side by the shareability rule, so the component needs no second `status === 'active'` check.

- [ ] **Step 3: Rebuild the filter bar** — keep the tab's existing `admin-chip` + `admin-input` idiom (there is no `SegmentGroup` primitive; do not invent one). Replace the filter `<div>` at lines 258-285:

```tsx
<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
  {(
    [
      { value: "verified", label: "Verified" },
      { value: "all", label: "All" }
    ] as const
  ).map((opt) => (
    <button
      key={opt.value}
      type="button"
      className="admin-chip"
      aria-pressed={verification === opt.value}
      onClick={() => setVerification(opt.value)}
    >
      {opt.label}
    </button>
  ))}
  <span style={{ width: 1, height: 20, background: "#E5E7EB" }} aria-hidden="true" />
  {(
    [
      { value: "active", label: "Active" },
      { value: "paused", label: "Paused" },
      { value: "pending_review", label: "Pending" },
      { value: "draft", label: "Draft" },
      { value: "archived", label: "Archived" },
      { value: "all", label: "All" }
    ] as const
  ).map((opt) => (
    <button
      key={opt.value}
      type="button"
      className="admin-chip"
      aria-pressed={statusFilter === opt.value}
      onClick={() => setStatusFilter(opt.value)}
    >
      {opt.label}
    </button>
  ))}
  <select
    className="admin-input"
    value={city}
    onChange={(e) => setCity(e.target.value)}
    aria-label="City"
    style={{ maxWidth: 180 }}
  >
    <option value="">All cities</option>
    {(data?.available_cities ?? []).map((c) => (
      <option key={c.slug} value={c.slug}>
        {c.name} ({c.count})
      </option>
    ))}
  </select>
  <select
    className="admin-input"
    value={sort}
    onChange={(e) => setSort(e.target.value as PgAdminListingSort)}
    aria-label="Sort listings"
    style={{ maxWidth: 190 }}
  >
    <option value="leads">Most leads (7d)</option>
    <option value="updated">Recently updated</option>
    <option value="rent_desc">Rent: high → low</option>
    <option value="rent_asc">Rent: low → high</option>
  </select>
  <select
    className="admin-input"
    value={pageSize}
    onChange={(e) => setPageSize(Number(e.target.value) as 25 | 50 | 100)}
    aria-label="Rows per page"
    style={{ maxWidth: 120 }}
  >
    <option value={25}>25 / page</option>
    <option value={50}>50 / page</option>
    <option value={100}>100 / page</option>
  </select>
  <input
    className="admin-input"
    placeholder="Search title, id, property, owner, phone, locality…"
    value={q}
    onChange={(e) => setQ(e.target.value)}
    aria-label="Search PG listings"
    style={{ maxWidth: 280, marginLeft: "auto" }}
  />
</div>
```

- [ ] **Step 4: Update the columns.** Keep the existing `owner`, `locality`, `status`, `leads_7d`, and `analytics` columns exactly as they are; insert these:

```tsx
    {
      key: "cover",
      header: "",
      width: "60px",
      render: (r) =>
        r.cover_photo_url ? (
          // Admin photo URLs are dynamic Azure/CDN values not covered by a fixed Next image host.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.cover_photo_url}
            alt=""
            style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: 44, height: 44, borderRadius: 6, background: "#F3F4F6" }} />
        )
    },
    // ...existing "title" column, but with the property_name fallback and short id:
    {
      key: "title",
      header: "Listing",
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600, color: "#111827", fontSize: 13 }}>
            {r.title || r.property_name || "Untitled PG"}
          </div>
          <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>
            {r.listing_id.slice(0, 8)}
          </div>
        </div>
      )
    },
    {
      key: "rent",
      header: "From",
      align: "right",
      render: (r) => (r.starting_rent_paise == null ? "—" : formatINR(r.starting_rent_paise))
    },
    {
      key: "gender",
      header: "Gender",
      render: (r) =>
        r.gender_policy === "boys"
          ? "Boys"
          : r.gender_policy === "girls"
            ? "Girls"
            : r.gender_policy === "coed"
              ? "Co-ed"
              : "—"
    },
    {
      key: "verification",
      header: "Verification",
      // StatusPill has no tone mapping for "failed"; pass it explicitly rather
      // than editing the shared primitive.
      render: (r) => <StatusPill status={r.verification_status} tone={r.verification_status === "failed" ? "danger" : undefined} />
    },
    {
      key: "updated",
      header: "Updated",
      render: (r) => formatDate(r.updated_at)
    },
    {
      key: "actions",
      header: "Public URL",
      render: (r) => <PublicActions item={r} />
    }
```

**Remove every `sortValue`** from the columns array. With server-side sort + pagination, client-side header sorting would reorder only the current page and silently contradict the `sort` dropdown. **Also remove `initialSort`** from the `DataTable` call:

```tsx
<DataTable
  columns={columns}
  rows={rows}
  rowKey={(r) => r.listing_id}
  onRowClick={(r) => setSelected(r.listing_id)}
/>
```

- [ ] **Step 5: Add pagination** below the table (tap targets ≥ 40px):

```tsx
<div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
  <button
    type="button"
    className="admin-btn admin-btn--ghost"
    style={{ minHeight: 40 }}
    disabled={page <= 1 || loading}
    onClick={() => setPage((p) => Math.max(1, p - 1))}
  >
    ← Prev
  </button>
  <span style={{ fontSize: 13, color: "#6B7280" }}>
    Page {page} of {totalPages} · {total} total
  </span>
  <button
    type="button"
    className="admin-btn admin-btn--ghost"
    style={{ minHeight: 40 }}
    disabled={page >= totalPages || loading}
    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
  >
    Next →
  </button>
</div>
```

- [ ] **Step 6: Render error / loading / empty as three distinct states.** `EmptyState`'s props are `{ title, hint, icon }` — it has **no** `action` prop, so render the reset button as a sibling:

```tsx
      {error ? (
        <div className="admin-empty" role="alert">
          <div className="admin-empty__title">Could not load PG listings</div>
          <div className="admin-empty__hint">{error}</div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            style={{ minHeight: 40, marginTop: 12 }}
            onClick={() => setReloadKey((k) => k + 1)}
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <SkeletonRows />
      ) : rows.length === 0 ? (
        <div>
          <EmptyState title="No PGs match these filters" hint="Try clearing the filters." />
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              style={{ minHeight: 40 }}
              onClick={() => {
                setQ("");
                setVerification("verified");
                setStatusFilter("all");
                setCity("");
                setSort("leads");
              }}
            >
              Show all verified
            </button>
          </div>
        </div>
      ) : (
        <DataTable ... />
      )}
```

- [ ] **Step 7: Rewire the summary tiles** to the envelope's `summary` (replacing the page-local `stats` useMemo at lines 122-133) and the header count to `total`:

```tsx
        <StatCard label="Verified PGs" value={loading ? "-" : (data?.summary.verified ?? 0)} tone="trust" />
        <StatCard label="Verified & Active" value={loading ? "-" : (data?.summary.active ?? 0)} tone="brand" />
        <StatCard label="Cities" value={loading ? "-" : (data?.summary.cities ?? 0)} />
        <StatCard label="Showing" value={loading ? "-" : total} />
```

Header sub-label becomes `{loading ? "loading…" : \`${total} total\`}`. Note the tiles describe the **q + city scope**, not the current page — that is intentional and documented on the response type.

- [ ] **Step 8:** `pnpm --filter @cribliv/web typecheck` → exits 0. Also `pnpm --filter @cribliv/web lint` → no new warnings (the `<img>` needs the eslint-disable comment shown above).

- [ ] **Step 9: Browser verification.**

  > **`.claude/launch.json` warning:** the entry named **"Web (Next.js)"** is broken — its `runtimeExecutable` points at `/Users/aryantripathi/Developer/Cribliv_v2-master/.claude/run-web.sh`, a path from another machine. **Use `"Web (Next.js, alt port)"` (port 3100) and `"API (NestJS)"` (port 4000) instead.** Do not "fix" the broken entry as part of this task.
  1. `preview_start {name: "API (NestJS)"}`, then `preview_start {name: "Web (Next.js, alt port)"}`.
  2. Sign in as admin (OTP mock, `+919999999903`), open the **PG Listings** tab.
  3. `read_console_messages` + `read_network_requests` → zero errors; confirm the first request carries `verification=verified&status=active&sort=leads&page=1&page_size=25`.
  4. Type in search → exactly **one** request after ~300 ms.
  5. Change sort → order changes. Change city → filtered. Click Next → `page=2` request.
  6. Click **Copy link** on an active row → `javascript_tool: await navigator.clipboard.readText()` returns `http://localhost:3100/en/pg/{city}/{id}` **only if** `NEXT_PUBLIC_SITE_URL` is set locally; with it unset the value is `https://cribliv.com/en/pg/{city}/{id}`. Assert the **path** is well-formed; do not assert the host.
  7. Click **Open** → verify it targets the correct path. **Expect a 404 against the production host** — V2 is not deployed there (see Deployment caveat). To verify the page really renders, navigate the local preview to `/en/pg/{city}/{id}` directly.
  8. Switch status to **Draft** → confirm draft PGs appear and their actions read "Not publicly available".
  9. `resize_window` to 375px → chips wrap; the table scrolls horizontally **inside** `.admin-table-wrap` and the page body does **not** scroll sideways; copy/open tap targets ≥ 40px. Screenshot desktop **and** mobile.

- [ ] **Step 10: Commit.** `git commit -m "feat(admin-pg): Verified-PGs tab — filters/search/sort/pagination + copy/open"`

---

## Task 8: PG detail — copy/open in the header

**Files:** Modify `apps/web/components/admin/pg-properties/PgListingDetail.tsx`.

**Verified context:** this is already a full 6-tab workspace (`overview | details | rooms | photos | location | owner`) — **do not rebuild it**. `detail` is guarded non-null at line 137, so everything below line 175 can dereference it safely. The DTO is `PgAdminListingDetail = { listing: { id, title, status }, property, city_slug, locality_slug, owner, overrides }` — no `verification_status`, which is fine: shareability is `status === 'active' && city_slug != null`.

- [ ] **Step 1: Import + state.**

```tsx
import { publicSiteUrl, copyPublicSiteUrl } from "../../../lib/public-site-url";
```

Next to `const [copied, setCopied] = useState(false);` (line 83):

```tsx
const [copiedUrl, setCopiedUrl] = useState(false);
```

- [ ] **Step 2: Compute the path** after the `if (!detail)` guard (i.e. below line 147, alongside `renderContentTab`):

```tsx
// Same shareability rule the list endpoint applies: publicly reachable iff
// active and city-slugged. Verification is a badge, not a gate.
const publicPath =
  detail.listing.status === "active" && detail.city_slug
    ? `/en/pg/${detail.city_slug}/${detail.listing.id}`
    : null;
```

- [ ] **Step 3: Render** immediately after the existing "Copy listing ID" `<button>` (which closes at line 246), inside the same flex row:

```tsx
{
  publicPath ? (
    <>
      <button
        type="button"
        className="admin-chip admin-btn--sm"
        style={{ fontSize: 11 }}
        onClick={async () => {
          try {
            await copyPublicSiteUrl(publicPath);
            setCopiedUrl(true);
            window.setTimeout(() => setCopiedUrl(false), 1500);
          } catch {
            onToast?.("Could not copy public link", "error");
          }
        }}
      >
        {copiedUrl ? "Copied ✓" : "Copy public link"}
      </button>
      <a
        className="admin-chip admin-btn--sm"
        style={{ fontSize: 11 }}
        href={publicSiteUrl(publicPath)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open public page
      </a>
    </>
  ) : (
    <span style={{ fontSize: 11, color: "#9CA3AF" }}>Not publicly available</span>
  );
}
```

- [ ] **Step 4:** `pnpm --filter @cribliv/web typecheck` → exits 0.
- [ ] **Step 5: Browser verify.** Open an active PG → both buttons work. Open a draft PG → "Not publicly available". Desktop + 375px. Screenshot.
- [ ] **Step 6: Commit.** `git commit -m "feat(admin-pg): copy/open public URL in the listing detail header"`

---

## Task 9: Docs + full verification

- [ ] **Step 1: Add to `.env.example`** near the other `NEXT_PUBLIC_*` web vars:

```bash
# Canonical public site origin. Used for canonical tags, sitemap, robots, OG URLs,
# and the admin copy/open share links. MUST be set in every deployed environment —
# the code fallback (https://cribliv.com) is a local-dev convenience only.
NEXT_PUBLIC_SITE_URL=https://cribliv.com
```

- [ ] **Step 2: Full build/lint/typecheck.**

```bash
export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"
pnpm build && pnpm lint && pnpm typecheck
```

- [ ] **Step 3: Test suites.**

```bash
export PATH="$(ls -d /opt/homebrew/opt/node@22/bin):$PATH"
export DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2"
pnpm --filter @cribliv/api test
pnpm --filter @cribliv/web test
```

**Known pre-existing failures — NOT your regression** (13 test-side failures: rent-agreement FK, notification_log teardown, the destructive migration-0034 test, the stale 0031 assertion). Record exact pass/fail counts and confirm the delta is zero new failures. If a NEW failure appears, stop and report — do not paper over it.

- [ ] **Step 4: API smoke.** Get an admin token (OTP mock, `+919999999903`), then:

```bash
curl -s -H "Authorization: Bearer <admin token>" \
  'http://localhost:4000/v1/admin/pg/listings?verification=verified&page=1&page_size=25' \
  | jq '{total: .data.total, count: (.data.items|length), cities: (.data.available_cities|length), summary: .data.summary, sample: .data.items[0]}'
```

Assert `sample` has `cover_photo_url`, `starting_rent_paise` (a **number**, not a string), `gender_policy`, `city_slug`, `public_path`, `verification_status`, `updated_at` — and **no** `owner_phone`, `cover_blob`, or `total` keys.

Then record the drift between the projection and the vestigial head column:

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) AS pg_total,
       count(*) FILTER (WHERE l.id IS NULL) AS missing_projection,
       count(*) FILTER (WHERE l.verification_status <> pl.verification_status) AS drifted
FROM pg_listings pl LEFT JOIN listings l ON l.id = pl.id;"
```

**A large `drifted` count is expected and harmless** — `pg_listings.verification_status` has zero readers in the API (see follow-up #1), so the divergence is cosmetic. Record it for the follow-up ticket, nothing more. **`missing_projection` is the number that matters**: it should be `0`. If it is non-zero, some PG listings have no `listings` row, meaning D1's `LEFT JOIN` + `COALESCE` fallback is load-bearing rather than defensive — report it, because it also implies those listings are invisible to search and maps.

- [ ] **Step 5: Regression — Verified Homes untouched.**

```bash
git diff --stat master -- apps/api/src/modules/admin/admin-homes.service.ts \
  apps/api/src/modules/admin/admin-homes.params.ts \
  apps/api/src/modules/admin/admin-homes.controller.ts \
  apps/web/components/admin/homes/ apps/web/lib/admin-home-url.ts
```

Must print **nothing**. Then open the Verified Homes tab in the browser and confirm list/filter/copy behave exactly as before.

- [ ] **Step 6: Commit.** `git commit -m "docs(env): document NEXT_PUBLIC_SITE_URL for public share URLs"`

---

## Acceptance Criteria

- `GET /admin/pg/listings?verification=verified` returns only listings whose **`listings.verification_status`** is `verified` (D1), each with `cover_photo_url`, `starting_rent_paise` (number), `gender_policy`, `city_slug`, `public_path`, `verification_status`, `updated_at`; the response is the envelope with correct `summary`, `available_cities`, `total`.
- Server-side filters all work: `status` (incl. `draft`/`pending_review` — D2), `city`, `q` (title/id/property/owner/phone/locality/city), `sort` (`leads|updated|rent_desc|rent_asc`), `page`/`page_size` ∈ {25,50,100}. Unknown/oversized params are clamped and never reach SQL as raw text.
- Facet counts (`available_cities`) use the **identical** `q` predicate as the row query — they can never disagree with the visible list.
- An out-of-range page reports the true `total`, not 0.
- Endpoint stays behind `@Roles("admin")`; raw owner phone never appears in a SELECTed column.
- UI: filter / 300 ms-debounced search / sort / paginate all function; **copy** yields `${NEXT_PUBLIC_SITE_URL}/en/pg/{city}/{id}`; **open** targets the same URL; actions read "Not publicly available" whenever `public_path` is null. A failed request renders a distinct error state with Retry — never an empty state.
- Responsive at 375px (table scrolls inside `.admin-table-wrap`, body does not); tap targets ≥ 40px.
- List is one main query + `count(*) OVER ()`; cover comes from a lateral (no N+1). No console/network errors.
- `admin-homes.*`, `HomesInventory.tsx`, `AdminHomeWorkspace.tsx`, `admin-home-url.ts` are byte-for-byte unchanged.
- Zero **new** test failures versus the recorded pre-existing baseline.

## Known follow-ups (out of scope — report, don't fix)

1. **`pg_listings.verification_status` is a vestigial write-only column.** Verified 2026-07-22: it has **zero readers** in `apps/api`. It is written on insert (`pg-listing.service.ts:292`, always `'unverified'`), by the V1 import (`write-pg.ts:63`), and by review approval (`admin.controller.ts:243`) — and read by nothing. Every consumer of PG verification reads the `listings` projection instead; `pg-listing.service.ts:815` even carries a comment saying so. Consequently D1 is not a workaround but conformance to the existing convention, and any drift is cosmetic. The real cleanup is to **deprecate the column** (stop writing it, comment it, drop it in a later migration) — _not_ to add a fourth writer that syncs it. Do not do either here.
2. **No index** on `pg_listings(status)` / `(verification_status)`, and the new sort touches `starting_rent_paise` unindexed. Fine at current volume; revisit if the tab slows.
3. **33 duplicated `NEXT_PUBLIC_SITE_URL` fallbacks** across `apps/web`. `public-site-url.ts` is the convergence point when those files are next touched.
4. **Broken `.claude/launch.json` entry** ("Web (Next.js)" → another machine's absolute path).
5. **`CLAUDE.md` is stale**: it says migrations end at `0054`/next `0055` (actually `0066`/next `0067`) and that `pnpm --filter @cribliv/web test` is Playwright (it's `vitest run`; Playwright is `test:e2e`).
