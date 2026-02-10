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
- Payment purchase intents and webhook processing are DB-backed with signature verification, webhook-event dedupe, and idempotent wallet credit posting.
- In-memory fallback remains for non-configured local development bootstrap.
- Worker process is DB-backed for 12-hour refund sweep scheduling.
- Worker process dispatches outbound CRM lead events with retry/backoff semantics.
- Owner/admin UI now uses contract-accurate request builders and response mappers to avoid route drift.

## Jobs

- refund_due_unlocks: every 5 min
- dispatch_outbound_events: every 1 min

## Persistence notes

- Unlock/refund lifecycle persists across:
  - `wallet_transactions`
  - `contact_unlocks`
  - `contact_events`
- Payment lifecycle persists across:
  - `payment_orders`
  - `payment_webhook_events`
  - `wallet_transactions` (`purchase_pack` ledger entries)
- Sales lead lifecycle persists across:
  - `sales_leads`
  - `outbound_events`
- Photo upload idempotency responses are persisted in `idempotency_keys`.
- Verification attempts persist with threshold scores and admin-review state transitions.

## Security

- OTP rate limiting and lockouts
- Idempotency keys on unlock/upload/payment-intents
- RBAC for owner/pg/admin scoped endpoints
- Structured audit trail for admin actions

## Testability

- Playwright suites use OTP-authenticated setup and localStorage session injection (`cribliv:auth-session`) to test protected owner/admin pages end-to-end.
