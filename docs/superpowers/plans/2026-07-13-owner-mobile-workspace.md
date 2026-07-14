# Owner Mobile Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated responsive owner workspace with focused overview, listings, leads, and verification routes that is fully operable on phones while preserving desktop functionality.

**Architecture:** Add an owner route layout that replaces public chrome with a responsive workspace shell. Split the current combined dashboard into route-level clients, render a non-drag lead list on touch/mobile devices, and add a minimal owner-scoped verification artifact upload boundary so verification uses real files rather than blob-path text.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, NextAuth v5, NestJS 10, Azure Blob Storage, Vitest/Testing Library, Playwright, Lucide React.

## Global Constraints

- Owner routes use dedicated workspace chrome and do not render the public header or footer.
- Mobile navigation exposes Overview, Listings, Add, Leads, and Verify and respects `env(safe-area-inset-bottom)`.
- The listing wizard hides workspace bottom navigation.
- Mobile leads never mount `@hello-pangea/dnd`.
- Desktop leads retain board and list views.
- New API services implement both database-enabled and in-memory paths.
- Mobile touch targets are at least 44 by 44 CSS pixels.
- Mobile form controls use at least 16px text.
- English and Hindi copy must not clip or overlap.
- New workspace cards use an 8px radius or less.
- No raw HTTP failures are displayed to owners.
- Every production behavior is introduced with a failing test first.

---

### Task 1: Owner Workspace Route Shell

**Files:**

- Create: `apps/web/app/[locale]/owner/layout.tsx`
- Create: `apps/web/components/owner/workspace-shell.tsx`
- Create: `apps/web/components/owner/owner-workspace.css`
- Create: `apps/web/components/owner/__tests__/workspace-shell.test.tsx`
- Create: `apps/web/components/__tests__/locale-chrome.owner.test.tsx`
- Modify: `apps/web/components/locale-chrome.tsx`
- Modify: `apps/web/lib/i18n.ts`

**Interfaces:**

- Consumes: `locale: Locale`, `pathname` from `usePathname()`, current NextAuth session.
- Produces:

```ts
export function OwnerWorkspaceShell(props: {
  locale: Locale;
  children: React.ReactNode;
}): JSX.Element;
```

- [ ] **Step 1: Write failing shell and public-chrome tests**

```tsx
it("renders owner navigation with overview, listings, add, leads and verify links");
it("marks the current owner destination with aria-current=page");
it("hides the mobile bottom navigation on /owner/listings/new");
it("keeps the owner shell content inside main#main-content");
it("LocaleChrome omits the public header and footer for /owner routes");
```

Mock `usePathname`, `useSession`, `Header`, and `Footer`. Assert exact hrefs:

```ts
[
  "/en/owner/dashboard",
  "/en/owner/listings",
  "/en/owner/listings/new",
  "/en/owner/leads",
  "/en/owner/verification"
];
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/web test -- \
  components/owner/__tests__/workspace-shell.test.tsx \
  components/__tests__/locale-chrome.owner.test.tsx
```

Expected: FAIL because `OwnerWorkspaceShell` and the owner route layout do not exist, and `LocaleChrome` still renders public chrome.

- [ ] **Step 3: Implement the shell**

Use a route table:

```ts
const OWNER_NAV = [
  { key: "ownerOverview", href: (l: string) => `/${l}/owner/dashboard`, Icon: LayoutDashboard },
  { key: "ownerListings", href: (l: string) => `/${l}/owner/listings`, Icon: Building2 },
  { key: "ownerAdd", href: (l: string) => `/${l}/owner/listings/new`, Icon: Plus },
  { key: "ownerLeads", href: (l: string) => `/${l}/owner/leads`, Icon: UsersRound },
  { key: "ownerVerify", href: (l: string) => `/${l}/owner/verification`, Icon: ShieldCheck }
] as const;
```

Render:

