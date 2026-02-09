# Cribliv v2 Architecture (Phase 1)

## System

- Next.js web frontend (SSR + CSR hybrid)
- NestJS modular monolith API
- Postgres primary datastore
- Blob storage for media artifacts
- Worker process for refund and async jobs
- Frontend API adapter layer for contract normalization (`owner-api` and `admin-api`)

## Backend Modules

- auth, users, search, listings, shortlist, wallet, contacts
- owner, verification, pg, admin, payments, audit
- health (readiness probe + DB status)

## Phase 1 implementation status (current)

- Auth, search, listing-detail, shortlist, owner listing write flows, verification, wallet, contact unlocks, and admin review paths are wired for **DB-first behavior** when `DATABASE_URL` is set.
- In-memory fallback remains for non-configured local development bootstrap.
- Worker process is DB-backed for 12-hour refund sweep scheduling.
- Owner/admin UI now uses contract-accurate request builders and response mappers to avoid route drift.

## Jobs

- refund_due_unlocks: every 5 min
- process_verification_attempt: on submission
- router_fallback_log: on timeout/error

## Persistence notes

- Unlock/refund lifecycle persists across:
  - `wallet_transactions`
  - `contact_unlocks`
  - `contact_events`
- Photo upload idempotency responses are persisted in `idempotency_keys`.
- Verification attempts persist with threshold scores and admin-review state transitions.

## Security

- OTP rate limiting and lockouts
- Idempotency keys on unlock/upload/payment-intents
- RBAC for owner/pg/admin scoped endpoints
- Structured audit trail for admin actions

## Testability

- Playwright suites use OTP-authenticated setup and localStorage session injection (`cribliv:auth-session`) to test protected owner/admin pages end-to-end.
