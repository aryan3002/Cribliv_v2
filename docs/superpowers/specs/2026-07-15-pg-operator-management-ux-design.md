# PG Operator Management UX Overhaul — Design Spec

**Date:** 2026-07-15
**Status:** Approved (brainstorming)
**Scope:** Operator **management** surfaces only — maintenance, property detail (bed inventory), operator dashboard. Tenant/public side is out of scope.
**Feature flag:** Reuse `NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2` where the surface is already gated by it (queue/kanban/ticket-route). New primitives (toast, overflow menu, skeleton) ship unflagged since they are additive and inert until called.

---

## 1. Problem statement

The PG operator dashboard is functional but feels unfinished on the management surfaces. A parallel audit plus direct inspection found:

| Dimension       | State       | Core issue                                                                                                                                                                                                                               |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action feedback | **Weak**    | No shared toast system; drag-to-move, assign, status change, comment all succeed **silently**. Feedback is vague or absent.                                                                                                              |
| Responsiveness  | **Partial** | Kanban is a fixed 4-col grid; queue table has `min-width: 920px`. Both break on phones. Operators use mobile in the field.                                                                                                               |
| Bed grid        | **Broken**  | Bed cards cram **four equal-weight text buttons** (Block/Relist/Tenants/Bed record) into a `minmax(130px,1fr)` cell → buttons overflow and visually collide (see screenshot). Redundant room number per tile; noisy "No available date". |
| Loading         | **Minimal** | Spinners only, no skeletons; detail pane blank-flashes while the timeline/photos load.                                                                                                                                                   |
| Errors          | **Basic**   | Inline `role="alert"` exists but there is no **retry** affordance and messages are generic.                                                                                                                                              |
| Accessibility   | **Mixed**   | Dialog focus handling is good, but kanban drag-drop (`@hello-pangea/dnd`) has **no keyboard path**.                                                                                                                                      |

### Theme: the surfaces are LIGHT (important correction)

The operator layout wraps content in `<div className="pgo-dark ...">`, but the ops/maintenance components style against a `--d-*` token namespace (`var(--d-surface, #fff)`, `var(--d-text, #1a1a2e)`, `var(--d-brand, #0066ff)`) **that is never defined anywhere in the codebase**. Every reference falls through to its **light fallback**, so the management surfaces render as a **light UI** (confirmed by screenshot). The `.pgo-dark` class only affects elements that consume `--pgo-*` variables (dashboard landing / header / aurora), not the operational surfaces.

**Direction:** embrace the light UI. Standardize on the light `--d-*` token set (define it explicitly as a light theme rather than relying on scattered fallbacks) and the canonical `packages/ui/src/tokens.css` scale (`--brand: #0066ff`, 8pt spacing, radius/shadow scales, Manrope/Inter, `--transition-*`). **Do not** introduce the `--pgo-*` dark palette on these surfaces.

## 2. Goals / non-goals

**Goals**

- A single shared toast/notification system with a `useToast()` hook, mounted at the operator layout.
- Every operator action gives **structured, specific feedback** — optimistic update → named toast → rollback+retry on error. No vague "Success".
- Management surfaces are **mobile-first responsive** — kanban, queue table, filters, bed grid, property detail, dashboard.
- **Bed grid redesigned** into a clean status-tinted occupancy map with a primary action + overflow menu (fixes the button overflow).
- Skeleton loading states replace blank flashes.
- Consistent light theme + restrained premium polish; motion that confirms, never decorates.
- A keyboard path for kanban status changes.

**Non-goals**

- No new brand/visual identity — reuse the existing light token scale.
- No `--pgo-*` dark theme on management surfaces.
- No tenant/public-side changes.
- No new drag-drop library; keep `@hello-pangea/dnd`.
- No backend/API changes (backend is handled separately). Data shapes (`PgBed`, ticket DTOs) stay as-is.
- Toast/menu primitives do **not** go in `packages/ui` (that package is presentational-only, no client context).

## 3. Design language (light, premium-restrained)

- **Tokens:** define the `--d-*` set explicitly as a light theme (colors, surfaces, borders, text) in one place so surfaces stop relying on inline fallbacks; map them to the canonical `packages/ui` palette. Text `#1a1a2e` / secondary `#64748b`; surface `#fff` / raised `#f5f5f7`; border `#e8ecf1` / strong `#cbd5e1`; brand `#0066ff`; success `#0d9f4f`; warning `#e88c00`; danger `#dc2626`.
- **Hierarchy over chrome:** whitespace and type hierarchy (Manrope headings / Inter body) carry structure; reduce reliance on heavy borders/boxes.
- **One accent:** brand blue `#0066ff` for primary/active/selected; status colors reserved for status meaning (bed status, SLA, outcomes).
- **Motion vocabulary (functional only), built on canonical `--transition-*`:**
  - fade+translate-up on content/list mount
  - scale-in for dialogs, toasts, sheets, menus (`--transition-spring`)
  - a brief brand-tinted confirmation pulse on the element an action just changed
  - All motion gated behind `@media (prefers-reduced-motion: reduce)` → instant state, no transform/opacity animation.

## 4. Component design

