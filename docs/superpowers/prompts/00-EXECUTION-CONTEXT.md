# PG Operations V2 — Shared Execution Context (READ FIRST)

Every phase prompt in this folder assumes you have read this file. It is the self-contained context pack: an agent with zero conversation history can execute from it. Paste the relevant phase prompt into Codex/Sonnet **after** telling it to read this file and the plan.

- **Plan (source of truth for DDL/design):** `docs/superpowers/plans/2026-07-12-pg-operations-v2-plan.md`
- **Branch:** `feat/pg-operations-v2` (already created off `master`). Do all work here.

---

## 0. SAFETY — non-negotiable

- The local dev DB is **`postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2`** (Docker container `cribliv-pg-local`, pgvector installed). Migrations 0001–0054 + seed are already applied. Test users exist: owner `+919999999901`, tenant `+919999999902`, admin `+919999999903`.
- The repo root `.env` `DATABASE_URL` currently points to local 5433; the **production Azure URL is commented out (line 7)**. **NEVER uncomment it. NEVER run any DB command that could reach Azure.**
- **Defense in depth:** prefix every migrate/seed/test command with the local URL inline, e.g.
  `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm db:migrate`
  (`dotenv.config()` here does NOT override an already-set env var, so the inline value wins.)
- Production is migrated **only at the very end**, by the human, deliberately. Do not touch it.
- If the local DB is down: `docker start cribliv-pg-local` then wait for `docker exec cribliv-pg-local pg_isready -U postgres`.

## 1. Stack & commands

- Monorepo: Turborepo + pnpm. `apps/api` (NestJS, port 4000, global prefix `/v1`), `apps/web` (Next.js 14 App Router, port 3000, **CSS modules — no Tailwind**), `packages/shared-types`, `packages/ui`, `infra/migrations` (raw SQL).
- Build shared-types after changing it: `pnpm --filter @cribliv/shared-types build` (API vitest resolves `@cribliv/shared-types` → `packages/shared-types/dist`, so **types are invisible until built**).
- Quality gates: `pnpm build`, `pnpm typecheck`, `pnpm lint`. API tests: `DATABASE_URL="postgres://postgres:postgres@127.0.0.1:5433/cribliv_v2" pnpm --filter @cribliv/api test`. Web E2E: Playwright.
- Migrations run via `infra/migrations/run-migrations.js`: filename MUST match `^\d+_.*\.sql$`, MUST NOT contain the substring `rollback`, applied in lexical order, each in its own `BEGIN…COMMIT`, tracked in `schema_migrations`. Next free number is **0055**. Companion rollback file: `00NN_name.rollback.sql`. Be idempotent (`IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object THEN null; END $$`). Reuse the existing `trigger_set_updated_at()` function (defined in `0001_init.sql`).

## 2. Verified schema facts (do NOT re-derive)

**FK targets:** `users.id` uuid; `users.phone_e164` varchar(15) UNIQUE (E.164, the normalized phone form). `cities.id`, `localities.id` = integer serial.

**`user_role` enum** = `tenant|owner|pg_operator|admin` (no `pg_tenant`; do NOT add one). `actor_role` adds `system`.

**`pg_listings`** (head/source of truth; id == `listings.id` 1:1): `id, operator_user_id uuid, pg_property_id uuid (nullable), title, starting_rent_paise bigint, status listing_status, verification_status, created_at, updated_at`. `listing_status` = `draft|pending_review|active|rejected|paused|archived`.

**`pg_properties`** (the OPS AGGREGATE — every published listing already owns one; the 1-primary-per-operator constraint was dropped in 0041): `id, operator_id uuid (NOTE: operator_id, not operator_user_id), display_name, internal_code, city_id int, locality_id int, status pg_property_status, is_primary bool, total_floors smallint, metadata jsonb, lat numeric(9,6), lng numeric(9,6), created_at, updated_at`. `pg_property_status` = `active|paused|archived`. Has `set_updated_at` trigger.