- desktop sticky top navigation;
- mobile compact header;
- mobile bottom navigation;
- account link/menu;
- `main#main-content`;
- no bottom navigation when pathname matches `/owner/listings/new`.

Add `ownerOverview`, `ownerListings`, `ownerAdd`, `ownerLeads`, and `ownerVerify` English/Hindi keys.

- [ ] **Step 4: Make LocaleChrome skip owner routes**

Update:

```ts
const NO_CHROME_PATHS = [/\/admin(\/|$)/, /\/owner(\/|$)/];
```

The owner route layout becomes the only chrome owner pages receive.

- [ ] **Step 5: Add responsive shell CSS**

Implement:

```css
.ows {
  min-height: 100dvh;
  background: #f6f8fb;
}

.ows__mobile-nav {
  display: none;
}

@media (max-width: 767px) {
  .ows__desktop-nav {
    display: none;
  }

  .ows__mobile-nav {
    position: fixed;
    inset: auto 0 0;
    z-index: 70;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    min-height: 64px;
    padding-bottom: env(safe-area-inset-bottom);
  }

  .ows__content {
    padding-bottom: calc(80px + env(safe-area-inset-bottom));
  }

  .ows[data-focus-flow="true"] .ows__content {
    padding-bottom: 0;
  }
}
```

Keep labels on two lines if required and ensure the longest Hindi label fits.

- [ ] **Step 6: Run tests and verify GREEN**

Run the two tests from Step 2 plus:

```bash
pnpm --filter @cribliv/web test -- components/__tests__/header-menu.pg-split.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/[locale]/owner/layout.tsx \
  apps/web/components/owner/workspace-shell.tsx \
  apps/web/components/owner/owner-workspace.css \
  apps/web/components/owner/__tests__/workspace-shell.test.tsx \
  apps/web/components/__tests__/locale-chrome.owner.test.tsx \
  apps/web/components/locale-chrome.tsx apps/web/lib/i18n.ts
git commit -m "feat(web): add responsive owner workspace shell"
```

---

### Task 2: Focused Owner Overview

**Files:**

- Create: `apps/web/components/owner/owner-overview-client.tsx`
- Create: `apps/web/components/owner/__tests__/owner-overview-client.test.tsx`
- Modify: `apps/web/app/[locale]/owner/dashboard/page.tsx`
- Modify: `apps/web/components/owner/owner-workspace.css`
- Delete after migration: `apps/web/components/owner/dashboard-client.tsx`

**Interfaces:**

- Consumes:

```ts
listOwnerListings(accessToken: string): Promise<{
  items: OwnerListingVm[];
  total: number;
}>;

fetchOwnerLeads(accessToken: string, params: { pageSize: number }): Promise<{
  items: LeadVm[];
  total: number;
}>;
```

- Produces:

```ts
export function OwnerOverviewClient(props: { locale: string }): JSX.Element;
```

- [ ] **Step 1: Write failing overview tests**

Test the real component with mocked owner API methods:

```tsx
it("renders active listings and seven-day leads as headline metrics");
it("renders pending, drafts and total as compact secondary metrics");
it("shows no more than three recent listings and three recent leads");
it("keeps listings usable when lead loading fails");
it("links urgent verification work to /owner/verification");
it("links portfolio management to /owner/listings and /owner/leads");
it("submits the existing property-management assistance request");
```

- [ ] **Step 2: Run the test and verify RED**

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-overview-client.test.tsx
```

Expected: FAIL because `OwnerOverviewClient` does not exist.

- [ ] **Step 3: Implement independent overview loading**

Use separate listing and lead states so one request cannot blank the other:

```ts
type LoadState<T> =
  | { status: "loading"; data: T }
  | { status: "ready"; data: T }
  | { status: "error"; data: T; message: string };
