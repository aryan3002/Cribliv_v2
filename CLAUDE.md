# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start everything
pnpm install
docker compose -f infra/docker-compose.yml up -d   # Postgres
pnpm db:migrate
pnpm db:seed
pnpm dev                                            # web (3000) + api (4000) in parallel

# Individual apps
pnpm dev:web
pnpm dev:api
pnpm worker                                         # background sweep process

# Quality
pnpm build
pnpm lint
pnpm typecheck
pnpm test

# Single app tests
pnpm --filter @cribliv/api test          # Vitest integration tests
pnpm --filter @cribliv/web test          # Vitest component tests
pnpm --filter @cribliv/web test:e2e      # Playwright E2E

# E2E one-time setup
pnpm --filter @cribliv/web exec playwright install
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test

# DB
pnpm db:migrate
pnpm db:seed
```

## Architecture

### Monorepo layout

Turborepo + pnpm workspaces. Build order is enforced: `packages/*` must build before `apps/*` (all use `"dependsOn": ["^build"]`).

- `apps/web` — Next.js 14 (App Router), port 3000
- `apps/api` — NestJS modular monolith, port 4000, all routes under `/v1`
- `apps/api/src/worker/` — standalone background process (separate from NestJS HTTP server), runs via `pnpm worker`
- `packages/shared-types` — canonical TypeScript contracts, enums, DTO shapes shared between web and API
- `packages/ui` — design tokens + React primitives
- `infra/migrations/` — raw SQL files (`0001_init.sql` … `0054_…sql`, sequential; next free number is `0055`), applied via `infra/migrations/run-migrations.js`

### DB dual-mode (critical)

Every service checks `DatabaseService.isEnabled()` (truthy when `DATABASE_URL` is set). When enabled, queries hit Postgres; when not, the service falls back to `AppStateService` (an in-memory singleton). This lets the API boot without a DB for quick local bring-up. New services must follow this same pattern — implement both code paths.

### API module structure

Each domain is a self-contained NestJS module under `apps/api/src/modules/`. Modules inject `AppStateService` and `DatabaseService` from the global `CoreModule`. Auth guards (`AuthGuard`, `RolesGuard`) come from the global `GuardsModule` and are applied per-controller or per-route.

Session tokens are bearer tokens prefixed `acc_<uuid>`. `AuthGuard` validates them against the DB (or in-memory store) and populates `request.user = { id, role }`.

### Auth flow

OTP-only, no passwords. The API issues challenges and verifies codes. `OTP_PROVIDER=mock` for local/test, `OTP_PROVIDER=d7` (with `D7_KEY`) for real SMS. On the web side, NextAuth v5 (`apps/web/auth.ts` + `apps/web/auth.config.ts`) wraps this — the Credentials provider calls `POST /auth/otp/verify` then stores the API access token in the JWT.

E2E tests inject sessions by calling the API directly and writing to `localStorage` key `cribliv:auth-session`. Default test phones: owner `+919999999901`, tenant `+919999999902`, admin `+919999999903`.

### Web routing & i18n

App Router with a `[locale]` segment (`en` | `hi`). All localised pages live under `apps/web/app/[locale]/`. The middleware (`apps/web/middleware.ts`) enforces role-based protection:

| Prefix        | Required role          |
| ------------- | ---------------------- |
| `/*/tenant/*` | `tenant`               |
| `/*/owner/*`  | `owner`, `pg_operator` |
| `/*/admin/*`  | `admin`                |

Translations are inline in `apps/web/lib/i18n.ts` (a dictionary object, not separate JSON files).

### Web → API calls

`apps/web/lib/api.ts` exports `fetchApi<T>()`, the single wrapper for all HTTP calls. It reads the base URL from `NEXT_PUBLIC_API_BASE_URL` → `API_BASE_URL` → `http://localhost:4000/v1`. Domain-specific API clients (`owner-api.ts`, `admin-api.ts`) re-export typed wrappers over `fetchApi`.

### Feature flags

**API-side**: `apps/api/src/config/feature-flags.ts` — `readFeatureFlags()` maps `FF_*` env vars to a typed `FeatureFlags` object with defined defaults. All flags default OFF except core launch features.

**Web-side**: `apps/web/lib/feature-flags.ts` — `useFlag(name)` checks `NEXT_PUBLIC_FF_*` env vars OR PostHog remote config (whichever is true wins). Major launch flags: `FF_REAL_VERIFICATION_PROVIDER`, `FF_PG_SALES_LEADS`, `FF_PRODUCTION_DB_ONLY`.

### Background worker

`apps/api/src/worker/worker.ts` is a standalone Node process (not part of the NestJS HTTP server). It runs periodic sweeps: timeout refunds, WhatsApp notification dispatch, stale listing cleanup, boost expiry, AI ranking recompute, lead nudges, subscription renewals, saved-search alerts, seeker pin cleanup, and alert zone sweeps. Start with `pnpm worker`.

### Key external integrations

- **Postgres** with PostGIS + pgvector (see migrations `0006`, `0009`)
- **Azure Blob Storage** — listing photo uploads
- **Azure Cognitive Services** — speech/voice agent (Microsoft Speech SDK)
- **Razorpay** — payments (`apps/web/lib/razorpay.ts`)
- **D7 Networks** — production SMS OTP
- **Google Maps / Places** — map browsing and locality autocomplete
- **PostHog** — analytics + remote feature flags
- **Socket.IO** — real-time notifications and voice agent WebSocket
