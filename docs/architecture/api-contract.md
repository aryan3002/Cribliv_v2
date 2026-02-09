# API Contract

OpenAPI skeleton: `apps/api/openapi.yaml`
Frontend mapping matrix: `docs/architecture/frontend-api-mapping.md`

All required Phase 1 endpoint groups are present and implemented with DB-first behavior:

- Auth and profile
- Agentic router + search + listing detail
- Shortlist CRUD
- Tenant unlock + wallet
- Owner listing + photos + verification
- Owner response tracking for refund logic
- PG segmentation
- Admin review and wallet adjust
- Payment webhooks placeholders

## DB-backed status (implemented)

- `POST /v1/tenant/contact-unlocks` now runs in a Postgres transaction:
  - Requires `Idempotency-Key`.
  - One debit txn max per idempotency key.
  - Persists `contact_unlocks` and `contact_events`.
  - Sets `response_deadline_at = unlock_time + 12h`.
- `POST /v1/owner/contact-unlocks/{unlock_id}/responded` persists owner response and event logs.
- Refund worker (`apps/api/src/worker/worker.ts`) scans due unlocks and posts exactly one refund txn per timeout unlock.
- `GET/POST/DELETE /v1/shortlist` now reads/writes `shortlists` table.
- Owner listing write endpoints now persist to:
  - `listings`
  - `listing_locations`
  - `pg_details` (PG type)
  - `listing_photos` (`client_upload_id` uniqueness enforced)
- Owner photo upload flows are idempotent via `idempotency_keys` table.
- Verification endpoints now persist `verification_attempts` and update `listings.verification_status`.
- Admin review endpoints now read/write DB state for listings, verifications, and wallet adjustments.

## Frontend contract alignment (implemented)

- Owner/Admin pages no longer consume raw endpoint payloads directly.
- Typed adapters now map request/response contracts and normalize naming differences:
  - `apps/web/lib/owner-api.ts`
  - `apps/web/lib/admin-api.ts`
- Idempotency header behavior for owner photo flows is centralized in adapter calls.
- Contract mismatches (snake_case vs camelCase and endpoint payload differences) are documented in `docs/architecture/frontend-api-mapping.md`.