```

Calculate:

```ts
const active = listings.filter((item) => item.status === "active").length;
const pending = listings.filter((item) => item.status === "pending_review").length;
const drafts = listings.filter((item) => item.status === "draft").length;
const newLeads7d = leads.filter((lead) => Date.now() - Date.parse(lead.createdAt) <= 604_800_000);
```

Render compact page heading, headline metrics, secondary metric rail, urgent task rows, recent listing rows, and recent lead rows.

Preserve the current property-management assistance behavior with:

```ts
await createSalesLead(accessToken, {
  source: "property_management",
  notes: "Property management consultation requested from owner dashboard",
  metadata: { locale, listing_count: listings.length },
  idempotencyKey: makeIdempotencyKey("pm-assist")
});
```

Expose it as a secondary overview action with loading, success, and retry states.

- [ ] **Step 4: Replace dashboard page**

Change `dashboard/page.tsx` to render:

```tsx
export default function OwnerDashboardPage({ params }: PageProps) {
  return <OwnerOverviewClient locale={params.locale} />;
}
```

Remove `searchParams.tab` behavior. The focused routes replace dashboard tabs.

- [ ] **Step 5: Add overview CSS**

At mobile widths:

- greeting and Add listing fit in the first viewport;
- two stable headline metric columns;
- secondary metrics scroll horizontally;
- recent rows are unframed sections rather than nested cards;
- retry controls are 44px high.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-overview-client.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/[locale]/owner/dashboard/page.tsx \
  apps/web/components/owner/owner-overview-client.tsx \
  apps/web/components/owner/__tests__/owner-overview-client.test.tsx \
  apps/web/components/owner/owner-workspace.css
git rm apps/web/components/owner/dashboard-client.tsx
git commit -m "feat(web): add focused owner overview"
```

---

### Task 3: Listings Management Route And Mobile Cards

**Files:**

- Create: `apps/web/app/[locale]/owner/listings/page.tsx`
- Create: `apps/web/components/owner/owner-listings-client.tsx`
- Create: `apps/web/components/owner/__tests__/owner-listings-client.test.tsx`
- Create: `apps/web/components/owner/__tests__/listing-card-luxe.mobile.test.tsx`
- Modify: `apps/web/components/owner/listing-card-luxe.tsx`
- Modify: `apps/web/components/owner/availability-toggle.tsx`
- Modify: `apps/web/components/owner/boost-modal.tsx`
- Modify: `apps/web/components/owner/owner-workspace.css`
- Modify: `apps/web/app/globals.css`

**Interfaces:**

- Produces:

```ts
export function OwnerListingsClient(props: { locale: string }): JSX.Element;
```

- `ListingCardLuxe` retains its existing props and adds no new API dependency.

- [ ] **Step 1: Write failing route and card tests**

```tsx
it("loads all listings and exposes status filters");
it("retries after a listing request fails");
it("keeps the Edit command visible on a compact card");
it("shows a labelled availability switch with a 44px control");
it("moves boost and verification into the mobile More actions sheet");
it("uses Fix and resubmit as the primary rejected-listing action");
```

For the card test, assert semantic output rather than CSS pixels:

```tsx
expect(screen.getByRole("link", { name: /edit/i })).toBeVisible();
expect(screen.getByRole("button", { name: /more actions/i })).toBeVisible();
expect(screen.getByRole("checkbox", { name: /available to tenants/i })).toBeVisible();
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @cribliv/web test -- \
  components/owner/__tests__/owner-listings-client.test.tsx \
  components/owner/__tests__/listing-card-luxe.mobile.test.tsx
```

Expected: FAIL because the route/client and mobile actions sheet do not exist.

- [ ] **Step 3: Implement OwnerListingsClient**

Move listing filter/loading/boost state from the deleted dashboard client:

```ts
const STATUS_FILTERS: Array<{ value: ListingStatus | "all"; labelKey: I18nKey }> = [
  { value: "all", labelKey: "ownerFilterAll" },
  { value: "draft", labelKey: "ownerFilterDrafts" },
  { value: "pending_review", labelKey: "ownerFilterPending" },
  { value: "active", labelKey: "ownerFilterActive" },
  { value: "rejected", labelKey: "ownerFilterRejected" },
  { value: "paused", labelKey: "ownerFilterPaused" }
];
```

