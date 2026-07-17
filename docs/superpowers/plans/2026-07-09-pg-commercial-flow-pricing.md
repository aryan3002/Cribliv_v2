# PG Commercial Flow Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PG listing detail pages show rent, deposit, and interest-flow copy truthfully while preventing PG listings from leaking into credit/contact-unlock UI.

**Architecture:** Add a small typed commercial presentation model for tenant listing detail pages, then wire PG detail to that model instead of calculating "all-in" rent inline. Keep flat/house behavior stable, add a canonical redirect for legacy PG `/listing/:id` URLs, and make backend trust metadata truthful for PG. Cross-surface fixes are limited to CTA copy and routing where a PG can currently say "Unlock contact".

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Vitest, Testing Library, NestJS, pnpm workspaces.

## Global Constraints

- Prefix shell commands with `rtk`.
- Do not change `apps/web/app/[locale]/page.tsx`, home carousel behavior, homepage fetch logic, or homepage search logic.
- Do not change shared listing cards except to add regression tests proving current PG routing and flat/home behavior are preserved.
- PG tenant flow is `pg_interest`: no credit, charge, unlock, auto-refund, or wallet copy may render on PG tenant-facing UI.
- Flat/house tenant flow remains `contact_unlock`: existing unlock panel and refund reassurance stay available for flat/house listings.
- Do not add a new dependency.
- Keep API dual-mode behavior: DB and `AppStateService` paths must both return truthful flow metadata.
- All new pricing/flow decisions must be covered by unit tests before UI wiring.

---

## File Structure

- Create `apps/web/lib/tenant-commercial-model.ts`
  - Owns tenant-facing commercial semantics: flow type, rent labels, deposit labels, CTA reassurance, and display-ready INR strings.
  - Keeps "PG interest" vs "contact unlock" out of component conditionals.

- Create `apps/web/lib/__tests__/tenant-commercial-model.test.ts`
  - Verifies PG rent is not deposit-amortized.
  - Verifies PG copy contains no credit/unlock/refund language.
  - Verifies flat/house output preserves current monthly-all-in behavior.

- Modify `apps/web/components/pg/PgDetailClient.tsx`
  - Replaces inline `monthlyAllInPaise` usage with `buildPgCommercialModel`.
  - Removes PG reuse of `noChargeUntilUnlock`.
  - Keeps room cards and room-type list intact.

- Modify `apps/web/lib/pg-public-api.ts`
  - Adds the already-returned `verification_status` field to the `PgPublicDetail` TypeScript interface.

- Modify `apps/web/components/pg/__tests__/PgDetailClient.test.tsx`
  - Adds regression tests for PG pricing labels and absence of contact-unlock copy.

- Modify `apps/web/app/[locale]/listing/[listingId]/page.tsx`
  - Redirects PG listings to canonical `/[locale]/pg/[city]/[id]` before rendering `UnlockContactPanel`.
  - Uses `listingHref` for PG-aware metadata canonicals on the legacy generic listing route.
  - Leaves flat/house page behavior unchanged.

- Create or modify `apps/web/lib/__tests__/listing-href.test.ts`
  - Verifies canonical PG and flat/house detail URLs.

- Modify `apps/api/src/modules/listings/listings.controller.ts`
  - Adds truthful `tenant_flow`.
  - Sets `owner_trust.no_response_refund` false for PG rows.

- Modify `apps/api/test/listing-view-tracking.test.ts`
  - Adds DB-backed and `AppStateService` fallback PG and flat/house assertions for `tenant_flow` and refund flag.

- Modify `apps/web/components/criblmap/panels/ListingDetailPanel.tsx`
  - Labels PG primary CTA as "Show Interest"; flat/house remains "Unlock Contact".
  - Keeps flat/house map detail reads compatible with the generic `/listings/:id` response envelope.

- Modify `apps/web/components/criblmap/__tests__/criblmap-regressions.test.tsx`
  - Adds PG map detail panel CTA regression coverage.
  - Adds flat/house map detail panel regression coverage so `Unlock Contact` and flat routing stay intact.

- Add the focused regression tests named in Tasks 1, 2, 3, 4, 5, and 6; do not alter homepage implementation.

---

### Task 1: Add Tenant Commercial Model

**Files:**

- Create: `apps/web/lib/tenant-commercial-model.ts`
- Create: `apps/web/lib/__tests__/tenant-commercial-model.test.ts`

**Interfaces:**

- Produces:
  - `TenantCommercialFlow = "contact_unlock" | "pg_interest"`
  - `CommercialSummaryCard`
  - `TenantCommercialModel`
  - `buildPgCommercialModel(input: PgCommercialInput): TenantCommercialModel`
  - `buildFlatHouseCommercialModel(input: FlatHouseCommercialInput): TenantCommercialModel`
- Consumes: none.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/tenant-commercial-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFlatHouseCommercialModel, buildPgCommercialModel } from "../tenant-commercial-model";