### 4.1 Toast system (new) — `apps/web/components/ui/toast/`

Follows the app's provider convention (feature-scoped `'use client'` provider, like `SessionProvider` / `PgFieldHighlightContext`).

```
apps/web/components/ui/toast/
  toast-provider.tsx   # 'use client'; ToastProvider + context; owns the queue + portal
  use-toast.ts         # useToast() hook → { success, error, info, promise, dismiss }
  Toast.tsx            # single toast presentation (icon, message, optional action, dismiss)
  toast.module.css     # light --d-* / canonical tokens; scale-in/fade motion; stack layout
```

**API**

```ts
const toast = useToast();
toast.success(message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number });
toast.error(message: string, opts?: { action?: {...}; duration?: number }); // sticky by default
toast.info(message: string, opts?);
toast.promise(p: Promise<T>, { loading, success, error }); // convenience for async flows
toast.dismiss(id);
```

**Behavior**

- Context provider holds an array of toasts; renders them via a portal into a fixed, `aria-live="polite"` region (errors → `assertive`).
- Stackable; max ~3 visible, older ones collapse/dismiss.
- Auto-dismiss ~2800ms (matches existing convention); errors are sticky until dismissed or retried.
- Entrance: scale-in + fade; exit: fade + slight translate. Respects reduced-motion.
- Optional inline **action** button (Undo / Retry).
- Placement: bottom-center on mobile, bottom-right on ≥760px.

**Mount point:** `apps/web/app/[locale]/pg-operator/layout.tsx` wraps children in `<ToastProvider>`. Scoped to operators now; liftable to root layout later.

**Migration:** the ad-hoc `useState` toast in `PgListingControls.tsx` is replaced by `useToast()` (removes duplicated snippet).

### 4.2 Overflow menu (new) — `apps/web/components/ui/menu/`

No shared menu primitive exists (only feature-specific dropdowns). Add a minimal accessible overflow menu for the bed-card kebab (and reusable elsewhere):

- Trigger button (`⋯`, `aria-haspopup="menu"`, `aria-expanded`), popover list of menu items, keyboard support (Arrow/Home/End/Escape), focus trap while open, click-outside close, focus return to trigger.
- Light-token styled; scale-in motion; renders in a portal to avoid clipping inside the bed grid.

### 4.3 Structured-feedback pattern (applied everywhere)

A small helper encapsulates the optimistic→toast→rollback loop so each call site stays declarative. Every mutating operator action adopts it:

| Action                           | Optimistic effect       | Success toast                            | Error handling                          |
| -------------------------------- | ----------------------- | ---------------------------------------- | --------------------------------------- |
| Kanban drag between columns      | card moves instantly    | `"Ticket #142 → In progress"` + **Undo** | revert card + `error` toast + **Retry** |
| Status change (detail/workspace) | badge updates           | `"Marked In progress"`                   | revert + retry                          |
| Bed block / relist / vacate      | tile updates            | `"Bed A blocked"` / `"Bed A relisted"`   | revert + retry                          |
| Priority override                | badge updates           | `"Priority set to High"`                 | revert + retry                          |
| Comment submit                   | appended optimistically | `"Comment added"`                        | remove + retry                          |
| Resolution submit                | ticket → resolved       | `"Ticket resolved"`                      | revert + retry                          |

**Rule:** toast messages name _what changed_ (ticket id, target state, bed label). No bare "Success"/"Saved".

### 4.4 Skeletons (new, small) — `apps/web/components/ui/skeleton/`

A reusable `Skeleton` block (light shimmer) used for:

- Queue table rows while filtering/paginating
- Kanban column cards on "Load more"
- Ticket detail pane (timeline + photo gallery) while it hydrates in `MaintenanceWorkspace`

### 4.5 Responsive (mobile-first)

| Surface           | < 760px behavior                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kanban**        | Horizontal **snap-scroll swimlanes** — one column ≈85vw with a peek of the next; sticky column-switcher chips at top. Keeps the board metaphor. (Approved.)            |
| **Queue table**   | Drop `min-width: 920px`; each row becomes a **stacked card** — status + priority header, then label/value rows (location, tenant, SLA, last update).                   |
| **Filters**       | Collapse into a **bottom-sheet** triggered by a "Filters" button; chips show active count.                                                                             |
| **Bed grid**      | Room columns already use `auto-fit minmax`; bed tiles go to a comfortable single/double column on narrow screens (raise the tile min-width so actions never overflow). |
| **Property page** | Verify occupancy summary + header stack at 640/760.                                                                                                                    |
| **Dashboard**     | Verify analytics strip, funnel, portfolio cards reflow to 1-col; anchor nav collapses (already desktop-only).                                                          |

### 4.6 Bed grid redesign (new) — `PgBedChip` + `PgBedGrid`

Rework the bed tile from a "button box" into a **status-tinted occupancy tile** (approved direction).

**Tile anatomy (top → bottom):**

