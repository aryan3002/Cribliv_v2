# Owner Mobile Workspace Design

**Date:** 2026-07-13
**Status:** Approved
**Scope:** `apps/web` owner dashboard, listings, leads, verification, navigation, and responsive presentation, plus the minimal `apps/api` verification-artifact upload support required by the mobile workflow

## Objective

Turn the owner area into a dedicated workspace that is fully usable on phones without reducing desktop capability. Owners must be able to understand portfolio health, manage listings, act on leads, complete verification, and create a listing using touch-friendly controls with no horizontal overflow or public-site navigation clutter.

## Current Problems

- Owner routes use the public header and full public footer, so primary owner actions are hidden in a general-purpose menu and every screen has a long non-operational tail.
- The dashboard's five metrics become five stacked rows on small screens and consume most of the first viewport.
- Listings, leads, verification, settings, and listing creation do not have persistent owner navigation.
- Lead controls wrap as desktop toolbars, while the Kanban board depends on horizontal scrolling and drag-and-drop.
- Opening the Leads tab can crash because `@hello-pangea/dnd` droppables render without a stable drag-drop provider during the tab transition.
- Listing card controls, modal layouts, filter rows, and verification forms are not consistently optimized for touch, safe areas, or the mobile keyboard.
- Verification uses generic page cards and text fields where owners expect guided upload actions.

## Product Direction

Use a dedicated owner application shell instead of applying CSS-only patches to the current dashboard.

- Mobile uses a compact top bar and persistent bottom navigation.
- Desktop uses a compact owner navigation bar and retains information-dense layouts.
- Public header and footer are removed from owner workspace routes.
- Operational features are separated into focused routes rather than combined into one oversized dashboard component.
- Mobile uses vertical lists and bottom sheets for repeated actions.
- Desktop may retain grids, rich toolbars, and Kanban where they are effective.

## Routes

### `/[locale]/owner/dashboard`

The overview screen contains:

- greeting and last-sync state;
- the two most useful headline metrics: active listings and new leads in the last seven days;
- a compact horizontally scrollable secondary metric row for pending, drafts, and total listings;
- urgent tasks such as unverified listings, rejected listings, and locked leads;
- recent listings;
- recent leads;
- direct links to full listings, leads, and verification screens.

The overview does not render the complete listing grid or lead pipeline.

### `/[locale]/owner/listings`

The listings management screen contains:

- page heading and listing count;
- status filters;
- create-listing command;
- responsive listing cards;
- empty, loading, retry, and filtered-empty states;
- listing actions for edit, availability, boost, and verification.

Existing links to `/owner/dashboard` remain valid. Links whose intent is "manage listings" move to `/owner/listings`.

### `/[locale]/owner/leads`

The leads screen contains:

- lead count and seven-day trend;
- search;
- status filters;
- credit balance and locked-lead state when flags are enabled;
- a vertical lead list on touch/mobile devices;
- desktop list/Kanban mode switching where drag-and-drop is supported;
- export as a secondary desktop command and an overflow-menu command on mobile.

Mobile never mounts the drag-and-drop Kanban implementation. This removes the provider crash from the mobile path and avoids presenting drag behavior on coarse pointers.

### `/[locale]/owner/verification`

The verification screen becomes a guided workflow:

1. Select a listing.
2. Review its current verification status.
3. Choose video verification or electricity-bill verification.
4. Provide the required information and upload the artifact.
5. Submit and review progress or submission history.

Only one verification method is expanded at a time on mobile. Upload controls use file inputs and a listing-scoped verification-artifact upload endpoint rather than asking owners to type artifact paths.

### `/[locale]/owner/listings/new`

The existing listing wizard remains the focused creation flow. The workspace bottom navigation is hidden while the wizard is active so it cannot compete with Back, Next, Submit, photo upload, map, or Maya controls.

## Owner Workspace Shell

Add an owner route layout that renders an `OwnerWorkspaceShell`.

### Desktop

- Compact sticky top navigation.
- Brand, Overview, Listings, Leads, Verification, Add listing, language, and account controls.
- No public footer.
- Content uses the existing desktop width constraints.

### Mobile