Keep:

- auth handling;
- status query;
- retry;
- optimistic availability patch;
- boost notice;
- create listing link;
- filtered empty state.

- [ ] **Step 4: Implement compact mobile listing actions**

Add a More button that opens a sheet/dialog. Keep desktop actions inline. The action content contains:

- Edit or Fix and resubmit;
- Verify listing when not verified;
- Boost when active;
- availability control when active or paused.

Change `AvailabilityToggle` to render a real visible label and input:

```tsx
<input
  id={id}
  type="checkbox"
  checked={isActive}
  aria-label="Available to tenants"
  disabled={toggling}
  onChange={() => void handleToggle()}
/>
```

- [ ] **Step 5: Make BoostModal responsive**

Use CSS classes instead of width-only inline styles. At `max-width: 640px`, render a bottom sheet with:

```css
.owner-sheet {
  position: fixed;
  inset: auto 0 0;
  max-height: min(86dvh, 720px);
  overflow: auto;
  padding-bottom: env(safe-area-inset-bottom);
  border-radius: 8px 8px 0 0;
}
```

Add Escape close, body scroll lock, focus restoration, and a labelled X icon button.

- [ ] **Step 6: Run tests and verify GREEN**

Run Step 2 tests plus:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/lead-credit-balance-bar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/[locale]/owner/listings/page.tsx \
  apps/web/components/owner/owner-listings-client.tsx \
  apps/web/components/owner/listing-card-luxe.tsx \
  apps/web/components/owner/availability-toggle.tsx \
  apps/web/components/owner/boost-modal.tsx \
  apps/web/components/owner/owner-workspace.css apps/web/app/globals.css \
  apps/web/components/owner/__tests__/owner-listings-client.test.tsx \
  apps/web/components/owner/__tests__/listing-card-luxe.mobile.test.tsx
git commit -m "feat(web): add mobile owner listings management"
```

---

### Task 4: Responsive Leads Route And Kanban Crash Fix

**Files:**

- Modify: `apps/web/app/[locale]/owner/leads/page.tsx`
- Modify: `apps/web/components/owner/leads-client.tsx`
- Create: `apps/web/components/owner/lead-mobile-list.tsx`
- Create: `apps/web/components/owner/__tests__/leads-client.responsive.test.tsx`
- Create: `apps/web/components/owner/__tests__/lead-kanban-provider.test.tsx`
- Modify: `apps/web/components/owner/lead-kanban.tsx`
- Modify: `apps/web/components/owner/lead-card.tsx`
- Modify: `apps/web/components/owner/leads-pipeline.tsx`
- Modify: `apps/web/components/owner/lead-kanban.css`
- Modify: `apps/web/components/owner/owner-workspace.css`

**Interfaces:**

- Produces:

```ts
export function LeadMobileList(props: {
  accessToken: string;
  locale: Locale;
  leads: LeadVm[];
  searchQuery: string;
  status: LeadStatus | "all";
  onLeadsChange(next: LeadVm[]): void;
}): JSX.Element;
```

- `LeadsClient` derives `desktopBoardCapable` from:

```ts
window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)").matches;
```

- [ ] **Step 1: Write failing responsive and provider tests**

```tsx
it("renders LeadMobileList and never LeadKanban on a coarse pointer");
it("renders board/list mode controls on a fine desktop pointer");
it("filters the mobile list by search and lead status");
it("updates a mobile lead status and reverts on API failure");
it("renders every Droppable inside DragDropContext even when drag is disabled");
```

Mock `matchMedia` separately for mobile and desktop. Mock `LeadKanban` and assert it is not called in the mobile case.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @cribliv/web test -- \
  components/owner/__tests__/leads-client.responsive.test.tsx \
  components/owner/__tests__/lead-kanban-provider.test.tsx
```

