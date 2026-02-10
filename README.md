# Cribliv v2

Monorepo for Cribliv v2 (web + API + shared packages), implementing Phase 1 architecture.

## Quick start

1. `pnpm install`
2. Copy `.env.example` to `.env`
3. Start Postgres: `docker compose -f infra/docker-compose.yml up -d`
4. `pnpm db:migrate`
5. `pnpm db:seed`
6. `pnpm dev`

### Run tests

1. API integration tests: `pnpm --filter @cribliv/api test`
2. Install browsers once for E2E: `pnpm --filter @cribliv/web exec playwright install`
3. Web E2E: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test`

### E2E auth notes

- E2E suites use OTP login via API request context and inject session into localStorage key `cribliv:auth-session`.
- Keep `OTP_PROVIDER=mock` for local API integration tests and web E2E suites.
- Use `OTP_PROVIDER=d7` with `D7_KEY` for real-device SMS OTP flows.
- Default E2E role phones in local bootstrap:
  - owner: `+919999999901`
  - tenant: `+919999999902`
  - admin: `+919999999903`

## Current implementation scope

- Web and API are scaffolded to match the Phase 1 contract and architecture.
- API persistence is represented by SQL migrations and seed scripts.
- Frontend owner/admin integration is contract-mapped via:
  - `apps/web/lib/owner-api.ts`
  - `apps/web/lib/admin-api.ts`
- DB-first now covers:
  - auth/session + OTP
  - search + listing detail
  - wallet + contact unlock + refund flow
  - shortlist CRUD
  - owner listing create/update/submit + photo complete
  - verification attempts + admin review decisions
- In-memory fallback remains enabled for quick local bring-up without DB.
- Health endpoint: `GET /v1/health` returns API status and DB availability.

## Launch scope and flags

- MVP launch scope and staging checklist: `docs/architecture/launch-scope.md`
- Key launch flags (from `.env.example`):
  - `FF_REAL_VERIFICATION_PROVIDER`
  - `FF_PG_SALES_LEADS`
  - `FF_PRODUCTION_DB_ONLY`

## Workspace

- `apps/web`: Next.js web frontend (bilingual, SEO-first)
- `apps/api`: NestJS modular monolith API + worker
- `packages/shared-types`: shared contracts, enums, DTO shapes
- `packages/ui`: design system tokens + primitives
- `infra/migrations`: SQL migrations
- `data/seeds`: seed data files
- `docs/*`: PRD/UX/architecture docs