- Compact top bar with brand, current screen title, and account menu.
- Fixed bottom navigation with Overview, Listings, Add, Leads, and Verify.
- Add is the visually prominent center command.
- Active state follows pathname, not component-local state.
- Navigation respects `env(safe-area-inset-bottom)`.
- Page content reserves enough bottom padding that the navigation never covers controls or final list items.
- The shell is omitted or simplified for the listing wizard.

`LocaleChrome` skips owner routes because the owner layout provides its own chrome.

## Responsive Components

### Overview Metrics

- Mobile displays two headline metrics in a stable two-column row.
- Secondary metrics use compact cells in a horizontally scrollable row with visible partial overflow as a scroll cue.
- Desktop may show all metrics in one grid.
- Metrics are links when they represent a destination or filtered view.

### Listing Cards

- Desktop retains the current image-led grid card.
- Mobile uses a full-width compact card with a stable thumbnail, title, locality, rent, status, and verification signal.
- Primary Edit action is always visible.
- Availability is a labelled switch with a minimum 44px hit area.
- Boost, verification, and less-common actions move into a More menu or bottom sheet.
- Rejected listings show Fix and resubmit as the primary action.
- Cards do not rely on hover to reveal information.

### Leads

- Mobile renders one lead per full-width card.
- Search and status filters remain reachable through a sticky controls row below the screen heading.
- Status changes use explicit buttons or a bottom sheet, not drag.
- Calling, unlocking, purchasing credits, notes, scheduling, and deal completion remain available from each card.
- Desktop Kanban is wrapped by a stable provider and is tested independently.
- Empty columns and invalid transitions remain clear on desktop.

### Verification

- Current status is the first visible section.
- Listing selection uses a full-width native select initially.
- Verification methods are accessible disclosure panels on desktop and focused steps/sheets on mobile.
- File controls display selected filename, upload status, retry, and remove actions.
- Submission history uses a compact timeline without fixed-width content.

### Dialogs And Sheets

- Existing centered dialogs remain on larger screens.
- On screens up to 640px, boost, More actions, credit purchase, and status-action dialogs render as bottom sheets.
- Sheets use a drag handle, labelled close button, bounded height, internal scrolling, safe-area padding, and body scroll locking.
- Destructive and payment actions are never triggered by dismiss gestures.

## Component Boundaries

### `OwnerWorkspaceShell`

Owns owner-only navigation, active route state, responsive desktop/mobile chrome, safe-area spacing, and account access. It does not fetch dashboard data.

### `OwnerOverviewClient`

Fetches the minimum listing and lead data needed by the overview and renders summary sections. It links to focused management routes instead of embedding full management interfaces.

### `OwnerListingsClient`

Owns listing loading, status filters, availability updates, boost selection, and listing empty/error states.

### `OwnerLeadsClient`

Owns lead loading, searching, status filters, credit controls, export, and responsive view selection. It mounts mobile list or desktop Kanban based on interaction capability.

### `OwnerVerificationClient`

Owns listing selection, verification status, method state, artifact upload, submission, and history.

### Verification Artifact Storage

Add a focused verification-artifact storage boundary that:

- validates listing ownership before issuing an upload target;
- accepts the content types required by the selected verification method;
- enforces configured size limits;
- returns an upload URL and listing-scoped blob path;
- validates that a submitted blob path belongs to the owner and selected listing;
- uses Azure Blob Storage when configured;
- provides an in-memory/local development path when external storage is disabled.

The verification submission endpoints continue to receive artifact blob paths after a successful upload.

### Shared Presentation

Listing cards, lead cards, metric cells, task rows, filters, sheet primitives, and loading states remain focused components. Shared data contracts continue to come from `owner-api.ts`.

## Data Flow

- Existing owner API methods remain the primary data boundary.
- A minimal verification-artifact presign/complete API is added so the browser can upload selected files before calling the existing verification submission methods.
- Each route fetches only the data it needs after the NextAuth access token is available.
- Unauthorized responses continue to trigger sign-out behavior.
- Overview data and focused management data may be loaded independently; a failure in one section does not blank the entire owner workspace.
- Listing availability changes are optimistic and revert on failure.
- Lead status changes are optimistic and revert on failure.
- URL path and query parameters are the source of truth for navigation and filters that should survive refresh.
- Mobile/desktop presentation choice is derived from pointer and viewport capability without changing server data.

## Error And Offline Behavior