Expected: FAIL because mobile still mounts `LeadKanban`, and non-drag Kanban renders `Droppable` outside `DragDropContext`.

- [ ] **Step 3: Fix LeadKanban provider ownership**

Always wrap the board:

```tsx
<DragDropContext onDragEnd={handleDragEnd}>{board}</DragDropContext>
```

Continue disabling each `Droppable` and `Draggable` when `enableDrag` is false. This fixes the current `Could not find "store" in the context of Connect(Droppable)` runtime failure.

- [ ] **Step 4: Implement LeadMobileList**

Render filtered full-width `LeadCard` rows. Reuse `LeadMonetizationControls`. Status actions call `updateLeadStatus`, optimistically patch the list, and restore the prior list on failure.

Use horizontal status chips:

```ts
const LEAD_FILTERS: Array<LeadStatus | "all"> = [
  "all",
  "new",
  "contacted",
  "visit_scheduled",
  "deal_done",
  "lost"
];
```

Do not import `@hello-pangea/dnd` from the mobile-list module.

- [ ] **Step 5: Refactor LeadsClient**

Render:

- heading and trend;
- credit bar under existing flags;
- sticky mobile search/filter controls;
- mobile list when `desktopBoardCapable` is false;
- desktop board/list toggle when true;
- export inside mobile overflow actions and as a desktop button;
- local loading, error, retry, and empty states.

Change `owner/leads/page.tsx` from redirect to:

```tsx
export default function OwnerLeadsPage({ params }: PageProps) {
  return <LeadsClient locale={params.locale} />;
}
```

- [ ] **Step 6: Run tests and verify GREEN**

Run Step 2 tests plus existing monetization tests:

```bash
pnpm --filter @cribliv/web test -- \
  components/owner/__tests__/lead-monetization-controls.test.tsx \
  components/owner/__tests__/lead-credit-balance-bar.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/[locale]/owner/leads/page.tsx \
  apps/web/components/owner/leads-client.tsx \
  apps/web/components/owner/lead-mobile-list.tsx \
  apps/web/components/owner/lead-kanban.tsx \
  apps/web/components/owner/lead-card.tsx \
  apps/web/components/owner/leads-pipeline.tsx \
  apps/web/components/owner/lead-kanban.css \
  apps/web/components/owner/owner-workspace.css \
  apps/web/components/owner/__tests__/leads-client.responsive.test.tsx \
  apps/web/components/owner/__tests__/lead-kanban-provider.test.tsx
git commit -m "fix(web): make owner leads responsive and stable"
```

---

### Task 5: Verification Artifact Upload API

**Files:**

- Create: `apps/api/src/modules/verification/verification-artifact-storage.service.ts`
- Create: `apps/api/src/modules/verification/__tests__/verification-artifact-storage.service.test.ts`
- Create: `apps/api/src/modules/verification/__tests__/verification-artifacts.controller.test.ts`
- Modify: `apps/api/src/modules/verification/verification.controller.ts`
- Modify: `apps/api/src/modules/verification/verification.module.ts`
- Modify: `apps/api/src/modules/verification/verification.service.ts`

**Interfaces:**

- Produces:

```ts
type VerificationArtifactKind = "video_liveness" | "electricity_bill";

interface VerificationArtifactTarget {
  uploadToken: string;
  uploadUrl: string;
  blobPath: string;
  expiresAt: string;
}

class VerificationArtifactStorageService {
  createTarget(input: {
    ownerId: string;
    listingId: string;
    kind: VerificationArtifactKind;
    contentType: string;
    sizeBytes: number;
    fileName: string;
  }): Promise<VerificationArtifactTarget>;

  upload(input: {
    ownerId: string;
    uploadToken: string;
    file: Express.Multer.File;
  }): Promise<{ blobPath: string }>;

  complete(input: {
    ownerId: string;
    listingId: string;
    uploadToken: string;
    blobPath: string;
  }): Promise<{ blobPath: string }>;

  assertCompletedArtifact(input: {
    ownerId: string;
    listingId: string;
    kind: VerificationArtifactKind;
    blobPath: string;
  }): Promise<void>;
}
```

