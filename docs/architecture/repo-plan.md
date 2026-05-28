# Repo and Dev Setup Plan

## Monorepo

- `apps/web`: Next.js app router UI
- `apps/api`: NestJS modular monolith + worker
- `packages/shared-types`: shared enums/contracts/events
- `packages/ui`: design tokens and primitives
- `infra/migrations`: SQL schema and migration runner
- `data/seeds`: city/locality seed assets
- `.github/workflows`: CI skeleton

## Local bootstrap

1. Install Node 20+ and pnpm 9+
2. `docker compose -f infra/docker-compose.yml up -d`
3. `pnpm install`
4. `pnpm db:migrate`
5. `pnpm db:seed`
6. `pnpm dev`

## CI jobs

- validate: typecheck, lint, test
- build: compile all packages/apps
- contract-check: OpenAPI + shared types presence
- migration-check: migration file validation
- deploy-staging/prod placeholders
