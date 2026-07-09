# Prod runbook — v1 → v2 listing migration

**You run every command here** (the sandbox is blocked from prod writes). Each step is **dry-run first → review → `--apply`**. Nothing writes until you add `--apply`.

Validated identically on local first: 67 flats + 19 PGs migrated, amenities/geo/rooms/owners correct, idempotent, fakes purged → 86 listings only.

## Key differences from local

- **`DATABASE_URL` = your PROD Azure connection string** (the one in `apps/api/.env` — the `…postgres.database.azure.com…` host). Set it explicitly on each command.
- **Photos ON** — do NOT pass `--skip-photos` on the migrate steps. This copies the Cloudinary photos into Azure (`criblivimgstorage/listing-photos`). Needs the real Azure key.
- **PostGIS is present on prod** → `geo_point` populates (map pins work). Local skipped it.

Export the shared env once per shell (fill in the two secrets):

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master/apps/api
export DATABASE_URL="<PROD Azure DATABASE_URL>"
export MONGO_URL="<READ-ONLY mongo connection string>"
export MONGO_DB="test"
export CLOUDINARY_CLOUD_NAME="dia01qg8p"
export EXCEL_PATH="/Users/aryantripathi/Downloads/Cribliv_Property_Location.xlsx"
export AZURE_STORAGE_ACCOUNT_NAME="criblivimgstorage"
export AZURE_STORAGE_ACCOUNT_KEY="<Azure key from apps/api/.env>"
```

## Step 0 — apply migration 0052 to prod

Creates the `v1_migration_map` table (idempotent; also applies any pending earlier migration).

```bash
DATABASE_URL="$DATABASE_URL" node ../../infra/migrations/run-migrations.js
# verify:
psql "$DATABASE_URL" -c "\d v1_migration_map"
```

## Step 1 — flats

**Dry-run with `--skip-photos`** (fast — validates the DB mapping in seconds without copying photos), then **apply WITHOUT `--skip-photos`** so photos copy exactly once. (Running the dry-run with photos ON would upload every photo, roll the DB back, then re-upload on apply — double the slow part.)

```bash
# DRY-RUN — fast DB validation (expect migrated ~67, owner source {mongo:...})
pnpm migrate:v1 --collection properties --skip-photos
# APPLY — copies Cloudinary→Azure photos (the slow step; watch photos ok/fail)
pnpm migrate:v1 --collection properties --apply
```

Watch **`photos ok/fail`** on the apply — this is the first real Cloudinary→Azure copy. A few failures are logged per-photo and are non-fatal (re-runnable). `unmapped amenities: Park` lines are expected.

## Step 2 — PGs

```bash
pnpm migrate:v1 --collection pgs --skip-photos   # dry-run (fast)
pnpm migrate:v1 --collection pgs --apply         # apply (photos copy)
```

Expected `unmapped amenities: Room Heater` on ~3 PGs (no v2 code — intended).

## Step 3 — purge the fakes ⚠️

Removes every listing **not** in `v1_migration_map`. On prod that's the pre-existing test listings.

```bash
# DRY-RUN — READ THE "to delete (fake): N" COUNT AND THE TYPE/STATUS BREAKDOWN CAREFULLY.
pnpm migrate:v1 --purge --skip-photos
# Only if the count matches what you expect to remove:
pnpm migrate:v1 --purge --skip-photos --apply
```

**⚠️ The purge deletes ALL non-migrated listings.** It's guarded (aborts if the migration map has <50 rows), but the guard only protects against running it _before_ the migration — it does NOT distinguish "test fake" from "a real listing someone created after cutover." Run the purge **only** right after the migration, before any organic v2 listings exist. Always eyeball the dry-run `to delete` count first.

## Step 4 — verify prod

```bash
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT count(*) FROM v1_migration_map) map,
    (SELECT count(*) FROM listings) listings,
    (SELECT count(*) FROM listings WHERE id NOT IN (SELECT v2_listing_id FROM v1_migration_map)) fakes,
    (SELECT count(*) FROM listing_locations WHERE geo_point IS NOT NULL) with_geopoint;"
# expect: map=86, listings=86, fakes=0, with_geopoint≈86 (PostGIS populated on prod — this path never ran locally)
```

Then open a few listing pages on the prod site — confirm photos load (Azure), amenities render, map pins show (PostGIS geo), and contact-unlock reveals the owner.

## Re-runs are safe (with one caveat)

Everything is idempotent (keyed on `v1_id`). Re-running `--apply` UPDATEs in place (never duplicates) and re-copies only missing photos. A second `--purge --apply` deletes nothing (fakes already gone).

**Caveat — re-runs do NOT reassign ownership.** The UPDATE path refreshes content (title, rent, amenities, geo, photos) but does not change `owner_user_id`. So get owners right on the **first** apply: verify the dry-run's `owner source` line reads `{mongo:86}` (or that any `excel`/`import_fallback` rows are the ones you intend) BEFORE you `--apply`. For our data it's 100% `mongo`, so this is just a confirmation. If a listing ever lands under `import_fallback` and you later fix its phone, reassigning the owner is a manual `UPDATE listings SET owner_user_id = … WHERE id = …`, not a re-run.

## Rollback (if needed)

- Migration table: `psql "$DATABASE_URL" -f ../../infra/migrations/0052_v1_migration_map.rollback.sql` (drops `v1_migration_map`; do this only if abandoning the migration — it removes the idempotency/301 map).
- Migrated listings: delete by joining `v1_migration_map` (the map is the record of exactly what this migration created).

## Follow-ups (post-cutover, separate)

- **301 redirect map:** generate from `v1_migration_map` + the GSC Pages export (old `/properties/…-<id>` & `/pgs/…-<id>` → v2 `/listing/<id>` & `/pg/<city>/<id>`).
- **Review the 5 flagged duplicate flats** in the v2 admin (Parag Road, Rashmi Khand, LDA Sector-F, Takrohi×3) — hide/merge before launch.
- Add Varanasi to `seo_city_config` when enabling programmatic SEO there.