- [ ] **Step 1: Write failing service tests**

Cover:

```ts
it("rejects an owner who does not own the listing in database mode");
it("rejects an owner who does not own the listing in in-memory mode");
it("accepts mp4/webm/quicktime video up to 50 MB");
it("accepts PDF/JPEG/PNG/WebP electricity evidence up to 15 MB");
it("rejects a mismatched content type or declared size");
it("rejects expired and cross-owner upload tokens");
it("requires upload before completion");
it("requires a completed listing-scoped artifact before verification submission");
```

Use `DatabaseService.isEnabled()` stubs and real `AppStateService` seeded listings for the dual-mode assertions.

- [ ] **Step 2: Run service tests and verify RED**

```bash
pnpm --filter @cribliv/api test -- src/modules/verification/__tests__/verification-artifact-storage.service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement target validation and ownership**

Use these exact limits:

```ts
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const BILL_MAX_BYTES = 15 * 1024 * 1024;
const TARGET_TTL_MS = 15 * 60 * 1000;
```

Database ownership query:

```sql
SELECT id::text
FROM listings
WHERE id = $1::uuid AND owner_user_id = $2::uuid
LIMIT 1
```

In-memory ownership check:

```ts
const listing = this.state.listings.get(listingId);
if (!listing || listing.ownerUserId !== ownerId) throw new NotFoundException(...);
```

Use an in-memory token registry for the short presign/upload/complete transaction. Persist actual bytes to Azure when configured; otherwise retain bytes in a service map for local/test mode. Blob paths use:

```ts
`${listingId}/verification/${kind}/${safeName}-${randomUUID()}${extension}`;
```

- [ ] **Step 4: Add controller endpoints**

Add:

```ts
@Post("artifacts/presign")
presign(...)

@Post("artifacts/upload")
@UseInterceptors(FileInterceptor("file", { limits: { fileSize: 50 * 1024 * 1024 } }))
upload(...)

@Post("artifacts/complete")
complete(...)
```

`presign` returns `upload_url: "/owner/verification/artifacts/upload"` and `upload_token`.

- [ ] **Step 5: Guard verification submissions**

Before provider execution:

```ts
await this.artifacts.assertCompletedArtifact({
  ownerId,
  listingId: input.listing_id,
  kind: "video_liveness",
  blobPath: input.artifact_blob_path
});
```

For electricity, only validate when `bill_artifact_blob_path` is supplied.

- [ ] **Step 6: Add controller tests**

Use a Nest testing module and Supertest to prove:

- auth/role guards remain applied;
- presign maps fields correctly;
- multipart upload requires `upload_token` and `file`;
- complete maps owner/listing/token/path correctly.

- [ ] **Step 7: Run API tests and verify GREEN**

```bash
pnpm --filter @cribliv/api test -- \
  src/modules/verification/__tests__/verification-artifact-storage.service.test.ts \
  src/modules/verification/__tests__/verification-artifacts.controller.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/verification