1. **Header:** `Bed {label}` (prominent) + status pill. **Remove the redundant room number** — the room group heading already provides it.
2. **Context line:** tenant name if occupied; `Available {date}` only when vacant _and_ a date exists; otherwise omit the line entirely (kills "No available date" noise).
3. **Action row:** **one primary action inline** + a **kebab (⋯)** overflow menu (§4.2) for the rest:
   - Vacant → primary **Assign** (→ `assignmentHref`); ⋯ = Block, Bed record.
   - Blocked → primary **Relist/Unblock** (→ set vacant); ⋯ = Bed record.
   - Occupied → primary **Manage** (→ `assignmentHref`/detail); ⋯ = Bed record.
   - This permanently removes the 4-button overflow.

**Visual (status-tinted occupancy map):**

- Each tile gets a **subtle status tint** as background (not just the left border): vacant → success-tint, occupied → brand-tint, reserved → warning-tint, blocked → danger-tint, inactive → muted/de-emphasized. Keep contrast AA for text on tint.
- Status pill retains an explicit text label (never color-only).
- **Uniform, denser grid:** raise the bed cell min-width (e.g. `minmax(160px, 1fr)`) and equalize tile height so a 2-bed room and a 10-bed room both read as clean seat maps.
- Room group header: normalize labels so every room reads consistently (e.g. always `Room {n}` — today some show `Room 101`, others bare `103`; source is `roomNumber` string).

**Constraints:** preserve all existing props/handlers (`onSetStatus`, `onRelist`, `assignmentHref`, `detailHref`, `pending`, `canAct` logic). This is a presentation + action-affordance change, not a data change. Bed status changes route through the §4.3 feedback pattern (optimistic tint change + specific toast + rollback).

### 4.7 Accessibility

- **Kanban keyboard path:** surface the existing status-move controls as visible/focusable buttons (or a per-card menu) so keyboard/SR users can change status without drag.
- Toasts: `aria-live` region; action buttons focusable.
- Overflow menu: full keyboard operation + focus return (§4.2).
- Focus-visible states on all new interactive elements (switcher chips, filter sheet, kebab, tiles).

## 5. Data flow

No API changes. Existing fetch/mutation calls stay; the feedback helper wraps their call sites to add optimistic state + toast + rollback. Skeletons key off existing `pending`/loading state already present in the components. Bed tiles consume the same `PgBed` shape.

## 6. Error handling

- Every mutation error path routes through `toast.error(...)` with a **Retry** action that re-invokes the same mutation.
- Optimistic state always rolls back on failure so the UI never lies.
- Inline `role="alert"` banners retained for form-level validation (e.g., required resolution reason); toasts handle transient action outcomes.

## 7. Testing

- **Toast system:** unit tests — queueing, auto-dismiss timing, error stickiness, action callback, reduced-motion, max-visible collapse.
- **Overflow menu:** unit tests — open/close, keyboard nav, Escape, click-outside, focus return, item activation.
- **Feedback pattern:** per migrated action, assert (a) optimistic update, (b) specific success toast text, (c) on mocked API failure the state rolls back and an error toast with Retry appears. Extend `MaintenanceKanban.test.tsx` / `MaintenanceQueueList.test.tsx` and add a `PgBedChip` test.
- **Bed grid:** test that a vacant tile renders exactly one primary action + a kebab; that occupied/blocked map to the right primary; that the room number is not duplicated inside the tile; that block/relist fire optimistic tint + toast.
- **Responsive:** Playwright (`pnpm --filter @cribliv/web test`) mobile-viewport checks — queue renders cards (not a 920px scroller), kanban is a snap-scroll container < 760px, bed tiles don't overflow their cell.
- **A11y:** kanban cards expose focusable status controls; toast region has `aria-live`; menu is keyboard-operable.

## 8. Delivery phases (each independently shippable)

- **Phase 0 — Primitives:** toast system (`ToastProvider` + `useToast` + `Toast` + tests), overflow `Menu`, `Skeleton`; mount `ToastProvider` at operator layout; migrate `PgListingControls` off its ad-hoc toast; define the `--d-*` light token set explicitly.
- **Phase 1 — Maintenance:** structured feedback into kanban/queue/detail/workspace; kanban keyboard path; skeletons; mobile responsive (snap-scroll kanban, card-list table, filter bottom-sheet); token cleanup on maintenance modules.
- **Phase 2 — Property detail + bed grid:** redesign `PgBedChip`/`PgBedGrid` (status-tinted tiles, primary+kebab, remove redundancy, denser uniform grid, responsive); apply feedback pattern to bed block/relist; verify property page reflow at 640/760.
- **Phase 3 — Dashboard:** responsive verification of analytics/funnel/portfolio cards; light-token consistency pass.

## 9. Risks / open items

- **`--d-*` token definition:** these tokens are currently undefined (light fallbacks only). Defining them explicitly must reproduce the _current_ light appearance exactly — verify visually per surface, don't change colors while formalizing.
- **Menu portal + grid clipping:** the kebab menu must render in a portal so it isn't clipped by the bed grid's `overflow`/`min-width:0` cells.
- **Snap-scroll discoverability:** ensure the "peek of next column" + switcher chips make horizontal scroll obvious on mobile.
- **Optimistic rollback correctness:** each action's rollback must restore the exact prior state (including derived analytics-strip counts and bed tints). Test explicitly.
