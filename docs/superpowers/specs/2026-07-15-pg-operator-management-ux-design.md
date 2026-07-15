# PG Operator Management UX Overhaul — Design Spec

**Date:** 2026-07-15
**Status:** Approved (brainstorming)
**Scope:** Operator **management** surfaces only — maintenance, property detail, operator dashboard. Tenant/public side is explicitly out of scope.
**Feature flag:** Reuse `NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2` where the surface is already gated by it (queue/kanban/ticket-route). New primitives (toast, motion) ship unflagged since they are additive and inert until called.

---

## 1. Problem statement

The PG operator dashboard is functional but feels unfinished on the management surfaces. A parallel audit found:

| Dimension       | State       | Core issue                                                                                                                  |
| --------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| Action feedback | **Weak**    | No shared toast system; drag-to-move, assign, status change, comment all succeed **silently**. Feedback is vague or absent. |
| Responsiveness  | **Partial** | Kanban is a fixed 4-col grid; queue table has `min-width: 920px`. Both break on phones. Operators use mobile in the field.  |
| Loading         | **Minimal** | Spinners only, no skeletons; detail pane blank-flashes while the timeline/photos load.                                      |
| Errors          | **Basic**   | Inline `role="alert"` exists but there is no **retry** affordance and messages are generic.                                 |
| Accessibility   | **Mixed**   | Dialog focus handling is good, but kanban drag-drop (`@hello-pangea/dnd`) has **no keyboard path**.                         |
| Empty states    | Good        | Clear text; minor polish only.                                                                                              |

**Key architectural finding:** the operator shell already ships a premium design system. `packages/ui/src/tokens.css` defines the canonical scale (8pt spacing, radius/shadow scales, Manrope/Inter, `--transition-spring`). `apps/web/app/[locale]/pg-operator/pg-operator.css` defines a scoped `.pgo-dark` theme — electric-violet brand `#7c3aed`, amber accent, glassy card surfaces (`rgba(255,255,255,0.04)`), aurora background, spring easings, and ready-made keyframes (`pgo-fade-up`, `pgo-scale-in`, `pgo-glow-ring`, `pgo-pulse-soft`). **But the maintenance components style against light-theme fallbacks** (`var(--text-primary, #1a1a2e)`) rather than the `--pgo-*` tokens. So the "premium feel" is largely a **consistency** problem, not a from-scratch redesign.

## 2. Goals / non-goals

**Goals**

- A single shared toast/notification system with a `useToast()` hook, mounted at the operator layout.
- Every operator action gives **structured, specific feedback** — optimistic update → named toast → rollback+retry on error. No vague "Success".
- Management surfaces are **mobile-first responsive** — kanban, queue table, filters, property detail, dashboard.
- Skeleton loading states replace blank flashes.
- Consistent application of the existing `--pgo-*` premium token system; motion that confirms, never decorates.
- A keyboard path for kanban status changes.

**Non-goals**

- No new visual design language — reuse `--pgo-*`.
- No tenant/public-side changes.
- No new drag-drop library; keep `@hello-pangea/dnd`.
- No backend/API changes (the user is handling backend separately).
- Toast system does **not** go in `packages/ui` (that package is presentational-only, no client context).

## 3. Design language

Reuse the existing system; the job is consistency and restraint.

- **Tokens:** operator surfaces use `--pgo-*` tokens exclusively. Remove light-theme fallbacks (`#1a1a2e` etc.) from maintenance modules so they render correctly inside the dark shell.
- **Hierarchy over chrome:** whitespace and type hierarchy (Manrope headings / Inter body) carry structure; reduce reliance on borders/boxes.
- **One accent:** violet `--pgo-brand` for primary/active/selected; amber `--pgo-accent` reserved for warnings/SLA; semantic `--pgo-success/--pgo-danger` for outcomes.
- **Motion vocabulary (functional only):**
  - `pgo-fade-up` — content/list mount
  - `pgo-scale-in` — dialogs, toasts, sheets
  - `pgo-glow-ring` — success confirmation pulse on the affected element
  - spring easing (`--pgo-spring`) — drag settle
  - All motion gated behind `@media (prefers-reduced-motion: reduce)` → no transform/opacity animation, instant state.

## 4. Component design

### 4.1 Toast system (new) — `apps/web/components/ui/toast/`

Follows the app's provider convention (feature-scoped `'use client'` provider, like `SessionProvider` / `PgFieldHighlightContext`).

