# Cribliv v2 Launch Scope (MVP)

## In Scope

- DB-first runtime behavior for production environments.
- Tenant wallet + purchase intents + webhook credit posting reliability.
- Owner verification flow with provider adapters and heuristic fallback.
- PG segmentation with sales lead creation and admin lead management.
- Search/listing trust baseline filters and metadata endpoint.
- Admin review operations + auditable lead/verification trails.

## Out of Scope

- Real-time in-app chat.
- Digital rent agreement, e-stamp, and Aadhaar e-sign.
- Full commute/family/lifestyle filter matrix.
- Bi-directional CRM sync.

## Production Defaults

- `FF_PRODUCTION_DB_ONLY=true`
- `FF_PG_SALES_LEADS=true`
- `FF_REAL_VERIFICATION_PROVIDER=false` (enable after provider credentials are ready)

## Staging Checklist

1. `docker compose -f infra/docker-compose.yml up -d`
2. `pnpm db:migrate`
3. `pnpm db:seed`
4. `pnpm --filter @cribliv/api typecheck`
5. `pnpm --filter @cribliv/api test`
6. `pnpm --filter @cribliv/web typecheck`
7. `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test`
8. Verify `GET /v1/health` returns `"db":"up"`.
9. Verify one PG sales lead creates:
   - `sales_leads` row
   - `outbound_events` row (`crm.sales_lead.created`).