git commit -m "feat(api): add owner verification artifact uploads"
```

---

### Task 6: Guided Verification Client

**Files:**

- Create: `apps/web/components/owner/verification-client.tsx`
- Create: `apps/web/components/owner/verification-artifact-field.tsx`
- Create: `apps/web/components/owner/__tests__/verification-client.test.tsx`
- Create: `apps/web/components/owner/__tests__/verification-artifact-field.test.tsx`
- Modify: `apps/web/app/[locale]/owner/verification/page.tsx`
- Modify: `apps/web/lib/owner-api.ts`
- Modify: `apps/web/lib/listing-photo.ts`
- Modify: `apps/web/components/owner/owner-workspace.css`
- Modify: `apps/web/lib/i18n.ts`

**Interfaces:**

- Add:

```ts
export async function uploadVerificationArtifact(
  accessToken: string,
  input: {
    listingId: string;
    kind: "video_liveness" | "electricity_bill";
    file: File;
    onProgress?: (percent: number) => void;
  }
): Promise<{ blobPath: string }>;
```

- Produces:

```ts
export function VerificationArtifactField(props: {
  accept: string;
  label: string;
  file: File | null;
  status: "idle" | "uploading" | "ready" | "error";
  progress: number;
  error?: string;
  onSelect(file: File): void;
  onRemove(): void;
  onRetry(): void;
}): JSX.Element;
```

- [ ] **Step 1: Write failing artifact-field and client tests**

```tsx
it("shows the selected filename and upload progress");
it("keeps a failed artifact and offers Retry and Remove");
it("shows only one verification method at a time on mobile");
it("uploads video before submitting its blob path");
it("uploads an optional electricity bill before submission");
it("renders current status before method controls");
it("renders submission history without fixed-width overflow");
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @cribliv/web test -- \
  components/owner/__tests__/verification-artifact-field.test.tsx \
  components/owner/__tests__/verification-client.test.tsx
```

Expected: FAIL because the components and upload API do not exist.

- [ ] **Step 3: Add web upload API**

`uploadVerificationArtifact` performs:

1. `POST /owner/verification/artifacts/presign`.
2. Multipart `POST` to the returned upload path with `upload_token` and `file`.
3. `POST /owner/verification/artifacts/complete`.

Use `XMLHttpRequest` for the multipart step so real upload progress is available. Map errors to:

- unsupported file;
- file too large;
- connection interrupted;
- expired upload;
- sign-in required;
- upload could not be completed.

- [ ] **Step 4: Implement VerificationArtifactField**

Use a visually hidden real file input and a labelled 44px Select file command. Display:

- filename and readable size;
- progress;
- Ready state;
- Retry and Remove after failure.

Use a 16px input label and never display the blob path.

- [ ] **Step 5: Implement VerificationClient**

Move all status/submission logic out of the route page. Use:

```ts
type VerificationMethod = "video" | "electricity";
```

Render:

- listing selector;
- current status;
- video/electricity segmented control;
- only the selected method panel;
- submit button disabled until required fields and artifact are ready;
- submission history.

Upload immediately after file selection and retain the resulting blob path in component state.

- [ ] **Step 6: Replace route page**

Keep metadata/server wrapper and render:

```tsx
export default function OwnerVerificationPage({ params }: PageProps) {
  return <VerificationClient locale={params.locale} />;
}
```

- [ ] **Step 7: Run tests and verify GREEN**

Run Step 2 tests plus:

```bash
pnpm --filter @cribliv/web test -- lib/__tests__/listing-photo.test.ts
pnpm --filter @cribliv/web typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/[locale]/owner/verification/page.tsx \
  apps/web/components/owner/verification-client.tsx \
  apps/web/components/owner/verification-artifact-field.tsx \
  apps/web/components/owner/__tests__/verification-client.test.tsx \
  apps/web/components/owner/__tests__/verification-artifact-field.test.tsx \
  apps/web/components/owner/owner-workspace.css \
  apps/web/lib/owner-api.ts apps/web/lib/listing-photo.ts apps/web/lib/i18n.ts
