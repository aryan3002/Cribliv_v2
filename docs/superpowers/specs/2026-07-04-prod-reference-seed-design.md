# Production-safe reference-data seed — Design

- **Date:** 2026-07-04
- **Status:** Approved (design)

## Problem

Production's DB has the schema (migrated to 0043) but **no city data**, so the admin Programmatic SEO console shows "No cities configured". The dev seed (`pnpm db:seed`) loads the data but also inserts **dev test users** (phones …901–904) + wallets, which must never exist in production.

## Goal

Load the reference data (cities, localities, micro-localities, landmarks, metro, `seo_city_config`) into prod **without** the dev users, idempotently, via a command that cannot insert dev users by construction.

## Design

- **Gate** the dev-user/wallet block in `data/seeds/seed.ts` behind `if (process.env.SEED_REFERENCE_ONLY === "1") { skip } else { …seed users… }`. Everything else runs unchanged.
- **Add `pnpm seed:reference`** (root + `apps/api`) that bakes in `SEED_REFERENCE_ONLY=1`. This is the only command pointed at prod. Plain `pnpm db:seed` stays forbidden against prod.
- **Enabled state:** unchanged from dev — Lucknow enabled/live, others Draft (per user decision). All upserts are `ON CONFLICT` (idempotent).

## Run procedure (nothing touches prod without an explicit go)

1. Local test: `DATABASE_URL=<local dev> pnpm seed:reference` → confirm it logs "Skipping dev seed users", loads reference data, and does not run the user-insert path.
2. Read-only prod preview: connect to prod, SELECT current counts (cities/localities/landmarks/metro/users) to confirm prod is empty + that I'm on the right DB.
3. Show the user what will be inserted → **explicit OK** → `DATABASE_URL=<prod> pnpm seed:reference` → verify post-run counts.

## Out of scope

Deploying the latest master (Vercel web + API) to prod so the admin shows the live counts + drawer. The data load makes the data exist; the deploy makes the prod code use it — separate follow-up.
