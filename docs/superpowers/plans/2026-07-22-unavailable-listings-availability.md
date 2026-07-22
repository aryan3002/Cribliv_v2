# Unavailable listings + notify-when-available — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a verified flat/house be marked "not available right now" from both the owner dashboard and the admin portal, showing a calm "Notify when available" waitlist CTA, sinking (not hiding) the listing to the bottom of search, and capturing OTP-verified signups as admin-visible leads.

**Architecture:** Availability is a new boolean `is_available` flag on an otherwise-`active` listing — **not** a new `listing_status` value. Because the listing stays `active`, it passes every existing visibility gate unchanged; the only deliberate changes are a leading "available-first" sort term in search, a CTA swap on the detail page, owner/admin toggles that write the flag, and a new `listing_availability_alerts` waitlist table + endpoints. Everything ships behind `ff_unavailable_listings` (default OFF).

**Tech Stack:** NestJS (apps/api) with dual-mode DB (`DatabaseService` Postgres path + `AppStateService` in-memory path), Next.js 14 App Router (apps/web), raw SQL migrations (`infra/migrations`), `packages/shared-types` contracts, Vitest (API), Playwright + component unit tests (web). Reference the spec: `docs/superpowers/specs/2026-07-22-unavailable-listings-availability-design.md`.

## Global Constraints

- **Feature flag:** everything gated by `ff_unavailable_listings` (API: `apps/api/src/config/feature-flags.ts`, env `FF_UNAVAILABLE_LISTINGS`, default `false`; web: `useFlag("ff_unavailable_listings")` reading `NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS` or PostHog). Flag OFF ⇒ zero behavior change end-to-end.
- **Scope:** flats/houses only. Every write path guards `listing_type = 'flat_house'`. PG is untouched.
- **Dual-mode required (CLAUDE.md):** every service method that hits Postgres via `DatabaseService.isEnabled()` MUST have a matching `AppStateService` in-memory branch. New tests exercise the in-memory branch.
- **Availability is independent of status:** unavailable = `status = 'active' AND is_available = false`. Never introduce an `unavailable` value into `listing_status`. Never make `paused` publicly visible.
- **Lead visibility:** owners see only a waitlist **count**; only admins see phone numbers.
- **Next migration number is `0067`.** Each migration ships with a matching `.rollback.sql`.
- **Copy:** sentence case, warm/hopeful (amber, not red). Seeker CTA: "Notify when available". Never say the home is gone.
- **Commit after every task.** Branch: `claude/unavailable-properties-ui-79eeb8` (already checked out). Do not push to master.

---

## Phase 1 — Foundation (flag, schema, types, in-memory)

### Task 1: API feature flag `ff_unavailable_listings`

**Files:**

- Modify: `apps/api/src/config/feature-flags.ts`
- Test: `apps/api/src/config/__tests__/feature-flags.test.ts` (create if absent; otherwise add a case to the existing flags test)

**Interfaces:**

- Produces: `FeatureFlags.ff_unavailable_listings: boolean` (default `false`), env `FF_UNAVAILABLE_LISTINGS`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readFeatureFlags, defaultFeatureFlags } from "../feature-flags";

