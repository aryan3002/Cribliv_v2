# Data Model (Postgres)

Implemented in `infra/migrations/0001_init.sql`.

## Core tables

- users, sessions, otp_challenges
- cities, localities
- listings, listing_locations, listing_photos, pg_details
- verification_attempts
- wallets, wallet_transactions
- contact_unlocks, contact_events
- shortlists
- admin_actions, audit_logs
- payment_orders, payment_webhook_events

## ERD Narrative

- One owner user -> many listings
- One listing -> one listing_location and many listing_photos
- PG listings -> optional one pg_details row
- One tenant -> one wallet -> many wallet_transactions
- Contact unlock links tenant + listing + debit txn (+ optional refund txn)
- Verification attempts link owner and listing and may be admin-reviewed
- Admin decisions are captured in admin_actions + audit_logs
