# PG Tenant Residence Redesign Design

## Context

The page is `apps/web/app/[locale]/tenant/pg-residence`. It serves logged-in tenants who have an active or recent PG bed assignment. The current page works functionally, but its content is stacked as basic cards, the maintenance workspace can visually dominate the page, and ticket/comment photos can exceed the usable viewport in narrow layouts. The redesign must keep the existing residence, move-out, and maintenance contracts intact while making the page feel intentionally structured and fully responsive.

Baseline validation before this spec:

```bash
rtk env PATH="/opt/homebrew/bin:$PATH" corepack pnpm --filter @cribliv/web test -- PgResidenceClient.test.tsx MaintenanceCreateForm.test.tsx MaintenanceWorkspace.test.tsx MaintenanceTicketDetail.test.tsx
```

Result: 4 test files passed, 27 tests passed. The only warning was the known Vite CJS deprecation warning.

## Goal

Ship an end-to-end responsive makeover for the logged-in tenant PG residence page. The page should open with a clear stay overview first, group related information into tabs on desktop and mobile, keep maintenance ticket creation/history easy to reach, constrain all ticket photos inside the page, and fix the maintenance photo upload repeat-selection/retry problem without breaking existing ticket behavior.

## Non-Goals

- Do not redesign public PG listing/detail/search pages.
- Do not change backend API contracts.
- Do not change residence, notice, move-out, or maintenance business rules.
- Do not change operator-only maintenance flows except where shared layout/upload components need responsive or input-reset hardening.
- Do not enable or change PG maintenance feature flags as part of this redesign.

## Design Direction

Subject: a logged-in PG tenant checking "where am I staying, what do I owe, what can I do now, and how do I get help?"

Primary job: make the current stay, money, notice state, operator contact, and maintenance actions understandable at a glance.

Visual token plan:

- Ink `#172033` for primary text.
- Slate `#64748B` for supporting labels.
- Mist `#F4F7FA` for page background.
- Porcelain `#FFFFFF` for panels.
- Lease Blue `#1F6FFF` for selected tabs and primary actions.
- Notice Amber `#F59E0B` for notice/SLA warning accents.
- Repair Red `#EF4444` for upload or ticket errors.

Typography:

- Use the existing app font stack and token variables.
- Add stronger hierarchy through size, weight, and grouping instead of new font loading.
- Use compact labels for data cards, not marketing copy.

Signature element:

- A "stay command strip" at the top: property, room/bed, assignment status, rent, notice state, and operator contact in one responsive visual band. It should feel like a tenant's current residence pass, not a generic dashboard hero.

## Information Architecture

The page has one tab system with these tabs:

1. Overview
2. Money
3. Food & Rules
4. Notice
5. Maintenance

Default tab: Overview on every viewport.

Desktop:

- Keep a top summary header.
- Render the tab control under the summary.
- Use a two-column content area when width allows:
  - Left: active tab content and primary details.
  - Right: compact "need help" or operator/contact/action summary when useful.
- Maintenance tab can use a wider single-column panel so the form, list, and ticket detail do not feel cramped.

Mobile:

- Show the top summary first.
- Render tabs as a horizontally scrollable segmented control with clear selected state.
- Show exactly one active tab panel at a time.
- Keep tap targets at least 40px high.
- Prevent page-level horizontal overflow. Horizontal scrolling is allowed only inside the tab list if needed.

## Component Design

### Tenant Residence Page Shell

`PgResidenceClient` should stop rendering five always-visible `SectionCard` blocks for active residences. It should own:

- Current residence state and move-out actions as today.
- Active tab state.
- A top summary component.
- Tab panel composition.

Recommended internal pieces can live inside `PgResidenceClient.tsx` unless the file becomes hard to read:

- `ResidenceSummary`
- `ResidenceTabs`
- `OverviewPanel`
- `MoneyPanel`
- `RulesPanel`
- `NoticePanel`
- `MaintenancePanel`

Do not introduce broad cross-app abstractions for this page.

### Overview Panel

The overview panel should contain the tenant's most important facts:

- Property name.
- Room and bed.
- Sharing type.
- Move-in date.
- Assignment status.
- Monthly rent.
- Notice state.
- Operator name and phone.

Group these as compact fact tiles, with the operator contact visually distinct enough that a tenant can find it quickly.

### Money Panel

The money panel should contain:

- Monthly rent.
- Security deposit.
- Notice period.
- Lock-in period.

Use one primary rent emphasis and secondary tiles for the rest. Avoid duplicate price emphasis in multiple places.

### Food & Rules Panel

The rules panel should contain:

- Food plan summary.
- House rules as chips.

Empty rules should render a calm "Not set" state. Rule chips must wrap and never force viewport overflow.

### Notice Panel

The notice panel should contain:

- Current notice/move-out state.
- Notice end date and days remaining when present.
- Serve notice and request move-out actions.
- Operator move-out accept/reject actions when present.
- Inline errors exactly as today.

Do not change which actions are enabled for each assignment state.

### Maintenance Panel

The maintenance panel should contain:

- A clearer "Raise a maintenance ticket" form at the top.
- Active and historical tickets below, using the existing `MaintenanceWorkspace` data behavior.
- Ticket detail and public thread inside a constrained responsive panel.