```
apps/web/components/ui/toast/
  toast-provider.tsx   # 'use client'; ToastProvider + context; owns the queue + portal
  use-toast.ts         # useToast() hook → { success, error, info, promise, dismiss }
  Toast.tsx            # single toast presentation (icon, message, optional action, dismiss)
  toast.module.css     # --pgo-* styled; scale-in/fade motion; stack layout
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
- Stackable (newest on top/bottom per placement); max ~3 visible, older ones collapse/dismiss.
- Auto-dismiss ~2800ms (matches existing convention); errors are sticky until dismissed or retried.
- Entrance: `pgo-scale-in` + fade; exit: fade + slight translate. Respects reduced-motion.
- Optional inline **action** button (Undo / Retry).
- Placement: bottom-center on mobile, bottom-right on ≥760px.

**Mount point:** `apps/web/app/[locale]/pg-operator/layout.tsx` wraps children in `<ToastProvider>`. Scoped to operators now; liftable to root layout later.

**Migration:** the ad-hoc `useState` toast in `PgListingControls.tsx` is replaced by `useToast()` (removes duplicated snippet).

### 4.2 Structured-feedback pattern (applied everywhere)

A small helper encapsulates the optimistic→toast→rollback loop so each call site stays declarative. Every mutating operator action adopts it:

| Action                           | Optimistic effect       | Success toast                            | Error handling                          |
| -------------------------------- | ----------------------- | ---------------------------------------- | --------------------------------------- |
| Kanban drag between columns      | card moves instantly    | `"Ticket #142 → In progress"` + **Undo** | revert card + `error` toast + **Retry** |
| Status change (detail/workspace) | badge updates           | `"Marked In progress"`                   | revert + retry                          |
| Assign / vacate bed              | chip updates            | `"Bed 5 assigned to <name>"`             | revert + retry                          |
| Priority override                | badge updates           | `"Priority set to High"`                 | revert + retry                          |
| Comment submit                   | appended optimistically | `"Comment added"`                        | remove + retry                          |
| Resolution submit                | ticket → resolved       | `"Ticket resolved"`                      | revert + retry                          |

**Rule:** toast messages name _what changed_ (ticket id, target state, bed number). No bare "Success"/"Saved".

### 4.3 Skeletons (new, small)

A reusable `Skeleton` block (`--pgo-*` shimmer via `pgo-pulse-soft`) used for:

- Queue table rows while filtering/paginating
- Kanban column cards on "Load more"
- Ticket detail pane (timeline + photo gallery) while it hydrates in `MaintenanceWorkspace`

### 4.4 Responsive (mobile-first)

| Surface             | < 760px behavior                                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kanban**          | Horizontal **snap-scroll swimlanes** — one column ≈85vw with a peek of the next; sticky column-switcher chips at top. Keeps the board metaphor. (Approved.) |
| **Queue table**     | Drop `min-width: 920px`; each row becomes a **stacked card** — status + priority header, then label/value rows (location, tenant, SLA, last update).        |
| **Filters**         | Collapse into a **bottom-sheet** triggered by a "Filters" button; chips show active count.                                                                  |
| **Property detail** | Bed grid `auto-fit minmax` already reflows; verify occupancy summary + header stack at 640/760.                                                             |
| **Dashboard**       | Verify analytics strip, funnel, portfolio cards reflow to 1-col; anchor nav collapses (already desktop-only).                                               |

### 4.5 Accessibility

- **Kanban keyboard path:** surface the existing status-move controls as visible/focusable buttons on each card (menu or inline), so keyboard/SR users can change status without drag. Add drag-lib live-region announcements if cheap.
- Toasts: `aria-live` region; action buttons focusable.
- Focus-visible states on all new interactive elements (switcher chips, filter sheet, card menus).
- Focus return after sheet/dialog close.

## 5. Data flow

No API changes. Existing fetch/mutation calls stay; the feedback helper wraps their call sites to add optimistic state + toast + rollback. Skeletons key off existing `pending`/loading state already present in the components.

## 6. Error handling

- Every mutation error path routes through `toast.error(...)` with a **Retry** action that re-invokes the same mutation.
- Optimistic state always rolls back on failure so the UI never lies.
- Inline `role="alert"` banners retained for form-level validation (e.g., required resolution reason); toasts handle transient action outcomes.

## 7. Testing

- **Toast system:** unit tests for the provider/hook — queueing, auto-dismiss timing, error stickiness, action callback, reduced-motion, max-visible collapse.
- **Feedback pattern:** for each migrated action, a test asserting (a) optimistic update happens, (b) success toast fires with the specific message, (c) on mocked API failure the state rolls back and an error toast with Retry appears. Extend the existing `MaintenanceKanban.test.tsx` / `MaintenanceQueueList.test.tsx`.
- **Responsive:** the app uses Playwright (`pnpm --filter @cribliv/web test`) — add mobile-viewport checks that the queue renders cards (not a 920px scroller) and the kanban is a snap-scroll container < 760px.
- **A11y:** assert kanban cards expose focusable status controls; toast region has `aria-live`.

## 8. Delivery phases (each independently shippable)

- **Phase 0 — Primitives:** toast system (`ToastProvider` + `useToast` + `Toast` + tests), `Skeleton`, mount at operator layout, migrate `PgListingControls` off its ad-hoc toast.
- **Phase 1 — Maintenance:** wire structured feedback into kanban/queue/detail/workspace; kanban keyboard path; skeletons; mobile responsive (snap-scroll kanban, card-list table, filter bottom-sheet); `--pgo-*` token cleanup on maintenance modules.
- **Phase 2 — Property detail:** verify/fix reflow at 640/760; apply feedback pattern to bed assign/vacate.
- **Phase 3 — Dashboard:** responsive verification of analytics/funnel/portfolio cards; token consistency pass.

## 9. Risks / open items

- **Theme mismatch:** removing light-theme fallbacks from maintenance modules must be verified visually inside `.pgo-dark` — some components may currently rely on those fallbacks. Verify per-file during Phase 1, don't bulk-replace blind.
- **Snap-scroll discoverability:** ensure the "peek of next column" + switcher chips make horizontal scroll obvious on mobile.
- **Optimistic rollback correctness:** each action's rollback must restore the exact prior state (including derived analytics-strip counts). Test explicitly.
