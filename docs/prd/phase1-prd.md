# Cribliv v2 Phase 1 PRD (Weeks 1-2)

## Scope Freeze

- Market: North India (Delhi, Gurugram, Noida, Ghaziabad, Faridabad, Chandigarh, Jaipur, Lucknow)
- Target: 30-40 users, trust-sensitive, WhatsApp-heavy, Hindi/Hinglish comfortable
- Platform: Web-first responsive
- Auth: OTP only for high-intent actions
- Monetization: 2 signup credits, 1 credit unlock, auto-refund if no owner response in 12h

## In Scope (MVP)

- Guest browsing (home, city, search, listing detail)
- Agentic route parser (Hindi/Hinglish/English)
- OTP send/verify/login session
- Contact unlock with idempotency and credits
- Owner listing wizard + verification submissions
- Admin review queues
- Refund worker and audit logs

## Out of Scope

- In-app chat
- Native apps
- Broker marketplace
- Dynamic pricing

## NFR

- LCP <= 2.5s p75
- API p95 <= 400ms for reads
- SSR SEO pages and canonical URLs
- OTP abuse control, RBAC, audit logging
- Bilingual EN/HI core flows