- Every route has local loading, empty, error, and retry states.
- A failed overview section leaves other sections usable.
- Network failures use actionable copy and a Retry command.
- Optimistic listing or lead updates revert and announce failure through an accessible status message.
- Payment and boost failures preserve the selected plan and let the owner retry.
- Upload failures retain the selected artifact and expose retry/remove actions.
- No raw HTTP error text is shown to owners.
- The mobile shell and navigation remain usable when route content fails.

## Accessibility

- All interactive targets are at least 44 by 44 CSS pixels on mobile.
- Bottom navigation uses labelled links and exposes the current page.
- Icon-only controls have accessible names and tooltips where needed.
- Filters use proper selected state.
- Status updates and async failures use live regions without stealing focus.
- Sheets trap focus while open and restore focus to their trigger on close.
- Keyboard focus is visible.
- Forms use labels, appropriate input modes, and 16px minimum mobile input text to prevent iOS zoom.
- Content supports English and Hindi without clipping.
- Motion respects `prefers-reduced-motion`.

## Visual System

- Keep Cribliv brand colors and existing typography.
- Replace the oversized dark mobile hero with a compact owner header band.
- Use white operational surfaces, subtle borders, restrained status colors, and clear hierarchy.
- Avoid nested cards and decorative sections that lengthen the mobile page.
- Use icons from Lucide for navigation and commands.
- Cards use no more than an 8px radius in newly introduced workspace UI unless an existing shared primitive requires otherwise.

## Testing

### Unit And Component Tests

- Owner routes skip public chrome and render workspace chrome.
- Mobile bottom navigation has correct links, active state, safe-area class, and wizard suppression.
- Overview renders compact headline and secondary metrics.
- Listings status filters and compact card actions remain functional.
- Availability updates optimistically and reverts on failure.
- Mobile leads never mount `LeadKanban`.
- Desktop leads mount a stable Kanban provider and do not crash during route/view changes.
- Lead search, status changes, notes, unlock, call, and credit purchase remain functional.
- Verification method switching, file selection, submission, retry, and history render correctly.
- Verification artifact presign, upload completion, ownership checks, content-type checks, and size checks are covered in both database-enabled and in-memory modes.
- Sheets restore focus and respond to Escape.

### Browser Tests

Use authenticated owner sessions at 390x844, 412x915, tablet, and desktop widths to verify:

- no horizontal document overflow;
- no public footer on owner screens;
- bottom navigation never covers content;
- all owner destinations are reachable within one tap;
- listing cards and actions remain usable;
- the Leads screen loads without runtime errors;
- mobile lead actions work without drag-and-drop;
- desktop Kanban remains usable;
- verification can be completed with file controls;
- boost and credit dialogs fit and scroll as bottom sheets;
- the listing wizard remains usable without workspace navigation overlap;
- English and Hindi labels fit;
- mobile keyboard opening does not hide the active field or primary action.

### Quality Gates

- `pnpm --filter @cribliv/api test`
- `pnpm --filter @cribliv/web test`
- `pnpm --filter @cribliv/web typecheck`
- `pnpm --filter @cribliv/web lint`
- focused owner Playwright tests
- desktop and mobile screenshot review

## Acceptance Criteria

1. Owner workspace routes no longer render the public header/footer.
2. Mobile has persistent, safe-area-aware navigation to Overview, Listings, Add, Leads, and Verify.
3. The listing wizard is not obstructed by workspace navigation.
4. The overview's primary actions and headline metrics fit within the first mobile viewport.
5. Listing management has no horizontal overflow and all actions are touch accessible.
6. Mobile lead management uses a vertical list and does not mount drag-and-drop.
7. The Leads route no longer crashes.
8. Desktop lead Kanban continues to work.
9. Verification uses guided controls and real artifact file inputs.
10. Dialogs and secondary actions are usable as mobile bottom sheets.
11. All async operations expose loading, error, retry, and accessible status behavior.
12. English and Hindi render without clipped controls or overlapping text.
13. Existing desktop owner functionality does not regress.
14. Automated tests, typecheck, lint, and mobile browser verification pass.

## Out Of Scope

- Database schema changes.
- API changes beyond the focused verification-artifact upload boundary.
- Redesigning the listing creation wizard beyond integrating it cleanly with the owner shell.
- Replacing NextAuth, owner authorization, Razorpay, or verification providers.
- Rebuilding the PG operator dashboard.
- Adding native mobile applications.