For tenant mode, the workspace should support a tenant-friendly responsive presentation:

- On desktop, the list/detail layout may remain two-column when space allows.
- On mobile, the ticket list and selected ticket detail stack, with no fixed widths.
- Ticket/comment/fix photos render in bounded grids with `max-width: 100%`, `min-width: 0`, and `object-fit: cover`.
- Long ticket IDs, phone numbers, and photo filenames wrap or truncate safely.

### Empty Residence State

If no active residence exists:

- Keep the current empty message.
- If maintenance history is enabled, show past-stay maintenance in the redesigned maintenance panel styling.
- Do not make tabs for an empty active residence unless there is meaningful content behind more than one tab.

## Photo Upload Fix

The user-reported bug: maintenance request photo upload works the first time and then is not altered until a hard refresh.

Design requirements:

- Preserve the current create-ticket flow: create the ticket first, then upload photos, then complete photo records.
- Preserve partial-success behavior: if the ticket is created but photo upload fails, the ticket stays visible and the error explains that photos did not upload.
- Reset the file input after every file selection and after submit/failure paths so the same file can be selected again without a hard refresh.
- Reset or clear stale pending photo state only after successful upload or explicit removal.
- If upload fails after ticket creation, keep the created ticket visible and selected, clear the create form and its selected photos, and show an inline alert telling the tenant that the ticket was raised and the same photos can be added from the ticket's public thread. The public-thread photo input must accept the same files immediately without a hard refresh.
- Keep idempotency keys correct: a retry of the same create action must not create duplicate tickets.

Likely files:

- `apps/web/components/pg-operator/ops/maintenance/MaintenanceCreateForm.tsx`
- `apps/web/components/pg-operator/ops/maintenance/useMaintenancePhotoUpload.ts`
- `apps/web/components/pg-operator/ops/MaintenanceWorkspace.tsx`
- `apps/web/components/pg-operator/ops/maintenance/MaintenanceTicketDetail.tsx`

## Responsive Rules

All affected containers must use `min-width: 0` where they live inside grid/flex layouts.

Rules:

- The page shell must use `overflow-x: clip` or equivalent scoped protection.
- Image grids must use `grid-template-columns: repeat(auto-fit, minmax(min(100%, 140px), 1fr))` or an equivalent mobile-safe pattern.
- Uploaded preview chips must never exceed their parent; filenames truncate with an accessible remove button.
- Ticket detail summaries must collapse to one column below mobile breakpoint.
- Tabs may scroll horizontally, but the page itself must not.
- Buttons and select controls must fit within mobile width without shrinking text into unreadable sizes.

## Accessibility

- Tabs use `role="tablist"`, each tab uses `role="tab"`, and each panel uses `role="tabpanel"` with matching `aria-controls` and `aria-labelledby`.
- Active tab state is visible and programmatic.
- Keyboard users can move through tabs and actions in DOM order.
- Upload controls keep explicit labels.
- Error messages use `role="alert"` where existing behavior already does.
- Photo thumbnails use the existing descriptive alt text pattern for persisted photos and decorative alt for pending previews.

## Test Plan

Focused tests should be written before implementation.

`PgResidenceClient.test.tsx`:

- Renders the stay overview as the default active tab.
- Renders the tab list with Overview, Money, Food & Rules, Notice, and Maintenance.
- Switching to Maintenance reveals the create-ticket form and ticket list.
- Notice actions remain available/disabled according to current assignment status.
- Overview exposes property, room, bed, rent, status, and operator contact.

`MaintenanceCreateForm.test.tsx`:

- Re-selecting the same file after a prior selection triggers the add-photo path without hard refresh.
- After a successful submit, the input and pending photo state are cleared.
- After ticket creation succeeds but photo upload fails, the ticket is still reported through `onCreated` and the UI gives a clear recovery path.

`MaintenanceWorkspace.test.tsx` and/or `MaintenanceTicketDetail.test.tsx`:

- Tenant maintenance photo grids render inside a bounded container.
- Long ticket IDs/descriptions remain present while wrapping safely.
- Comment photo input can be used repeatedly without stale hidden input state.

Verification commands:

```bash
rtk env PATH="/opt/homebrew/bin:$PATH" corepack pnpm --filter @cribliv/web test -- PgResidenceClient.test.tsx MaintenanceCreateForm.test.tsx MaintenanceWorkspace.test.tsx MaintenanceTicketDetail.test.tsx
rtk env PATH="/opt/homebrew/bin:$PATH" corepack pnpm --filter @cribliv/web typecheck
```

Manual/browser verification:

- Desktop width around 1440px.
- Tablet width around 768px.
- Mobile width around 390px.
- On mobile, confirm no horizontal page scroll and the Maintenance tab can show uploaded ticket/comment photos without spilling outside the viewport.

## Implementation Boundaries

- Keep changes path-limited to the tenant residence page and shared maintenance components already rendered by that page.
- Keep existing data fetching in `page.tsx`.
- Keep existing API calls in `pg-operations-api.ts`.
- Do not touch unrelated operator assignment drawer, feature flag, API service, or migration work already dirty in the worktree.
- Stage and commit only files changed for this redesign when implementation begins.