describe("tenant commercial model", () => {
  it("models PG rent as starting room rent without deposit amortization", () => {
    const model = buildPgCommercialModel({
      lowestRoomRentPaise: 700_000,
      securityDepositPaise: 700_000,
      noticePeriodDays: 30,
      verificationStatus: "verified"
    });

    expect(model.flow).toBe("pg_interest");
    expect(model.primaryPrice).toEqual({
      headline: "from ₹7,000",
      period: "/mo",
      supportingText: null
    });
    expect(model.summaryCards[0]).toMatchObject({
      id: "monthly_rent",
      label: "Monthly rent from",
      value: "₹7,000",
      note: "Per person, varies by room type"
    });
    expect(model.depositBadge).toBe("₹7,000 security deposit");
    expect(model.reassurance).toBe(
      "Free to show interest. The PG owner receives your request and may contact you directly."
    );
    expect(JSON.stringify(model).toLowerCase()).not.toMatch(/credit|unlock|charged|refund/);
    expect(JSON.stringify(model)).not.toContain("₹7,636");
  });

  it("models PG with unknown rent as price on request", () => {
    const model = buildPgCommercialModel({
      lowestRoomRentPaise: null,
      securityDepositPaise: null,
      noticePeriodDays: null,
      verificationStatus: "pending"
    });

    expect(model.primaryPrice).toEqual({
      headline: "Price on request",
      period: null,
      supportingText: null
    });
    expect(model.summaryCards[0]).toMatchObject({
      id: "monthly_rent",
      label: "Monthly rent",
      value: "Request price",
      note: "Ask the PG owner for current room pricing"
    });
    expect(model.depositBadge).toBeNull();
  });

  it("preserves flat or house all-in estimate behavior", () => {
    const model = buildFlatHouseCommercialModel({
      monthlyRent: 18_000,
      securityDeposit: 36_000,
      noResponseRefund: true,
      verificationStatus: "verified"
    });

    expect(model.flow).toBe("contact_unlock");
    expect(model.primaryPrice).toEqual({
      headline: "₹21,273",
      period: "/mo all-in",
      supportingText: "₹18,000 rent · ₹36,000 deposit"
    });
    expect(model.summaryCards[0]).toMatchObject({
      id: "total_monthly_cost",
      label: "Total monthly cost",
      value: "₹21,273",
      note: "Rent plus deposit spread across 11 months"
    });
    expect(model.reassurance).toBe(
      "You won't be charged unless the owner picks up — auto-refund in 12h."
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- lib/__tests__/tenant-commercial-model.test.ts
```

Expected: FAIL because `../tenant-commercial-model` does not exist.

- [ ] **Step 3: Implement the commercial model**

Create `apps/web/lib/tenant-commercial-model.ts`:

```ts
export type TenantCommercialFlow = "contact_unlock" | "pg_interest";

export type CommercialCardTone = "price" | "amber" | "trust";

export interface CommercialSummaryCard {
  id:
    | "total_monthly_cost"
    | "monthly_rent"
    | "move_in_estimate"
    | "security_deposit"
    | "owner_trust"
    | "pg_trust";
  label: string;
  value: string;
  note: string;
  tone: CommercialCardTone;
}

export interface TenantCommercialModel {
  flow: TenantCommercialFlow;
  ctaLabel: string;
  reassurance: string;
  primaryPrice: {
    headline: string;
    period: string | null;
    supportingText: string | null;
  };
  depositBadge: string | null;
  summaryCards: CommercialSummaryCard[];
}

export interface PgCommercialInput {
  lowestRoomRentPaise: number | null;
  securityDepositPaise: number | null;
  noticePeriodDays: number | null;
  verificationStatus: string | null;
}

export interface FlatHouseCommercialInput {
  monthlyRent: number;
  securityDeposit: number | null;
  noResponseRefund: boolean;
  verificationStatus: "unverified" | "pending" | "verified" | "failed" | string | null;
}

function rupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function rupeesFromPaise(paise: number): string {
  return rupees(Math.round(paise / 100));
}

function verificationValue(status: string | null, verifiedLabel: string): string {
  if (status === "verified") return verifiedLabel;
  if (status === "pending") return "In review";
  return "Listed";
}

export function buildPgCommercialModel(input: PgCommercialInput): TenantCommercialModel {
  const hasRent = input.lowestRoomRentPaise != null && input.lowestRoomRentPaise > 0;
  const rent = hasRent ? rupeesFromPaise(input.lowestRoomRentPaise!) : null;
  const deposit =
    input.securityDepositPaise != null && input.securityDepositPaise > 0
      ? rupeesFromPaise(input.securityDepositPaise)
      : null;

  return {
    flow: "pg_interest",
    ctaLabel: "I'm interested",
    reassurance:
      "Free to show interest. The PG owner receives your request and may contact you directly.",
    primaryPrice: {
      headline: rent ? `from ${rent}` : "Price on request",
      period: rent ? "/mo" : null,
      supportingText: null
    },
    depositBadge: deposit ? `${deposit} security deposit` : null,
    summaryCards: [
      {
        id: "monthly_rent",
        label: rent ? "Monthly rent from" : "Monthly rent",
        value: rent ?? "Request price",
        note: rent
          ? "Per person, varies by room type"
          : "Ask the PG owner for current room pricing",
        tone: "price"
      },
      {
        id: "security_deposit",
        label: deposit ? "Security deposit" : "Move-in terms",
        value: deposit ?? "Ask owner",
        note:
          deposit && input.noticePeriodDays != null
            ? `${input.noticePeriodDays} day notice period`
            : "Terms shown before move-in",
        tone: "amber"
      },
      {
        id: "pg_trust",
        label: "PG trust",
        value: verificationValue(input.verificationStatus, "Verified"),
        note: "Interest sent directly to owner",
        tone: "trust"
      }
    ]
  };
}

export function buildFlatHouseCommercialModel(
  input: FlatHouseCommercialInput
): TenantCommercialModel {
  const deposit = input.securityDeposit ?? 0;
  const totalMoveIn = input.monthlyRent + deposit;
  const monthlyAllIn = input.monthlyRent + Math.round(deposit / 11);
  const hasDeposit = deposit > 0;

  return {
    flow: "contact_unlock",
    ctaLabel: "Unlock Number",
    reassurance: input.noResponseRefund
      ? "You won't be charged unless the owner picks up — auto-refund in 12h."
      : "Direct owner connection",
    primaryPrice: {
      headline: rupees(monthlyAllIn),
      period: "/mo all-in",
      supportingText: hasDeposit
        ? `${rupees(input.monthlyRent)} rent · ${rupees(deposit)} deposit`
        : `${rupees(input.monthlyRent)} rent`
    },
    depositBadge: hasDeposit ? `${rupees(deposit)} deposit` : null,
    summaryCards: [
      {
        id: "total_monthly_cost",
        label: "Total monthly cost",
        value: rupees(monthlyAllIn),
        note: "Rent plus deposit spread across 11 months",
        tone: "price"
      },
      {
        id: "move_in_estimate",
        label: "Move-in estimate",
        value: rupees(totalMoveIn),
        note: hasDeposit ? `Includes ${rupees(deposit)} deposit` : "Deposit not listed yet",
        tone: "amber"
      },
      {
        id: "owner_trust",
        label: "Owner trust",
        value: verificationValue(input.verificationStatus, "Verified"),
        note: input.noResponseRefund ? "12-hour no-response refund" : "Direct owner connection",
        tone: "trust"
      }
    ]
  };
}
```

- [ ] **Step 4: Run model test to verify it passes**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- lib/__tests__/tenant-commercial-model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/lib/tenant-commercial-model.ts apps/web/lib/__tests__/tenant-commercial-model.test.ts
rtk git commit -m "feat(web): model tenant commercial flows"
```

---

### Task 2: Wire PG Detail Page to the Commercial Model

**Files:**

- Modify: `apps/web/components/pg/PgDetailClient.tsx`
- Modify: `apps/web/lib/pg-public-api.ts`
- Modify: `apps/web/components/pg/__tests__/PgDetailClient.test.tsx`

**Interfaces:**

- Consumes: `buildPgCommercialModel(input: PgCommercialInput): TenantCommercialModel`
- Produces: PG detail UI that renders base rent, deposit, and interest reassurance without credit-unlock copy.

- [ ] **Step 1: Write failing PG detail tests**

Append these tests inside the existing `describe("PgDetailClient", ...)` block in `apps/web/components/pg/__tests__/PgDetailClient.test.tsx`:

```tsx
it("shows PG rent and deposit separately without an all-in monthly estimate", () => {
  render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

  expect(screen.getByText(/monthly rent from/i)).toBeTruthy();
  expect(screen.getAllByText("₹7,000").length).toBeGreaterThan(0);
  expect(screen.getByText(/per person, varies by room type/i)).toBeTruthy();
  expect(screen.getByText(/₹15,000 security deposit/i)).toBeTruthy();
  expect(screen.queryByText(/total monthly cost/i)).toBeNull();
  expect(screen.queryByText(/mo all-in/i)).toBeNull();
  expect(screen.queryByText("₹8,364")).toBeNull();
});

it("uses interest-flow reassurance instead of contact-unlock reassurance", () => {
  render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

  expect(
    screen.getByText(/free to show interest\. the pg owner receives your request/i)
  ).toBeTruthy();
  expect(screen.queryByText(/you won't be charged/i)).toBeNull();
  expect(screen.queryByText(/auto-refund/i)).toBeNull();
  expect(screen.queryByText(/unlock credits/i)).toBeNull();
});
```

Run:

```bash
rtk pnpm --filter @cribliv/web test -- components/pg/__tests__/PgDetailClient.test.tsx
```

Expected: FAIL because the current page renders "Total monthly cost", `/mo all-in`, and `noChargeUntilUnlock`.

- [ ] **Step 2: Import and build the model in `PgDetailClient`**

In `apps/web/lib/pg-public-api.ts`, add the optional field that the PG public API already returns:

```ts
  verification_status?: string | null;
```

Place it in `PgPublicDetail` near `status`.

In `apps/web/components/pg/PgDetailClient.tsx`, add:

```ts
import { buildPgCommercialModel } from "../../lib/tenant-commercial-model";
```

Replace the existing `monthlyAllInPaise` block with:

```ts
const lowestPrice =
  detail.room_types.length > 0
    ? Math.min(...detail.room_types.map((r) => r.monthly_rent_paise))
    : detail.monthly_rent != null
      ? detail.monthly_rent * 100
      : null;

const commercial = buildPgCommercialModel({
  lowestRoomRentPaise: lowestPrice,
  securityDepositPaise: pd.security_deposit_paise,
  noticePeriodDays: pd.notice_period_days,
  verificationStatus: detail.verification_status ?? null
});
```

Remove the old `monthlyAllInPaise` declaration entirely.

- [ ] **Step 3: Replace top summary cards**

Replace the current hard-coded `<section className="tenant-cost-strip"...>` body with:

```tsx
<section className="tenant-cost-strip" aria-label="PG pricing and trust summary">
  {commercial.summaryCards.map((card) => (
    <div
      key={card.id}
      className={`tenant-cost-card${card.tone === "price" ? " tenant-cost-card--price" : ""}`}
    >
      <span
        className={`tenant-cost-card__icon${
          card.tone === "amber"
            ? " tenant-cost-card__icon--amber"
            : card.tone === "trust"
              ? " tenant-cost-card__icon--trust"
              : ""
        }`}
        aria-hidden="true"
      >
        {card.tone === "amber" ? (
          <Shield size={18} />
        ) : card.tone === "trust" ? (
          <ShieldCheck size={18} />
        ) : (
          <Wallet size={18} />
        )}
      </span>
      <span className="tenant-cost-card__label">{card.label}</span>
      <strong>{card.value}</strong>
      <span className="tenant-cost-card__note">{card.note}</span>
    </div>
  ))}
</section>
```

- [ ] **Step 4: Replace sticky rail price block**

In the sidebar price block, replace the `monthlyAllInPaise` rendering with:

```tsx
<div className="detail-rail__price">
  <strong>{commercial.primaryPrice.headline}</strong>
  {commercial.primaryPrice.period && <span>{commercial.primaryPrice.period}</span>}
</div>;
{
  commercial.primaryPrice.supportingText && (
    <div className="detail-rail__secondary">{commercial.primaryPrice.supportingText}</div>
  );
}
{
  commercial.depositBadge && (
    <div className="pg-rail-deposit">
      <Shield size={13} aria-hidden="true" />
      {commercial.depositBadge}
    </div>
  );
}
```

This removes the confusing duplicate `₹7,000 rent` line for PG; the full room-type rent list below remains the source of room-level prices.

- [ ] **Step 5: Replace PG reassurance copy**

Replace:

```tsx
{
  t(locale as Locale, "noChargeUntilUnlock") || "Owner will contact you directly";
}
```

with:

```tsx
{
  commercial.reassurance;
}
```

- [ ] **Step 6: Replace mobile CTA price copy**

Replace the mobile CTA price block with:

```tsx
<div className="card__price">
  {commercial.primaryPrice.headline.replace(/^from /, "")}
  {commercial.primaryPrice.period && (
    <span className="card__price-period">{commercial.primaryPrice.period}</span>
  )}
</div>;
{
  commercial.depositBadge && (
    <div className="body-sm text-secondary" style={{ fontSize: 12 }}>
      {commercial.depositBadge}
    </div>
  );
}
```

Keep the mobile button text `Show Interest`.

- [ ] **Step 7: Run PG detail tests**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- components/pg/__tests__/PgDetailClient.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add apps/web/components/pg/PgDetailClient.tsx apps/web/lib/pg-public-api.ts apps/web/components/pg/__tests__/PgDetailClient.test.tsx
rtk git commit -m "fix(web): show PG interest pricing truthfully"
```

---

### Task 3: Guard Generic Listing Detail Route Against PG Credit UI

**Files:**

- Modify: `apps/web/app/[locale]/listing/[listingId]/page.tsx`
- Create: `apps/web/lib/__tests__/listing-href.test.ts`

**Interfaces:**

- Consumes: `listingHref(locale, listing)` from `apps/web/lib/listing-href.ts`
- Produces:
  - Generic listing route redirects PGs before rendering `UnlockContactPanel`.
  - Generic listing route metadata uses the same canonical PG/flat URL rules as cards/search results.

- [ ] **Step 1: Add listing href regression tests**

Create `apps/web/lib/__tests__/listing-href.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listingHref } from "../listing-href";

describe("listingHref", () => {
  it("routes PG listings to the split PG detail route", () => {
    expect(listingHref("en", { id: "pg-1", listing_type: "pg", city: "lucknow" })).toBe(
      "/en/pg/lucknow/pg-1"
    );
  });

  it("routes flat and house listings to the generic listing route", () => {
    expect(listingHref("en", { id: "flat-1", listing_type: "flat_house", city: "lucknow" })).toBe(
      "/en/listing/flat-1"
    );
  });

  it("falls back to the generic route when a PG city is missing", () => {
    expect(listingHref("en", { id: "pg-1", listing_type: "pg", city: null })).toBe(
      "/en/listing/pg-1"
    );
  });
});
```

Run:

```bash
rtk pnpm --filter @cribliv/web test -- lib/__tests__/listing-href.test.ts
```

Expected: PASS. This is a guard before touching the route.

- [ ] **Step 2: Import routing helpers in the generic listing page**

In `apps/web/app/[locale]/listing/[listingId]/page.tsx`, add imports:

```ts
import { redirect } from "next/navigation";
import { listingHref } from "../../../../lib/listing-href";
```

- [ ] **Step 3: Make generic listing metadata use canonical PG-aware hrefs**

In `generateMetadata`, after:

```ts
const listing = payload.listing_detail;
```

add:

```ts
const canonicalEn = listingHref("en", {
  id: listing.id,
  listing_type: listing.listing_type,
  city: listing.city
});
const canonicalHi = listingHref("hi", {
  id: listing.id,
  listing_type: listing.listing_type,
  city: listing.city
});
const currentHref = listingHref(params.locale, {
  id: listing.id,
  listing_type: listing.listing_type,
  city: listing.city
});
```

Replace the `alternates` block with:

```ts
    alternates: {
      canonical: `${BASE_URL}${canonicalEn}`,
      languages: {
        en: `${BASE_URL}${canonicalEn}`,
        hi: `${BASE_URL}${canonicalHi}`
      }
    },
```

Replace:

```ts
      url: `${BASE_URL}/${params.locale}/listing/${params.listingId}`,
```

with:

```ts
      url: `${BASE_URL}${currentHref}`,
```

This keeps flat/house metadata identical in shape while preventing a PG response at `/listing/:id` from advertising the stale generic URL.

- [ ] **Step 4: Redirect PG listings in the generic listing page**

In `ListingDetailPage`, after:

```ts
const listing = payload.listing_detail;
```

add:

```ts
if (listing.listing_type === "pg") {
  redirect(listingHref(locale, { id: listing.id, listing_type: "pg", city: listing.city }));
}
```

Do not add any PG-specific rendering branch below this point. The purpose is to guarantee the generic route never reaches `UnlockContactPanel` for PG listings.

- [ ] **Step 5: Preserve flat/house behavior**

Do not change:

```tsx
<UnlockContactPanel listingId={params.listingId} source={sourceRef ?? undefined} />
```

Do not change flat/house `monthlyAllIn`, `totalMoveIn`, or existing cost-strip labels in this task.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- lib/__tests__/listing-href.test.ts
rtk pnpm --filter @cribliv/web typecheck
```

Expected: both commands exit 0.

- [ ] **Step 7: Commit**

```bash
rtk git add 'apps/web/app/[locale]/listing/[listingId]/page.tsx' apps/web/lib/__tests__/listing-href.test.ts
rtk git commit -m "fix(web): redirect PGs away from contact unlock route"
```

---

### Task 4: Make Generic Listing API Flow Metadata Truthful

**Files:**

- Modify: `apps/api/src/modules/listings/listings.controller.ts`
- Modify: `apps/api/test/listing-view-tracking.test.ts`

**Interfaces:**

- Produces:
  - Top-level `tenant_flow: "pg_interest" | "contact_unlock"` in `/v1/listings/:listing_id`
  - `owner_trust.no_response_refund === false` for PG listings
  - `owner_trust.no_response_refund === true` for flat/house listings unless future business rules change it

- [ ] **Step 1: Add failing API tests**

In `apps/api/test/listing-view-tracking.test.ts`, add these tests inside the existing `describe` block:

```ts
it("marks generic PG detail responses as interest flow without no-response refund", async () => {
  const db = {
    isEnabled: () => true,
    query: vi.fn(async () => ({ rows: [detailRow("owner-1")], rowCount: 1 }))
  };
  const analytics = { trackEvent: vi.fn(async () => undefined) };
  const ctrl = new ListingsController({} as any, db as any, analytics as any);

  const res: any = await ctrl.detail(UUID, undefined);

  expect(res.data.listing_detail.listing_type).toBe("pg");
  expect(res.data.tenant_flow).toBe("pg_interest");
  expect(res.data.owner_trust.no_response_refund).toBe(false);
});

it("keeps flat or house detail responses on contact unlock flow", async () => {
  const db = {
    isEnabled: () => true,
    query: vi.fn(async () => ({
      rows: [{ ...detailRow("owner-1"), listing_type: "flat_house", bhk: 2 }],
      rowCount: 1
    }))
  };
  const analytics = { trackEvent: vi.fn(async () => undefined) };
  const ctrl = new ListingsController({} as any, db as any, analytics as any);

  const res: any = await ctrl.detail(UUID, undefined);

  expect(res.data.listing_detail.listing_type).toBe("flat_house");
  expect(res.data.tenant_flow).toBe("contact_unlock");
  expect(res.data.owner_trust.no_response_refund).toBe(true);
});

it("marks in-memory PG fallback responses as interest flow without no-response refund", async () => {
  const appState = {
    listings: new Map([
      [
        UUID,
        {
          id: UUID,
          ownerUserId: "owner-1",
          listingType: "pg",
          title: "Fallback PG",
          city: "noida",
          locality: "sector-62",
          monthlyRent: 14000,
          furnishing: "fully_furnished",
          verificationStatus: "pending",
          status: "active",
          createdAt: Date.now(),
          amenities: []
        }
      ]
    ])
  };
  const db = { isEnabled: () => false, query: vi.fn() };
  const analytics = { trackEvent: vi.fn(async () => undefined) };
  const ctrl = new ListingsController(appState as any, db as any, analytics as any);

  const res: any = await ctrl.detail(UUID, undefined);

  expect(res.data.listing_detail.listing_type).toBe("pg");
  expect(res.data.tenant_flow).toBe("pg_interest");
  expect(res.data.owner_trust.no_response_refund).toBe(false);
});

it("keeps in-memory flat or house fallback responses on contact unlock flow", async () => {
  const appState = {
    listings: new Map([
      [
        UUID,
        {
          id: UUID,
          ownerUserId: "owner-1",
          listingType: "flat_house",
          title: "Fallback Flat",
          city: "gurugram",
          locality: "dlf-phase-2",
          monthlyRent: 32000,
          furnishing: "semi_furnished",
          verificationStatus: "verified",
          status: "active",
          createdAt: Date.now(),
          amenities: []
        }
      ]
    ])
  };
  const db = { isEnabled: () => false, query: vi.fn() };
  const analytics = { trackEvent: vi.fn(async () => undefined) };
  const ctrl = new ListingsController(appState as any, db as any, analytics as any);

  const res: any = await ctrl.detail(UUID, undefined);

  expect(res.data.listing_detail.listing_type).toBe("flat_house");
  expect(res.data.tenant_flow).toBe("contact_unlock");
  expect(res.data.owner_trust.no_response_refund).toBe(true);
});
```

Run:

```bash
rtk pnpm --filter @cribliv/api test -- test/listing-view-tracking.test.ts
```

Expected: FAIL because `tenant_flow` is missing and DB-backed plus in-memory PG refund flags are currently true.

- [ ] **Step 2: Update DB-backed response**

In `apps/api/src/modules/listings/listings.controller.ts`, after:

```ts
const isPg = listing.listing_type === "pg";
```

ensure the returned envelope includes:

```ts
          tenant_flow: isPg ? "pg_interest" : "contact_unlock",
```

and change `owner_trust` to:

```ts
          owner_trust: {
            verification_status: listing.verification_status,
            no_response_refund: !isPg
          },
```

- [ ] **Step 3: Update in-memory fallback response**

In the fallback response near the bottom of `ListingsController.detail`, before `owner_trust`, add:

```ts
      tenant_flow: listing.listingType === "pg" ? "pg_interest" : "contact_unlock",
```

and change fallback `owner_trust` to:

```ts
      owner_trust: {
        verification_status: listing.verificationStatus,
        no_response_refund: listing.listingType !== "pg"
      },
```

- [ ] **Step 4: Run API tests**

Run:

```bash
rtk pnpm --filter @cribliv/api test -- test/listing-view-tracking.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/api/src/modules/listings/listings.controller.ts apps/api/test/listing-view-tracking.test.ts
rtk git commit -m "fix(api): expose truthful tenant listing flow"
```

---

### Task 5: Fix PG CTA Copy on Map Detail Panel

**Files:**

- Modify: `apps/web/components/criblmap/panels/ListingDetailPanel.tsx`
- Modify: `apps/web/components/criblmap/__tests__/criblmap-regressions.test.tsx`

**Interfaces:**

- Consumes:
  - `view.listing_type`
  - Generic listing detail envelope from `fetchApi<{ listing_detail: ListingDetail }>(/listings/:id)`
- Produces: Map detail primary CTA label:
  - PG: `Show Interest`
  - flat/house: `Unlock Contact`
  - flat/house map detail still reads the generic listing API response correctly.

- [ ] **Step 1: Add failing map panel regression tests**

In `apps/web/components/criblmap/__tests__/criblmap-regressions.test.tsx`, add imports:

```ts
import { ListingDetailPanel } from "../panels/ListingDetailPanel";
```

Add an API mock near the existing mocks:

```ts
const fetchApiMock = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api")>()),
  fetchApi: (...args: unknown[]) => fetchApiMock(...args)
}));
```

Add a PG public mock near the existing mocks:

```ts
vi.mock("../../../lib/pg-public-api", () => ({
  getPgPublicListing: vi.fn(async () => ({
    id: "11111111-1111-1111-1111-111111111111",
    status: "active",
    title: "Gomti PG",
    monthly_rent: 12000,
    created_at: null,
    city_slug: "lucknow",
    locality_slug: "gomti-nagar",
    verification_status: "verified",
    pg_details: {
      total_beds: 10,
      gender_policy: "boys",
      tenant_type: "students",
      security_deposit_paise: 700000,
      notice_period_days: 30,
      lock_in_months: null,
      electricity_mode: null,
      rent_due_day: null,
      price_negotiable: false,
      payment_modes: [],
      meals: null,
      amenities: {},
      house_rules: {}
    },
    room_types: [
      {
        sharing: "double",
        ac: true,
        bathroom_kind: "attached",
        furnishing: "semi_furnished",
        monthly_rent_paise: 700000,
        vacancy_count: 1,
        available_from: null
      }
    ],
    photos: []
  }))
}));
```

Inside the existing `beforeEach`, after the global fetch stub, reset and default the `fetchApi` mock:

```ts
fetchApiMock.mockReset();
fetchApiMock.mockImplementation(async (path: string) => {
  if (path.startsWith("/listings/pricing-intel")) {
    return { p25: null, p50: null, p75: null, sample_size: 0 };
  }
  throw new Error(`Unhandled fetchApi path: ${path}`);
});
```

Add a flat pin fixture near `basePin`:

```ts
const flatPin: MapPin = {
  id: "22222222-2222-2222-2222-222222222222",
  lat: 26.85,
  lng: 80.95,
  title: "2BHK Flat",
  monthly_rent: 18000,
  listing_type: "flat_house",
  bhk: 2,
  verification_status: "verified",
  furnishing: "semi_furnished",
  cover_photo: null,
  city: "lucknow",
  locality: "Hazratganj",
  locality_slug: "hazratganj"
};
```

Add helper:

```tsx
function SelectPin({ pinId }: { pinId: string }) {
  const dispatch = useMapDispatch();
  useEffect(() => {
    dispatch({ type: "SELECT_PIN", pinId });
  }, [dispatch, pinId]);
  return null;
}
```

Add test:

```tsx
it("labels PG map detail CTA as show interest instead of unlock contact", async () => {
  render(
    <MapStateProvider>
      <SeedPins pins={[basePin]} />
      <SelectPin pinId={basePin.id} />
      <ListingDetailPanel locale="en" />
    </MapStateProvider>
  );

  expect(await screen.findByRole("link", { name: /show interest/i })).toHaveAttribute(
    "href",
    "/en/pg/lucknow/11111111-1111-1111-1111-111111111111"
  );
  expect(screen.queryByRole("link", { name: /unlock contact/i })).toBeNull();
});
```

Add flat/house regression test:

```tsx
it("keeps flat map detail CTA as unlock contact and reads the generic detail envelope", async () => {
  fetchApiMock.mockImplementation(async (path: string) => {
    if (path === `/listings/${flatPin.id}`) {
      return {
        listing_detail: {
          id: flatPin.id,
          title: "2BHK Flat",
          city: "lucknow",
          locality: "hazratganj",
          listing_type: "flat_house",
          monthly_rent: 18000,
          bhk: 2,
          furnishing: "semi_furnished",
          area_sqft: 900,
          verification_status: "verified",
          cover_photo: null
        },
        owner_trust: { verification_status: "verified", no_response_refund: true },
        contact_locked: true
      };
    }
    if (path.startsWith("/listings/pricing-intel")) {
      return { p25: null, p50: null, p75: null, sample_size: 0 };
    }
    throw new Error(`Unhandled fetchApi path: ${path}`);
  });

  render(
    <MapStateProvider>
      <SeedPins pins={[flatPin]} />
      <SelectPin pinId={flatPin.id} />
      <ListingDetailPanel locale="en" />
    </MapStateProvider>
  );

  expect(await screen.findByRole("link", { name: /unlock contact/i })).toHaveAttribute(
    "href",
    "/en/listing/22222222-2222-2222-2222-222222222222"
  );
  expect(screen.queryByRole("link", { name: /show interest/i })).toBeNull();
});
```

Run:

```bash
rtk pnpm --filter @cribliv/web test -- components/criblmap/__tests__/criblmap-regressions.test.tsx
```

Expected: FAIL because the PG CTA currently says `Unlock Contact`, and the flat branch currently treats the generic detail API envelope as if it were a flat-shaped object.

- [ ] **Step 2: Read the flat/house generic detail envelope correctly**

In `apps/web/components/criblmap/panels/ListingDetailPanel.tsx`, add `city` to `ListingDetail`:

```ts
  city?: string | null;
```

Add an envelope interface after `ListingDetail`:

```ts
interface ListingDetailResponse {
  listing_detail: ListingDetail;
}
```

Replace:

```ts
const data = await fetchApi<ListingDetail>(`/listings/${listingId}`);
```

with:

```ts
const payload = await fetchApi<ListingDetailResponse>(`/listings/${listingId}`);
const data = payload.listing_detail;
```

Replace:

```ts
          cityName: data.city_name ?? null,
```

with:

```ts
          cityName: data.city_name ?? titleCase(data.city) ?? null,
```

- [ ] **Step 3: Update map CTA copy**

In `apps/web/components/criblmap/panels/ListingDetailPanel.tsx`, replace:

```tsx
            <Phone size={14} /> Unlock Contact
```

with:

```tsx
            <Phone size={14} /> {view.listing_type === "pg" ? "Show Interest" : "Unlock Contact"}
```

No routing change is needed because `view.href` already uses `listingHref`.

- [ ] **Step 4: Run map regression test**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- components/criblmap/__tests__/criblmap-regressions.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add apps/web/components/criblmap/panels/ListingDetailPanel.tsx apps/web/components/criblmap/__tests__/criblmap-regressions.test.tsx
rtk git commit -m "fix(web): preserve map detail tenant flows"
```

---

### Task 6: Add Shared Listing Card/Home-Logic Regression Tests

**Files:**

- Create or modify: `apps/web/components/__tests__/listing-card-routing.test.tsx`
- No implementation files should change in this task unless this test exposes an existing breakage caused by earlier tasks.

**Interfaces:**

- Consumes: `ListingCardItem`
- Produces: confidence that home/shared listing-card routing behavior remains stable.

- [ ] **Step 1: Add shared card regression test**

Create `apps/web/components/__tests__/listing-card-routing.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingCardItem } from "../listing-card";

describe("ListingCardItem routing", () => {
  it("keeps PG shared cards on the split PG route", () => {
    const { container } = render(
      <ListingCardItem
        locale="en"
        listing={{
          id: "pg-1",
          title: "Sunrise PG",
          listing_type: "pg",
          city: "lucknow",
          locality: "gomti-nagar",
          monthly_rent: 7000,
          verification_status: "verified",
          cover_photo: null
        }}
      />
    );

    expect(container.querySelector('a[href="/en/pg/lucknow/pg-1"]')).toBeTruthy();
    expect(screen.getByText("/mo onwards")).toBeTruthy();
    expect(screen.queryByText(/unlock contact/i)).toBeNull();
  });

  it("keeps flat shared cards on the generic listing route", () => {
    const { container } = render(
      <ListingCardItem
        locale="en"
        listing={{
          id: "flat-1",
          title: "2BHK Flat",
          listing_type: "flat_house",
          city: "lucknow",
          locality: "hazratganj",
          monthly_rent: 18000,
          bhk: 2,
          verification_status: "verified",
          cover_photo: null
        }}
      />
    );

    expect(container.querySelector('a[href="/en/listing/flat-1"]')).toBeTruthy();
    expect(screen.getByText("/month")).toBeTruthy();
    expect(screen.queryByText("/mo onwards")).toBeNull();
  });
});
```

- [ ] **Step 2: Run shared card regression test**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- components/__tests__/listing-card-routing.test.tsx
```

Expected: PASS without implementation changes. If it fails because of test environment setup only, fix the test harness. Do not change home page code.

- [ ] **Step 3: Commit**

```bash
rtk git add apps/web/components/__tests__/listing-card-routing.test.tsx
rtk git commit -m "test(web): guard shared listing card routing"
```

---

### Task 7: Full Regression Gate

**Files:**

- No code changes expected.

**Interfaces:**

- Verifies all prior tasks together.

- [ ] **Step 1: Run focused web tests**

Run:

```bash
rtk pnpm --filter @cribliv/web test -- lib/__tests__/tenant-commercial-model.test.ts lib/__tests__/listing-href.test.ts components/pg/__tests__/PgDetailClient.test.tsx components/criblmap/__tests__/criblmap-regressions.test.tsx components/__tests__/listing-card-routing.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run focused API test**

Run:

```bash
rtk pnpm --filter @cribliv/api test -- test/listing-view-tracking.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck for touched packages**

Run:

```bash
rtk pnpm --filter @cribliv/web typecheck
rtk pnpm --filter @cribliv/api typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Run full repo quality gate**

Run:

```bash
rtk pnpm test
rtk pnpm typecheck
```

Expected: both commands exit 0. If unrelated pre-existing failures occur, capture the failing test names and confirm all focused tests above still pass.

- [ ] **Step 5: Manual UI verification**

Start web/API only if local dependencies are already available:

```bash
rtk pnpm dev
```

Open a PG detail URL and verify:

- Top strip says `Monthly rent from`, not `Total monthly cost`.
- Sticky rail says `from ₹7,000 /mo`, not `/mo all-in`.
- The smaller duplicate `₹7,000 rent` line is gone from the sticky rail.
- Deposit is shown as a separate security deposit value.
- Reassurance says `Free to show interest...`.
- No visible PG page copy contains `charged`, `credit`, `unlock`, or `auto-refund`.
- Room option cards still show room-level rent for each room type.

Open a flat/house detail URL and verify:

- Unlock contact panel still appears.
- Existing no-response refund reassurance still appears when supported.
- Existing flat/house pricing behavior is unchanged.

Open the map and verify:

- Selecting a PG pin shows a primary `Show Interest` CTA that routes to `/[locale]/pg/[city]/[id]`.
- Selecting a flat/house pin shows a primary `Unlock Contact` CTA that routes to `/[locale]/listing/[id]`.

Open the home page and verify:

- Home page loads.
- Existing cards still navigate correctly.
- No homepage search or carousel behavior changed.

- [ ] **Step 6: Final commit if Task 7 found small test-only fixes**

Only run this if Task 7 required test harness or copy corrections:

```bash
rtk git add apps/web apps/api
rtk git commit -m "test: verify tenant commercial flow regressions"
```

---

## Rollback Plan

- If PG detail UI fails after Task 2, revert only Task 2 and keep Task 1; the pure model is isolated and harmless.
- If generic route redirect causes a routing issue, revert Task 3; Tasks 1-2 still fix the canonical PG page.
- If API consumers break on `tenant_flow`, keep `no_response_refund: !isPg` and remove only the new top-level `tenant_flow` field. This is unlikely because extra JSON fields are normally backward compatible, but the plan keeps the safety valve explicit.
- If the map panel fix causes a regression, revert Task 5 only; PG detail and generic route protections remain intact.

## Self-Review Checklist

- PG detail no longer calculates deposit-amortized monthly rent in the component.
- PG detail no longer imports or renders `noChargeUntilUnlock`.
- Flat/house detail still renders `UnlockContactPanel`.
- Generic `/listing/:id` can no longer render credit-unlock UI for PG listings.
- Generic listing metadata canonical URLs use `listingHref` for PG and flat/house.
- API DB-backed and in-memory fallback metadata no longer say PG has no-response refund.
- Map PG CTA no longer says unlock contact, and flat/house map CTA still says unlock contact.
- Home page implementation files remain untouched.
- Shared listing-card regression tests prove PG card routing and flat card routing still work.