describe("ff_unavailable_listings", () => {
  afterEach(() => {
    delete process.env.FF_UNAVAILABLE_LISTINGS;
  });

  it("defaults to false", () => {
    expect(defaultFeatureFlags.ff_unavailable_listings).toBe(false);
    expect(readFeatureFlags().ff_unavailable_listings).toBe(false);
  });

  it("reads FF_UNAVAILABLE_LISTINGS=true", () => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
    expect(readFeatureFlags().ff_unavailable_listings).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- feature-flags`
Expected: FAIL — `ff_unavailable_listings` does not exist on `FeatureFlags`.

- [ ] **Step 3: Add the flag**

In `feature-flags.ts`: add to the `FeatureFlags` interface (near the callback/lead flags, ~line 90):

```ts
/** Unavailable listings + notify-when-available waitlist (flats/houses). */
ff_unavailable_listings: boolean;
```

Add to `defaultFeatureFlags` (~line 178):

```ts
ff_unavailable_listings: false;
```

Add to `readFeatureFlags()` return (~line 441):

```ts
    ff_unavailable_listings: parseBooleanEnv(
      "FF_UNAVAILABLE_LISTINGS",
      defaultFeatureFlags.ff_unavailable_listings
    ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- feature-flags`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/feature-flags.ts apps/api/src/config/__tests__/feature-flags.test.ts
git commit -m "feat(api): add ff_unavailable_listings flag (default off)"
```

---

### Task 2: Migration 0067 — `is_available` flag, waitlist table, audit enum

**Files:**

- Create: `infra/migrations/0067_listing_availability.sql`
- Create: `infra/migrations/0067_listing_availability.rollback.sql`

**Interfaces:**

- Produces: `listings.is_available boolean NOT NULL DEFAULT true`, `listings.became_unavailable_at timestamptz`, `listings.availability_source text`; table `listing_availability_alerts`; enum value `admin_action_type.availability_change`.

- [ ] **Step 1: Write the forward migration**

`infra/migrations/0067_listing_availability.sql`:

```sql
-- 0067: Unavailable listings + notify-when-available waitlist (flats/houses).
-- Availability is independent of listing_status. Unavailable = status='active' AND is_available=false.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS became_unavailable_at timestamptz,
  ADD COLUMN IF NOT EXISTS availability_source text; -- 'owner' | 'admin' | null

CREATE INDEX IF NOT EXISTS idx_listings_is_available_active
  ON listings (is_available)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS listing_availability_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  user_id      uuid,
  phone        text NOT NULL,
  locale       text,
  status       text NOT NULL DEFAULT 'waiting', -- 'waiting' | 'ready' | 'notified' | 'cancelled'
  created_at   timestamptz NOT NULL DEFAULT now(),
  ready_at     timestamptz,
  notified_at  timestamptz,
  UNIQUE (listing_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_avail_alerts_listing ON listing_availability_alerts (listing_id);
CREATE INDEX IF NOT EXISTS idx_avail_alerts_status  ON listing_availability_alerts (status);

-- New admin audit action (ALTER TYPE ADD VALUE must run outside a txn block;
-- follow the same pattern as 0061_pg_bed_status_inactive.sql).
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'availability_change';
```

Note: `user_id` is intentionally left without an FK — match whatever the accounts/users table is called elsewhere if you want a constraint, but the app enforces the relationship. If `gen_random_uuid()` is unavailable, this repo already uses it in later migrations (pgcrypto is enabled); keep it.

- [ ] **Step 2: Write the rollback**

`infra/migrations/0067_listing_availability.rollback.sql`:

```sql
DROP TABLE IF EXISTS listing_availability_alerts;
DROP INDEX IF EXISTS idx_listings_is_available_active;
ALTER TABLE listings
  DROP COLUMN IF EXISTS availability_source,
  DROP COLUMN IF EXISTS became_unavailable_at,
  DROP COLUMN IF EXISTS is_available;
-- Note: Postgres cannot remove an enum value; 'availability_change' remains on admin_action_type (harmless).
```

- [ ] **Step 3: Apply the migration locally**

Run: `pnpm db:migrate`
Expected: `0067_listing_availability.sql` applies with no error. (If the runner wraps everything in one transaction and the `ALTER TYPE ADD VALUE` fails, split the enum ALTER into its own statement/file exactly as `0061` does — read `infra/migrations/0061_pg_bed_status_inactive.sql` first and mirror it.)

- [ ] **Step 4: Verify schema**

Run: `psql "$DATABASE_URL" -c "\d listings" -c "\d listing_availability_alerts"`
Expected: `is_available`, `became_unavailable_at`, `availability_source` on `listings`; `listing_availability_alerts` present with the unique constraint.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/0067_listing_availability.sql infra/migrations/0067_listing_availability.rollback.sql
git commit -m "feat(db): 0067 is_available flag + listing_availability_alerts"
```

---

### Task 3: Shared types — `is_available`, `waitlist_count`, alert DTOs

**Files:**

- Modify: `packages/shared-types/src/types.ts`
- Modify: `packages/shared-types/src/admin-homes.ts`
- Modify: `packages/shared-types/src/index.ts` (only if new file/exports need surfacing)
- Test: `packages/shared-types/src/__tests__/availability.test.ts` (create)

**Interfaces:**

- Produces:
  - `Listing.is_available?: boolean` and search-item/detail DTOs carry `is_available: boolean`.
  - `AvailabilityAlertStatus = "waiting" | "ready" | "notified" | "cancelled"`.
  - `AvailabilityAlertResult = { status: AvailabilityAlertStatus; already_on_list: boolean }`.
  - `WaitlistLead = { id: string; phone: string; user_id: string | null; status: AvailabilityAlertStatus; created_at: string }`.
  - `AdminHomeListItem.waitlist_count: number` and `.is_available: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { AvailabilityAlertResult, WaitlistLead, AvailabilityAlertStatus } from "../types";

describe("availability types", () => {
  it("exposes alert result + lead shapes", () => {
    expectTypeOf<AvailabilityAlertResult["already_on_list"]>().toEqualTypeOf<boolean>();
    expectTypeOf<WaitlistLead["phone"]>().toEqualTypeOf<string>();
    expectTypeOf<AvailabilityAlertStatus>().toMatchTypeOf<
      "waiting" | "ready" | "notified" | "cancelled"
    >();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/shared-types test -- availability`
Expected: FAIL — types not exported.

- [ ] **Step 3: Add the types**

In `types.ts` add:

```ts
export type AvailabilityAlertStatus = "waiting" | "ready" | "notified" | "cancelled";

export interface AvailabilityAlertResult {
  status: AvailabilityAlertStatus;
  already_on_list: boolean;
}

export interface WaitlistLead {
  id: string;
  phone: string;
  user_id: string | null;
  status: AvailabilityAlertStatus;
  created_at: string;
}
```

Add `is_available: boolean` to the search-result item interface and the listing-detail payload interface (whichever interfaces the search service and listings controller return — search item and detail DTO). If the base `Listing` interface exists, add `is_available?: boolean` there too.

In `admin-homes.ts`, add to `AdminHomeListItem` (near `status`, ~line 32) and the detail DTO:

```ts
is_available: boolean;
waitlist_count: number;
```

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @cribliv/shared-types test -- availability && pnpm --filter @cribliv/shared-types build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src
git commit -m "feat(types): availability flag, alert + waitlist DTOs"
```

---

### Task 4: In-memory dual-mode parity (`AppStateService`)

**Files:**

- Modify: `apps/api/src/common/app-state.service.ts`
- Test: `apps/api/src/common/__tests__/app-state.availability.test.ts` (create)

**Interfaces:**

- Produces:
  - In-memory listings carry `is_available: boolean` (default `true`).
  - `AppStateService.availabilityAlerts: Array<{ id; listing_id; user_id; phone; locale; status; created_at; ready_at; notified_at }>` plus helpers `addAvailabilityAlert(alert)`, `listAvailabilityAlerts(listingId)`, `setListingAvailability(listingId, isAvailable)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { AppStateService } from "../app-state.service";

describe("AppStateService availability", () => {
  let app: AppStateService;
  beforeEach(() => {
    app = new AppStateService();
  });

  it("listings default to available", () => {
    const l = app.listings[0];
    if (l) expect(l.is_available).toBe(true);
  });

  it("adds a waitlist alert and lists it, idempotently by phone", () => {
    const listingId = app.listings[0]?.id ?? "seed-listing";
    app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900000",
      user_id: null,
      locale: "en"
    });
    app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900000",
      user_id: null,
      locale: "en"
    });
    expect(app.listAvailabilityAlerts(listingId)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- app-state.availability`
Expected: FAIL — `is_available`/`availabilityAlerts` undefined.

- [ ] **Step 3: Implement in-memory parity**

- Add `is_available: true` to the seed-listing shape(s) in `AppStateService` (wherever listings are seeded; grep for `status:` on the seed objects).
- Add:

```ts
availabilityAlerts: Array<{
  id: string; listing_id: string; user_id: string | null; phone: string;
  locale: string | null; status: "waiting" | "ready" | "notified" | "cancelled";
  created_at: string; ready_at: string | null; notified_at: string | null;
}> = [];

addAvailabilityAlert(input: { listing_id: string; phone: string; user_id: string | null; locale: string | null }) {
  const existing = this.availabilityAlerts.find(a => a.listing_id === input.listing_id && a.phone === input.phone);
  if (existing) return { alert: existing, already_on_list: true };
  const alert = {
    id: `alert_${this.availabilityAlerts.length + 1}`,
    listing_id: input.listing_id, user_id: input.user_id, phone: input.phone, locale: input.locale,
    status: "waiting" as const, created_at: new Date().toISOString(), ready_at: null, notified_at: null,
  };
  this.availabilityAlerts.push(alert);
  return { alert, already_on_list: false };
}

listAvailabilityAlerts(listingId: string) {
  return this.availabilityAlerts.filter(a => a.listing_id === listingId);
}

setListingAvailability(listingId: string, isAvailable: boolean) {
  const l = this.listings.find(x => x.id === listingId);
  if (!l) return null;
  l.is_available = isAvailable;
  if (isAvailable) {
    this.availabilityAlerts.forEach(a => { if (a.listing_id === listingId && a.status === "waiting") { a.status = "ready"; a.ready_at = new Date().toISOString(); } });
  }
  return l;
}
```

(Match the existing `AppStateService` field/type conventions; the listing shape type may need `is_available` added to its interface.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- app-state.availability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/app-state.service.ts apps/api/src/common/__tests__/app-state.availability.test.ts
git commit -m "feat(api): in-memory availability flag + waitlist store"
```

---

## Phase 2 — Owner availability toggle

### Task 5: API — owner `setAvailability` + relabel existing pause to "visibility"

**Files:**

- Modify: `apps/api/src/modules/owner/owner.service.ts` (add `setAvailability`; the existing `toggleAvailability` at ~849-884 stays but is now conceptually "visibility/pause")
- Modify: `apps/api/src/modules/owner/owner.controller.ts` (add route; rename existing pause route path to `/visibility` per spec §2, keeping the handler)
- Test: `apps/api/src/modules/owner/__tests__/owner-availability.service.test.ts` (create)

**Interfaces:**

- Consumes: `AppStateService.setListingAvailability` (Task 4).
- Produces:
  - `OwnerService.setAvailability(userId: string, listingId: string, available: boolean): Promise<{ listing_id: string; is_available: boolean }>` — flats/houses only, ownership-scoped, `status='active'` guard.
  - Route `PATCH /owner/listings/:listing_id/availability-status` body `{ available: boolean }`.
  - Existing pause route renamed to `PATCH /owner/listings/:listing_id/visibility` body `{ available: boolean }` (same handler/service `toggleAvailability`).

Note (deviation from spec §2, chosen for execution safety): the NEW flag uses the fresh path `/availability-status` and the existing pause endpoint is renamed to `/visibility`. This guarantees no path is ever reused for a new meaning. User-facing labels are unchanged ("Availability" vs "Visibility").

- [ ] **Step 1: Write the failing test** (in-memory path)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { OwnerService } from "../owner.service";
import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";

function makeService() {
  const app = new AppStateService();
  const db = { isEnabled: () => false } as unknown as DatabaseService;
  const svc = new OwnerService(db, app /*, ...other deps as constructor requires */);
  return { app, svc };
}

describe("OwnerService.setAvailability", () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it("marks an owned active flat unavailable", async () => {
    const l = ctx.app.listings.find(
      (x) => x.listing_type === "flat_house" && x.status === "active"
    )!;
    l.owner_user_id = "owner-1";
    const res = await ctx.svc.setAvailability("owner-1", l.id, false);
    expect(res.is_available).toBe(false);
    expect(ctx.app.listings.find((x) => x.id === l.id)!.is_available).toBe(false);
  });

  it("rejects a listing the caller does not own", async () => {
    const l = ctx.app.listings.find((x) => x.listing_type === "flat_house")!;
    l.owner_user_id = "someone-else";
    await expect(ctx.svc.setAvailability("owner-1", l.id, false)).rejects.toThrow();
  });
});
```

(Adjust the `OwnerService` constructor arg list to match the real signature — read the top of `owner.service.ts` first.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- owner-availability`
Expected: FAIL — `setAvailability` not defined.

- [ ] **Step 3: Implement `setAvailability`**

In `owner.service.ts`, mirror `toggleAvailability` (~849):

```ts
async setAvailability(userId: string, listingId: string, available: boolean) {
  if (!this.db.isEnabled()) {
    const l = this.appState.listings.find(x => x.id === listingId);
    if (!l || l.owner_user_id !== userId) throw new NotFoundException("listing_not_found");
    if (l.listing_type !== "flat_house") throw new BadRequestException("availability_flat_house_only");
    if (l.status !== "active") throw new BadRequestException("availability_requires_active");
    this.appState.setListingAvailability(listingId, available);
    return { listing_id: listingId, is_available: available };
  }
  const { rows } = await this.db.query(
    `UPDATE listings
        SET is_available = $3,
            became_unavailable_at = CASE WHEN $3 THEN NULL ELSE now() END,
            availability_source = 'owner',
            last_owner_activity_at = now(),
            updated_at = now()
      WHERE id = $1::uuid
        AND owner_user_id = $2::uuid
        AND status = 'active'
        AND listing_type = 'flat_house'
      RETURNING id::text, is_available`,
    [listingId, userId, available]
  );
  if (!rows[0]) throw new NotFoundException("listing_not_found");
  if (available) {
    await this.db.query(
      `UPDATE listing_availability_alerts
          SET status = 'ready', ready_at = now()
        WHERE listing_id = $1::uuid AND status = 'waiting'`,
      [listingId]
    );
  }
  return { listing_id: rows[0].id, is_available: rows[0].is_available };
}
```

Import `BadRequestException` if not already imported.

- [ ] **Step 4: Add controller routes**

In `owner.controller.ts`, add near the existing availability route (~122):

```ts
@Patch("listings/:listing_id/availability-status")
async setAvailability(
  @Req() req: AuthedRequest,
  @Param("listing_id") listingId: string,
  @Body() body: { available: boolean }
) {
  return ok(await this.ownerService.setAvailability(req.user.id, listingId, body.available));
}
```

Rename the existing pause route decorator from `@Patch("listings/:listing_id/availability")` to `@Patch("listings/:listing_id/visibility")` (leave the handler/service name `toggleAvailability` as-is). Use the exact `ok(...)`/response helper the file already uses.

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @cribliv/api test -- owner-availability`
Expected: PASS.

```bash
git add apps/api/src/modules/owner
git commit -m "feat(api): owner setAvailability + rename pause route to /visibility"
```

---

### Task 6: API — include `is_available` + `waitlist_count` in owner listing reads

**Files:**

- Modify: `apps/api/src/modules/owner/owner.service.ts` (`listOwnerListings` ~27, `getOwnerListing`)
- Test: extend `apps/api/src/modules/owner/__tests__/owner-availability.service.test.ts`

**Interfaces:**

- Produces: each owner listing row gains `is_available: boolean` and `waitlist_count: number` (count of alerts with status in `('waiting','ready')`).

- [ ] **Step 1: Write the failing test**

```ts
it("exposes is_available and waitlist_count on owner listings", async () => {
  const l = ctx.app.listings.find((x) => x.listing_type === "flat_house")!;
  l.owner_user_id = "owner-1";
  ctx.app.addAvailabilityAlert({
    listing_id: l.id,
    phone: "+919000000001",
    user_id: null,
    locale: "en"
  });
  const rows = await ctx.svc.listOwnerListings("owner-1");
  const row = rows.find((r: any) => r.id === l.id);
  expect(row.is_available).toBe(true);
  expect(row.waitlist_count).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- owner-availability`
Expected: FAIL — fields missing.

- [ ] **Step 3: Implement**

In-memory branch of `listOwnerListings`/`getOwnerListing`: map each listing to include
`is_available: l.is_available ?? true` and
`waitlist_count: this.appState.listAvailabilityAlerts(l.id).filter(a => a.status === "waiting" || a.status === "ready").length`.
DB branch: add `l.is_available` to the SELECT column list, and a correlated subquery:

```sql
, (SELECT count(*) FROM listing_availability_alerts a
     WHERE a.listing_id = l.id AND a.status IN ('waiting','ready'))::int AS waitlist_count
```

Map both into the returned DTO.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api test -- owner-availability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/owner
git commit -m "feat(api): expose is_available + waitlist_count on owner listings"
```

---

### Task 7: Web — owner API client (`setListingAvailability`, rename visibility)

**Files:**

- Modify: `apps/web/lib/owner-api.ts` (existing `toggleListingAvailability` ~1258)
- Test: `apps/web/lib/__tests__/owner-api-availability.test.ts` (create; mirror existing `admin-api-*.test.ts` mocking of `fetchApi`)

**Interfaces:**

- Consumes: routes from Task 5.
- Produces:
  - `setListingAvailability(token: string, listingId: string, available: boolean): Promise<{ listing_id: string; is_available: boolean }>` → `PATCH /owner/listings/:id/availability-status`.
  - Rename `toggleListingAvailability` → `setListingVisibility(token, listingId, available)` → `PATCH /owner/listings/:id/visibility`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as api from "../api";
import { setListingAvailability } from "../owner-api";

describe("setListingAvailability", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("PATCHes /availability-status with { available }", async () => {
    const spy = vi
      .spyOn(api, "fetchApi")
      .mockResolvedValue({ listing_id: "L1", is_available: false } as any);
    const res = await setListingAvailability("tok", "L1", false);
    expect(spy).toHaveBeenCalledWith(
      "/owner/listings/L1/availability-status",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(res.is_available).toBe(false);
  });
});
```

(Match how the existing owner-api functions call `fetchApi` — copy the exact option shape used by `toggleListingAvailability`.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test:unit -- owner-api-availability` (use the repo's unit-test command; check `apps/web/package.json` scripts)
Expected: FAIL — `setListingAvailability` not exported.

- [ ] **Step 3: Implement**

Copy the body of `toggleListingAvailability` to a new `setListingAvailability` that targets `/owner/listings/${listingId}/availability-status` with body `{ available }`. Rename the original to `setListingVisibility` and point it at `/visibility`. Update its type import to reuse the existing return shape.

- [ ] **Step 4: Run to verify it passes**

Run: same as Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/owner-api.ts apps/web/lib/__tests__/owner-api-availability.test.ts
git commit -m "feat(web): owner-api setListingAvailability + rename visibility"
```

---

### Task 8: Web — owner UI: two labeled toggles + waitlist nudge

**Files:**

- Create: `apps/web/components/owner/listing-availability-toggle.tsx` (the NEW flag toggle)
- Modify: `apps/web/components/owner/availability-toggle.tsx` → relabel to "Visibility · Live/Paused"; call `setListingVisibility`
- Modify: `apps/web/components/owner/listing-card-luxe.tsx` (render both toggles ~293-304/379-389; add waitlist nudge)
- Modify: `apps/web/components/owner/owner-listings-client.tsx` (thread `is_available` + `waitlist_count`)
- Modify: `apps/web/lib/i18n.ts` (labels — or rely on Task 16 if done first)
- Test: `apps/web/components/owner/__tests__/listing-availability-toggle.test.tsx` (create; mirror existing owner component tests)

**Interfaces:**

- Consumes: `setListingAvailability`, `setListingVisibility` (Task 7); `is_available`, `waitlist_count` on the owner listing (Task 6).
- Produces: `ListingAvailabilityToggle` React component with props `{ listingId: string; accessToken: string; available: boolean; onAvailabilityChange?: (available: boolean) => void }`; only rendered for `listing_type === "flat_house"` and `status === "active"` and when `useFlag("ff_unavailable_listings")`.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ListingAvailabilityToggle } from "../listing-availability-toggle";
import * as ownerApi from "../../../lib/owner-api";

describe("ListingAvailabilityToggle", () => {
  it("optimistically marks not available and calls the API", async () => {
    const spy = vi
      .spyOn(ownerApi, "setListingAvailability")
      .mockResolvedValue({ listing_id: "L1", is_available: false });
    render(<ListingAvailabilityToggle listingId="L1" accessToken="tok" available={true} />);
    fireEvent.click(screen.getByRole("switch", { name: /availability/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("tok", "L1", false));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test:unit -- listing-availability-toggle`
Expected: FAIL — component missing.

- [ ] **Step 3: Build `ListingAvailabilityToggle`**

Copy the structure of the existing `availability-toggle.tsx` (`handleToggle` optimistic + revert-on-error at ~32-50) into `listing-availability-toggle.tsx`, but call `setListingAvailability`, render a labeled row "Availability" with states "Available"/"Not available" (amber when not available), an `aria-label` containing "availability", and helper text "Stays listed, sinks in search, collects notify sign-ups." Guard render with `useFlag("ff_unavailable_listings")`.

- [ ] **Step 4: Wire into the card**

In `listing-card-luxe.tsx`: relabel the existing toggle block to "Visibility" (copy update only) and render `<ListingAvailabilityToggle>` next to it (desktop inline + inside the actions sheet), passing `available={listing.is_available ?? true}`. Below the toggles, when `listing.waitlist_count > 0` and `!listing.is_available`, render the amber nudge: `{waitlist_count} people want to be notified when this is available`. Thread `is_available` + `waitlist_count` through `owner-listings-client.tsx` (they arrive from Task 6).

- [ ] **Step 5: Run tests, verify in preview, commit**

Run: `pnpm --filter @cribliv/web test:unit -- listing-availability-toggle` → PASS.
Verify in the browser preview (owner listings page) that both toggles render with distinct labels and the nudge appears when unavailable + waitlisted.

```bash
git add apps/web/components/owner apps/web/lib/i18n.ts
git commit -m "feat(web): owner availability + visibility toggles with waitlist nudge"
```

---

## Phase 3 — Search: sink + card variant

### Task 9: API — "available first" sort, `is_available` in results, similar exclusion

**Files:**

- Modify: `apps/api/src/modules/search/search.service.ts` (orderBy ~573-583 applied ~659; in-memory fallback ~790-800; item DTO ~668-690; similar ~990/1072)
- Test: `apps/api/src/modules/search/__tests__/search-availability.service.test.ts` (create; in-memory path)

**Interfaces:**

- Produces: search results include `is_available: boolean`; unavailable listings sort strictly after all available ones in every sort mode; similar-listings excludes unavailable.

- [ ] **Step 1: Write the failing test**

```ts
it("sorts unavailable listings after all available ones", async () => {
  // Arrange: two flat_house active listings in the same city, one unavailable.
  // Use the in-memory AppStateService seed; set one listing's is_available=false.
  const items = (
    await searchService.searchListings({
      city: SEED_CITY,
      listing_type: "flat_house",
      sort: "newest"
    })
  ).items;
  const idx = items.map((i: any) => i.is_available);
  // every `true` precedes every `false`
  const firstFalse = idx.indexOf(false);
  if (firstFalse !== -1) expect(idx.slice(firstFalse).every((v) => v === false)).toBe(true);
  expect(items[0]).toHaveProperty("is_available");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- search-availability`
Expected: FAIL — `is_available` absent / order not guaranteed.

- [ ] **Step 3: Implement the sort + DTO**

In `search.service.ts`, define once:

```ts
const availabilityOrder = "CASE WHEN l.is_available THEN 0 ELSE 1 END ASC";
```

Prepend it to every branch of `orderBy` (rent_asc/rent_desc/verified/newest/relevance) so it reads `${availabilityOrder}, <existing order…>`. Add `l.is_available` to the SELECT and map it into the returned item (near ~668-690). In the in-memory fallback sort (~790-800), sort by `Number(!a.is_available) - Number(!b.is_available)` first, then the existing comparator; include `is_available` in the mapped item. For similar listings queries (~990, ~1072) add `AND l.is_available` to the WHERE.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api test -- search-availability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/search
git commit -m "feat(api): sink unavailable listings in search; exclude from similar"
```

---

### Task 10: Web — unavailable search card + "currently unavailable" divider

**Files:**

- Modify: `apps/web/components/listing-card.tsx` (`ListingCardData` ~19-32; badge ~107-126)
- Modify: `apps/web/app/[locale]/search/page.tsx` (grid ~409-436)
- Create: `apps/web/components/listing/notify-availability-button.tsx` (shared inline notify trigger; reused on detail in Task 13)
- Test: `apps/web/components/__tests__/listing-card-availability.test.tsx` (create)

**Interfaces:**

- Consumes: `is_available` on the search item (Task 9).
- Produces:
  - `ListingCardData` gains `is_available?: boolean`.
  - When `is_available === false` and flag on: card renders grayscale image, amber "Unavailable" badge, and `<NotifyAvailabilityButton listingId locale variant="inline" />`.
  - `NotifyAvailabilityButton` component (props `{ listingId: string; locale: string; variant: "inline" | "primary" }`) — opens the OTP → waitlist flow (implemented in Task 13; here it renders and is clickable).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ListingCardItem } from "../../components/listing-card";

it("renders an Unavailable badge and notify button when not available", () => {
  render(
    <ListingCardItem
      listing={
        { id: "L1", title: "2BHK", is_available: false, verification_status: "verified" } as any
      }
      locale="en"
    />
  );
  expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /notify me/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test:unit -- listing-card-availability`
Expected: FAIL.

- [ ] **Step 3: Implement card variant + NotifyAvailabilityButton stub**

- Add `is_available?: boolean` to `ListingCardData`.
- In `ListingCardItem`: when `is_available === false`, add `filter: grayscale(1); opacity: .8` to the image wrapper, render an amber "Unavailable" badge (reuse the `Badge` primitive with a warning tone) in place of / alongside the verified badge, and render `<NotifyAvailabilityButton listingId={listing.id} locale={locale} variant="inline" />`.
- Create `notify-availability-button.tsx` rendering a bordered amber button "Notify me" (`ti-bell`). For now `onClick` opens the flow added in Task 13 (export a no-op-safe handler placeholder that Task 13 fills). Keep it a real, clickable button so the test passes.

- [ ] **Step 4: Add the divider in search page**

In `search/page.tsx`, split `response.items` into `available` and `unavailable` by `is_available !== false`. Render the available grid, then — only if `unavailable.length > 0` — the divider ("Currently unavailable · get notified when they're back") followed by the unavailable grid. Preserve existing pagination/empty-state logic. Gate the whole split behind the flag (fallback: render one grid as today).

- [ ] **Step 5: Run tests, verify preview, commit**

Run: `pnpm --filter @cribliv/web test:unit -- listing-card-availability` → PASS.
Verify in preview: unavailable cards appear dimmed under the divider at the tail.

```bash
git add apps/web/components/listing-card.tsx apps/web/components/listing apps/web/app/[locale]/search/page.tsx
git commit -m "feat(web): unavailable search card + currently-unavailable section"
```

---

## Phase 4 — Notify waitlist + detail page

### Task 11: API — `availability-alerts` module (join/leave/list + ready flip)

**Files:**

- Create: `apps/api/src/modules/availability-alerts/availability-alerts.module.ts`
- Create: `apps/api/src/modules/availability-alerts/availability-alerts.controller.ts`
- Create: `apps/api/src/modules/availability-alerts/availability-alerts.service.ts`
- Modify: the root module that imports feature modules (grep for where `AlertsModule` is imported, e.g. `apps/api/src/app.module.ts`)
- Test: `apps/api/src/modules/availability-alerts/__tests__/availability-alerts.service.test.ts` (create)

**Interfaces:**

- Consumes: `AppStateService.addAvailabilityAlert`, `listAvailabilityAlerts` (Task 4); `AvailabilityAlertResult` (Task 3).
- Produces:
  - `POST /listings/:listing_id/availability-alerts` (AuthGuard) → `{ status, already_on_list }`. Reads phone from `request.user`.
  - `DELETE /listings/:listing_id/availability-alerts` (AuthGuard) → `{ ok: true }`.
  - `GET /tenant/availability-alerts` (AuthGuard) → `{ items: Array<{ listing_id; status }> }`.
  - `AvailabilityAlertsService.join(userId, phone, listingId, locale)`, `.leave(userId, listingId)`, `.listForUser(userId)`, `.listForListing(listingId)`.

- [ ] **Step 1: Write the failing test**

```ts
it("join is idempotent per (listing, phone)", async () => {
  const first = await svc.join("u1", "+919000000002", "L1", "en");
  expect(first.already_on_list).toBe(false);
  const second = await svc.join("u1", "+919000000002", "L1", "en");
  expect(second.already_on_list).toBe(true);
  expect((await svc.listForListing("L1")).length).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- availability-alerts`
Expected: FAIL — module/service missing.

- [ ] **Step 3: Implement service (dual-mode)**

In-memory: delegate to `AppStateService.addAvailabilityAlert`/`listAvailabilityAlerts`. DB: `INSERT ... ON CONFLICT (listing_id, phone) DO NOTHING RETURNING id` — if no row returned, it already existed (`already_on_list: true`); otherwise `false`. `listForListing` selects ordered by `created_at DESC`. Gate all endpoints behind `ff_unavailable_listings` (read flags via the same provider other modules use); when off, `POST` returns 404/`feature_disabled`.

- [ ] **Step 4: Implement controller + module, register it**

Controller methods call the service with `req.user.id` and `req.user.phone` (confirm the auth payload field name; `AuthGuard` populates `request.user`). Wire `AvailabilityAlertsModule` into the root module imports next to `AlertsModule`.

- [ ] **Step 5: Run tests + commit**

Run: `pnpm --filter @cribliv/api test -- availability-alerts` → PASS.

```bash
git add apps/api/src/modules/availability-alerts apps/api/src/app.module.ts
git commit -m "feat(api): availability-alerts module (notify waitlist)"
```

---

### Task 12: API — detail payload carries `is_available` (+ `waitlist_count`)

**Files:**

- Modify: `apps/api/src/modules/listings/listings.controller.ts` (detail handler ~162/270)
- Test: `apps/api/src/modules/listings/__tests__/listing-detail-availability.test.ts` (create)

**Interfaces:**

- Produces: `GET /listings/:id` payload includes `is_available: boolean` and `waitlist_count: number`. No change to which listings are served (still `status='active'`).

- [ ] **Step 1: Write the failing test**

```ts
it("returns is_available on the detail payload for an active listing", async () => {
  const l = app.listings.find((x) => x.status === "active" && x.listing_type === "flat_house")!;
  const res = await controller.getListing(l.id /*, ...args */);
  expect(res).toHaveProperty("is_available");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- listing-detail-availability`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `is_available` to the SELECT / mapped detail DTO (default `true` for in-memory). Add `waitlist_count` via the same correlated subquery as Task 6 (or in-memory count). Keep the `status='active'` serving gate exactly as-is.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/api test -- listing-detail-availability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/listings
git commit -m "feat(api): expose is_available + waitlist_count on listing detail"
```

---

### Task 13: Web — detail calm-swap CTA + OTP→waitlist flow

**Files:**

- Modify: `apps/web/components/unlock-contact-panel.tsx` (CTA ~390-403; intro ~361-363; OTP flow ~134-198)
- Modify: `apps/web/components/listing/notify-availability-button.tsx` (fill in the flow from Task 10)
- Modify: `apps/web/app/[locale]/listing/[listingId]/page.tsx` (header badge ~278-289; mobile CTA ~643-659; pass `is_available`, `waitlist_count`)
- Modify: `apps/web/lib/i18n.ts` (or Task 16)
- Create: `apps/web/lib/availability-api.ts` — `joinAvailabilityWaitlist(token, listingId)`, `getMyWaitlist(token)`
- Test: `apps/web/components/__tests__/unlock-panel-availability.test.tsx` (create)

**Interfaces:**

- Consumes: `is_available` from detail payload (Task 12); `POST /listings/:id/availability-alerts` (Task 11).
- Produces: `joinAvailabilityWaitlist(token, listingId): Promise<AvailabilityAlertResult>`; `UnlockContactPanel` renders the calm-swap variant when `!is_available`.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows Notify when available instead of Request Callback when unavailable", () => {
  render(
    <UnlockContactPanel
      listing={{ id: "L1", is_available: false, monthly_rent: 14000 } as any}
      locale="en" /* ...required props */
    />
  );
  expect(screen.getByRole("button", { name: /notify when available/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /request callback/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test:unit -- unlock-panel-availability`
Expected: FAIL.

- [ ] **Step 3: Implement the client + panel variant**

- `availability-api.ts`: `joinAvailabilityWaitlist` → `POST /listings/${listingId}/availability-alerts` with bearer token; `getMyWaitlist` → `GET /tenant/availability-alerts`.
- In `unlock-contact-panel.tsx`, add an `isUnavailable = listing.is_available === false && useFlag("ff_unavailable_listings")` branch:
  - amber "Not available right now" chip;
  - primary button "Notify when available" that reuses the existing OTP steps (`requestOtp`/`verifyOtp…`), and on a valid token calls `joinAvailabilityWaitlist`;
  - success → "You're on the list — we'll notify you when it's available";
  - social-proof line when `waitlist_count > 0`;
  - keep price/specs + Save (Option A calm-swap).
- Fill `NotifyAvailabilityButton` (used by the search card) to run the same OTP→join flow (extract a small shared hook `useNotifyAvailability(listingId)` so search card and detail panel share logic — DRY).

- [ ] **Step 4: Detail page chrome**

In `page.tsx`: pass `is_available`/`waitlist_count` into the panel; add an amber "Unavailable" badge to the badge row (~278-289) when unavailable; swap the mobile CTA bar (~643-659) label to "Notify when available".

- [ ] **Step 5: Run tests, verify preview, commit**

Run: `pnpm --filter @cribliv/web test:unit -- unlock-panel-availability` → PASS.
Verify in preview on an unavailable listing: chip + Notify CTA + mobile bar; OTP flow reaches the success state.

```bash
git add apps/web/components/unlock-contact-panel.tsx apps/web/components/listing apps/web/app/[locale]/listing apps/web/lib/availability-api.ts apps/web/lib/i18n.ts
git commit -m "feat(web): detail calm-swap CTA + OTP notify-waitlist flow"
```

---

## Phase 5 — Admin

### Task 14: API — admin availability toggle + waitlist leads (Verified Homes)

**Files:**

- Modify: `apps/api/src/modules/admin/admin-homes.controller.ts` (~15-31)
- Modify: `apps/api/src/modules/admin/admin-homes.service.ts` (currently read-only)
- Test: `apps/api/src/modules/admin/__tests__/admin-homes-availability.test.ts` (create)

**Interfaces:**

- Produces:
  - `PATCH /admin/homes/:listing_id/availability-status` body `{ available: boolean; reason?: string }` → `AdminHomesService.setAvailability(listingId, available, adminId, reason)` (no owner scoping; writes an `admin_actions` row with `action='availability_change'`; same `ready` flip as owner).
  - `GET /admin/homes/:listing_id/waitlist` → `{ items: WaitlistLead[] }` (phone numbers included; admin only).

- [ ] **Step 1: Write the failing test**

```ts
it("admin marks unavailable and lists waitlist leads with phone", async () => {
  const l = app.listings.find((x) => x.status === "active" && x.listing_type === "flat_house")!;
  app.addAvailabilityAlert({
    listing_id: l.id,
    phone: "+919000000009",
    user_id: null,
    locale: "en"
  });
  await svc.setAvailability(l.id, false, "admin-1");
  expect(app.listings.find((x) => x.id === l.id)!.is_available).toBe(false);
  const leads = await svc.listWaitlist(l.id);
  expect(leads[0].phone).toBe("+919000000009");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-homes-availability`
Expected: FAIL.

- [ ] **Step 3: Implement service methods (dual-mode)**

`setAvailability`: DB `UPDATE listings SET is_available=$2, became_unavailable_at=CASE WHEN $2 THEN NULL ELSE now() END, availability_source='admin', updated_at=now() WHERE id=$1 AND listing_type='flat_house' RETURNING id, is_available`; on success `INSERT INTO admin_actions(admin_user_id, listing_id, action, reason, created_at) VALUES (...,'availability_change',...)`; if `available` flip alerts `waiting→ready`. In-memory: `appState.setListingAvailability`. `listWaitlist`: DB select `id, phone, user_id, status, created_at` from `listing_availability_alerts WHERE listing_id=$1 ORDER BY created_at DESC`; in-memory via `listAvailabilityAlerts`.

- [ ] **Step 4: Add controller routes + run tests**

Add the two routes with `@Roles("admin")` guards matching sibling routes. Run: `pnpm --filter @cribliv/api test -- admin-homes-availability` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin
git commit -m "feat(api): admin availability toggle + waitlist leads"
```

---

### Task 15: Web — admin Verified Homes: toggle + waitlist leads panel

**Files:**

- Modify: `apps/web/lib/admin-api.ts` (~60-79 area)
- Modify: `apps/web/components/admin/homes/AdminHomeWorkspace.tsx` (~157-197)
- Create: `apps/web/components/admin/homes/WaitlistLeadsPanel.tsx`
- Test: `apps/web/lib/__tests__/admin-api-availability.test.ts` + `apps/web/components/admin/homes/__tests__/WaitlistLeadsPanel.test.tsx` (create)

**Interfaces:**

- Consumes: routes from Task 14.
- Produces:
  - `setAdminHomeAvailability(token, listingId, available, reason?)` → `PATCH /admin/homes/:id/availability-status`.
  - `fetchAdminHomeWaitlist(token, listingId): Promise<WaitlistLead[]>` → `GET /admin/homes/:id/waitlist`.
  - `WaitlistLeadsPanel` component rendering count + rows (phone · joined · guest/logged-in) + Call + "View all · export CSV".

- [ ] **Step 1: Write the failing test**

```ts
it("fetchAdminHomeWaitlist GETs the waitlist route", async () => {
  const spy = vi
    .spyOn(api, "fetchApi")
    .mockResolvedValue({
      items: [{ id: "a1", phone: "+91900", user_id: null, status: "waiting", created_at: "" }]
    } as any);
  const leads = await fetchAdminHomeWaitlist("tok", "L1");
  expect(spy).toHaveBeenCalledWith("/admin/homes/L1/waitlist", expect.anything());
  expect(leads[0].phone).toBe("+91900");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test:unit -- admin-api-availability`
Expected: FAIL.

- [ ] **Step 3: Implement client fns**

Add `setAdminHomeAvailability` and `fetchAdminHomeWaitlist` to `admin-api.ts`, mirroring the existing `fetchAdminHomeDetail`/`decideAdminListing` call shapes.

- [ ] **Step 4: Build the UI**

`WaitlistLeadsPanel.tsx`: props `{ token: string; listingId: string; count: number }`; loads leads on mount, renders the rows + Call (`tel:` link) + export. In `AdminHomeWorkspace.tsx`, add an availability toggle to the header actions (reuse the toggle+confirm+reason pattern from `components/admin/pg-properties/VisibilityControls.tsx`) calling `setAdminHomeAvailability`, and render `<WaitlistLeadsPanel>` when the home is unavailable or has leads. Gate with `useFlag("ff_unavailable_listings")`.

- [ ] **Step 5: Run tests, verify preview, commit**

Run: `pnpm --filter @cribliv/web test:unit -- admin-api-availability WaitlistLeadsPanel` → PASS.
Verify in preview (admin → Verified Homes → a home): toggle flips availability; leads panel shows numbers.

```bash
git add apps/web/lib/admin-api.ts apps/web/components/admin/homes
git commit -m "feat(web): admin availability toggle + waitlist leads panel"
```

---

## Phase 6 — Copy + full-stack verification

### Task 16: i18n strings (en + hi) + copy pass

**Files:**

- Modify: `apps/web/lib/i18n.ts`
- Test: `apps/web/lib/__tests__/i18n-availability.test.ts` (create)

**Interfaces:**

- Produces: keys `notAvailableNow`, `notifyWhenAvailable`, `notifyMe`, `onWaitlist`, `waitlistCount` (with `{count}`), `currentlyUnavailable`, `availabilityLabel`, `visibilityLabel`, `available`, `notAvailable`, `live`, `paused`, `notifySuccess`, `notifyReassure` — present for both `en` and `hi`.

- [ ] **Step 1: Write the failing test**

```ts
import { t } from "../i18n";
it("has availability copy in en and hi", () => {
  for (const loc of ["en", "hi"] as const) {
    expect(t(loc, "notifyWhenAvailable")).toBeTruthy();
    expect(t(loc, "currentlyUnavailable")).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @cribliv/web test:unit -- i18n-availability`
Expected: FAIL.

- [ ] **Step 3: Add strings**

Add all keys to both the `en` and `hi` dictionaries in `i18n.ts` (sentence case; amber/hopeful tone). Replace any hardcoded strings introduced in Tasks 8/10/13/15 with `t(locale, key)` calls.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @cribliv/web test:unit -- i18n-availability`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/i18n.ts
git commit -m "feat(web): en+hi copy for availability + notify waitlist"
```

---

### Task 17: Full-stack verification + flag-off safety

**Files:**

- Test: `apps/web/tests/e2e/unavailable-listing.spec.ts` (create; Playwright)

- [ ] **Step 1: Write the E2E**

Playwright flow (inject a session as the E2E harness does — see CLAUDE.md testing notes): as owner, mark a flat unavailable via the new toggle; assert the detail page shows "Notify when available"; as a guest, complete the OTP→notify flow and assert the success state; assert search places the listing under the "currently unavailable" divider; as admin, open Verified Homes and assert the waitlist shows the guest's number.

- [ ] **Step 2: Run the full suites**

Run:

```bash
pnpm --filter @cribliv/api test
pnpm --filter @cribliv/web test:unit
pnpm typecheck && pnpm lint
```

Expected: all green.

- [ ] **Step 3: Flag-off regression check**

With `FF_UNAVAILABLE_LISTINGS`/`NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS` unset: run the API search + detail tests and manually confirm in preview that no toggles/badges/dividers render and search order is unchanged. Add an assertion to the search test that with the flag off the sort output equals the pre-feature order.

- [ ] **Step 4: Run E2E**

Run: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test -- unavailable-listing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/e2e/unavailable-listing.spec.ts
git commit -m "test: e2e for unavailable listing + notify waitlist"
```

---

## Self-Review (completed by author)

**Spec coverage:** flag (T1) · migration/schema (T2) · types (T3) · in-memory (T4) · owner toggle + relabel (T5, T7, T8) · owner reads count (T6) · search sink + similar exclusion (T9) · search card + divider (T10) · notify module + ready flip (T11) · detail payload (T12) · detail calm-swap + OTP waitlist (T13) · admin toggle + leads (T14, T15) · i18n (T16) · flag-off safety + e2e (T17). Capture-now/deliver-later: the `ready` flip is in T5/T11/T14; automated delivery is explicitly out of scope (spec §9) — no task, by design.

**Placeholder scan:** none — every code step carries real SQL/TS/JSX. Where a real signature must be confirmed against an unread file (e.g. `OwnerService` constructor args, `request.user.phone` field, web unit-test command), the step says so explicitly rather than guessing silently.

**Type consistency:** `is_available` (boolean), `waitlist_count` (int), `AvailabilityAlertResult { status, already_on_list }`, `WaitlistLead { id, phone, user_id, status, created_at }`, endpoints `/availability-status` (new flag), `/visibility` (renamed pause), `/admin/homes/:id/availability-status`, `/listings/:id/availability-alerts` — used identically across producer and consumer tasks.

**Known verification points for the implementer** (not placeholders — real "confirm against code" notes): exact `OwnerService`/`AdminHomesService` constructor DI args; the auth payload field for phone; the web unit-test script name in `apps/web/package.json`; whether the migration runner needs the `ALTER TYPE ADD VALUE` split out (mirror `0061`).
