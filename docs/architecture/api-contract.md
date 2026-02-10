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
- Payment purchase intents and webhooks (signature-verified, idempotent)

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
- `POST /v1/wallet/purchase-intents` now persists idempotent order records in `payment_orders`:
  - Requires `Idempotency-Key`.
  - Same user + same key returns the same order response.
  - Plan validation is allowlisted (`starter_10`, `growth_20`).
- `POST /v1/webhooks/razorpay` and `POST /v1/webhooks/upi` now:
  - Verify HMAC signatures.
  - Persist deduplicated receipts to `payment_webhook_events`.
  - Atomically transition payment status and post `purchase_pack` wallet credits on capture events.
  - Prevent double-crediting on webhook replay via DB idempotency keys.
- `POST /v1/sales/leads` now captures PG sales-assist/property-management leads with idempotency.
- `GET /v1/admin/leads` and `POST /v1/admin/leads/{lead_id}/status` provide admin lead queue operations.
- `GET /v1/listings/search/filters-metadata` provides dynamic city/locality/filter metadata.
- Verification responses now expose provider audit fields:
  - `provider`
  - `provider_reference`
  - `provider_result_code`
  - `review_reason`
  - `retryable`
- Verification policy is admin-finalized:
  - automated provider outcomes (`pass`, `manual_review`, `fail`) keep listing `verification_status = pending`
  - final `verified`/`failed` status is set by admin verification decision endpoint
- Provider audit payloads are persisted in masked form in `verification_provider_logs` to avoid raw PII storage.

## Frontend contract alignment (implemented)

- Owner/Admin pages no longer consume raw endpoint payloads directly.
- Typed adapters now map request/response contracts and normalize naming differences:
  - `apps/web/lib/owner-api.ts`
  - `apps/web/lib/admin-api.ts`
- Idempotency header behavior for owner photo flows is centralized in adapter calls.
- Contract mismatches (snake_case vs camelCase and endpoint payload differences) are documented in `docs/architecture/frontend-api-mapping.md`.