**`pg_rooms`** (extend, don't recreate): `id, pg_property_id→pg_properties(CASCADE), room_type_id→pg_room_types(SET NULL), floor smallint, room_number text, created_at`. `UNIQUE(pg_property_id, room_number)`. **No updated_at yet.**

**`pg_beds`** (extend): `id, room_id→pg_rooms(CASCADE), bed_label text, status pg_bed_status, available_from date, created_at, updated_at`. `UNIQUE(room_id, bed_label)`. `pg_bed_status` = `vacant|reserved|occupied|blocked`.

**`pg_room_types`** (pricing bands, reuse as-is): `id, listing_id→pg_listings(CASCADE), sharing pg_sharing_kind, ac bool, bathroom_kind pg_bathroom_kind, furnishing furnishing_type, room_size_sqft smallint, monthly_rent_paise bigint, vacancy_count smallint, available_from date`. `UNIQUE(listing_id, sharing, ac, bathroom_kind, furnishing)`.

**Enums:** `pg_sharing_kind` = `single|double|triple|quad|dorm`; `pg_bathroom_kind` = `attached_western|attached_indian|shared_western|shared_indian`; `furnishing_type` = `unfurnished|semi_furnished|fully_furnished`.

**Money = integer paise; currency always INR.** Payment forward-compat template = `rent_agreement_payment_orders` (migration `0029`) + the `rent_agreements.payment_order_id` FK back-pointer (migration `0030`). Reuse `RazorpayOrdersService.createOrder` (`apps/api/src/modules/payments/razorpay-orders.service.ts`) when payment is wired (Phase 6 only).

## 3. API patterns to copy

- **Module wiring:** copy `apps/api/src/modules/pg-operator/pg-operator.module.ts`. New module imports `[CoreModule, GuardsModule, …]`, lists controllers + providers, and is registered in `apps/api/src/app.module.ts` imports array. `CoreModule` (`@Global`) provides `AppStateService, DatabaseService, IdempotencyService`. `GuardsModule` (`@Global`) provides `AuthGuard, RolesGuard`.
- **Guards/roles:** `@Controller("…")`, `@UseGuards(AuthGuard, RolesGuard)`, `@Roles("pg_operator"|"tenant"|"admin")` (from `apps/api/src/common/roles.decorator.ts`). `AuthGuard` sets `request.user = { id, role }`. Read it with `@Req()` / a `@CurrentUser`-style access as existing controllers do.
- **Dual-mode (MANDATORY on every service method):** start with `if (this.db.isEnabled()) { …SQL… } else { …safe path… }`. For these ops features the DB-off path is: **reads → return typed-empty (`[]`/`null`/zeroed summary); writes → `throw new ServiceUnavailableException({ code: 'operations_requires_db', message: 'PG operations require a database' })`.** Do NOT build in-memory Map parity for the state machines. Reference the real example: `apps/api/src/modules/pg-operator/services/pg-properties.service.ts` (`createProperty`, `listProperties`, `getOwnedProperty`, `resolveLocation`). `this.db.query<T>(sql, params)` returns `{ rows, rowCount }`.
- **Ownership guard (service-level, matches `getOwnedProperty`):** every operator ops method begins with `assertManagedOwnership(operatorId, propertyId)` → property `operator_id === operatorId` AND `manage_enabled = true`, else `ForbiddenException`. Never trust a property/bed id from the client without it. Tenant methods scope strictly to the caller's residence.
- **Idempotency:** mutations that create rows read the `Idempotency-Key` header (pattern in `pg-listing.controller.ts` create). Use `IdempotencyService`.
- **Notifications (best-effort only):** `NotificationService.send(input)` (`apps/api/src/modules/notifications/notification.service.ts`), WhatsApp-only, opt-in + `FF_WHATSAPP_NOTIFICATIONS` gated. Add new `NotificationType` values + templates in `notification.templates.ts`. Never block a state transition on notification success.
- **Photos:** `AzureBlobPhotoStorageService` (`apps/api/src/modules/owner/azure-blob-photo-storage.service.ts`), `createUploadTarget` presign. Its `assertListingScopedBlobPath` is **listing-scoped** — maintenance needs a property-scoped variant (`pg-maintenance/<propertyId>/…`).

## 4. Web patterns to copy

- **API client:** `apps/web/lib/api.ts` → `fetchApi<T>(path, init?, {server?})` unwraps the `{ data }` envelope and throws `ApiError` on non-2xx. Auth is **not** auto-attached: pass `headers: authHeaders(token)` (`{ Authorization: Bearer <token> }`) — pattern in `apps/web/lib/pg-operator-api.ts`. Put all new calls in a new `apps/web/lib/pg-operations-api.ts`.
- **Auth/session:** server components: `const s = await auth(); const role = s?.user?.role; const token = (s as any)?.accessToken;`. Client: `const { data: session } = useSession()` → `session?.user?.role`, `session?.accessToken`. `UserRole = "tenant"|"owner"|"pg_operator"|"admin"` (`apps/web/auth.config.ts`).
- **Routing/middleware:** `apps/web/middleware.ts` already protects `/*/pg-operator/*`→`pg_operator`, `/*/tenant/*`→`tenant`, `/*/admin/*`→`admin` for both `/en` and `/hi`. No middleware change needed.
- **i18n:** new PG-ops UI uses **hardcoded English strings** (matches the adjacent newer PG UI in `pg-operator/dashboard` and `listings/[id]`). Do not add `lib/i18n.ts` keys unless a phase says so.
- **UI primitives:** `@cribliv/ui` exports `Button` (`variant: primary|secondary|tertiary`), `Badge` (`tone: verified|pending|brand|neutral|danger`), `tokens`. Reuse app-local primitives from `apps/web/components/pg-operator/wizard/shared/` (`SectionCard`, `SegmentedControl`, `Toggle`, `RupeeInput`, `ChipMultiSelect`, `EnumChips`, `Stepper`, `Disclosure`) and admin `Toast`/`useToast` (`apps/web/components/admin/primitives/`). Style with `.module.css` + existing global classes (`.pgo-*`, `.card`, `.btn`, `.badge`, `.alert`).
- **Admin surface:** admin is a single tabbed client shell `apps/web/components/admin/shell/AdminShell.tsx` + `AdminSidebar`; tabs live in `apps/web/components/admin/tabs/`. Admin API client fns are in `apps/web/lib/admin-api.ts` (naming `…AdminPg…`).

## 5. Shared-types pattern

- New file `packages/shared-types/src/pg-operations.ts` (interfaces only — no runtime values). Add `export * from "./pg-operations";` to `packages/shared-types/src/index.ts`. **Reuse** existing `PgSharingKind`, `PgBathroomKind`, `PgFurnishing`, `PgProperty`, `PgRoomType` from `pg-operator.ts`. Do NOT overload `PgListingPayload`. Run `pnpm --filter @cribliv/shared-types build` after editing.

## 6. Test conventions

- Framework: Vitest (`apps/api/vitest.config.ts`; include `test/**/*.test.ts`, `src/**/__tests__/**/*.test.ts`).
- Two existing styles: (a) **direct instantiation with mocked `DatabaseService`** (`isEnabled: () => false`) — good for DB-off/no-op assertions; example `apps/api/src/modules/admin/__tests__/pg-admin.controller.integration.test.ts`; (b) **real-local-Postgres integration** — the true test for ops logic; must run with the inline local `DATABASE_URL`. Real-DB suites are quarantined in CI but run locally.
- For these ops features, **write real-Postgres integration tests** (constraints, transactions, and state machines can't be faithfully mocked). Each test: create fixture rows via SQL/service, exercise the service/controller, assert DB state. **TDD: write the failing test first, watch it fail, then implement.**

## 7. Definition of done (every phase)

1. Migration(s) apply clean on local 5433 **and** the paired `*.rollback.sql` reverses cleanly (test both once).
2. `pnpm --filter @cribliv/shared-types build` green; `pnpm typecheck` green; `pnpm lint` green for touched packages.
3. New integration tests pass against local 5433 (report exact counts). No regression in existing `pnpm --filter @cribliv/api test`.
4. Public `/v1/pg/*` and admin review flows unchanged.
5. Commit with a clear message. Do NOT push, do NOT migrate production.

## 8. Model routing

- **Sonnet** can execute Phases 1, 4, 5, and the frontend of every phase from the brief alone (well-specified, pattern-driven).
- **Opus** should author/review: the assignment state machine + partial-unique-constraint logic (Phase 3), the layout generate/persist/soft-retire logic (Phase 2 service), and the final whole-branch review.
- Verification flows upward: review each phase with a model at least as strong as the one that wrote it.