git commit -m "feat(web): add guided mobile owner verification"
```

---

### Task 7: Owner Mobile Browser Coverage

**Files:**

- Create: `apps/web/tests/owner-workspace-mobile.spec.ts`
- Modify: `apps/web/tests/mobile-card-overflow.spec.ts`
- Modify: `apps/web/tests/mobile-input-zoom.spec.ts`
- Modify: `apps/web/playwright.config.ts` only if a named mobile project is missing

**Interfaces:**

- Uses existing `loginAsRole(request, "owner")` and `setSessionOnPage(page, session)`.

- [ ] **Step 1: Write failing owner workspace E2E tests**

Cover at 390x844:

```ts
test("owner workspace navigation reaches every owner destination");
test("dashboard primary metrics and add action fit in the first viewport");
test("listings have no horizontal overflow and expose mobile actions");
test("leads load without a runtime error and do not render a Kanban board");
test("verification uses real file controls and keeps the submit action reachable");
test("listing wizard hides owner bottom navigation");
```

Add helpers:

```ts
async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => document.documentElement.clientWidth + 1)
  );
}
```

- [ ] **Step 2: Run E2E and verify RED**

```bash
pnpm --filter @cribliv/web exec playwright test tests/owner-workspace-mobile.spec.ts --project=chromium
```

Expected: FAIL against the old combined dashboard/public chrome.

- [ ] **Step 3: Fix final integration issues found by the browser**

Only make scoped corrections required by the failing tests:

- safe-area or fixed-nav overlap;
- horizontal overflow;
- inaccessible action;
- wrong route active state;
- mobile Kanban mount;
- verification keyboard/file-control visibility.

- [ ] **Step 4: Run focused browser verification**

```bash
pnpm --filter @cribliv/web exec playwright test \
  tests/owner-workspace-mobile.spec.ts \
  tests/owner-wizard.spec.ts \
  tests/mobile-card-overflow.spec.ts \
  tests/mobile-input-zoom.spec.ts \
  --project=chromium
```

Expected: PASS.

- [ ] **Step 5: Capture visual evidence**

Capture full-page screenshots at:

- 390x844 dashboard;
- 390x844 listings;
- 390x844 leads;
- 390x844 verification;
- 1440x1000 dashboard;
- 1440x1000 leads board.

Store in `output/playwright/` and inspect for overlap, clipping, blank sections, and covered controls.

- [ ] **Step 6: Run full quality gates**

```bash
pnpm --filter @cribliv/api test
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/web test
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/web lint
```

Expected: all commands pass. Existing non-failing warnings must not increase in owner tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/tests apps/web/playwright.config.ts
git commit -m "test(web): cover owner mobile workspace"
```

---

### Task 8: Acceptance Audit

**Files:**

- Modify only if the audit finds a missing requirement.

- [ ] **Step 1: Verify route and chrome requirements**

Confirm:

```bash
rg -n 'OwnerWorkspaceShell|/owner/listings|/owner/leads|/owner/verification' \
  apps/web/app apps/web/components/owner
rg -n '/owner\\(\\/|\\$\\)' apps/web/components/locale-chrome.tsx
```

- [ ] **Step 2: Verify mobile lead isolation**

Confirm `lead-mobile-list.tsx` does not import drag-and-drop:

```bash
rg -n '@hello-pangea/dnd|LeadKanban' apps/web/components/owner/lead-mobile-list.tsx
```

Expected: no matches.

- [ ] **Step 3: Verify verification upload boundary**

Confirm all three API steps and submission validation exist:

```bash
rg -n 'artifacts/(presign|upload|complete)|assertCompletedArtifact' \
  apps/api/src/modules/verification apps/web/lib/owner-api.ts
```

- [ ] **Step 4: Verify working tree and commits**

```bash
git status --short
git log --oneline --decorate origin/master..HEAD
```

Expected: clean worktree and focused commits for shell, overview, listings, leads, verification API/web, and browser tests.

- [ ] **Step 5: Review acceptance criteria against screenshots and test output**

Record evidence for all 14 criteria from the design:

- route screenshots;
- no-overflow browser assertions;
- mobile navigation assertions;
- mobile non-Kanban assertion;
- desktop Kanban assertion;
- verification file upload tests;
- unit/type/lint/API/browser command outputs.

Do not mark the feature complete while any criterion lacks direct evidence.
