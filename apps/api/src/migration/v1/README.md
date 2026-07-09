# v1 → v2 listing migration

Migrates VERIFIED v1 listings (MongoDB `properties` / `pgs` collections) into the v2
Postgres schema, and copies their photos from Cloudinary to Azure Blob Storage.

Built on the same safety pattern as `data/seeds/load-city.ts`:

- **Dry-run by default.** Every run is wrapped in `BEGIN … ROLLBACK` unless you pass
  `--apply`, in which case it `COMMIT`s instead.
- **No `.env` reads.** All config comes from explicit environment variables passed on
  the command line. This script will never accidentally pick up `apps/api/.env`
  (which points at Azure production) — you must set `DATABASE_URL` (and the other
  required vars) yourself, every time.
- **Masked logging.** The target DB host is logged with credentials masked
  (`postgres://***@host/db`), never the raw connection string.

## Required environment variables

| Variable                                 | Required                            | Notes                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                           | always                              | v2 Postgres target. Never sourced from `.env` — pass it explicitly.                                                                                                                 |
| `MONGO_URL`                              | always                              | v1 MongoDB connection string. **Read-only** — this script only ever reads from Mongo, it never writes back to v1. Use a read-only user/connection string if you have one available. |
| `MONGO_DB`                               | optional (default `test`)           | v1 database name.                                                                                                                                                                   |
| `CLOUDINARY_CLOUD_NAME`                  | always                              | Source cloud for v1 listing photos (prod: `dia01qg8p`).                                                                                                                             |
| `EXCEL_PATH`                             | optional                            | Path to the supplementary Excel reference sheet, if used.                                                                                                                           |
| `AZURE_STORAGE_ACCOUNT_NAME`             | required unless `--skip-photos`     | Destination for copied photos.                                                                                                                                                      |
| `AZURE_STORAGE_ACCOUNT_KEY`              | required unless `--skip-photos`     | Destination for copied photos.                                                                                                                                                      |
| `AZURE_STORAGE_CONTAINER_LISTING_PHOTOS` | optional (default `listing-photos`) | Destination container.                                                                                                                                                              |

## Flags

- `--apply` — commit the transaction instead of rolling it back. Omit for a dry-run.
- `--collection properties|pgs|both` — scope the run to one v1 collection. Defaults to `both`.
- `--skip-photos` — skip the Azure Blob photo copy step. Azure Blob writes are **not**
  transactional (an upload sticks even if the Postgres side rolls back), so use this
  flag for local dry-run validation to keep prod Azure storage clean until cutover.
  When set, Azure credentials are not required.

## Run order

1. **Local dry-run** — validate against your local Postgres, with `--skip-photos` so
   nothing touches Azure:

   ```bash
   export DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2"
   export MONGO_URL="mongodb://<read-only-v1-mongo-connection-string>"
   export MONGO_DB="test"
   export CLOUDINARY_CLOUD_NAME="dia01qg8p"
   cd apps/api && pnpm migrate:v1 --skip-photos
   ```

2. **Local apply** — once the dry-run output looks correct, commit it locally:

   ```bash
   cd apps/api && pnpm migrate:v1 --skip-photos --apply
   ```

3. **Prod apply** — run by the user only, against the real `DATABASE_URL` (Azure
   production) and with photo copying enabled:

   ```bash
   export DATABASE_URL="<azure production DATABASE_URL>"
   export MONGO_URL="mongodb://<read-only-v1-mongo-connection-string>"
   export MONGO_DB="test"
   export CLOUDINARY_CLOUD_NAME="dia01qg8p"
   export AZURE_STORAGE_ACCOUNT_NAME="<prod storage account>"
   export AZURE_STORAGE_ACCOUNT_KEY="<prod storage key>"
   cd apps/api && pnpm migrate:v1 --apply
   ```

Never commit a file containing these values — always export them inline in the shell
for the single run, as shown above.

### Reminder: `MONGO_URL` is read-only

This script only reads from v1 MongoDB — it never writes, updates, or deletes
anything there. Point `MONGO_URL` at a read-only connection/user where possible so a
bug here can't touch v1 data.
