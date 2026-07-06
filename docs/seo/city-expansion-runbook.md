# City-wise SEO Expansion — Runbook & Automation Plan

How to add a new city to the programmatic-SEO system, and how to turn the manual
CLI pipeline into a one-click admin workflow.

**Status:** live cities = **Lucknow** (reference), **Noida** (added via this pipeline, 2026-07-06). Next per the plan: Gurugram → Ghaziabad → Faridabad (NCR belt).

---

## 1. How it works (the mental model)

Each city goes through four stages. Today stages 1–3 are CLI scripts; stage 4 is the admin toggle.

```
  generate            review              load                 enable
 ─────────────       ──────────         ───────────          ──────────
 AI draft +          human eyeballs     upsert into          flip programmatic_
 Google verify   →   the JSON diff,  →  the prod DB      →    enabled=true in the
 → JSON files        fix junk           (upsert-only)         admin (pages go live)
```

- **Data model:** localities live in the shared `data/seeds/localities.json` (keyed by `city_slug`); micro-localities and landmarks are per-city in `data/seeds/<slug>/`.
- **DB tables:** `localities` (top-level + micro via `parent_locality_id`), `landmarks`, `metro_stations`, `seo_city_config` (the enable flags + denormalized counts).
- **Live ≠ indexable:** enabling makes pages _render_; a page is only allowed into the sitemap / `index` once its locality has **≥3 real listings**. Below that it renders `noindex` (thin-content guard). So SEO payoff needs supply, not just data.
- **Model:** `cribliv-chat` Azure deployment = **GPT-4.1**. Good; don't change it.

Key files:

- `data/seeds/generate-city.ts` + `generate-city-helpers.ts` — the generator
- `data/seeds/load-city.ts` — safe single-city prod loader (`pnpm load:city`)
- `apps/api/src/modules/seo/*` + `apps/api/src/modules/admin/admin-seo.controller.ts` — API
- `apps/web/app/[locale]/city/[citySlug]/**` — the 6 page templates

---

## 2. One-time prerequisites

Both live in `apps/api/.env` (which points at **prod** — see note in §5).

### Azure OpenAI (drafting)

- `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_CHAT_DEPLOYMENT=cribliv-chat`.
- If the key rotates, pull the current one:
  `az cognitiveservices account keys list -n cribliv2-openai -g Cribliv --query key1 -o tsv`

### Google Maps (verification)

- `GOOGLE_MAPS_APIKEY` (server key). On its Google Cloud project you must enable:
  **Geocoding API** and **Distance Matrix API** (server), plus **Maps JavaScript API** + **Places API** (browser, used by the site).
- **Billing must be enabled** on the project, and the server key must have **no HTTP-referrer restriction** (referrer-restricted keys reject server-side Geocoding).

> Full Google setup detail is in the commit history / team notes; the short version: Geocoding API + Distance Matrix API on, billing on, server key unrestricted.

---

## 3. Runbook — add a new city (example: `gurugram`)

### Step 1 — Generate

```bash
cd <repo root>
# NOTE the `env -u AZURE_OPENAI_API_KEY`: a stale key is often exported in the
# shell and dotenv WON'T override it, causing a silent 401 → "zero candidates".
env -u AZURE_OPENAI_API_KEY pnpm generate:city --city gurugram
```

This drafts localities/micro-localities/landmarks with GPT-4.1, verifies every
candidate against Google Geocoding, drops anything unverifiable, and writes:

- `data/seeds/localities.json` (merged — new city's rows appended)
- `data/seeds/gurugram/micro-localities.json`, `landmarks.json`

If the city isn't in `data/seeds/cities.json` yet, add it there first (slug, name_en/hi, state_en/hi).

### Step 2 — Review (do NOT skip)

The generator prints _"REVIEW THE GIT DIFF before committing."_ Check the new city's rows:

```bash
# counts + quality
node -e 'const a=require("./data/seeds/localities.json").filter(x=>x.city_slug==="gurugram");
console.log("localities:",a.length,
 "| with lat/lng:",a.filter(x=>x.lat&&x.lng).length,
 "| Devanagari:",a.filter(x=>/[ऀ-ॿ]/.test(x.name_hi||"")).length)'

# find bogus geocodes: multiple localities sharing ONE coordinate = Google
# fallback for a place that does not exist (e.g. sectors beyond what exists)
node -e 'const a=require("./data/seeds/localities.json").filter(x=>x.city_slug==="gurugram");
const m={};a.forEach(x=>{const k=x.lat.toFixed(5)+","+x.lng.toFixed(5);(m[k]=m[k]||[]).push(x.slug)});
Object.entries(m).filter(([,v])=>v.length>1).forEach(([k,v])=>console.log(v.length,"@",k,":",v.join(", ")))'
```

Remove any collision-cluster slugs (they're phantom entries). Also eyeball a few
`name_en`/`name_hi` pairs. See the Noida case: GPT over-enumerated sectors 169–177
which don't exist, and Google mapped all 9 to one point 400km away — we deleted them.

### Step 3 — Load into the DB (prod)

```bash
# DRY-RUN first — connects, prints BEFORE/AFTER/DELTA, then ROLLS BACK (no writes).
DATABASE_URL="$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')" \
  pnpm load:city --city gurugram

# Review the DELTA line (localities/landmarks should jump; users MUST be 0), then apply:
DATABASE_URL="$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')" \
  pnpm load:city --city gurugram --apply
```

`load:city` is **upsert-only, single-city, transactional**. It never deletes, never
touches other cities/users/metro/enable-flags, and aborts if the user count changes.
Prefer it over `pnpm db:seed`/`seed:reference` for prod (those are broader; the seed's
metro block does a destructive DELETE+reinsert).

### Step 4 — Commit + PR

```bash
git checkout -b feat/seo-gurugram-city-data origin/master
git add data/seeds/localities.json data/seeds/gurugram/
git commit -m "feat(seo): Gurugram city data (<N> localities)"
git push -u origin HEAD && gh pr create --base master --fill
# wait for the `validate` check, then: gh pr merge <#> --squash --delete-branch
```

### Step 5 — Enable in the admin

Admin → **Programmatic SEO** → refresh → the city shows its counts → click **Enable**.
Optionally preview a page first: `/en/city/gurugram/<locality>?adminPreview=1`.

---

## 4. Troubleshooting (every issue we actually hit)

| Symptom                                     | Cause                                                                 | Fix                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `AI draft returned zero candidates`         | Stale `AZURE_OPENAI_API_KEY` exported in shell overrides `.env` → 401 | Run with `env -u AZURE_OPENAI_API_KEY` (or `unset` it)                |
| `zero candidates`, draft took ~40s          | Output truncated at token cap → invalid JSON                          | Already fixed: `max_tokens=16384`. Very large cities: raise further   |
| `zero candidates`, request aborted ~30s     | AI timeout too low for exhaustive draft                               | Already fixed: default 120s. Override with `SEO_GENERATE_TIMEOUT_MS`  |
| Only ~20 localities for a big city          | Prompt asked for "well-known" only                                    | Already fixed: exhaustive-coverage prompt. Re-run to accumulate more  |
| `REQUEST_DENIED: This API is not activated` | Geocoding API not enabled on the key's project                        | Enable Geocoding API on that project                                  |
| `REQUEST_DENIED: enable Billing`            | No billing account on the project                                     | Attach billing                                                        |
| `REQUEST_DENIED: referer restrictions`      | Server key has an HTTP-referrer restriction                           | Set the key's application restriction to None/IP                      |
| `column "geo_point" does not exist`         | PostGIS wasn't installed when 0009/0027 ran                           | Fixed by migration `0044`. New DBs are fine                           |
| Loader: `current transaction is aborted`    | A statement failed inside the txn                                     | Loader now SAVEPOINTs the geo backfill; check the real error above it |

---

## 5. Important environment notes

- **`apps/api/.env` `DATABASE_URL` points at PROD** (`cribliv-db.postgres.database.azure.com`). So `pnpm load:city` / `db:migrate` with that URL hit production. There is no local DB by default. Consider a local Docker Postgres before real users arrive.
- The v2 prod DB currently holds **test accounts only** — real traction is on the separate v1 site.
- The sandbox blocks an AI agent from pulling the prod DB password; a human runs the prod steps (or grants a permission rule).

---

## 6. Automating this through the admin panel (proposed)

Goal: an admin adds a city and reviews/approves candidates **in the UI** — no CLI, no
JSON files, no manual DB writes. Keep the human-review gate; remove the plumbing.

### Target flow

```
 [Admin] Add city "Gurugram"
    │  POST /admin/seo/cities/gurugram/generate   (async job)
    ▼
 API runs draftCity() + verifyPlace()  ── reuse data/seeds/generate-city-helpers.ts
    │  writes rows to a NEW staging table: seo_city_candidates (status='pending')
    ▼
 [Admin] Review drawer shows staged candidates, auto-flagged:
    • coordinate-collision clusters (phantom geocodes)  ← auto-detected
    • missing Hindi / missing pincode
    Admin bulk-approves / rejects individual rows.
    │  PATCH /admin/seo/candidates/:id { status: approved|rejected }
    ▼
 [Admin] "Approve & Load"
    │  POST /admin/seo/cities/gurugram/publish
    │  upserts approved candidates → localities/landmarks (reuse load-city logic)
    ▼
 [Admin] "Enable"  ← the existing toggle. Done.
```

### What to build (phased)

**Phase A — server-side generation (removes steps 1–2 CLI)**

1. Migration: `seo_city_candidates` table — `(id, city_slug, kind[locality|micro|landmark], slug, name_en, name_hi, lat, lng, extra jsonb, status[pending|approved|rejected], flags text[], created_at)`.
2. Refactor: make `draftCity()` / `verifyPlace()` importable by the API (they're already pure functions in `generate-city-helpers.ts`; the API can call them directly).
3. Endpoint `POST /admin/seo/cities/:slug/generate` → runs draft+verify, inserts candidates with `status='pending'`, auto-computes `flags` (collision clusters, missing fields). **Run async** — generation is ~40s + geocoding; use the existing worker/queue or a job row the UI polls (don't block the HTTP request).

**Phase B — review UI (removes step 2 fully)** 4. Extend `SeoCityReviewDrawer.tsx` to list `pending` candidates with the auto-flags surfaced, per-row approve/reject, bulk actions, and the `?adminPreview=1` preview links it already has. 5. Endpoints: `GET /admin/seo/cities/:slug/candidates`, `PATCH /admin/seo/candidates/:id`.

**Phase C — publish (removes step 3 CLI)** 6. Endpoint `POST /admin/seo/cities/:slug/publish` → upserts **approved** candidates into `localities`/`landmarks` using the exact upsert-only, transactional logic from `load-city.ts` (no deletes, geo_point backfill via SAVEPOINT). Refreshes `seo_city_config` counts. 7. The existing **Enable** toggle stays as the final live switch.

### Design decisions / guardrails to keep

- **Keep the human gate.** Auto-publishing unreviewed AI output is how the phantom-sector junk would reach the live site. The admin still approves.
- **Async generation.** ~1 min per city → job + polling, not a blocking request. Reuse the worker (`apps/api/src/worker/`).
- **Server-side data path.** Candidates live in the DB (`seo_city_candidates`), not JSON files. Optionally still emit JSON for git history, but the DB is the source of truth for the workflow.
- **Upsert-only publish.** Never delete; safe to re-run.
- **Secrets stay server-side.** Azure/Google keys are already in the API env — generation from the API means no local `.env` juggling.

### Effort estimate

- Phase A: 1 migration + 1 endpoint + async job wiring (~1–2 days).
- Phase B: drawer extension + 2 endpoints (~1–2 days).
- Phase C: 1 endpoint reusing load-city logic (~0.5 day).

This is a good candidate for its own spec → plan → implementation cycle.
